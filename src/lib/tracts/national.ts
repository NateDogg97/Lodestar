/**
 * Areas as the results (plan §9 Phase 8f): every US area scored on one search.
 *
 * An area's match = one weighted average over all the search's priorities:
 * - county-level ones (climate, taxes, cost of living…) at its county's national
 *   percentile — every area in a county shares that part (`countyParts`);
 * - area-level ones at the area's national percentile among all US areas.
 * County-level must-haves gate whole counties (as before); area-level ones gate
 * areas. Results are the top N areas; counties are ranked by their best area.
 *
 * Data: `areas.json` from `etl/tracts/national.py`, column by column. Pure.
 *
 * Results audit (2026-10-04) rules, so results never mislead:
 * - A weighted priority with no value counts as average (50 points), never dropped.
 * - Places nobody lives (50 residents or fewer: water, airports, parks), or that are
 *   mostly group quarters (bases, campuses, prisons), aren't results.
 * - A home value from mostly mobile homes is flagged and never wins "cheapest homes".
 * - An area unknown for a must-have ranks after every verified match.
 * - A value scores as at least as good as the values it ties with (best value = 100).
 * - Zero violent AND zero property crime is no report, not a perfect record.
 *
 * Full audit (2026-10-04):
 * - National percentiles are over the areas that can be results: places nobody lives
 *   (`notResidential`) are left out of the distribution too, not just the list — they
 *   held half the bottom 1% of density and a fifth of the bottom 1% of walkability.
 * - A county-wide priority the county has no value for counts as average (50), like an
 *   area one (`countyParts` used to drop it).
 * - Each part says whether its value is low confidence (`flagged`), so lists can show it.
 */

import {
  beatsAt,
  directionalScore,
  getMetric,
  percentileBounds,
  percentileRanks,
  type PercentileBounds,
  type CountyScore,
  type Direction,
  type MetricKey,
} from "@/lib/scoring";

import { areaPriority, type AreaCriterion, type AreaLimit } from "./scoring";

export const AREAS_FORMAT = "areas-v1";

export interface NationalAreas {
  n: number;
  geoid: string[];
  /** County FIPS of each area (the geoid's first five digits). */
  county: string[];
  label: string[];
  /** The label, told apart from areas that share it ("Grand Forks · 58201 · north"): what lists show. */
  name: string[];
  lowConfidence: string[][];
  population: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Every numeric column, NaN where unknown. */
  values: Map<string, Float64Array>;
}

export function parseNationalAreas(raw: unknown): NationalAreas {
  const p = raw as { format?: string; n?: number; columns?: Record<string, unknown[]> };
  if (!p || p.format !== AREAS_FORMAT || !p.columns || typeof p.n !== "number") {
    throw new Error(`areas.json: expected format ${AREAS_FORMAT}`);
  }
  const n = p.n;
  const cols = p.columns;
  const text = (c: string) => (cols[c] ?? []).map((v) => (v === null || v === undefined ? "" : String(v)));
  const nums = (c: string) => Float64Array.from({ length: n }, (_, i) => {
    const v = cols[c]?.[i];
    return typeof v === "number" ? v : NaN;
  });
  const values = new Map<string, Float64Array>();
  for (const c of Object.keys(cols)) {
    if (c !== "geoid" && c !== "label" && c !== "low_confidence") values.set(c, nums(c));
  }
  // Zero violent and zero property crime for a whole area is an agency that reported
  // nothing (106 of the 108 such areas are flagged low confidence): no data.
  const violent = values.get("violent_rate");
  const property = values.get("property_rate");
  if (violent && property) {
    for (let i = 0; i < n; i++) {
      if (violent[i] === 0 && property[i] === 0) violent[i] = property[i] = NaN;
    }
  }
  const geoid = text("geoid");
  const label = text("label");
  const lat = values.get("pop_lat") ?? new Float64Array(n).fill(NaN);
  const lon = values.get("pop_lon") ?? new Float64Array(n).fill(NaN);
  return {
    n,
    geoid,
    county: geoid.map((g) => g.slice(0, 5)),
    label,
    name: distinctNames(label, lat, lon),
    lowConfidence: text("low_confidence").map((s) => (s ? s.split(";").filter(Boolean) : [])),
    population: values.get("population") ?? new Float64Array(n).fill(NaN),
    lat,
    lon,
    values,
  };
}

const COMPASS = ["east", "northeast", "north", "northwest", "west", "southwest", "south", "southeast"];

/**
 * Names that tell areas apart: many share a label (a ZIP or neighborhood covers
 * several census tracts), so those get their direction from the group's middle —
 * "Grand Forks · 58201 · north" — and a number if that still repeats.
 */
export function distinctNames(label: string[], lat: Float64Array, lon: Float64Array): string[] {
  const groups = new Map<string, number[]>();
  label.forEach((l, i) => {
    const g = groups.get(l);
    if (g) g.push(i);
    else groups.set(l, [i]);
  });
  const name = [...label];
  for (const [l, idx] of groups) {
    if (idx.length < 2) continue;
    const known = idx.filter((i) => Number.isFinite(lat[i]) && Number.isFinite(lon[i]));
    const clat = known.reduce((a, i) => a + lat[i], 0) / (known.length || 1);
    const clon = known.reduce((a, i) => a + lon[i], 0) / (known.length || 1);
    const k = Math.cos((clat * Math.PI) / 180);
    const off = idx.map((i) => {
      const dx = (lon[i] - clon) * k;
      const dy = lat[i] - clat;
      return { i, d: Math.hypot(dx, dy), a: Math.atan2(dy, dx) };
    });
    const far = Math.max(...off.map((o) => (Number.isFinite(o.d) ? o.d : 0)));
    const used = new Map<string, number>();
    for (const o of off.sort((a, b) => a.d - b.d)) {
      const dir = !Number.isFinite(o.d)
        ? "area"
        : o.d <= far * 0.25
          ? "central"
          : COMPASS[Math.round(((o.a + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8];
      const n = (used.get(dir) ?? 0) + 1;
      used.set(dir, n);
      name[o.i] = `${l} · ${dir}${n > 1 ? ` ${n}` : ""}`;
    }
  }
  return name;
}

/** Fewer people than this and an area isn't a place to move to (water, airports, parks). */
export const MIN_RESIDENTS = 51;

/** Mostly this share of people in group quarters (barracks, dorms, prisons, nursing homes). */
export const MAX_GROUP_QUARTERS = 50;

/**
 * Not a place to move to, so never a result: 50 or fewer residents (water, airports,
 * parks), or mostly group quarters — a military base, a campus, a prison (results audit).
 */
export const notResidential = (areas: NationalAreas, i: number) =>
  !(areas.population[i] >= MIN_RESIDENTS) || (areas.values.get("group_quarters_share")?.[i] ?? 0) >= MAX_GROUP_QUARTERS;

/** Most owned homes are mobile homes: the home value is real but isn't a house price. */
export const mostlyMobileHomes = (areas: NationalAreas, i: number) => areas.lowConfidence[i].includes("mobile_homes");

const pctCache = new WeakMap<NationalAreas, Map<string, Float64Array>>();
const boundsCache = new WeakMap<NationalAreas, Map<string, PercentileBounds>>();
const rankedCache = new WeakMap<NationalAreas, Map<string, Float64Array>>();

/**
 * The column as the percentiles see it: places that can't be results (`notResidential`)
 * are NaN, so they take no part in anyone's rank — the distribution is of the places a
 * person could move to. (Their own points come out NaN; they're never listed.)
 */
function rankedColumn(areas: NationalAreas, column: string): Float64Array {
  let cache = rankedCache.get(areas);
  if (!cache) rankedCache.set(areas, (cache = new Map()));
  let v = cache.get(column);
  if (!v) {
    const src = areas.values.get(column);
    v = new Float64Array(areas.n).fill(NaN);
    if (src) for (let i = 0; i < areas.n; i++) if (!notResidential(areas, i)) v[i] = src[i];
    cache.set(column, v);
  }
  return v;
}

/** An area-level column's tie groups, for points (see `percentileBounds`), computed once. */
export function areaBounds(areas: NationalAreas, column: string): PercentileBounds {
  let cache = boundsCache.get(areas);
  if (!cache) boundsCache.set(areas, (cache = new Map()));
  let b = cache.get(column);
  if (!b) {
    b = percentileBounds(rankedColumn(areas, column));
    cache.set(column, b);
  }
  return b;
}

/** An area's points on one column (0–100, higher is better), or NaN with no value. */
export function areaPoints(areas: NationalAreas, column: string, i: number, direction: Direction): number {
  const p = areaPercentiles(areas, column)[i];
  if (Number.isNaN(p)) return NaN;
  const b = areaBounds(areas, column);
  return directionalScore(p, direction, { lo: b.lo[i], hi: b.hi[i] });
}

/** An area-level column's national percentile per area (0–100, NaN unknown), computed once. */
export function areaPercentiles(areas: NationalAreas, column: string): Float64Array {
  let cache = pctCache.get(areas);
  if (!cache) pctCache.set(areas, (cache = new Map()));
  let p = cache.get(column);
  if (!p) {
    p = percentileRanks(rankedColumn(areas, column));
    cache.set(column, p);
  }
  return p;
}

/**
 * The scoring columns an area's low-confidence flags cover: a flag is usually the
 * column's own name; "crime" covers both crime rates and "mobile_homes" the home value.
 */
export function flaggedColumns(areas: NationalAreas, i: number): Set<string> {
  const out = new Set<string>();
  for (const f of areas.lowConfidence[i]) {
    if (f === "crime") out.add("violent_rate").add("property_rate");
    else if (f === "mobile_homes") out.add("median_home_value");
    else out.add(f);
  }
  return out;
}

/** A county's shared part of its areas' scores: its status and its county-level points. */
export interface CountyPart {
  status: "match" | "unknown" | "excluded";
  sum: number;
  weight: number;
}

export function countyParts(scores: CountyScore[]): Map<string, CountyPart> {
  const out = new Map<string, CountyPart>();
  for (const s of scores) {
    let sum = 0;
    let weight = 0;
    for (const c of s.contributions) {
      // No value: average (50) at full weight, the same rule as `scoreCounties`.
      sum += c.weight * (c.percentile ?? 50);
      weight += c.weight;
    }
    out.set(s.fips, { status: s.status, sum, weight });
  }
  return out;
}

export interface NationalSearch {
  criteria: AreaCriterion[];
  limits: AreaLimit[];
  counties: Map<string, CountyPart>;
}

export const MATCH = 0;
export const UNKNOWN = 1;
export const EXCLUDED = 2;
/** The area's county isn't in play (an opt-in state that's off). */
export const OUT = 3;

export interface NationalScores {
  /** 0–100, NaN when excluded or nothing to rank by. */
  score: Float64Array;
  status: Uint8Array;
}

export function scoreNational(areas: NationalAreas, s: NationalSearch): NationalScores {
  const limitValues = s.limits.map((l) => areas.values.get(l.column));
  const score = new Float64Array(areas.n).fill(NaN);
  const status = new Uint8Array(areas.n);
  for (let i = 0; i < areas.n; i++) {
    const cp = s.counties.get(areas.county[i]);
    if (!cp || notResidential(areas, i)) {
      status[i] = OUT;
      continue;
    }
    if (cp.status === "excluded") {
      status[i] = EXCLUDED;
      continue;
    }
    let st = cp.status === "unknown" ? UNKNOWN : MATCH;
    for (let k = 0; k < s.limits.length; k++) {
      const v = limitValues[k]?.[i] ?? NaN;
      const l = s.limits[k];
      if (Number.isNaN(v)) st = UNKNOWN;
      else if ((l.min !== undefined && v < l.min) || (l.max !== undefined && v > l.max)) {
        st = EXCLUDED;
        break;
      }
    }
    status[i] = st;
    if (st === EXCLUDED) continue;
    let sum = cp.sum;
    let w = cp.weight;
    for (const c of s.criteria) {
      const pts = areaPoints(areas, c.column, i, c.direction);
      // No value: counted as average, never dropped (it would lift the score).
      sum += c.weight * (Number.isNaN(pts) ? 50 : pts);
      w += c.weight;
    }
    if (w > 0) score[i] = sum / w;
  }
  return { score, status };
}

const shown = (st: number, includeUnknown: boolean) => st === MATCH || (st === UNKNOWN && includeUnknown);

/**
 * Result order: verified matches before areas unknown for a must-have, then by score,
 * then more people first. With nothing weighted (must-haves only) there is no score,
 * and matches come by population.
 */
const byResult = (areas: NationalAreas, sc: NationalScores) => (a: number, b: number) =>
  sc.status[a] - sc.status[b] ||
  (Number.isNaN(sc.score[b]) ? -1 : sc.score[b]) - (Number.isNaN(sc.score[a]) ? -1 : sc.score[a]) ||
  (areas.population[b] || 0) - (areas.population[a] || 0);

/** The best `n` areas, best first (see `byResult`). */
export function topAreas(areas: NationalAreas, sc: NationalScores, n: number, includeUnknown: boolean): number[] {
  const idx: number[] = [];
  for (let i = 0; i < areas.n; i++) {
    if (shown(sc.status[i], includeUnknown)) idx.push(i);
  }
  idx.sort(byResult(areas, sc));
  return idx.slice(0, n);
}

/** Every area of a county that passes the search, best first. */
export function countyMatches(
  areas: NationalAreas,
  sc: NationalScores,
  fips: string,
  includeUnknown: boolean,
): number[] {
  const idx: number[] = [];
  for (let i = 0; i < areas.n; i++) {
    if (areas.county[i] === fips && shown(sc.status[i], includeUnknown)) idx.push(i);
  }
  return idx.sort(byResult(areas, sc));
}

export interface CountyResult {
  fips: string;
  /** Its areas among the results, best first. */
  areas: number[];
  bestScore: number;
}

/** The counties holding the results, by their best area (owner, 2026-10-03). */
export function countiesOf(areas: NationalAreas, top: number[], sc: NationalScores): CountyResult[] {
  const by = new Map<string, CountyResult>();
  for (const i of top) {
    const f = areas.county[i];
    const r = by.get(f) ?? { fips: f, areas: [], bestScore: sc.score[i] };
    r.areas.push(i);
    by.set(f, r);
  }
  return [...by.values()].sort((a, b) => b.bestScore - a.bestScore);
}

/** One priority's part in an area's score: the fingerprint bar and the "why". */
export interface AreaPart {
  key: string;
  label: string;
  level: "area" | "county";
  direction: Direction;
  weight: number;
  value: number | null;
  /** National percentile of the value, 0–100 (higher value → higher). */
  rawPercentile: number | null;
  /** Points after the direction: higher is always better. */
  points: number | null;
  /** weight × (points − 50). */
  impact: number | null;
  /** Share of places strictly worse, 0–100 — for "top 1%" claims (see MetricContribution.beats). */
  beats: number | null;
  /** The value is low confidence (a wide Census margin, a small police agency): show a caution. */
  flagged: boolean;
}

/** An area's parts, most important first (the fingerprint's order). */
export function explainArea(
  areas: NationalAreas,
  i: number,
  s: NationalSearch,
  county: CountyScore | undefined,
): AreaPart[] {
  const flagged = flaggedColumns(areas, i);
  const parts: AreaPart[] = s.criteria.map((c) => {
    const p = areaPercentiles(areas, c.column)[i];
    const v = areas.values.get(c.column)?.[i] ?? NaN;
    const pts = areaPoints(areas, c.column, i, c.direction);
    const points = Number.isNaN(pts) ? null : pts;
    return {
      key: c.column, label: c.label, level: "area", direction: c.direction, weight: c.weight,
      value: Number.isNaN(v) ? null : v, rawPercentile: Number.isNaN(p) ? null : p, points,
      impact: points === null ? null : c.weight * (points - 50),
      beats: points === null ? null : beatsAt(areaBounds(areas, c.column), i, c.direction),
      flagged: !Number.isNaN(v) && flagged.has(c.column),
    };
  });
  for (const c of county?.contributions ?? []) {
    parts.push({
      key: c.metric, label: getMetric(c.metric).label, level: "county", direction: c.direction, weight: c.weight,
      value: c.value, rawPercentile: c.rawPercentile, points: c.percentile, impact: c.impact, beats: c.beats,
      flagged: false,
    });
  }
  return parts.sort((a, b) => b.weight - a.weight);
}

export interface AreaLimitResult extends AreaLimit {
  value: number | null;
  state: "pass" | "fail" | "unknown";
}

export function areaLimitResults(areas: NationalAreas, i: number, limits: AreaLimit[]): AreaLimitResult[] {
  return limits.map((l) => {
    const v = areas.values.get(l.column)?.[i] ?? NaN;
    const state = Number.isNaN(v)
      ? "unknown"
      : (l.min !== undefined && v < l.min) || (l.max !== undefined && v > l.max)
        ? "fail"
        : "pass";
    return { ...l, value: Number.isNaN(v) ? null : v, state };
  });
}

/** County measures that read better as their own phrase (in their default direction): [helps, hurts]. */
const COUNTY_WORDS: Partial<Record<string, [string, string]>> = {
  hottest_month_high_f: ["cooler summers", "hot summers"],
  coldest_month_low_f: ["milder winters", "cold winters"],
  spring_mean_f: ["warm springs", "cool springs"],
  fall_mean_f: ["warm falls", "cool falls"],
  hazard_risk: ["low hazard risk", "high hazard risk"],
  racial_equality: ["racial equality", "racial inequality"],
};

/**
 * How a priority reads in the trade-off sentence: an area measure's own words, else a
 * phrase from its label and direction — "low cost of living", "few days above 90°F",
 * "a major airport nearby", "high risk of tornadoes".
 */
const words = (part: AreaPart, good: boolean): string => {
  const def = part.level === "area" ? areaPriority(part.key) : undefined;
  if (def && part.direction === def.defaultDirection) return (good ? def.good : def.bad) ?? part.label.toLowerCase();
  const metric = part.level === "county" ? getMetric(part.key as MetricKey) : undefined;
  const own = COUNTY_WORDS[part.key];
  if (metric && own && part.direction === metric.defaultDirection) return good ? own[0] : own[1];
  const label = (metric?.label ?? part.label).replace(/\s*\(.*\)$/, "");
  const name = label[0].toLowerCase() + label.slice(1);
  const unit = metric?.unit ?? "";
  if (part.direction === "middle") return good ? `typical ${name}` : `unusual ${name}`;
  // Which end this place is at: the good end when it helped.
  const high = part.direction === "higher" ? good : !good;
  if (unit === "mi" && /^distance to /i.test(label)) {
    const target = label.replace(/^distance to /i, "");
    return high ? `the distance to ${target}` : good ? `${target} nearby` : `${target} close by`;
  }
  if (unit === "pctl") return `${high ? "high" : "low"} risk of ${name}`;
  if (/^(days|nights)\//.test(unit)) return `${high ? "many" : "few"} ${name}`;
  return `${high ? "high" : "low"} ${name}`;
};

const list = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * The trade-off sentence: from the (at most) 3 priorities that moved the score most
 * (owner: with 15 filters, never list them all). "Helped by cheap homes and strong
 * schools; held back by long commutes."
 */
export function tradeOff(parts: AreaPart[]): string {
  const top = parts
    .filter((p) => p.impact !== null && Math.abs(p.impact) >= 1)
    .sort((a, b) => Math.abs(b.impact!) - Math.abs(a.impact!))
    .slice(0, 3);
  const pos = top.filter((p) => p.impact! > 0).map((p) => words(p, true));
  const neg = top.filter((p) => p.impact! < 0).map((p) => words(p, false));
  // "Helped by …; held back by …" reads right whatever the phrases' number.
  if (pos.length && neg.length) return `Helped by ${list(pos)}; held back by ${list(neg)}.`;
  if (pos.length) return `Helped by ${list(pos)}.`;
  if (neg.length) return `Held back by ${list(neg)}.`;
  return "About average on everything you asked for.";
}

export interface ResultBadges {
  /** "Best of your results" (green), at most two. */
  best: string[];
  /** "Top 1% … in the US" (gold), at most one. */
  top1: string[];
}

/**
 * Badges for the results (owner, 2026-10-03): the single best result on an area-level
 * priority gets its badge ("Most walkable"); an area in the top 1% of the US on one gets
 * a gold one. Ties get none, so a badge always means "the one".
 */
export function resultBadges(areas: NationalAreas, top: number[], s: NationalSearch): Map<number, ResultBadges> {
  const out = new Map<number, ResultBadges>(top.map((i) => [i, { best: [], top1: [] }]));
  if (top.length < 2) return out;
  for (const c of s.criteria) {
    const def = areaPriority(c.column);
    let best = -1;
    let bestPts = -Infinity;
    let tie = false;
    const homeValue = c.column === "median_home_value";
    for (const i of top) {
      if (homeValue && mostlyMobileHomes(areas, i)) continue; // not a house price
      const pts = areaPoints(areas, c.column, i, c.direction);
      if (Number.isNaN(pts)) continue;
      if (pts > bestPts) {
        best = i;
        bestPts = pts;
        tie = false;
      } else if (pts === bestPts) tie = true;
    }
    if (best >= 0 && !tie) {
      const b = out.get(best)!;
      const name = def && c.direction === def.defaultDirection && def.badge ? def.badge : `Best for ${c.label.toLowerCase()}`;
      if (b.best.length < 2) b.best.push(name);
    }
    if (def?.topBadge && c.direction === def.defaultDirection) {
      for (const i of top) {
        if (homeValue && mostlyMobileHomes(areas, i)) continue;
        const b = out.get(i)!;
        // Rarer than 99% of US areas, ties counted against it.
        if (b.top1.length === 0 && (beatsAt(areaBounds(areas, c.column), i, c.direction) ?? 0) >= 99) b.top1.push(def.topBadge);
      }
    }
  }
  return out;
}
