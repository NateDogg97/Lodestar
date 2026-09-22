/**
 * The metrics the scoring engine can weight or filter on.
 *
 * Each key is a column in `public/data/counties.json`. Columns that exist only
 * for provenance or display (lat/lon, station ids, vintages) are deliberately
 * absent — they are not things a person would want to rank places by.
 *
 * `defaultDirection` is what "better" means for most people. It is a default,
 * not a rule: whether a hot summer is good is a matter of taste, so the
 * scoring input can flip any metric (see `ScoringInput.directions`).
 */

export type Direction = "higher" | "lower";

export type MetricGroup = "people" | "housing" | "cost" | "schools" | "climate";

export interface MetricDef {
  key: string;
  label: string;
  unit: string;
  group: MetricGroup;
  defaultDirection: Direction;
}

export const METRICS = [
  // people
  { key: "population", label: "Population", unit: "people", group: "people", defaultDirection: "higher" },
  { key: "median_household_income", label: "Median household income", unit: "$", group: "people", defaultDirection: "higher" },
  { key: "real_income", label: "Income adjusted for local prices", unit: "$", group: "people", defaultDirection: "higher" },

  // housing
  { key: "median_home_value", label: "Median home value", unit: "$", group: "housing", defaultDirection: "lower" },
  { key: "median_gross_rent", label: "Median rent", unit: "$/mo", group: "housing", defaultDirection: "lower" },
  { key: "home_value_to_income", label: "Home price to income", unit: "×", group: "housing", defaultDirection: "lower" },
  { key: "rent_to_income", label: "Rent share of income", unit: "ratio", group: "housing", defaultDirection: "lower" },
  { key: "price_to_rent", label: "Price to rent", unit: "×", group: "housing", defaultDirection: "lower" },

  // cost of living (BEA Regional Price Parities; 100 = national average)
  { key: "rpp_all", label: "Cost of living", unit: "index", group: "cost", defaultDirection: "lower" },
  { key: "rpp_rents", label: "Cost of living: rents", unit: "index", group: "cost", defaultDirection: "lower" },
  { key: "rpp_utilities", label: "Cost of living: utilities", unit: "index", group: "cost", defaultDirection: "lower" },
  { key: "rpp_goods", label: "Cost of living: goods", unit: "index", group: "cost", defaultDirection: "lower" },
  { key: "rpp_services", label: "Cost of living: services", unit: "index", group: "cost", defaultDirection: "lower" },

  // schools (SEDA; grade levels above/below the national average)
  { key: "school_achievement", label: "School achievement", unit: "grades", group: "schools", defaultDirection: "higher" },

  // climate (NOAA 1991–2020 normals)
  { key: "summer_high_f", label: "Summer high", unit: "°F", group: "climate", defaultDirection: "lower" },
  { key: "winter_low_f", label: "Winter low", unit: "°F", group: "climate", defaultDirection: "higher" },
  { key: "spring_mean_f", label: "Spring average", unit: "°F", group: "climate", defaultDirection: "higher" },
  { key: "fall_mean_f", label: "Fall average", unit: "°F", group: "climate", defaultDirection: "higher" },
  { key: "annual_precip_in", label: "Annual precipitation", unit: "in", group: "climate", defaultDirection: "lower" },
  { key: "annual_snow_in", label: "Annual snowfall", unit: "in", group: "climate", defaultDirection: "lower" },
] as const satisfies readonly MetricDef[];

export type MetricKey = (typeof METRICS)[number]["key"];

export const METRIC_KEYS: readonly MetricKey[] = METRICS.map((m) => m.key);

const BY_KEY = new Map<string, MetricDef>(METRICS.map((m) => [m.key, m]));

export function getMetric(key: MetricKey): MetricDef {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown metric: ${key}`);
  return def;
}

export function isMetricKey(key: string): key is MetricKey {
  return BY_KEY.has(key);
}
