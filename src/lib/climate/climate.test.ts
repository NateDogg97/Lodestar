import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyStateLaws } from "@/lib/laws";
import { categoryLabel, getCategory, parseCountyPayload } from "@/lib/scoring";

import { isAllZero, MEASURE_KEYS, parseClimatePayload, summarize } from ".";

const root = join(__dirname, "../../..");
const climate = parseClimatePayload(JSON.parse(readFileSync(join(root, "public/data/climate.json"), "utf8")));
const counties = parseCountyPayload(JSON.parse(readFileSync(join(root, "public/data/counties.json"), "utf8")));

describe("parseClimatePayload", () => {
  it("rejects the wrong format", () => {
    expect(() => parseClimatePayload({ format: "x" })).toThrow(/format/);
  });

  it("reads every county with 12 months per measure", () => {
    expect(climate.byFips.size).toBeGreaterThan(3100);
    const travis = climate.byFips.get("48453")!;
    for (const key of MEASURE_KEYS) expect(travis[key]).toHaveLength(12);
    expect(climate.stationMi.get("48453")).toBeLessThan(25);
  });

  it("orders months January first (Austin is hottest mid-year)", () => {
    const t = climate.byFips.get("48453")!.tmax_f as number[];
    expect(Math.max(...t)).toBe(Math.max(t[6], t[7]));
    expect(t[0]).toBeLessThan(t[6]);
  });
});

describe("summarize", () => {
  it("reproduces the county dataset's yearly climate numbers", () => {
    for (const fips of ["48453", "06075", "27053", "12086"]) {
      const s = summarize(climate.byFips.get(fips)!);
      const i = counties.indexByFips.get(fips)!;
      expect(s.hottestHigh!).toBeCloseTo(counties.values.hottest_month_high_f[i], 1);
      expect(s.coldestLow!).toBeCloseTo(counties.values.coldest_month_low_f[i], 1);
      // Monthly values are rounded to 0.1 in the file, so sums drift by up to ~0.6.
      expect(Math.abs(s.daysAbove90! - counties.values.days_above_90f[i])).toBeLessThan(0.7);
      expect(Math.abs(s.rainyDays! - counties.values.rainy_days[i])).toBeLessThan(0.7);
    }
  });

  it("leaves a yearly total unknown if a month is missing", () => {
    const c = climate.byFips.get("48453")!;
    const gap = { ...c, snow_in: [null, ...c.snow_in.slice(1)] };
    expect(summarize(gap).snow).toBeNull();
  });

  it("knows Miami gets no snow", () => {
    expect(isAllZero(climate.byFips.get("12086")!.snow_in)).toBe(true);
    expect(isAllZero(climate.byFips.get("27053")!.snow_in)).toBe(false);
  });
});

describe("Köppen climate type", () => {
  const def = getCategory("koppen");
  const codes = new Set(def.options.map((o) => o.value));

  it("every county with climate data has a type the app can label", () => {
    const types = counties.categories.koppen;
    for (const fips of climate.byFips.keys()) {
      const t = types[counties.indexByFips.get(fips)!];
      expect(t, fips).not.toBeNull();
      expect(codes.has(t!), `${fips}: ${t}`).toBe(true);
    }
  });

  it("classifies well-known places as expected", () => {
    const at = (fips: string) => counties.categories.koppen[counties.indexByFips.get(fips)!];
    expect(at("48453")).toBe("Cfa"); // Austin
    expect(at("04013")).toBe("BWh"); // Phoenix
    expect(at("53033")).toBe("Csb"); // Seattle
    expect(at("27053")).toBe("Dfa"); // Minneapolis
    expect(categoryLabel("koppen", "Cfa")).toBe("Humid subtropical (Cfa)");
  });

  it("survives the law join (county-level, not overwritten by state data)", () => {
    const joined = applyStateLaws(counties, null);
    expect(joined.categories.koppen[counties.indexByFips.get("48453")!]).toBe("Cfa");
  });
});
