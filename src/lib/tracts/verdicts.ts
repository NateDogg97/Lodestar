/**
 * Plain-language takeaways for the area page's sections (owner, 2026-10-04: "visuals up
 * front, analysis on tap"), and the typical US area they compare with. Pure: no UI.
 */

import type { Direction } from "@/lib/scoring";
import { ordinal } from "@/lib/scoring/format";

/**
 * The typical US area: medians over all 84,119 areas (census tracts), computed
 * 2026-10-04 from the published area files and re-checked in the full audit the same
 * day (residential areas only give the same values within rounding; population-weighted
 * medians differ by a few percent). They move slowly; recompute when the area data is
 * rebuilt from a new Census release.
 */
export const US_TYPICAL = {
  violent_rate: 248,
  property_rate: 1324,
  median_age: 39.7,
  bachelors_share: 29.1,
  owner_share: 70.6,
  kids_share: 29.4,
  highrise_share: 2.1,
  single_family_share: 68.9,
  density_per_sq_mi: 2212,
  commute_minutes: 25.7,
  work_from_home_share: 10.6,
  zhvi_yoy: 1.6,
} as const;

const BETTER = { lower: "lower is better", higher: "higher is better", middle: "typical is best" } as const;

/**
 * Where a priority's value stands, said the way the score reads: "lower than 98% of US
 * areas". Points count ties as wins and `beats` counts them against, so when they differ
 * it says which: "as low as any US area" for the best value shared by many, "lower than or
 * tied with 97%" when the tie is smaller. Only the percentile for "typical is best".
 */
export function standing(p: {
  level: "area" | "county";
  direction: Direction;
  points: number | null;
  beats: number | null;
  rawPercentile: number | null;
}): string {
  const of = p.level === "county" ? "US counties" : "US areas";
  if (p.direction === "middle" || p.points === null || p.beats === null) {
    return `${ordinal(Math.round(p.rawPercentile ?? 0))} percentile of ${of} · ${BETTER.middle}`;
  }
  const word = p.direction === "lower" ? "lower" : "higher";
  if (p.points >= 99.95 && p.beats < 99.5) return `as ${p.direction === "lower" ? "low" : "high"} as any of the ${of}`;
  if (p.points - p.beats >= 1) return `${word} than or tied with ${Math.round(p.points)}% of ${of}`;
  return `${word} than ${Math.round(p.beats)}% of ${of}`;
}

/** FEMA risk percentile in words — the same cutoffs as the county page. */
export function hazardWord(p: number): string {
  return p < 20 ? "Very low" : p < 40 ? "Low" : p < 60 ? "Moderate" : p < 80 ? "High" : "Very high";
}

/** Nearby schools' national percentile. */
export function schoolsVerdict(p: number | null): string {
  if (p === null) return "No scored schools nearby";
  return p >= 75 ? "Strong schools" : p >= 60 ? "Above average" : p >= 40 ? "About average" : p >= 25 ? "Below average" : "Weak schools";
}

/**
 * Violent crime against the typical US area. `note`: the ETL's reason there is no rate
 * (`crime_note`: the agency reported too few months, serves too few people, or reported
 * implausibly little) — then it's "too little to rate", not "no data".
 */
export function safetyVerdict(violent: number | null, note?: string | null): string {
  if (violent === null) return note ? "Too little reported to rate" : "No crime data";
  const r = violent / US_TYPICAL.violent_rate;
  return r < 0.6
    ? "Much safer than a typical US area"
    : r < 0.9
      ? "Safer than a typical US area"
      : r <= 1.15
        ? "About as safe as a typical US area"
        : r <= 2
          ? "More crime than a typical US area"
          : "Much more crime than a typical US area";
}

/** "Young, mostly renters, mostly apartments" — only what stands out. */
export function peopleVerdict(v: {
  age: number | null;
  owners: number | null;
  highrise: number | null;
  singleFamily: number | null;
}): string {
  const bits = [
    v.age === null ? null : v.age < 35 ? "Young" : v.age > 45 ? "Older" : null,
    v.owners === null ? null : v.owners < 40 ? "mostly renters" : v.owners > 75 ? "mostly owners" : null,
    v.highrise !== null && v.highrise >= 40 ? "mostly apartments" : v.singleFamily !== null && v.singleFamily >= 75 ? "mostly houses" : null,
  ].filter((b): b is string => b !== null);
  if (bits.length === 0) return "A mix of ages, owners and renters";
  const s = bits.join(", ");
  return s[0].toUpperCase() + s.slice(1);
}

/** Downtown distance and commute. */
export function aroundVerdict(downtownMi: number | null, commuteMin: number | null): string {
  const d =
    downtownMi === null ? null : downtownMi <= 3 ? "Close to downtown" : downtownMi <= 12 ? `${Math.round(downtownMi)} mi to downtown` : "Far from a downtown";
  const c = commuteMin === null ? null : commuteMin <= 20 ? "short commute" : commuteMin >= 35 ? "long commute" : null;
  if (d && c) return `${d}, ${c}`;
  if (d) return d;
  return c ? c[0].toUpperCase() + c.slice(1) : "Distances below";
}

/** Home values over the last year, against the typical area. */
export function marketVerdict(yoy: number | null): string {
  if (yoy === null) return "No recent price data";
  const pct = `${Math.abs(yoy).toFixed(1)}%`;
  const typical = `typical ${US_TYPICAL.zhvi_yoy >= 0 ? "+" : "−"}${US_TYPICAL.zhvi_yoy}%`;
  return Math.abs(yoy) < 0.5 ? `Prices flat this year (${typical})` : `Prices ${yoy > 0 ? "up" : "down"} ${pct} in a year (${typical})`;
}

/** Overall risk, and the worst single hazard when it stands out. */
export function hazardsVerdict(overall: number | null, hazards: { label: string; p: number | null }[]): string {
  const worst = hazards.filter((h): h is { label: string; p: number } => h.p !== null).sort((a, b) => b.p - a.p)[0];
  if (overall === null) return worst ? `Highest: ${worst.label.toLowerCase()}` : "No hazard data";
  const word = hazardWord(overall);
  if (worst && worst.p >= 80 && overall < 60) return `${word} overall — but ${worst.label.toLowerCase()}`;
  return `${word} risk overall`;
}

/**
 * A county's price-to-rent ratio (median home value ÷ a year of median rent) in words:
 * under 15 buying is cheap next to renting, over 20 renting is (the usual rule of thumb).
 */
export function buyOrRentVerdict(priceToRent: number | null): string {
  if (priceToRent === null) return "No housing data";
  // Judged on the rounded years shown, so "20 years" never reads as one side of the line.
  const years = Math.round(priceToRent);
  if (years < 15) return `Buying is cheap next to renting · a home costs ${years} years of rent`;
  if (years > 20) return `Renting is cheap next to buying · a home costs ${years} years of rent`;
  return `Buying and renting are about even · a home costs ${years} years of rent`;
}

/** Hyphenated city names that metro names would otherwise split ("Winston-Salem, NC"). */
const HYPHENATED = ["Winston-Salem", "Wilkes-Barre"];

/** A metro's first city: "Minneapolis-St. Paul-Bloomington, MN-WI" → "Minneapolis". */
export function metroCity(metro: string): string {
  const head = metro.split(",")[0].trim();
  return HYPHENATED.find((c) => head.startsWith(c)) ?? head.split("-")[0].trim();
}

/** A county's distance to the nearest 500k+ metro ("Minneapolis-St. Paul-Bloomington, MN-WI"). */
export function locationVerdict(metroMi: number | null, metro: string | null): string {
  if (metroMi === null) return "Distances below";
  const city = metro ? metroCity(metro) : "a big metro";
  if (metroMi <= 25) return `In or near the ${city} metro`;
  if (metroMi <= 75) return `${Math.round(metroMi)} mi to ${city}`;
  return `Far from big metros · ${Math.round(metroMi)} mi to ${city}`;
}
