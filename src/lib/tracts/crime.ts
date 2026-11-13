/**
 * Crime rates that aren't an area's own (plan §9 Phase 14a, §11 "Crime: what the number
 * can and can't claim"). Pure: no UI imports.
 *
 * The FBI reports crime by police agency, so every area an agency polices carries its one
 * rate. Two cases are no rate for an area at all: average on crime, unknown for a
 * must-have, not shaded on the map:
 * - "crime_wide" (ETL, 2026-11-11): a county agency's one rate over farmland and suburbs.
 * - City-wide (owner, 2026-11-13): one agency's rate shared by `CITY_WIDE_AREAS` or more
 *   areas of the county — a big city's (Chicago, 790 areas), or a county police force that
 *   acts as one (Fairfax County, 261). Worked out here from the published rates, so the
 *   area files and areas.json both carry it with no new data.
 */

/** One agency's rate over this many areas of a county or more is the city's, not an area's. */
export const CITY_WIDE_AREAS = 100;

/**
 * What areas on the same police agency share within a county: its two published rates
 * (an agency's rate is the same for every area it polices). Null with no rate.
 *
 * Counted within the county because that's all an area file holds; areas.json has no
 * agency names to count across county lines. A city that spills into the next county
 * (Kansas City's 27 areas in Clay County, 116 in Jackson) counts only the areas on each
 * side.
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
