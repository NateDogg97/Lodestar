/**
 * What the app says about crime in an area (plan §9 Phase 14a, §11 "Crime: what the
 * number can and can't claim"). Pure: no UI imports.
 *
 * The FBI reports crime by police agency, so every area an agency polices carries its one
 * rate. Crime is not ranked, filtered or shaded on (owner, 2026-11-13: "not reliable enough
 * to filter results based on them"); the area page shows a figure only where one exists
 * for the area or its city (`crimeView`):
 * - "own": a city or town agency's rate over fewer than `CITY_WIDE_AREAS` areas.
 * - "city": one agency's rate shared by `CITY_WIDE_AREAS` or more areas of the county — a
 *   big city's (Chicago, 790 areas), or a county police force that acts as one (Fairfax
 *   County, 261). Shown as the whole city's figure, never as the area's.
 * - "nearby": no figure of its own or its city's — a sheriff's one rate over farmland and
 *   suburbs ("crime_wide", ETL 2026-11-11), or none at all. On request, the agency that
 *   polices it and every other agency in the county, each once, from the county file.
 * - "none": not one agency in the county has a rate.
 */

import type { Area } from "./index";

/** One agency's rate over this many areas of a county or more is the city's, not an area's. */
export const CITY_WIDE_AREAS = 100;

/** Fewer reported crimes than this in the year and a per-100,000 rate says less than the count. */
export const FEW_CRIMES = 20;

/**
 * What areas on the same police agency share within a county: its two published rates
 * (an agency's rate is the same for every area it polices). Null with no rate.
 *
 * Counted within the county because that's all an area file holds. A city that spills
 * into the next county (Kansas City's 27 areas in Clay County, 116 in Jackson) counts
 * only the areas on each side.
 */
export function rateKey(county: string, violent: number | null | undefined, property: number | null | undefined): string | null {
  if (typeof violent !== "number" || !Number.isFinite(violent)) return null;
  return `${county}|${violent}|${typeof property === "number" && Number.isFinite(property) ? property : "-"}`;
}

/**
 * Per area, how many areas share its rate (`rateKey`), counting only those where people
 * live (`counted`: the ETL's `crime_shared` counts areas of more than 50 people); 0 with
 * no rate.
 */
export function sharedRateCounts(keys: readonly (string | null)[], counted: readonly boolean[]): number[] {
  const n = new Map<string, number>();
  keys.forEach((k, i) => {
    if (k !== null && counted[i]) n.set(k, (n.get(k) ?? 0) + 1);
  });
  return keys.map((k) => (k === null ? 0 : (n.get(k) ?? 0)));
}

/** A sheriff or county police department (the names etl/tracts/crime.py gives them). */
export const isCountyAgency = (name: string) => /County \((sheriff|county police)/.test(name);

/**
 * How many crimes an agency reported in its year, from its yearly rate and the people it
 * serves (rates are whole numbers, so this is within one of the count). A partial year's
 * rate was scaled to a year: this is what was reported.
 */
export function crimesReported(rate: number | null, people: number | null, months: number | null): number | null {
  if (rate === null || people === null) return null;
  return Math.round((rate * people * (months ?? 12)) / 12 / 100_000);
}

/** One police agency's published figures, as an area file carries them. */
export interface AgencyFigure {
  agency: string;
  /** Per 100,000 people a year. */
  violent: number;
  property: number | null;
  year: number | null;
  /** Under 12: a partial year, scaled to a year. */
  months: number | null;
  /** How many people it serves, in all (in other counties too). */
  people: number | null;
  /** How many areas of this county carry its rate. */
  areas: number;
  countyAgency: boolean;
  /** Violent crimes it reported in the year (see `FEW_CRIMES`). */
  violentCrimes: number | null;
}

export type CrimeView =
  | { kind: "own"; figure: AgencyFigure }
  | { kind: "city"; figure: AgencyFigure }
  | {
      kind: "nearby";
      /** The agency that polices the area, when it has a rate (a sheriff's county-wide one). */
      covering: AgencyFigure | null;
      /** Every other agency in the county with a rate, each once, most people served first. */
      others: AgencyFigure[];
    }
  | { kind: "none" };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The area's agency figures, or null with no usable rate. Zero violent and zero property
 * crime for a whole agency is a report of nothing (106 of 108 such areas were flagged), not
 * a perfect record.
 */
export function agencyFigure(a: Area): AgencyFigure | null {
  const violent = num(a.row.violent_rate);
  const property = num(a.row.property_rate);
  if (violent === null || (violent === 0 && property === 0)) return null;
  const agency = typeof a.row.crime_agency === "string" && a.row.crime_agency ? a.row.crime_agency : "Its police agency";
  const people = num(a.row.crime_population);
  const months = num(a.row.crime_months);
  return {
    agency,
    violent,
    property,
    year: num(a.row.crime_year),
    months,
    people,
    areas: a.crimeShared,
    countyAgency: isCountyAgency(agency),
    violentCrimes: crimesReported(violent, people, months),
  };
}

/**
 * What to show about crime for `area`, one of `county`'s areas: its own agency's figure,
 * its city's, or (no figure for either) the nearest figures on request. See the top of
 * this file.
 */
export function crimeView(area: Area, county: readonly Area[]): CrimeView {
  const own = agencyFigure(area);
  if (own && !area.lowConfidence.includes("crime_wide")) {
    return { kind: own.areas >= CITY_WIDE_AREAS ? "city" : "own", figure: own };
  }
  const seen = new Set(own ? [own.agency] : []);
  const others: AgencyFigure[] = [];
  for (const a of county) {
    const f = agencyFigure(a);
    if (!f || seen.has(f.agency)) continue;
    seen.add(f.agency);
    others.push(f);
  }
  others.sort((x, y) => (y.people ?? -1) - (x.people ?? -1) || x.agency.localeCompare(y.agency));
  if (!own && others.length === 0) return { kind: "none" };
  return { kind: "nearby", covering: own, others };
}
