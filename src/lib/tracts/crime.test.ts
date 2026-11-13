import { describe, expect, it } from "vitest";

import { CITY_WIDE_AREAS, crimesReported, crimeView, isCountyAgency, rateKey, sharedRateCounts } from "./crime";
import { parseCountyAreas } from "./index";

describe("areas sharing one police agency's rate (2026-11-13)", () => {
  it("keys an area by its county and its two published rates", () => {
    expect(rateKey("17031", 425, 3075)).toBe("17031|425|3075");
    expect(rateKey("17031", 425, null)).toBe("17031|425|-");
    expect(rateKey("17031", 425, NaN)).toBe("17031|425|-");
    expect(rateKey("17031", null, 3075)).toBeNull();
    expect(rateKey("17031", NaN, 3075)).toBeNull();
    expect(rateKey("17031", undefined, undefined)).toBeNull();
  });

  it("counts the areas people live in, per county, for every area on the rate", () => {
    const keys = ["a", "a", "a", "b", null, "a"];
    const counted = [true, true, false, true, true, true];
    expect(sharedRateCounts(keys, counted)).toEqual([3, 3, 3, 1, 0, 3]);
    // The same numbers in two counties are two agencies (or one city's two sides of a line).
    const k = [rateKey("17031", 425, 3075), rateKey("17043", 425, 3075)];
    expect(sharedRateCounts(k, [true, true])).toEqual([1, 1]);
  });

  it("names county agencies as the ETL writes them", () => {
    expect(isCountyAgency("Harris County (sheriff or county police)")).toBe(true);
    expect(isCountyAgency("Fairfax County (sheriff and State Police)")).toBe(true);
    expect(isCountyAgency("Chicago")).toBe(false);
    expect(isCountyAgency("Charlotte-Mecklenburg")).toBe(false);
  });

  it("draws the line at 100 areas (owner, 2026-11-13)", () => {
    expect(CITY_WIDE_AREAS).toBe(100);
  });

  it("counts the crimes behind a rate", () => {
    expect(crimesReported(204, 5379, 12)).toBe(11);
    expect(crimesReported(294, 122740, 6)).toBe(180); // a half year's rate, scaled to a year
    expect(crimesReported(204, null, 12)).toBeNull();
  });
});

describe("what an area page shows about crime (2026-11-13)", () => {
  const cols = ["geoid", "label", "population", "low_confidence", "crime_agency", "violent_rate", "property_rate",
    "crime_population", "crime_year", "crime_months", "crime_note"];
  type R = [number, string, string, number | null, number | null, number | null, string | null];
  // [people, flags, agency, violent, property, agency people, note]
  const county = (rows: R[]) =>
    parseCountyAreas({
      format: "tracts-v1",
      county: "26161",
      columns: cols,
      rows: rows.map(([people, flags, agency, v, p, pop, note], k) =>
        [`26161${String(k).padStart(6, "0")}`, `Area ${k}`, people, flags, agency, v, p, pop, 2025, 12, note]),
      schools: { columns: ["school_id"], rows: [] },
    }).areas;
  const sheriff = "Washtenaw County (sheriff and State Police)";
  const areas = county([
    ...Array.from({ length: 100 }, (): R => [3500, "", "Ann Arbor", 294, 1721, 122740, null]),
    [3078, "crime", "Chelsea", 204, 781, 5379, null],
    [4007, "crime_wide", sheriff, 363, 658, 162060, null],
    [3900, "crime_wide", sheriff, 363, 658, 162060, null],
    [2500, "", "Dexter", null, null, 4600, "reported only 1 month of 2025: too little to rate"],
    [2000, "crime", "Manchester", 0, 0, 2100, null],
  ]);
  const [annArbor] = areas;
  const [chelsea, wide, , dexter, manchester] = areas.slice(100);

  it("shows an area's own agency's rate as its own", () => {
    expect(crimeView(chelsea, areas)).toMatchObject({ kind: "own", figure: { agency: "Chelsea", violent: 204, areas: 1, violentCrimes: 11 } });
  });

  it(`shows a rate shared by ${CITY_WIDE_AREAS}+ areas as the city's`, () => {
    expect(crimeView(annArbor, areas)).toMatchObject({
      kind: "city", figure: { agency: "Ann Arbor", violent: 294, areas: 100, people: 122740, countyAgency: false },
    });
  });

  it("shows no figure for a sheriff's county-wide rate, but offers the nearest: its own, then the county's others", () => {
    const v = crimeView(wide, areas);
    expect(v.kind).toBe("nearby");
    if (v.kind !== "nearby") return;
    expect(v.covering).toMatchObject({ agency: sheriff, violent: 363, areas: 2, countyAgency: true });
    // Each other agency once, most people served first; none without a usable rate.
    expect(v.others.map((f) => f.agency)).toEqual(["Ann Arbor", "Chelsea"]);
  });

  it("offers the nearest where the agency has no rate, or reported nothing at all", () => {
    for (const a of [dexter, manchester]) {
      const v = crimeView(a, areas);
      expect(v).toMatchObject({ kind: "nearby", covering: null });
      if (v.kind === "nearby") expect(v.others.map((f) => f.agency)).toEqual([sheriff, "Ann Arbor", "Chelsea"]);
    }
  });

  it("says so when no agency in the county has a rate", () => {
    const none = county([[2500, "", "Dexter", null, null, 4600, "reported only 1 month of 2025: too little to rate"]]);
    expect(crimeView(none[0], none)).toEqual({ kind: "none" });
  });
});
