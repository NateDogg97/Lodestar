import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyStateLaws, parseLawPayload, taxSchedules } from "@/lib/laws";
import { countyTaxes, parseCountyPayload, parseSchedule } from "@/lib/scoring";

import { parseNationalAreas } from "./national";
import { AREA_TAXES, AREA_TAX_RATE, areaTaxes, areaTaxSearch, withAreaTaxes } from "./taxes";

const root = process.cwd();
const laws = parseLawPayload(JSON.parse(readFileSync(join(root, "public/data/laws.json"), "utf8")));
const counties = applyStateLaws(
  parseCountyPayload(JSON.parse(readFileSync(join(root, "public/data/counties.json"), "utf8"))),
  laws,
);
const schedules = taxSchedules(laws);
const MI = parseSchedule(schedules.MI);
const wash = counties.indexByFips.get("26161")!;
const countyRate = counties.values.property_tax_effective_rate[wash];

// Three Washtenaw areas: a township, a noisy Ypsilanti city area (published 1.29%, estimated
// at 1.81%), and a student area the Census publishes no rate for.
const areas = parseNationalAreas({
  format: "areas-v1",
  n: 3,
  columns: {
    geoid: ["26161445000", "26161410300", "26161400500"],
    label: ["Near Ann Arbor", "Ypsilanti", "Ann Arbor"],
    low_confidence: ["", "property_tax_rate", ""],
    population: [3000, 2500, 7500],
    property_tax_rate: [1.35, 1.29, null],
    property_tax_rate_eb: [1.37, 1.81, null],
  },
});

describe("taxes by area", () => {
  it("uses the area's estimate, else the county's rate", () => {
    const town = areaTaxes(areas, 0, counties, MI)!;
    const ypsi = areaTaxes(areas, 1, counties, MI)!;
    const student = areaTaxes(areas, 2, counties, MI)!;
    expect(town.rate).toBe(1.37);
    expect(town.rateSource).toBe("area");
    expect(ypsi.rate).toBe(1.81);
    expect(student.rate).toBe(countyRate);
    expect(student.rateSource).toBe("county");
    // Same county home, new-buyer ratio, income and sales tax: only the rate differs.
    const county = countyTaxes(counties, wash, MI)!;
    expect(student.total).toBeCloseTo(county.total, 6);
    expect(ypsi.income).toBe(town.income);
    expect(ypsi.property / town.property).toBeCloseTo(1.81 / 1.37, 6);
  });

  it("a budget replaces the typical home; renting counts no property tax", () => {
    const buy = areaTaxes(areas, 1, counties, MI, { tenure: "buy", budget: 300_000 })!;
    expect(buy.property).toBeCloseTo(0.0181 * buy.newBuyer * 300_000, 6);
    expect(areaTaxes(areas, 1, counties, MI, { tenure: "rent" })!.property).toBe(0);
  });

  it("adds a taxes column and the rate a limit tests (published, else the county's)", () => {
    const a = withAreaTaxes(areas, counties, schedules);
    expect(a).not.toBe(areas);
    expect(a.values.get(AREA_TAXES)![1]).toBeCloseTo(areaTaxes(areas, 1, counties, MI)!.total, 6);
    expect([...a.values.get(AREA_TAX_RATE)!]).toEqual([1.35, 1.29, countyRate]);
    expect(areas.values.has(AREA_TAXES)).toBe(false); // the input is untouched
  });

  it("moves Taxes and the tax limits from the county part to the areas", () => {
    const s = areaTaxSearch({
      weights: { taxes: 3, rpp_all: 2 },
      filters: [
        { metric: "taxes", max: 9000 },
        { metric: "property_tax_effective_rate", max: 1.5 },
        { metric: "income_tax_top_rate", max: 5 },
      ],
    });
    expect(s.county.weights).toEqual({ rpp_all: 2 });
    expect(s.county.filters).toEqual([{ metric: "income_tax_top_rate", max: 5 }]);
    expect(s.criteria).toEqual([{ column: AREA_TAXES, label: "Taxes", weight: 3, direction: "lower", badge: "Lowest taxes" }]);
    expect(s.limits.map((l) => [l.column, l.max])).toEqual([
      [AREA_TAXES, 9000],
      [AREA_TAX_RATE, 1.5],
    ]);
    expect(areaTaxSearch({ weights: { rpp_all: 2 } }).criteria).toEqual([]);
  });
});
