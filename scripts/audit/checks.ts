/**
 * Automatic checks on a search's results (full audit, 2026-10-04). Each check is
 * independent of the scoring code where it can be: points and percentiles are
 * re-derived from the raw columns here, not read back from `explainArea`.
 *
 * `hard` findings fail the audit; `warn` findings are listed for a person to judge.
 */
import { formatValue, getMetric, isCategoryKey, type Direction, type MetricKey } from "@/lib/scoring";
import { areaPriority, formatArea, notResidential, tradeOff, type NationalAreas } from "@/lib/tracts";
import { isGap } from "@/lib/laws";

import type { RunResult } from "./run";

export interface Findings {
  hard: string[];
  warn: string[];
  /** Lines of plain statistics for the report. */
  stats: string[];
}

// ---------------------------------------------------------------------------
// Independent percentiles: sorted known values per column, residential areas only.

const sortedCache = new WeakMap<NationalAreas, Map<string, Float64Array>>();

/**
 * The value a measure is ranked on, re-derived independently (Phase 10e): its `_eb`
 * estimate column where the file has one and both are known, else the published value.
 */
export function scoredAt(areas: NationalAreas, column: string, i: number): number {
  const raw = areas.values.get(column)?.[i] ?? NaN;
  const est = areas.values.get(`${column}_eb`)?.[i] ?? NaN;
  return Number.isFinite(raw) && Number.isFinite(est) ? est : raw;
}

export function sortedResidential(areas: NationalAreas, column: string): Float64Array {
  let cache = sortedCache.get(areas);
  if (!cache) sortedCache.set(areas, (cache = new Map()));
  let s = cache.get(column);
  if (!s) {
    const xs: number[] = [];
    for (let i = 0; i < areas.n; i++) {
      const v = scoredAt(areas, column, i);
      if (!Number.isNaN(v) && !notResidential(areas, i)) xs.push(v);
    }
    s = Float64Array.from(xs.sort((a, b) => a - b));
    cache.set(column, s);
  }
  return s;
}

/** Fit to a budget, re-derived (Phase 10c): 100 at or under it, 0 at 1.5× it. */
const budgetFit = (v: number, b: number) => (v <= b ? 100 : Math.max(0, (100 * (1.5 * b - v)) / (0.5 * b)));

const sortedCounties = new WeakMap<Float64Array, Float64Array>();
function sortedKnown(col: Float64Array): Float64Array {
  let s = sortedCounties.get(col);
  if (!s) {
    s = Float64Array.from(Array.from(col).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b));
    sortedCounties.set(col, s);
  }
  return s;
}

/** Count of sorted values strictly below v, and at or below v. */
function counts(sorted: Float64Array, v: number): [number, number] {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m] < v) lo = m + 1;
    else hi = m;
  }
  const below = lo;
  hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m] <= v) lo = m + 1;
    else hi = m;
  }
  return [below, lo];
}

/** Points and "beats" for a value, re-derived from the sorted distribution (plan §6, tie rules). */
export function derive(sorted: Float64Array, v: number, direction: Direction): { points: number; beats: number | null; pctl: number } {
  const m = sorted.length;
  if (m <= 1) return { points: 50, beats: null, pctl: 50 };
  const [below, atOrBelow] = counts(sorted, v);
  const lo = (below / (m - 1)) * 100;
  const hi = ((atOrBelow - 1) / (m - 1)) * 100;
  const mid = (lo + hi) / 2;
  if (direction === "higher") return { points: hi, beats: lo, pctl: mid };
  if (direction === "lower") return { points: 100 - lo, beats: 100 - hi, pctl: mid };
  return { points: 100 - 2 * Math.abs(mid - 50), beats: null, pctl: mid };
}

/** The value at a share of the sorted distribution (0–1). */
export const quantile = (sorted: Float64Array, q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

const bad = (s: string) => /NaN|undefined|Infinity|null/.test(s);

/**
 * Anchored points (pollution, Phase 11), derived independently of the app: PM2.5's band
 * points integrated numerically over N(value, 1.7) (the app uses an erf formula), capped at
 * 50 when the area's own "pm25" flag says a monitor doubts it; smoke and older homes linear.
 */
function anchoredPoints(key: string, v: number, doubted: boolean): number | null {
  if (key === "pm25") {
    const band = (x: number) => (x <= 5 ? 100 : x <= 7 ? 75 : x <= 9 ? 50 : x <= 12 ? 25 : 0);
    const sd = 1.7;
    let sum = 0;
    let wsum = 0;
    for (let z = -8; z <= 8; z += 0.001) {
      const w = Math.exp(-0.5 * z * z);
      sum += w * band(v + z * sd);
      wsum += w;
    }
    return doubted ? Math.min(50, sum / wsum) : sum / wsum;
  }
  const lin = (best: number, worst: number) => Math.max(0, Math.min(100, (100 * (worst - v)) / (worst - best)));
  if (key === "smoke_days_thick") return lin(5, 30);
  if (key === "pre1960_share") return lin(0, 60);
  return null;
}

// ---------------------------------------------------------------------------

export function automaticChecks(r: RunResult): Findings {
  const f: Findings = { hard: [], warn: [], stats: [] };
  if (!r.areaMode) return countyChecks(r, f);
  const { areas, top, ns, criteria, limits } = r;
  if (!ns) return f;
  const n = top.length;
  if (n === 0) {
    f.warn.push("no results at all");
    return f;
  }
  const weighted = criteria.length + r.countyCriteria.length;

  // 1. Every result is a place to move to, passes every must-have it has data for.
  for (const i of top) {
    if (notResidential(areas, i)) f.hard.push(`not residential in results: ${areas.name[i]} (pop ${areas.population[i]})`);
    for (const l of limits) {
      const v = r.value(i, l.column);
      if (!Number.isNaN(v) && ((l.min !== undefined && v < l.min) || (l.max !== undefined && v > l.max))) {
        f.hard.push(`must-have leak: ${areas.name[i]} ${l.column}=${v} outside ${l.min ?? ""}~${l.max ?? ""}`);
      }
    }
  }

  // 2. Shown points agree with an independent re-derivation; the score is their weighted average.
  let unknownStatus = 0;
  for (const i of top) {
    const parts = r.parts(i);
    let sum = 0;
    let w = 0;
    for (const p of parts) {
      sum += p.weight * (p.points ?? 50);
      w += p.weight;
      if (p.value === null) continue;
      if (p.budget !== undefined) {
        const want = budgetFit(scoredAt(areas, p.key, i), p.budget);
        if (p.points === null || Math.abs(want - p.points) > 0.01) {
          f.hard.push(`budget fit contradicts the value: ${areas.name[i]} ${p.key}=${p.value} shown ${p.points?.toFixed(2)}, derived ${want.toFixed(2)}`);
        }
        if (p.beats !== null) f.hard.push(`a rarity claim on budget fit: ${areas.name[i]} ${p.key}`);
        continue;
      }
      const anchored = p.level === "area" ? anchoredPoints(p.key, scoredAt(areas, p.key, i), areas.lowConfidence[i].includes(p.key)) : null;
      if (anchored !== null) {
        if (p.points === null || Math.abs(anchored - p.points) > 0.05) {
          f.hard.push(`anchored points contradict the value: ${areas.name[i]} ${p.key}=${p.value} shown ${p.points?.toFixed(2)}, derived ${anchored.toFixed(2)}`);
        }
        if (p.beats !== null) f.hard.push(`a rarity claim on anchored points: ${areas.name[i]} ${p.key}`);
        continue;
      }
      const d = p.level === "area"
        ? derive(sortedResidential(areas, p.key), scoredAt(areas, p.key, i), p.direction)
        : derive(sortedKnown(r.counties.values[p.key as MetricKey]), p.value, p.direction);
      if (p.points === null || Math.abs(d.points - p.points) > 0.01) {
        f.hard.push(`points contradict the value: ${areas.name[i]} ${p.key}=${p.value} shown ${p.points?.toFixed(2)} pts, derived ${d.points.toFixed(2)}`);
      }
      if (p.direction !== "middle" && (p.beats === null || Math.abs((d.beats ?? NaN) - p.beats) > 0.01)) {
        f.hard.push(`'beats' contradicts the value: ${areas.name[i]} ${p.key}=${p.value} shown ${p.beats?.toFixed(2)}, derived ${d.beats?.toFixed(2)}`);
      }
      const text = p.level === "area" ? formatArea(p.key, p.value) : formatValue(p.key as MetricKey, p.value);
      if (bad(text)) f.hard.push(`bad formatting: ${p.key} → "${text}"`);
    }
    if (w > 0 && Math.abs(sum / w - ns.score[i]) > 1e-6) {
      f.hard.push(`score isn't the weighted average of its parts: ${areas.name[i]} ${ns.score[i].toFixed(3)} vs ${(sum / w).toFixed(3)}`);
    }
    if (ns.status[i] === 1) unknownStatus++;
    // Trade-off sentence: never "about average" when a priority clearly moved the score.
    const moved = parts.filter((p) => p.impact !== null && Math.abs(p.impact) >= 1);
    const sentence = tradeOff(parts);
    if (moved.length && /About average/.test(sentence)) f.hard.push(`trade-off says average while ${moved[0].key} moved it: ${areas.name[i]}`);
    if (bad(sentence)) f.hard.push(`bad trade-off text: "${sentence}"`);
    const missing = parts.filter((p) => p.points === null).length;
    if (weighted > 0 && missing > weighted / 2 && top.indexOf(i) < 10) {
      f.warn.push(`top-10 result scored mostly on missing data: ${areas.name[i]} (${missing} of ${weighted} missing)`);
    }
  }

  // 3. Policy and state must-haves: the county's law values really match.
  for (const [key, accept] of Object.entries(r.prefs.categories)) {
    if (!accept || !isCategoryKey(key)) continue;
    for (const i of top) {
      const ci = r.counties.indexByFips.get(areas.county[i]);
      if (ci === undefined) continue;
      let v: string | null;
      if (key === "state") v = r.counties.state[ci];
      else if (key === "koppen") v = r.counties.categories.koppen[ci];
      else {
        const fact = r.laws.states[r.counties.state[ci]]?.[key];
        v = fact && !isGap(fact) ? fact.v : null;
      }
      // A borderline climate (within 0.5 °C of a line) passes on either of its types.
      const alt = key === "koppen" ? r.counties.koppenAlt[ci] : null;
      if (v !== null && !accept.includes(v) && !(alt && accept.includes(alt))) {
        f.hard.push(`policy filter passed a wrong value: ${areas.name[i]} ${key}=${v}${alt ? `/${alt}` : ""}, wanted ${accept.join("/")}`);
      }
      if (v === null && ns.status[i] !== 1) f.hard.push(`policy value unknown but result not marked unknown: ${areas.name[i]} ${key}`);
    }
  }

  // 4. "Top 1%" badges are true by direct count; "best of results" badges name the single best.
  for (const i of top) {
    const b = r.badges.get(i);
    if (!b) continue;
    for (const label of b.top1) {
      const c = criteria.find((x) => areaPriority(x.column)?.topBadge === label);
      if (!c) {
        f.hard.push(`badge without a priority: ${label}`);
        continue;
      }
      const d = derive(sortedResidential(areas, c.column), scoredAt(areas, c.column, i), c.direction);
      if ((d.beats ?? 0) < 99) f.hard.push(`false "Top 1%": ${areas.name[i]} ${c.column}=${r.value(i, c.column)} beats only ${d.beats?.toFixed(1)}%`);
    }
    for (const label of b.best) {
      const nameOf = (x: (typeof criteria)[number]) => {
        const def = areaPriority(x.column);
        return x.badge ?? (def && x.direction === def.defaultDirection && def.badge ? def.badge : `Best for ${x.label.toLowerCase()}`);
      };
      const c = criteria.find((x) => nameOf(x) === label);
      if (!c) {
        f.hard.push(`best-badge without a priority: ${label}`);
        continue;
      }
      const mine = r.parts(i).find((p) => p.key === c.column)?.points ?? -1;
      const better = top.filter((j) => j !== i && (r.parts(j).find((p) => p.key === c.column)?.points ?? -1) >= mine);
      if (better.length) f.hard.push(`"${label}" isn't the single best: ${areas.name[i]} ${mine.toFixed(1)} pts, ${better.length} others as good`);
    }
  }

  // 5. Shape of the list: ties, concentration, size, confidence.
  const best = ns.score[top[0]];
  const ties = top.filter((i) => Math.abs(ns.score[i] - best) < 1e-9).length;
  if (ties > 10 && !Number.isNaN(best)) f.warn.push(`${ties} results tied for #1 at ${best.toFixed(1)} (order falls back to population)`);
  const stateCounts = new Map<string, number>();
  for (const i of top) stateCounts.set(r.stateOf(i), (stateCounts.get(r.stateOf(i)) ?? 0) + 1);
  const states = [...stateCounts].sort((a, b) => b[1] - a[1]);
  const stateFilter = r.prefs.categories.state;
  if (states[0] && states[0][1] > 0.6 * n && !(stateFilter && stateFilter.length <= 3)) {
    f.warn.push(`one state holds ${states[0][1]} of ${n}: ${states[0][0]}`);
  }
  const biggest = r.byCounty.slice().sort((a, b) => b.areas.length - a.areas.length)[0];
  if (biggest && biggest.areas.length > 0.3 * n) f.warn.push(`one county holds ${biggest.areas.length} of ${n}: ${r.countyName(biggest.fips)}`);
  const pops = top.map((i) => areas.population[i]).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  const p10 = pops[Math.floor(pops.length * 0.1)] ?? NaN;
  if (p10 < 1000) f.warn.push(`small areas: a tenth of results have under ${Math.round(p10)} residents`);
  for (const c of criteria) {
    const flagged = top.filter((i) => r.parts(i).find((p) => p.key === c.column)?.flagged).length;
    if (flagged > n / 2) f.warn.push(`${c.label}: ${flagged} of ${n} results rest on a low-confidence value`);
    const missing = top.filter((i) => Number.isNaN(r.value(i, c.column))).length;
    if (missing > n / 4) f.warn.push(`${c.label}: ${missing} of ${n} results have no value (scored as average)`);
  }
  if (unknownStatus > n / 2) f.warn.push(`${unknownStatus} of ${n} results are unknown for a must-have`);

  const lowConf = top.filter((i) => r.parts(i).some((p) => p.flagged)).length;
  f.stats.push(
    `Population: median ${Math.round(pops[Math.floor(pops.length / 2)] ?? NaN).toLocaleString()}, p10 ${Math.round(p10).toLocaleString()}`,
    `Low-confidence on a priority: ${lowConf} of ${n}`,
    `States: ${states.slice(0, 8).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `Biggest county share: ${biggest ? `${r.countyName(biggest.fips)} with ${biggest.areas.length}` : "—"}`,
    `Tied for #1: ${ties}; score range ${ns.score[top[n - 1]]?.toFixed(1)}–${best?.toFixed(1)}`,
  );
  return f;
}

function countyChecks(r: RunResult, f: Findings): Findings {
  const ranked = r.rankedCounties;
  const n = Math.min(100, ranked.length);
  if (n === 0) {
    f.warn.push("no counties pass");
    return f;
  }
  for (const s of ranked.slice(0, n)) {
    let sum = 0;
    let w = 0;
    for (const c of s.contributions) {
      sum += c.weight * (c.percentile ?? 50);
      w += c.weight;
      if (c.value === null) continue;
      const d = derive(sortedKnown(r.counties.values[c.metric]), c.value, c.direction);
      if (c.percentile === null || Math.abs(d.points - c.percentile) > 0.01) {
        f.hard.push(`county points contradict the value: ${r.countyName(s.fips)} ${c.metric}=${c.value} shown ${c.percentile?.toFixed(2)}, derived ${d.points.toFixed(2)}`);
      }
      if (bad(formatValue(c.metric, c.value))) f.hard.push(`bad formatting: ${c.metric}`);
    }
    if (w > 0 && s.score !== null && Math.abs(sum / w - s.score) > 1e-6) f.hard.push(`county score isn't its weighted average: ${r.countyName(s.fips)}`);
    for (const fl of r.prefs.limits ? Object.entries(r.prefs.limits) : []) {
      const [k, l] = fl as [MetricKey, { min?: number; max?: number }];
      const v = r.counties.values[k]?.[s.index];
      if (v !== undefined && !Number.isNaN(v) && ((l.min !== undefined && v < l.min) || (l.max !== undefined && v > l.max))) {
        f.hard.push(`county must-have leak: ${r.countyName(s.fips)} ${k}=${v}`);
      }
    }
    for (const [key, accept] of Object.entries(r.prefs.categories)) {
      if (!accept || !isCategoryKey(key)) continue;
      const v = r.counties.categories[key][s.index];
      if (v !== null && !accept.includes(v)) f.hard.push(`county policy leak: ${r.countyName(s.fips)} ${key}=${v}`);
    }
  }
  const states = new Map<string, number>();
  for (const s of ranked.slice(0, 50)) states.set(r.counties.state[s.index], (states.get(r.counties.state[s.index]) ?? 0) + 1);
  const sorted = [...states].sort((a, b) => b[1] - a[1]);
  f.stats.push(`Top 50 by state: ${sorted.slice(0, 8).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const missing = ranked.slice(0, n).filter((s) => s.missingMetrics.length > 0).length;
  if (missing > n / 4) f.warn.push(`${missing} of the top ${n} counties are scored with a missing priority (as average)`);
  f.stats.push(`Counties ranked: ${ranked.length.toLocaleString()}; unknown for a must-have in the top ${n}: ${ranked.slice(0, n).filter((s) => s.status === "unknown").length}`);
  return f;
}

/** A metric's label for reports. */
export const metricLabel = (k: MetricKey) => getMetric(k).label;
