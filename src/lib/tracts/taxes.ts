/**
 * Taxes by area (2026-10-13).
 *
 * Property tax rates differ inside a county — by city, township and school district:
 * Washtenaw's areas run from about 1.1% (rural townships) to 2.1% (Ypsilanti city) on the
 * same county figure of 1.49%. So when areas are the results, Taxes is the same sum as a
 * county's (`householdTaxes`) with the area's own rate in place of the county's:
 *
 * - rate: the area's estimate (`property_tax_rate_eb`: its Census rate, weighed toward its
 *   city's typical area for its margin — etl/tracts/national.py), else its rate as published,
 *   else the county's (renter-heavy areas where the Census publishes none);
 * - the new buyer's ratio, the typical home (when no budget is set), the sales tax and the
 *   state's income tax are the county's and state's, as before.
 *
 * The home stays the county's typical home without a budget (plan §9 Phase 10b: the
 * area's own would count home prices twice), so areas in a county differ by their rate.
 *
 * Taxes and the rate limits are then scored per area, not as the county's shared part:
 * `areaTaxSearch` moves them out of the county scoring and into the area criteria.
 * Pure: no UI imports.
 */

import {
  countyTaxInputs,
  getMetric,
  householdTaxes,
  MAX_WEIGHT,
  parseSchedule,
  type CountyDataset,
  type Household,
  type MetricKey,
  type Schedule,
  type ScoringInput,
  type TaxParts,
} from "@/lib/scoring";

import type { NationalAreas } from "./national";
import type { AreaCriterion, AreaLimit } from "./scoring";

/** Columns `withAreaTaxes` adds: $/yr for the household, and the rate a limit tests. */
export const AREA_TAXES = "taxes";
export const AREA_TAX_RATE = "taxes_rate";

export interface AreaTaxes extends TaxParts {
  /** The property tax rate used, %. */
  rate: number;
  /** Whose rate it is: the area's own, or its county's where the area has none. */
  rateSource: "area" | "county";
}

/** The area's own rate for the estimate: its estimate, else as published; NaN if neither. */
export function areaTaxRate(areas: NationalAreas, i: number): number {
  const eb = areas.values.get("property_tax_rate_eb")?.[i] ?? NaN;
  const own = areas.values.get("property_tax_rate")?.[i] ?? NaN;
  return Number.isFinite(own) && Number.isFinite(eb) ? eb : own;
}

/**
 * The household's taxes in county `ci` with an area's own rate (NaN: the county's). Null
 * when an input is unknown.
 */
export function taxesAtRate(
  data: CountyDataset,
  ci: number,
  own: number,
  schedule: Schedule | "none" | null,
  household: Household = {},
): AreaTaxes | null {
  const inputs = countyTaxInputs(data, ci);
  const rate = Number.isFinite(own) ? own : inputs.rate;
  const t = householdTaxes({ ...inputs, rate }, schedule, household);
  return t && { ...t, rate, rateSource: Number.isFinite(own) ? "area" : "county" };
}

/** One area's yearly taxes for the household; null when an input is unknown. */
export function areaTaxes(
  areas: NationalAreas,
  i: number,
  data: CountyDataset,
  schedule: Schedule | "none" | null,
  household: Household = {},
): AreaTaxes | null {
  const ci = data.indexByFips.get(areas.county[i]);
  return ci === undefined ? null : taxesAtRate(data, ci, areaTaxRate(areas, i), schedule, household);
}

/** What an area page needs to estimate its taxes: its county, the state's schedule, the household. */
export interface AreaTaxContext {
  data: CountyDataset;
  /** The county's row in `data`. */
  index: number;
  schedule: Schedule | "none" | null;
  household: Household;
  /**
   * The area's own rate (`areaTaxRate`): its estimate is in the national file only, so this
   * is unset until that file loads and the page uses the published rate meanwhile.
   */
  rate?: number;
}

/**
 * A copy of the areas with `taxes` ($/yr for this household, NaN where unknown) and
 * `taxes_rate` (the area's rate as published, else its county's — what a limit tests and
 * the page shows). `data` must have the state law values applied (`applyStateLaws`).
 */
export function withAreaTaxes(
  areas: NationalAreas,
  data: CountyDataset,
  schedules: Record<string, string | null | undefined>,
  household: Household = {},
): NationalAreas {
  const taxes = new Float64Array(areas.n).fill(NaN);
  const rates = new Float64Array(areas.n).fill(NaN);
  const parsed = new Map<string, Schedule | "none" | null>();
  const published = areas.values.get("property_tax_rate");
  for (let i = 0; i < areas.n; i++) {
    const ci = data.indexByFips.get(areas.county[i]);
    if (ci === undefined) continue;
    const st = data.state[ci];
    if (!parsed.has(st)) parsed.set(st, parseSchedule(schedules[st]));
    const t = areaTaxes(areas, i, data, parsed.get(st)!, household);
    if (t) taxes[i] = t.total;
    const own = published?.[i] ?? NaN;
    rates[i] = Number.isFinite(own) ? own : data.values.property_tax_effective_rate[ci];
  }
  return { ...areas, values: new Map([...areas.values, [AREA_TAXES, taxes], [AREA_TAX_RATE, rates]]) };
}

/** County limits that test an area's own value when areas are ranked: metric → area column. */
const AREA_TAX_LIMITS: Partial<Record<MetricKey, string>> = {
  taxes: AREA_TAXES,
  property_tax_effective_rate: AREA_TAX_RATE,
};

/**
 * A search's taxes, by area: the county scoring without them, and the area criterion and
 * limits that replace them. Used only when areas are the results; ranking counties keeps
 * the county's own Taxes.
 */
export function areaTaxSearch(input: ScoringInput): { county: ScoringInput; criteria: AreaCriterion[]; limits: AreaLimit[] } {
  const raw = input.weights.taxes ?? 0;
  const weight = Number.isFinite(raw) ? Math.min(MAX_WEIGHT, Math.max(0, raw)) : 0;
  const weights = { ...input.weights };
  delete weights.taxes;
  const criteria: AreaCriterion[] =
    weight > 0 ? [{ column: AREA_TAXES, label: getMetric("taxes").label, weight, direction: "lower", badge: "Lowest taxes" }] : [];
  const limits: AreaLimit[] = [];
  const filters = (input.filters ?? []).filter((f) => {
    const column = AREA_TAX_LIMITS[f.metric];
    if (!column) return true;
    limits.push({ column, label: getMetric(f.metric).label, min: f.min, max: f.max });
    return false;
  });
  return { county: { ...input, weights, filters }, criteria, limits };
}
