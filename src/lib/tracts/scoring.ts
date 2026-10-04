/**
 * What a search asks of areas (plan §9 Phase 8f, "one level per filter").
 *
 * Every measure has one level, the most precise that exists (owner, 2026-10-03):
 * - County/state level: climate, taxes, laws, cost of living, electricity,
 *   unemployment… the same everywhere in a county (`@/lib/scoring` METRICS).
 * - Area level (`AREA_PRIORITIES`): home value, rent, income, schools — the
 *   nearest specific schools, never a county average —, hazards, distances,
 *   crime, walkability, downtown, families, density, commute.
 *
 * County priorities that used to stand in for an area measure (a county's
 * median home value, its average school grade level…) move to the area level
 * when a saved search or link is read (`MOVED_TO_AREAS`).
 *
 * Pure: no UI imports.
 */

import { MAX_WEIGHT, type Direction, type MetricGroup, type MetricKey } from "@/lib/scoring";

export type AreaGroup = MetricGroup | "safety";

export interface AreaPriorityDef {
  key: string;
  label: string;
  unit: string;
  defaultDirection: Direction;
  /** The Filters section it sits in, beside county-level measures on the same topic. */
  group: AreaGroup;
  /** For the "i": what the number is. */
  note?: string;
  /** "Best of your results" badge, when the default direction is what's asked for. */
  badge?: string;
  /** The gold badge for the top 1% of US areas on this measure. */
  topBadge?: string;
  /** Trade-off sentence words when this measure helps / hurts (default direction). */
  good?: string;
  bad?: string;
}

const PCTL_NOTE = "National percentile among US areas (census tracts) of the same measure.";

export const AREA_PRIORITIES: readonly AreaPriorityDef[] = [
  { key: "median_home_value", label: "Home value", unit: "$", defaultDirection: "lower", group: "housing",
    note: "Census median value of owner-occupied homes in the area (ACS 5-year).",
    badge: "Cheapest homes", topBadge: "Top 1% cheapest in the US", good: "cheap homes", bad: "pricey homes" },
  { key: "median_gross_rent", label: "Rent", unit: "$/mo", defaultDirection: "lower", group: "housing",
    note: "Census median gross rent in the area (ACS 5-year).",
    badge: "Lowest rent", topBadge: "Top 1% lowest rent in the US", good: "low rent", bad: "high rent" },
  { key: "nearby_school_pctl", label: "Nearby schools", unit: "pctl", defaultDirection: "higher", group: "schools",
    note: "The nearest elementary and middle schools' test scores (Stanford SEDA), national percentile — specific schools, not a county average.",
    badge: "Best schools", topBadge: "Top 1% schools in the US", good: "strong schools", bad: "weaker schools" },
  { key: "nearby_hs_pctl", label: "High schools", unit: "pctl", defaultDirection: "higher", group: "schools",
    note: "Access to college-prep courses (AP) at the nearest high schools, national percentile.",
    badge: "Best high schools", topBadge: "Top 1% high schools in the US", good: "strong high schools", bad: "the nearest high schools" },
  { key: "violent_rate", label: "Violent crime", unit: "per 100k", defaultDirection: "lower", group: "safety",
    note: "FBI, per 100,000 residents, for the police agency covering the area.",
    badge: "Safest", topBadge: "Top 1% safest in the US", good: "low violent crime", bad: "more violent crime" },
  { key: "property_rate", label: "Property crime", unit: "per 100k", defaultDirection: "lower", group: "safety",
    note: "FBI, per 100,000 residents, for the police agency covering the area.",
    badge: "Least property crime", topBadge: "Top 1% least property crime in the US", good: "low property crime", bad: "more property crime" },
  { key: "walkability", label: "Walkability", unit: "of 20", defaultDirection: "higher", group: "location",
    note: "EPA National Walkability Index, 1–20: street grid, transit, and shops near homes.",
    badge: "Most walkable", topBadge: "Top 1% walkability in the US", good: "walkable streets", bad: "less walkable streets" },
  { key: "dist_downtown_mi", label: "Distance to downtown", unit: "mi", defaultDirection: "lower", group: "location",
    badge: "Closest to downtown", topBadge: "Top 1% closest to downtown in the US", good: "a short trip downtown", bad: "a long trip downtown" },
  { key: "commute_minutes", label: "Average commute", unit: "min", defaultDirection: "lower", group: "location",
    badge: "Shortest commutes", topBadge: "Top 1% shortest commutes in the US", good: "short commutes", bad: "long commutes" },
  { key: "dist_airport_mi", label: "Distance to a major airport", unit: "mi", defaultDirection: "lower", group: "location",
    badge: "Closest to an airport", good: "an airport nearby", bad: "a long drive to an airport" },
  { key: "dist_coast_mi", label: "Distance to the coast", unit: "mi", defaultDirection: "lower", group: "location",
    badge: "Closest to the coast", good: "the coast nearby", bad: "far from the coast" },
  { key: "dist_metro_mi", label: "Distance to a 500k+ metro", unit: "mi", defaultDirection: "lower", group: "location",
    badge: "Closest to a big city", good: "a big city nearby", bad: "far from a big city" },
  { key: "median_household_income", label: "Household income", unit: "$", defaultDirection: "higher", group: "people",
    note: "Census median household income in the area (ACS 5-year).",
    badge: "Highest incomes", good: "high incomes", bad: "lower incomes" },
  { key: "kids_share", label: "Households with kids", unit: "%", defaultDirection: "higher", group: "people",
    badge: "Most families", good: "lots of families", bad: "few families" },
  { key: "density_per_sq_mi", label: "People per sq mi", unit: "people", defaultDirection: "lower", group: "people",
    note: "Lower: quieter, more space. Higher: more urban.",
    badge: "Most space", good: "space and quiet", bad: "crowding" },
  { key: "hazard_risk", label: "Natural hazard risk (all)", unit: "pctl", defaultDirection: "lower", group: "hazards",
    note: PCTL_NOTE, badge: "Lowest hazard risk", good: "low hazard risk", bad: "high hazard risk" },
  { key: "hazard_hurricane", label: "Hurricanes", unit: "pctl", defaultDirection: "lower", group: "hazards", note: PCTL_NOTE,
    good: "little hurricane risk", bad: "hurricane risk" },
  { key: "hazard_wildfire", label: "Wildfire", unit: "pctl", defaultDirection: "lower", group: "hazards", note: PCTL_NOTE,
    good: "little wildfire risk", bad: "wildfire risk" },
  { key: "hazard_inland_flood", label: "Inland flooding", unit: "pctl", defaultDirection: "lower", group: "hazards", note: PCTL_NOTE,
    good: "little flood risk", bad: "flood risk" },
  { key: "hazard_coastal_flood", label: "Coastal flooding", unit: "pctl", defaultDirection: "lower", group: "hazards", note: PCTL_NOTE,
    good: "little coastal flood risk", bad: "coastal flood risk" },
  { key: "hazard_earthquake", label: "Earthquakes", unit: "pctl", defaultDirection: "lower", group: "hazards", note: PCTL_NOTE,
    good: "little earthquake risk", bad: "earthquake risk" },
  { key: "hazard_tornado", label: "Tornadoes", unit: "pctl", defaultDirection: "lower", group: "hazards", note: PCTL_NOTE,
    good: "little tornado risk", bad: "tornado risk" },
];

const AREA_DEF = new Map(AREA_PRIORITIES.map((d) => [d.key, d]));

export function areaPriority(key: string): AreaPriorityDef | undefined {
  return AREA_DEF.get(key);
}

/**
 * County priorities that are area measures now, and the area measure each becomes.
 * `keepLimit`: the county limit is in the same units, so it moves too (a maximum home
 * value); schools' grade levels don't (areas use the nearest schools' percentile).
 */
export const MOVED_TO_AREAS: Partial<Record<MetricKey, { to: string; keepLimit: boolean }>> = {
  median_home_value: { to: "median_home_value", keepLimit: true },
  median_gross_rent: { to: "median_gross_rent", keepLimit: true },
  median_household_income: { to: "median_household_income", keepLimit: true },
  school_achievement: { to: "nearby_school_pctl", keepLimit: false },
  hazard_risk: { to: "hazard_risk", keepLimit: true },
  hazard_hurricane: { to: "hazard_hurricane", keepLimit: true },
  hazard_wildfire: { to: "hazard_wildfire", keepLimit: true },
  hazard_inland_flood: { to: "hazard_inland_flood", keepLimit: true },
  hazard_coastal_flood: { to: "hazard_coastal_flood", keepLimit: true },
  hazard_earthquake: { to: "hazard_earthquake", keepLimit: true },
  hazard_tornado: { to: "hazard_tornado", keepLimit: true },
  dist_airport_mi: { to: "dist_airport_mi", keepLimit: true },
  dist_coast_mi: { to: "dist_coast_mi", keepLimit: true },
  dist_metro_mi: { to: "dist_metro_mi", keepLimit: true },
};

/** County metrics that are area measures now: not offered at the county level. */
export const COUNTY_METRICS_NOW_AREA = new Set(Object.keys(MOVED_TO_AREAS) as MetricKey[]);

export interface AreaSearch {
  areaWeights: Partial<Record<string, number>>;
  areaDirections: Partial<Record<string, Direction>>;
  areaLimits: Partial<Record<string, { min?: number; max?: number }>>;
}

/** One area-level measure ranking areas. */
export interface AreaCriterion {
  column: string;
  label: string;
  weight: number;
  direction: Direction;
}

export interface AreaLimit {
  column: string;
  label: string;
  min?: number;
  max?: number;
}

const clampWeight = (w: number | undefined) =>
  w === undefined || !Number.isFinite(w) ? 0 : Math.min(MAX_WEIGHT, Math.max(0, w));

/** The area-level priorities and limits of a search, most important first. */
export function areaCriteria(search: AreaSearch): { criteria: AreaCriterion[]; limits: AreaLimit[] } {
  const criteria: AreaCriterion[] = [];
  const limits: AreaLimit[] = [];
  for (const def of AREA_PRIORITIES) {
    const weight = clampWeight(search.areaWeights[def.key]);
    if (weight > 0) {
      criteria.push({ column: def.key, label: def.label, weight,
        direction: search.areaDirections[def.key] ?? def.defaultDirection });
    }
    const l = search.areaLimits[def.key];
    if (l && (l.min !== undefined || l.max !== undefined)) limits.push({ column: def.key, label: def.label, ...l });
  }
  criteria.sort((a, b) => b.weight - a.weight);
  return { criteria, limits };
}
