/**
 * The metrics the scoring engine can weight or filter on.
 *
 * Each key is a column in `public/data/counties.json`. Columns that exist only
 * for provenance or display (lat/lon, station ids, vintages) are deliberately
 * absent — they are not things a person would want to rank places by.
 *
 * `defaultDirection` is what "better" means for most people. It is a default,
 * not a rule: whether a hot summer is good is a matter of taste, so the
 * scoring input can change it for any metric (see `ScoringInput.directions`).
 */

/**
 * What "better" means for a metric:
 * - `higher` / `lower`: the more (or less), the better.
 * - `middle`: the closer to the typical county, the better — "average rain,
 *   not a little or a lot". Typical means the MEDIAN county (50th
 *   percentile), not the arithmetic mean, which extremes drag around
 *   (a few 200-inch mountain counties pull mean snowfall far above typical).
 */
export type Direction = "higher" | "lower" | "middle";

export const DIRECTIONS: readonly Direction[] = ["lower", "middle", "higher"];

export type MetricGroup = "people" | "housing" | "cost" | "schools" | "climate" | "hazards" | "location" | "taxes";

export interface MetricDef {
  key: string;
  label: string;
  unit: string;
  group: MetricGroup;
  defaultDirection: Direction;
  /**
   * `state`: not a column of counties.json — every county takes its state's
   * value from the law table (public/data/laws.json, same key). See
   * `applyStateLaws` in src/lib/laws.
   */
  scope?: "state";
}

export const METRICS = [
  // people
  { key: "population", label: "County population", unit: "people", group: "people", defaultDirection: "higher" },
  { key: "median_household_income", label: "Median household income", unit: "$", group: "people", defaultDirection: "higher" },
  { key: "real_income", label: "Income adjusted for local prices", unit: "$", group: "people", defaultDirection: "higher" },
  // Racial equality (2026-10-04, etl/sources/equality.py): income parity between groups
  // and residential integration, 0–100. County-wide: both compare neighborhoods.
  { key: "racial_equality", label: "Racial equality", unit: "of 100", group: "people", defaultDirection: "higher" },
  // BLS LAUS, latest annual average
  { key: "unemployment_rate", label: "Unemployment rate", unit: "%", group: "people", defaultDirection: "lower" },

  // housing
  { key: "median_home_value", label: "Median home value", unit: "$", group: "housing", defaultDirection: "lower" },
  { key: "median_gross_rent", label: "Median rent", unit: "$/mo", group: "housing", defaultDirection: "lower" },
  { key: "home_value_to_income", label: "Home price to income", unit: "×", group: "housing", defaultDirection: "lower" },
  { key: "rent_to_income", label: "Rent share of income", unit: "ratio", group: "housing", defaultDirection: "lower" },
  { key: "price_to_rent", label: "Price to rent", unit: "×", group: "housing", defaultDirection: "lower" },
  // Census ACS: aggregate property taxes paid / aggregate home value, owner-occupied (LAWS.md)
  { key: "property_tax_effective_rate", label: "Property tax rate", unit: "%", group: "housing", defaultDirection: "lower" },

  // cost of living (BEA Regional Price Parities; 100 = national average)
  { key: "rpp_all", label: "Cost of living", unit: "index", group: "cost", defaultDirection: "lower" },
  { key: "rpp_rents", label: "Cost of living: rents", unit: "index", group: "cost", defaultDirection: "lower" },
  { key: "rpp_utilities", label: "Cost of living: utilities", unit: "index", group: "cost", defaultDirection: "lower" },
  // EIA average residential price, statewide (LAWS.md)
  { key: "electricity_price_cents_kwh", label: "Electricity price", unit: "¢/kWh", group: "cost", defaultDirection: "lower", scope: "state" },
  { key: "rpp_goods", label: "Cost of living: goods", unit: "index", group: "cost", defaultDirection: "lower" },
  { key: "rpp_services", label: "Cost of living: services", unit: "index", group: "cost", defaultDirection: "lower" },

  // schools (SEDA; grade levels above/below the national average)
  { key: "school_achievement", label: "School achievement", unit: "grades", group: "schools", defaultDirection: "higher" },

  // climate (NOAA 1991–2020 normals). The year is described by its two ends
  // plus how long the extremes last — see Working Master Plan §6 "Climate
  // preferences". The 3-month summer/winter averages stay in the data for
  // display but are not offered here: the hottest/coldest month is the real
  // peak and trough, and is right even where the peak isn't in Jun–Aug.
  { key: "hottest_month_high_f", label: "Hottest month's high", unit: "°F", group: "climate", defaultDirection: "lower" },
  { key: "coldest_month_low_f", label: "Coldest month's low", unit: "°F", group: "climate", defaultDirection: "higher" },
  { key: "days_above_90f", label: "Days above 90°F", unit: "days/yr", group: "climate", defaultDirection: "lower" },
  { key: "nights_below_32f", label: "Nights below freezing", unit: "nights/yr", group: "climate", defaultDirection: "lower" },
  { key: "rainy_days", label: "Rainy days", unit: "days/yr", group: "climate", defaultDirection: "lower" },
  { key: "snow_days", label: "Snowy days (1 in+)", unit: "days/yr", group: "climate", defaultDirection: "lower" },
  { key: "spring_mean_f", label: "Spring average", unit: "°F", group: "climate", defaultDirection: "higher" },
  { key: "fall_mean_f", label: "Fall average", unit: "°F", group: "climate", defaultDirection: "higher" },
  { key: "annual_precip_in", label: "Annual precipitation", unit: "in", group: "climate", defaultDirection: "lower" },
  { key: "annual_snow_in", label: "Annual snowfall", unit: "in", group: "climate", defaultDirection: "lower" },

  // natural hazards (FEMA National Risk Index): national percentile of the
  // expected annual LOSS RATE — the share of what's there lost in a typical year
  { key: "hazard_risk", label: "Natural hazard risk (all)", unit: "pctl", group: "hazards", defaultDirection: "lower" },
  { key: "hazard_hurricane", label: "Hurricanes", unit: "pctl", group: "hazards", defaultDirection: "lower" },
  { key: "hazard_wildfire", label: "Wildfire", unit: "pctl", group: "hazards", defaultDirection: "lower" },
  { key: "hazard_inland_flood", label: "Inland flooding", unit: "pctl", group: "hazards", defaultDirection: "lower" },
  { key: "hazard_coastal_flood", label: "Coastal flooding", unit: "pctl", group: "hazards", defaultDirection: "lower" },
  { key: "hazard_earthquake", label: "Earthquakes", unit: "pctl", group: "hazards", defaultDirection: "lower" },
  { key: "hazard_tornado", label: "Tornadoes", unit: "pctl", group: "hazards", defaultDirection: "lower" },

  // location: miles from where people live (population center)
  { key: "dist_airport_mi", label: "Distance to a major airport", unit: "mi", group: "location", defaultDirection: "lower" },
  { key: "dist_coast_mi", label: "Distance to the coast", unit: "mi", group: "location", defaultDirection: "lower" },
  { key: "dist_metro_mi", label: "Distance to a 500k+ metro", unit: "mi", group: "location", defaultDirection: "lower" },

  // state taxes (LAWS.md; Tax Foundation) — shown in the Laws & taxes tab
  { key: "income_tax_top_rate", label: "Income tax (top rate)", unit: "%", group: "taxes", defaultDirection: "lower", scope: "state" },
  { key: "sales_tax_combined", label: "Sales tax (state + avg local)", unit: "%", group: "taxes", defaultDirection: "lower", scope: "state" },
] as const satisfies readonly MetricDef[];

export type MetricKey = (typeof METRICS)[number]["key"];

export const METRIC_KEYS: readonly MetricKey[] = METRICS.map((m) => m.key);

const BY_KEY = new Map<string, MetricDef>(METRICS.map((m) => [m.key, m]));

/**
 * Measures kept as data (county page, cost-of-living breakdown, laws tab) but not offered
 * as filters (owner, 2026-10-04: "fewer filters"):
 * - the cost-of-living parts: "Cost of living" (rpp_all) already covers rents, goods,
 *   utilities and services, and housing has its own rent and home value by area;
 * - electricity price: part of utilities in the cost of living; shown in Laws & taxes;
 * - ratios to the local income (home price to income, rent share of income, price to
 *   rent) and income adjusted for local prices: a mover's own income is what matters,
 *   so they're context on the county page, not something to rank by.
 * A saved search or link that weighted one drops it (a cost-of-living part becomes
 * "Cost of living" when that isn't set) — see `sanitizePreferences`.
 */
export const NOT_IN_FILTERS: ReadonlySet<MetricKey> = new Set<MetricKey>([
  "rpp_rents", "rpp_utilities", "rpp_goods", "rpp_services", "electricity_price_cents_kwh",
  "home_value_to_income", "rent_to_income", "price_to_rent", "real_income",
]);

/** Cost-of-living parts that fold into "Cost of living" when an old search weighted one. */
export const COST_PARTS: readonly MetricKey[] = ["rpp_rents", "rpp_utilities", "rpp_goods", "rpp_services", "electricity_price_cents_kwh"];

export function getMetric(key: MetricKey): MetricDef {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown metric: ${key}`);
  return def;
}

export function isMetricKey(key: string): key is MetricKey {
  return BY_KEY.has(key);
}

/** Metrics whose value is the county's state's, from the law table. */
export const STATE_METRIC_KEYS: readonly MetricKey[] = METRICS.filter(
  (m) => (m as MetricDef).scope === "state",
).map((m) => m.key);
