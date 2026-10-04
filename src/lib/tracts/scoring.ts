/**
 * Ranking the areas inside a county (plan §9 Phase 8e): one search, two levels
 * (owner, 2026-10-03). The same Filters that rank counties rank areas:
 *
 * - County priorities that have an area equivalent carry over — home value,
 *   rent, income, schools, hazards, airport distance — with their importance
 *   and direction. The rest (climate, taxes, cost of living…) are the same
 *   everywhere in a county, so they don't rank areas.
 * - Area-only priorities (`AREA_PRIORITIES`) live in the Filters modal's
 *   "Inside a county" section: walkability, crime, high schools, downtown…
 * - Each measure is ranked among the county's own areas (percentile, as for
 *   counties), turned into points by its direction, and weighted the same way.
 * - Must-haves: area-only limits, plus county limits in the same units (a
 *   maximum home value). An area failing one is "excluded"; one lacking the
 *   value is "unknown" — never a guess.
 *
 * Pure: no UI imports.
 */

import {
  directionalScore,
  MAX_WEIGHT,
  percentileRanks,
  type Direction,
  type MetricKey,
} from "@/lib/scoring";

import type { Area } from "./index";

export interface AreaPriorityDef {
  key: string;
  label: string;
  unit: string;
  defaultDirection: Direction;
  /** For the "i": what the number is. */
  note?: string;
}

/** Priorities that only mean something inside a county (Filters → Inside a county). */
export const AREA_PRIORITIES: readonly AreaPriorityDef[] = [
  { key: "walkability", label: "Walkability", unit: "of 20", defaultDirection: "higher",
    note: "EPA National Walkability Index, 1–20: street grid, transit, and shops near homes." },
  { key: "violent_rate", label: "Violent crime", unit: "per 100k", defaultDirection: "lower",
    note: "FBI, per 100,000 residents, for the police agency covering the area." },
  { key: "property_rate", label: "Property crime", unit: "per 100k", defaultDirection: "lower",
    note: "FBI, per 100,000 residents, for the police agency covering the area." },
  { key: "nearby_hs_pctl", label: "High schools", unit: "pctl", defaultDirection: "higher",
    note: "Access to college-prep courses (AP) at the nearest high schools, national percentile." },
  { key: "dist_downtown_mi", label: "Distance to downtown", unit: "mi", defaultDirection: "lower" },
  { key: "kids_share", label: "Households with kids", unit: "%", defaultDirection: "higher" },
  { key: "density_per_sq_mi", label: "People per sq mi", unit: "people", defaultDirection: "lower",
    note: "Lower: quieter, more space. Higher: more urban." },
  { key: "commute_minutes", label: "Average commute", unit: "min", defaultDirection: "lower" },
];

export type AreaPriorityKey = string;

/**
 * County priorities that also rank areas, and the area column each reads.
 * `sameUnits`: a county limit (a maximum home value) also applies to areas.
 */
export const CARRIED_OVER: Partial<Record<MetricKey, { column: string; sameUnits: boolean; label?: string }>> = {
  median_home_value: { column: "median_home_value", sameUnits: true },
  median_gross_rent: { column: "median_gross_rent", sameUnits: true },
  median_household_income: { column: "median_household_income", sameUnits: true },
  // Counties: grade levels; areas: the nearest schools' national percentile.
  school_achievement: { column: "nearby_school_pctl", sameUnits: false, label: "Nearby schools" },
  hazard_risk: { column: "hazard_risk", sameUnits: false },
  hazard_hurricane: { column: "hazard_hurricane", sameUnits: false },
  hazard_wildfire: { column: "hazard_wildfire", sameUnits: false },
  hazard_inland_flood: { column: "hazard_inland_flood", sameUnits: false },
  hazard_coastal_flood: { column: "hazard_coastal_flood", sameUnits: false },
  hazard_earthquake: { column: "hazard_earthquake", sameUnits: false },
  hazard_tornado: { column: "hazard_tornado", sameUnits: false },
  dist_airport_mi: { column: "dist_airport_mi", sameUnits: true },
};

export interface AreaSearch {
  /** The county search's priorities and limits (carried over where they apply). */
  weights: Partial<Record<MetricKey, number>>;
  directions: Partial<Record<MetricKey, Direction>>;
  limits: Partial<Record<MetricKey, { min?: number; max?: number }>>;
  /** Area-only priorities and limits, keyed by AREA_PRIORITIES key. */
  areaWeights: Partial<Record<string, number>>;
  areaDirections: Partial<Record<string, Direction>>;
  areaLimits: Partial<Record<string, { min?: number; max?: number }>>;
}

/** One measure ranking areas: where it came from, and how it counts. */
export interface AreaCriterion {
  column: string;
  label: string;
  weight: number;
  direction: Direction;
  /** "county": carried over from a county priority; "area": an area-only one. */
  from: "county" | "area";
}

export interface AreaLimit {
  column: string;
  label: string;
  min?: number;
  max?: number;
}

export type AreaStatus = "match" | "unknown" | "excluded";

/** How one measure moved an area's score (the area view's "Why it ranks here"). */
export interface AreaContribution {
  column: string;
  label: string;
  value: number | null;
  direction: Direction;
  weight: number;
  /** Where the value sits among the county's areas, 0–100 (higher value → higher). */
  rawPercentile: number | null;
  /** Points after the direction: higher is always better. */
  points: number | null;
  /** weight × (points − 50): how far it pushed the score up or down. */
  impact: number | null;
}

export interface AreaLimitResult extends AreaLimit {
  value: number | null;
  state: "pass" | "fail" | "unknown";
}

export interface AreaScore {
  geoid: string;
  /** 0–100 among the county's areas, or null (excluded, or nothing to rank by). */
  score: number | null;
  status: AreaStatus;
  failed: string[];
  unknown: string[];
  contributions: AreaContribution[];
  limits: AreaLimitResult[];
}

export interface AreaRanking {
  criteria: AreaCriterion[];
  limits: AreaLimit[];
  byGeoid: Map<string, AreaScore>;
}

const clampWeight = (w: number | undefined) =>
  w === undefined || !Number.isFinite(w) ? 0 : Math.min(MAX_WEIGHT, Math.max(0, w));

const AREA_DEF = new Map(AREA_PRIORITIES.map((d) => [d.key, d]));

/** What ranks and what rules out areas under a search, in a stable order. */
export function areaCriteria(
  search: AreaSearch,
  countyLabel: (k: MetricKey) => string,
  defaultDirection: (k: MetricKey) => Direction,
): { criteria: AreaCriterion[]; limits: AreaLimit[] } {
  const criteria: AreaCriterion[] = [];
  const limits: AreaLimit[] = [];
  for (const [key, carry] of Object.entries(CARRIED_OVER) as [MetricKey, { column: string; sameUnits: boolean; label?: string }][]) {
    const weight = clampWeight(search.weights[key]);
    if (weight > 0) {
      criteria.push({ column: carry.column, label: carry.label ?? countyLabel(key), weight, from: "county",
        direction: search.directions[key] ?? defaultDirection(key) });
    }
    const l = search.limits[key];
    if (carry.sameUnits && l && (l.min !== undefined || l.max !== undefined)) {
      limits.push({ column: carry.column, label: countyLabel(key), min: l.min, max: l.max });
    }
  }
  for (const def of AREA_PRIORITIES) {
    const weight = clampWeight(search.areaWeights[def.key]);
    if (weight > 0) {
      criteria.push({ column: def.key, label: def.label, weight, from: "area",
        direction: search.areaDirections[def.key] ?? def.defaultDirection });
    }
    const l = search.areaLimits[def.key];
    if (l && (l.min !== undefined || l.max !== undefined)) limits.push({ column: def.key, label: def.label, ...l });
  }
  return { criteria, limits };
}

/** Score a county's areas: within-county percentiles, weighted like counties. */
export function scoreAreas(areas: Area[], criteria: AreaCriterion[], limits: AreaLimit[]): Map<string, AreaScore> {
  const value = (a: Area, col: string): number => {
    const v = a.row[col];
    return typeof v === "number" && Number.isFinite(v) ? v : NaN;
  };
  const pct = criteria.map((c) => percentileRanks(Float64Array.from(areas, (a) => value(a, c.column))));
  const out = new Map<string, AreaScore>();
  areas.forEach((a, i) => {
    const failed: string[] = [];
    const unknown: string[] = [];
    const limitResults: AreaLimitResult[] = [];
    for (const l of limits) {
      const v = value(a, l.column);
      let state: AreaLimitResult["state"] = "pass";
      if (Number.isNaN(v)) {
        unknown.push(l.label);
        state = "unknown";
      } else if ((l.min !== undefined && v < l.min) || (l.max !== undefined && v > l.max)) {
        failed.push(l.label);
        state = "fail";
      }
      limitResults.push({ ...l, value: Number.isNaN(v) ? null : v, state });
    }
    const status: AreaStatus = failed.length ? "excluded" : unknown.length ? "unknown" : "match";
    let sum = 0;
    let weights = 0;
    const contributions: AreaContribution[] = criteria.map((c, k) => {
      const p = pct[k][i];
      const raw = value(a, c.column);
      if (Number.isNaN(p)) {
        return { column: c.column, label: c.label, value: null, direction: c.direction, weight: c.weight,
          rawPercentile: null, points: null, impact: null };
      }
      const points = directionalScore(p, c.direction);
      sum += c.weight * points;
      weights += c.weight;
      return { column: c.column, label: c.label, value: raw, direction: c.direction, weight: c.weight,
        rawPercentile: p, points, impact: c.weight * (points - 50) };
    });
    out.set(a.geoid, { geoid: a.geoid, status, failed, unknown, contributions, limits: limitResults,
      score: status === "excluded" || weights === 0 ? null : sum / weights });
  });
  return out;
}

/** The strongest push up and down, for a one-line reason in the list. */
export function topReasons(s: AreaScore | undefined): { up: AreaContribution | null; down: AreaContribution | null } {
  const known = (s?.contributions ?? []).filter((c) => c.impact !== null && c.impact !== 0);
  const up = known.filter((c) => c.impact! > 0).sort((a, b) => b.impact! - a.impact!)[0] ?? null;
  const down = known.filter((c) => c.impact! < 0).sort((a, b) => a.impact! - b.impact!)[0] ?? null;
  return { up, down };
}

export function areaPriority(key: string): AreaPriorityDef | undefined {
  return AREA_DEF.get(key);
}
