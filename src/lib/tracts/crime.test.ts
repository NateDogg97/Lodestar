import { describe, expect, it } from "vitest";

import { CITY_WIDE_AREAS, isCountyAgency, rateKey, sharedRateCounts } from "./crime";

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
});
