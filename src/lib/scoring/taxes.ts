/**
 * Taxes in dollars a year (plan §9 Phase 10b, 2026-10-12).
 *
 * "Low taxes" used to be three rates, each its own priority: the state's top income tax
 * rate, its sales tax, and the county's property tax rate. Rates mislead — Teton County,
 * WY has a property tax rate lower than 98% of US areas, but the bill on its typical
 * home is higher than about 90% of them — and three priorities made one wish count three
 * times. Now Taxes is one county-wide measure: what a household pays a year in
 *
 * - property tax: the county's effective rate × what a new buyer pays over the average
 *   owner (`new_buyer_ratio`: assessments capped until a sale — Michigan, California,
 *   Florida, Texas… — make a buyer's bill higher) × the home price — the person's budget
 *   when they're buying with one, else the county's typical home at today's prices
 *   (`home_value_today`, Zillow). Renters pay it through rent, which rent already covers,
 *   so it isn't counted for them;
 * - state income tax: the state's brackets (`income_tax_brackets`, Tax Foundation) on
 *   the household's income — the person's, else the US median household income;
 * - sales tax: the combined state and average local rate on the taxable part of
 *   spending, `TAXABLE_SPENDING_SHARE` of income.
 *
 * Areas (2026-10-13) use the same sum with their own property tax rate in place of the
 * county's (`@/lib/tracts/taxes`); the rest is the county's or the state's.
 *
 * Not in it: local income taxes (New York City, Ohio cities, Maryland counties,
 * Pennsylvania's earned income tax), credits other than the personal exemption,
 * federal taxes (the same everywhere). Pure: no UI imports.
 */

import type { CountyDataset } from "./dataset";

/** US median household income, ACS 2019–2023 5-year (B19013, United States). */
export const US_MEDIAN_HOUSEHOLD_INCOME = 78_538;

/**
 * Share of income spent on purchases that pay sales tax. Tax Foundation puts state sales
 * tax bases at about 23–31% of personal income (median to mean), and those bases include
 * business purchases, so a household's own taxable spending is near the low end.
 */
export const TAXABLE_SPENDING_SHARE = 0.25;

export type Tenure = "buy" | "rent";
export type Filing = "single" | "joint";

/** What the person told us about themselves (Filters → What I'm looking for). All optional. */
export interface Household {
  tenure?: Tenure;
  /** Home price when buying, monthly rent when renting. */
  budget?: number;
  /** Household income a year. */
  income?: number;
  filing?: Filing;
}

export interface Bracket {
  rate: number;
  over: number;
}

export interface Schedule {
  single: Bracket[];
  joint: Bracket[];
  /** [single, joint] */
  deduction: [number, number];
  exemption: [number, number];
  credit: [number, number];
}

/**
 * The law table's compact form (etl/laws/sources/taxfoundation.py `encode_schedule`):
 * "s:0.02@0,0.04@500;m:…;sd:3000,8500;ex:1500,3000;cr:0,0", or "none". Null if unreadable.
 */
export function parseSchedule(text: string | null | undefined): Schedule | "none" | null {
  if (!text) return null;
  if (text.trim() === "none") return "none";
  const parts = new Map(
    text.split(";").map((p) => {
      const i = p.indexOf(":");
      return [p.slice(0, i), p.slice(i + 1)] as const;
    }),
  );
  const brackets = (s: string | undefined) =>
    (s ?? "")
      .split(",")
      .filter(Boolean)
      .map((b) => {
        const [rate, over] = b.split("@").map(Number);
        return { rate, over };
      })
      .sort((a, b) => a.over - b.over);
  const pair = (s: string | undefined): [number, number] => {
    const [a = 0, b = 0] = (s ?? "").split(",").map(Number);
    return [a, b];
  };
  const single = brackets(parts.get("s"));
  const joint = brackets(parts.get("m"));
  const all = [...single, ...joint];
  if (single.length === 0 || all.some((b) => !Number.isFinite(b.rate) || !Number.isFinite(b.over))) return null;
  return {
    single,
    joint: joint.length ? joint : single,
    deduction: pair(parts.get("sd")),
    exemption: pair(parts.get("ex")),
    credit: pair(parts.get("cr")),
  };
}

/** State income tax on a year's income, in dollars. */
export function incomeTax(schedule: Schedule | "none", income: number, filing: Filing = "joint"): number {
  if (schedule === "none" || !(income > 0)) return 0;
  const k = filing === "joint" ? 1 : 0;
  const brackets = filing === "joint" ? schedule.joint : schedule.single;
  const taxable = Math.max(0, income - schedule.deduction[k] - schedule.exemption[k]);
  let tax = 0;
  for (let b = 0; b < brackets.length; b++) {
    const top = b + 1 < brackets.length ? brackets[b + 1].over : Infinity;
    if (taxable > brackets[b].over) tax += brackets[b].rate * (Math.min(taxable, top) - brackets[b].over);
  }
  return Math.max(0, tax - schedule.credit[k]);
}

export interface TaxParts {
  property: number;
  /** The county rate's multiplier for a new buyer (1 where none is known). */
  newBuyer: number;
  income: number;
  sales: number;
  total: number;
  /** The home price the property tax is on, or null when it isn't counted (renting). */
  home: number | null;
  /** The income the income and sales tax are on. */
  householdIncome: number;
}

/** What a place's tax bill is made of, before the household is applied. */
export interface TaxInputs {
  /** Effective property tax rate, % of value (all owners). */
  rate: number;
  /** A new buyer's rate over all owners' (1 where none is known). */
  newBuyer: number;
  /** The typical home today, for property tax when no budget is set. */
  typicalHome: number;
  /** Combined state and average local sales tax, %. */
  sales: number;
}

/**
 * A household's yearly taxes from a place's inputs. Null when an input it needs is
 * unknown: the income tax schedule or sales tax always; the rate or home when buying.
 */
export function householdTaxes(
  inputs: TaxInputs,
  schedule: Schedule | "none" | null,
  household: Household = {},
): TaxParts | null {
  const income = household.income && household.income > 0 ? household.income : US_MEDIAN_HOUSEHOLD_INCOME;
  const home =
    household.tenure === "rent"
      ? null
      : household.tenure === "buy" && household.budget && household.budget > 0
        ? household.budget
        : inputs.typicalHome;
  const newBuyer = Number.isFinite(inputs.newBuyer) && inputs.newBuyer > 0 ? inputs.newBuyer : 1;
  if (schedule === null || !Number.isFinite(inputs.sales)) return null;
  if (home !== null && !(Number.isFinite(home) && Number.isFinite(inputs.rate))) return null;
  const property = home === null ? 0 : (inputs.rate / 100) * newBuyer * home;
  const inc = incomeTax(schedule, income, household.filing ?? "joint");
  const sale = (inputs.sales / 100) * TAXABLE_SPENDING_SHARE * income;
  return { property, newBuyer, income: inc, sales: sale, total: property + inc + sale, home, householdIncome: income };
}

/** A county's tax inputs: its own rate, new-buyer ratio, typical home today and sales tax. */
export function countyTaxInputs(data: CountyDataset, i: number): TaxInputs {
  const today = data.info.home_value_today?.[i];
  return {
    rate: data.values.property_tax_effective_rate[i],
    newBuyer: data.info.new_buyer_ratio?.[i] ?? NaN,
    typicalHome: Number.isFinite(today) ? today : data.values.median_home_value[i],
    sales: data.values.sales_tax_combined[i],
  };
}

/**
 * One county's yearly taxes for the household. Null parts are unknown inputs: no
 * property tax rate or home value, no income tax schedule, no sales tax rate.
 */
export function countyTaxes(
  data: CountyDataset,
  i: number,
  schedule: Schedule | "none" | null,
  household: Household = {},
): TaxParts | null {
  return householdTaxes(countyTaxInputs(data, i), schedule, household);
}

/**
 * The dataset with its `taxes` column filled for this household (dollars a year, NaN where
 * an input is unknown). Run after the law values are applied (`applyStateLaws`).
 * `schedules`: each state's `income_tax_brackets` value.
 */
export function withTaxes(
  data: CountyDataset,
  schedules: Record<string, string | null | undefined>,
  household: Household = {},
): CountyDataset {
  const parsed = new Map<string, Schedule | "none" | null>();
  const taxes = new Float64Array(data.n).fill(NaN);
  for (let i = 0; i < data.n; i++) {
    const st = data.state[i];
    if (!parsed.has(st)) parsed.set(st, parseSchedule(schedules[st]));
    const t = countyTaxes(data, i, parsed.get(st)!, household);
    if (t) taxes[i] = t.total;
  }
  return { ...data, values: { ...data.values, taxes } };
}
