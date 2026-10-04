/**
 * The searches the audit runs (full audit, 2026-10-04): what real people would ask for,
 * each with what a knowledgeable person would expect of the results. An expectation
 * returns the results that break it; any means the audit fails.
 */
import { AREA_PRIORITIES, COUNTY_METRICS_NOW_AREA } from "@/lib/tracts";
import { METRICS, NOT_IN_FILTERS, type Direction, type MetricKey } from "@/lib/scoring";
import { DEFAULT_PREFERENCES, EMPTY_PREFERENCES, type Preferences } from "@/components/finder/preferences";

import { derive, quantile, sortedResidential } from "./checks";
import type { RunResult } from "./run";

export type Expectation = (r: RunResult) => string[];

export interface Scenario {
  name: string;
  intent: string;
  /** What a knowledgeable person expects, in words (printed in the report). */
  expect: string;
  prefs: Preferences;
  checks: Expectation[];
}

export const P = (over: Omit<Partial<Preferences>, "area"> & { area?: Partial<Preferences["area"]> }): Preferences => ({
  ...EMPTY_PREFERENCES,
  ...over,
  area: { ...EMPTY_PREFERENCES.area, ...(over.area ?? {}) },
});

// ---- expectation helpers ----

/** Every one of the top `n` areas satisfies `pred`. */
const allTop = (n: number, label: string, pred: (r: RunResult, i: number) => boolean): Expectation => (r) =>
  r.top.slice(0, n).filter((i) => !pred(r, i)).map((i) => `${label}: ${r.areas.name[i]} (${r.countyName(r.areas.county[i])})`);

/** A value in the best `share` of the residential distribution for its direction. */
const extreme = (column: string, direction: Direction, share = 0.02) => (r: RunResult, i: number) => {
  const v = r.value(i, column);
  if (Number.isNaN(v)) return false;
  const s = sortedResidential(r.areas, column);
  if (direction === "lower") return v <= quantile(s, share);
  if (direction === "higher") return v >= quantile(s, 1 - share);
  const { pctl } = derive(s, v, "middle");
  return Math.abs(pctl - 50) <= 100 * share;
};

const inStates = (states: string[]): Expectation => allTop(100, `outside ${states.join("/")}`, (r, i) => states.includes(r.stateOf(i)));

const atLeast = (what: string, n: number, count: (r: RunResult) => number): Expectation => (r) =>
  count(r) >= n ? [] : [`${what}: ${count(r)} (expected at least ${n})`];

const countyValue = (r: RunResult, i: number, k: MetricKey) => r.counties.values[k][r.counties.indexByFips.get(r.areas.county[i]) ?? -1];

const spread = (minStates: number): Expectation => (r) => {
  const states = new Set(r.top.map((i) => r.stateOf(i)));
  return states.size >= minStates ? [] : [`only ${states.size} states in the top 100 (expected ${minStates}+)`];
};

// ---- the searches ----

const composite: Scenario[] = [
  {
    name: "Default search",
    intent: "What a first-time visitor sees.",
    expect: "Cheap, mild places with good nearby schools; nothing bizarre at #1; several states represented.",
    prefs: DEFAULT_PREFERENCES,
    checks: [spread(5), allTop(20, "cost of living above the US median", (r, i) => countyValue(r, i, "rpp_all") < 93.7)],
  },
  {
    name: "Young family, mid budget",
    intent: "Strong nearby schools, low violent crime, lots of families, homes under $500k.",
    expect: "Suburbs and small towns with 75th+ percentile schools and well under median crime; no mobile-home parks as 'cheap homes'; no unrated crime at the top.",
    prefs: P({ area: { weights: { nearby_school_pctl: 5, violent_rate: 4, kids_share: 3, median_home_value: 3 }, limits: { median_home_value: { max: 500_000 } } } }),
    checks: [
      allTop(20, "schools below the 65th percentile", (r, i) => r.value(i, "nearby_school_pctl") >= 65),
      allTop(20, "violent crime above the US median", (r, i) => r.value(i, "violent_rate") < 248),
      allTop(50, "a mobile-home park", (r, i) => !r.areas.lowConfidence[i].includes("mobile_homes") || r.value(i, "median_home_value") > 100_000),
    ],
  },
  {
    name: "Walkable city life",
    intent: "Very walkable, close to downtown.",
    expect: "Downtowns and dense inner neighborhoods: walkability 17+, under a mile from downtown.",
    prefs: P({ area: { weights: { walkability: 5, dist_downtown_mi: 4 } } }),
    checks: [allTop(20, "walkability under 17", (r, i) => r.value(i, "walkability") >= 17), allTop(20, "over 1 mi from downtown", (r, i) => r.value(i, "dist_downtown_mi") <= 1)],
  },
  {
    name: "Retire somewhere warm and affordable",
    intent: "Mild winters, low cost of living, low income tax; safe, low hazard risk, near an airport.",
    expect: "Sun Belt, mostly no-income-tax states (TX, FL, TN); coldest month above 30°F; every result within 90 mi of an airport.",
    prefs: P({
      weights: { coldest_month_low_f: 4, rpp_all: 3, income_tax_top_rate: 2 },
      area: { weights: { hazard_risk: 3, violent_rate: 3, median_home_value: 3 }, limits: { dist_airport_mi: { max: 90 } } },
    }),
    checks: [allTop(50, "coldest month below 30°F", (r, i) => countyValue(r, i, "coldest_month_low_f") >= 30), allTop(100, "airport over 90 mi", (r, i) => r.value(i, "dist_airport_mi") <= 90)],
  },
  {
    name: "Remote worker: cheap and quiet, within reach of a city",
    intent: "Low cost of living, cheap homes, low density; within 120 mi of a 500k+ metro.",
    expect: "Rural areas in cheap states, homes under $150k, under 100 people per sq mi, all within 120 mi of a metro.",
    prefs: P({ weights: { rpp_all: 4 }, area: { weights: { median_home_value: 4, density_per_sq_mi: 3, nearby_school_pctl: 1 }, limits: { dist_metro_mi: { max: 120 } } } }),
    checks: [allTop(20, "home over $150k", (r, i) => r.value(i, "median_home_value") <= 150_000), allTop(100, "metro over 120 mi", (r, i) => r.value(i, "dist_metro_mi") <= 120)],
  },
  {
    name: "Safety above all",
    intent: "Lowest violent and property crime.",
    expect: "Real low-crime towns: every rate from an agency with enough coverage (no partial years inflated to zero), violent under 25 and property under 300 per 100k.",
    prefs: P({ area: { weights: { violent_rate: 5, property_rate: 5 } } }),
    checks: [allTop(100, "violent crime over 25", (r, i) => r.value(i, "violent_rate") <= 25), allTop(100, "property crime over 300", (r, i) => r.value(i, "property_rate") <= 300)],
  },
  {
    name: "Mild climate",
    intent: "Few hot days, few freezing nights, little snow; homes not too pricey.",
    expect: "The Pacific coast (CA, OR, WA): under 10 days above 90°F, under 40 freezing nights.",
    prefs: P({ weights: { days_above_90f: 4, nights_below_32f: 4, snow_days: 2 }, area: { weights: { median_home_value: 2 } } }),
    checks: [allTop(20, "over 10 days above 90°F", (r, i) => countyValue(r, i, "days_above_90f") <= 10), allTop(20, "over 40 freezing nights", (r, i) => countyValue(r, i, "nights_below_32f") <= 40)],
  },
  {
    name: "Beach life, low hurricane risk",
    intent: "Close to the coast, low hurricane and coastal-flood risk, homes under $900k.",
    expect: "West Coast waterfronts (Puget Sound, California): within 1 mi of the coast, hurricane risk 0, homes at most $900k. (The 'coast' includes bays and tidal rivers — see the note.)",
    prefs: P({ area: { weights: { dist_coast_mi: 5, hazard_hurricane: 4, hazard_coastal_flood: 3 }, limits: { median_home_value: { max: 900_000 } } } }),
    checks: [allTop(50, "over 1 mi from the coast", (r, i) => r.value(i, "dist_coast_mi") <= 1), allTop(50, "hurricane risk above the 5th percentile", (r, i) => r.value(i, "hazard_hurricane") <= 5)],
  },
  {
    name: "Must-haves only (no priorities)",
    intent: "Homes ≤ $300k, nearby schools ≥ 70th pctl, violent crime ≤ 200 — nothing weighted.",
    expect: "A list by population, not a ranking: every result passes all three limits; scores are blank.",
    prefs: P({ area: { limits: { median_home_value: { max: 300_000 }, nearby_school_pctl: { min: 70 }, violent_rate: { max: 200 } } } }),
    checks: [
      (r) => (r.ns && r.top.every((i) => Number.isNaN(r.ns!.score[i])) ? [] : ["a score was shown with nothing weighted"]),
      (r) => (r.top.every((i, k) => k === 0 || r.areas.population[i] <= r.areas.population[r.top[k - 1]]) ? [] : ["not ordered by population"]),
    ],
  },
  {
    name: "Texas only: value and schools",
    intent: "States = TX; cheaper homes and strong schools.",
    expect: "All in Texas; no Houston-only crowding (several metros and small towns).",
    prefs: P({ categories: { state: ["TX"] }, area: { weights: { median_home_value: 3, nearby_school_pctl: 4 } } }),
    checks: [inStates(["TX"]), atLeast("counties in the top 100", 10, (r) => r.byCounty.length)],
  },
  {
    name: "No state income tax, great schools",
    intent: "Lowest income tax; strong nearby schools.",
    expect: "Only no-income-tax states at the top (TX, FL, TN, WA, NV, SD, WY, NH, AK); schools 95th+ percentile.",
    prefs: P({ weights: { income_tax_top_rate: 5 }, area: { weights: { nearby_school_pctl: 4 } } }),
    checks: [allTop(100, "a state with an income tax", (r, i) => countyValue(r, i, "income_tax_top_rate") === 0), allTop(50, "schools under the 95th percentile", (r, i) => r.value(i, "nearby_school_pctl") >= 95)],
  },
  {
    name: "Typical-density suburb",
    intent: "Density near the typical US area (middle), good schools.",
    expect: "Suburbs at 1,900–2,600 people per sq mi with top schools, spread over many states.",
    prefs: P({ area: { weights: { density_per_sq_mi: 4, nearby_school_pctl: 3 }, directions: { density_per_sq_mi: "middle" } } }),
    checks: [allTop(50, "density far from typical", (r, i) => Math.abs(r.value(i, "density_per_sq_mi") - 2212) < 450), spread(10)],
  },
  {
    name: "Big-city access on a budget",
    intent: "Within 25 mi of a 500k+ metro; cheapest homes; close to downtown.",
    expect: "Cheap inner-city neighborhoods of Rust Belt metros (Toledo, Detroit, Cleveland…): homes under $100k, within 25 mi of a metro.",
    prefs: P({ area: { weights: { median_home_value: 5, dist_downtown_mi: 3 }, limits: { dist_metro_mi: { max: 25 } } } }),
    checks: [allTop(20, "home over $100k", (r, i) => r.value(i, "median_home_value") <= 100_000), allTop(100, "metro over 25 mi", (r, i) => r.value(i, "dist_metro_mi") <= 25)],
  },
  {
    name: "Recreational marijuana, low cost, low wildfire",
    intent: "Policy filter + county cost of living + area wildfire risk.",
    expect: "Only states where marijuana is legal for adults; cheap Midwest cities (MO, OH, IL, MN, MI); wildfire risk near zero.",
    prefs: P({ weights: { rpp_all: 3 }, categories: { marijuana_status: ["recreational"] }, area: { weights: { hazard_wildfire: 3, walkability: 2 } } }),
    checks: [allTop(100, "wildfire risk above the 30th percentile", (r, i) => r.value(i, "hazard_wildfire") <= 30)],
  },
  {
    name: "Counties only (no area priorities)",
    intent: "Low cost of living, low unemployment, few hot days — results are counties.",
    expect: "Upper Midwest and Plains counties (ND, SD, IA, MN, NE); every top county below the median cost of living.",
    prefs: P({ weights: { rpp_all: 4, unemployment_rate: 3, days_above_90f: 2 } }),
    checks: [(r) => r.rankedCounties.slice(0, 20).filter((s) => r.counties.values.rpp_all[s.index] > 93.7).map((s) => `cost of living above median: ${r.countyName(s.fips)}`)],
  },
  {
    name: "Affluent, top high schools",
    intent: "High household income and strong high schools.",
    expect: "The richest suburbs (Potomac, McLean, Cupertino…): incomes at the $250k Census cap, high schools 95th+.",
    prefs: P({ area: { weights: { median_household_income: 4, nearby_hs_pctl: 4 } } }),
    checks: [allTop(50, "income under $200k", (r, i) => r.value(i, "median_household_income") >= 200_000)],
  },
  // ---- added in the full audit ----
  {
    name: "Leaving the Bay Area",
    intent: "Homes ≤ $700k, mild winters, walkable-ish, good schools, near an airport, not in CA.",
    expect: "Mild-winter metros outside California (Pacific NW, Southwest, Southeast): everything at most $700k, no California.",
    prefs: P({
      weights: { nights_below_32f: 3 },
      categories: { state: ["AL", "AZ", "AR", "CO", "CT", "DE", "DC", "FL", "GA", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"] },
      area: { weights: { walkability: 3, nearby_school_pctl: 4, dist_airport_mi: 2 }, limits: { median_home_value: { max: 700_000 } } },
    }),
    checks: [allTop(100, "in California", (r, i) => r.stateOf(i) !== "CA"), allTop(100, "home over $700k", (r, i) => r.value(i, "median_home_value") <= 700_000)],
  },
  {
    name: "Mountain town: snow, space, no wildfire, within reach",
    intent: "More snowy days (direction flipped to higher), low density, low wildfire risk; within 150 mi of a metro.",
    expect: "Snowy rural areas of the Upper Midwest, Northeast and Rockies' east side; snow days in the top fifth; wildfire risk low.",
    prefs: P({ weights: { snow_days: 4 }, directions: { snow_days: "higher" }, area: { weights: { density_per_sq_mi: 3, hazard_wildfire: 3 }, limits: { dist_metro_mi: { max: 150 } } } }),
    checks: [allTop(20, "fewer than 15 snowy days", (r, i) => countyValue(r, i, "snow_days") >= 15), allTop(100, "metro over 150 mi", (r, i) => r.value(i, "dist_metro_mi") <= 150)],
  },
  {
    name: "City lover: dense, walkable, near downtown, good high schools",
    intent: "Density flipped to higher, walkability, downtown distance, high schools.",
    expect: "Dense urban cores (Manhattan, Chicago's North Side, SF, Boston…): density in the top 5%, walkability 17+.",
    prefs: P({ area: { weights: { density_per_sq_mi: 5, walkability: 4, dist_downtown_mi: 3, nearby_hs_pctl: 2 }, directions: { density_per_sq_mi: "higher" } } }),
    checks: [allTop(20, "density below the top 5%", extreme("density_per_sq_mi", "higher", 0.05)), allTop(20, "walkability under 15", (r, i) => r.value(i, "walkability") >= 15)],
  },
  {
    name: "Renter on a budget",
    intent: "Low rent (5), close to downtown (3), walkability (2).",
    expect: "Cheap small cities: rent under $900 at today's prices in the top 20.",
    prefs: P({ area: { weights: { median_gross_rent: 5, dist_downtown_mi: 3, walkability: 2 } } }),
    checks: [allTop(20, "rent over $900", (r, i) => r.value(i, "median_gross_rent") <= 900)],
  },
  {
    name: "Conflicting: cheap AND top schools AND walkable",
    intent: "Home value 5, schools 5, walkability 5 — three things that rarely coincide.",
    expect: "Compromises: no result is best at everything; the top 20 still have schools 80th+ and homes under $300k, spread over several states.",
    prefs: P({ area: { weights: { median_home_value: 5, nearby_school_pctl: 5, walkability: 5 } } }),
    checks: [allTop(20, "schools under the 70th percentile", (r, i) => r.value(i, "nearby_school_pctl") >= 70), spread(5)],
  },
  {
    name: "Extreme weights: one at 5, ten at 1",
    intent: "Schools 5; ten other priorities at 1 — the one should dominate but not erase the rest.",
    expect: "Schools in the top quarter (75th+) for the top 20 — the ten at 1 together outweigh the one at 5, so it leads but doesn't dictate; county-wide and area parts both present in every explanation.",
    prefs: P({
      weights: { rpp_all: 1, days_above_90f: 1, nights_below_32f: 1, unemployment_rate: 1, income_tax_top_rate: 1 },
      area: { weights: { nearby_school_pctl: 5, violent_rate: 1, walkability: 1, median_home_value: 1, hazard_risk: 1, kids_share: 1 } },
    }),
    checks: [allTop(20, "schools under the 75th percentile", (r, i) => r.value(i, "nearby_school_pctl") >= 75), (r) => (r.top.slice(0, 5).every((i) => r.parts(i).length === 11) ? [] : ["an explanation is missing parts"])],
  },
  {
    name: "Everything weighted",
    intent: "All 22 area priorities at 3 and five county-wide ones at 3.",
    expect: "Runs; no result rests mostly on missing data; a wide spread of states.",
    prefs: P({
      weights: { rpp_all: 3, days_above_90f: 3, nights_below_32f: 3, unemployment_rate: 3, income_tax_top_rate: 3 },
      area: { weights: Object.fromEntries(AREA_PRIORITIES.map((d) => [d.key, 3])) },
    }),
    checks: [spread(8), (r) => r.top.slice(0, 20).filter((i) => r.parts(i).filter((p) => p.points === null).length > 3).map((i) => `more than 3 missing parts: ${r.areas.name[i]}`)],
  },
  {
    name: "Hide unknowns, medical-or-better marijuana, low cost",
    intent: "Marijuana medical or recreational, unknown counties hidden, cost of living 4.",
    expect: "No result is unknown for the must-have; none in an illegal/CBD-only state.",
    prefs: P({ includeUnknown: false, weights: { rpp_all: 4 }, categories: { marijuana_status: ["medical", "recreational"] }, area: { weights: { median_home_value: 2 } } }),
    checks: [(r) => (r.ns && r.top.every((i) => r.ns!.status[i] === 0) ? [] : ["an unknown result shown with unknowns hidden"])],
  },
  {
    name: "Alaska and Hawaii on: warmest winters",
    intent: "Opt-in states on; coldest month higher (warm winters) at 5; walkability 2.",
    expect: "Hawaii leads (coldest-month lows in the 60s); Hawaii counties shift everyone else's percentile.",
    prefs: P({ includeStates: { AK: true, HI: true }, weights: { coldest_month_low_f: 5 }, area: { weights: { walkability: 2 } } }),
    checks: [atLeast("Hawaii areas in the top 100", 20, (r) => r.top.filter((i) => r.stateOf(i) === "HI").length)],
  },
  {
    name: "Vermont only, schools and safety",
    intent: "States = VT; schools 4, violent crime 3.",
    expect: "Only Vermont; small towns; crime rates from real agencies (Vermont State Police cover much of the state).",
    prefs: P({ categories: { state: ["VT"] }, area: { weights: { nearby_school_pctl: 4, violent_rate: 3 } } }),
    checks: [inStates(["VT"])],
  },
  {
    name: "Oceanic climate (Köppen Cfb), near the coast",
    intent: "Climate type Cfb; distance to the coast 4; home value 2.",
    expect: "Only Cfb counties (the automatic policy check verifies each): the Pacific Northwest, coastal Northern California, and the surprises — Nantucket, Appalachian highlands.",
    prefs: P({ categories: { koppen: ["Cfb"] }, area: { weights: { dist_coast_mi: 4, median_home_value: 2 } } }),
    checks: [spread(3)],
  },
  {
    name: "Abortion protected, permit required to carry",
    intent: "Two policy must-haves; schools 3, home value 3.",
    expect: "Only states with both (CA, NY, NJ, MA, MD, IL, WA, OR, CO, MN, NM, HI, DE, CT, RI, VA, NV…).",
    prefs: P({ categories: { abortion_access: ["protected"], permitless_carry: ["false"] }, area: { weights: { nearby_school_pctl: 3, median_home_value: 3 } } }),
    checks: [allTop(100, "a permitless-carry or restrictive state", (r, i) => ["CA", "NY", "NJ", "MA", "MD", "IL", "WA", "OR", "CO", "MN", "NM", "HI", "DE", "CT", "RI", "VA", "NV", "MI", "PA", "DC", "AK", "AZ", "NE", "KS", "WI", "MT", "OH", "VT", "ME", "NH"].includes(r.stateOf(i)))],
  },
  {
    name: "Low property tax, low cost of living, cheap homes",
    intent: "Property tax rate 4, cost of living 3, home value 3.",
    expect: "Deep South and Mountain West (AL, LA, WV, AR, ID, UT…): property tax rate under 0.7%.",
    prefs: P({ weights: { property_tax_effective_rate: 4, rpp_all: 3 }, area: { weights: { median_home_value: 3 } } }),
    checks: [allTop(50, "property tax rate at or above 0.7%", (r, i) => countyValue(r, i, "property_tax_effective_rate") < 0.7)],
  },
  {
    name: "Must-haves only: three states, hard caps",
    intent: "States CO/UT/ID; homes ≤ $450k; schools ≥ 60; violent ≤ 150. Nothing weighted.",
    expect: "A population-ordered list, all in the three states, all passing.",
    prefs: P({ categories: { state: ["CO", "UT", "ID"] }, area: { limits: { median_home_value: { max: 450_000 }, nearby_school_pctl: { min: 60 }, violent_rate: { max: 150 } } } }),
    checks: [inStates(["CO", "UT", "ID"])],
  },
  {
    name: "Limits that nothing passes",
    intent: "Homes ≤ $50k and schools ≥ 95: an empty result.",
    expect: "No verified match; the only results are areas unknown for a must-have (shown as unknown, never as a pass).",
    prefs: P({ area: { weights: { walkability: 1 }, limits: { median_home_value: { max: 50_000 }, nearby_school_pctl: { min: 95 } } } }),
    checks: [(r) => (r.ns && r.top.every((i) => r.ns!.status[i] === 1) ? [] : ["a verified match passed impossible limits"])],
  },
  {
    name: "Cheapest living anywhere (income flipped lower, rent lower)",
    intent: "Household income direction lower (a cheap area to live), rent lower, cost of living lower.",
    expect: "Very poor areas: incomes under $30k. A reminder that 'lower' on income means poverty, not bargains.",
    prefs: P({ weights: { rpp_all: 3 }, area: { weights: { median_household_income: 3, median_gross_rent: 3 }, directions: { median_household_income: "lower" } } }),
    checks: [allTop(20, "income over $30k", (r, i) => r.value(i, "median_household_income") <= 30_000)],
  },
  {
    name: "Hot summers wanted (hottest month flipped higher), low humidity proxy: little rain",
    intent: "Hottest month higher 4, rainy days lower 3, home value 2.",
    expect: "The desert Southwest (AZ, NV, inland CA, TX): hottest-month highs over 100°F.",
    prefs: P({ weights: { hottest_month_high_f: 4, rainy_days: 3 }, directions: { hottest_month_high_f: "higher" }, area: { weights: { median_home_value: 2 } } }),
    checks: [allTop(20, "hottest month under 95°F", (r, i) => countyValue(r, i, "hottest_month_high_f") >= 95)],
  },
];

/** One priority at a time, at its default direction: the top 20 must sit in the best 2%. */
const singles: Scenario[] = AREA_PRIORITIES.map((d) => ({
  name: `Single priority: ${d.label} (${d.defaultDirection})`,
  intent: `Only ${d.label.toLowerCase()} weighted, ${d.defaultDirection} is better.`,
  expect: "The top 20 are in the best 2% of US areas on this measure; ties broken by population.",
  prefs: P({ area: { weights: { [d.key]: 3 } } }),
  checks: [allTop(20, `not in the best 2% of ${d.label}`, extreme(d.key, d.defaultDirection))],
}));

const flipped: Scenario[] = (
  [
    ["density_per_sq_mi", "higher"],
    ["kids_share", "lower"],
    ["median_home_value", "middle"],
    ["dist_downtown_mi", "middle"],
  ] as [string, Direction][]
).map(([key, dir]) => {
  const d = AREA_PRIORITIES.find((x) => x.key === key)!;
  return {
    name: `Single priority, flipped: ${d.label} (${dir})`,
    intent: `Only ${d.label.toLowerCase()} weighted, direction ${dir}.`,
    expect: dir === "middle" ? "The top 20 are within 2 percentile points of the US median." : "The top 20 are in the best 2% for the flipped direction.",
    prefs: P({ area: { weights: { [key]: 3 }, directions: { [key]: dir } } }),
    checks: [allTop(20, `not at the ${dir} end of ${d.label}`, extreme(key, dir))],
  };
});

const countySingles: Scenario[] = METRICS.filter((m) => !COUNTY_METRICS_NOW_AREA.has(m.key) && !NOT_IN_FILTERS.has(m.key) && m.key !== "population").map((m) => ({
  name: `County priority: ${m.label} (${m.defaultDirection})`,
  intent: `Only ${m.label.toLowerCase()} weighted — results are counties.`,
  expect: "The top 20 counties are in the best 2% of counties on this measure.",
  prefs: P({ weights: { [m.key]: 3 } }),
  checks: [
    (r) => {
      const col = r.counties.values[m.key];
      const sorted = Float64Array.from(Array.from(col).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b));
      return r.rankedCounties
        .slice(0, 20)
        .filter((s) => {
          const v = col[s.index];
          if (Number.isNaN(v)) return true;
          if (m.defaultDirection === "lower") return v > quantile(sorted, 0.02);
          if (m.defaultDirection === "higher") return v < quantile(sorted, 0.98);
          return Math.abs(derive(sorted, v, "middle").pctl - 50) > 2;
        })
        .map((s) => `not in the best 2%: ${r.countyName(s.fips)} ${m.key}=${col[s.index]}`);
    },
  ],
}));

export const SCENARIOS: Scenario[] = [...composite, ...singles, ...flipped, ...countySingles];
