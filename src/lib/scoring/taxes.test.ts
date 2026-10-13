import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyStateLaws, parseLawPayload, taxSchedules } from "@/lib/laws";

import { parseCountyPayload } from "./dataset";
import { countyTaxes, incomeTax, parseSchedule, US_MEDIAN_HOUSEHOLD_INCOME, withTaxes } from "./taxes";

const CA = "s:0.01@0,0.02@11079,0.04@26264;m:0.01@0,0.02@22158,0.04@52528,0.06@82904;sd:5540,11080;ex:0,0;cr:153,306";

describe("income tax from brackets", () => {
  it("parses the law table's compact form", () => {
    const s = parseSchedule(CA);
    expect(s).not.toBe("none");
    expect(s && s !== "none" && s.joint[1]).toEqual({ rate: 0.02, over: 22158 });
    expect(parseSchedule("none")).toBe("none");
    expect(parseSchedule("garbage")).toBeNull();
  });

  it("taxes each bracket's slice after the deduction, less the credit", () => {
    // Taxable 78,538 − 11,080 = 67,458: 1% of 22,158 + 2% of 30,370 + 4% of 14,930 − 306.
    const s = parseSchedule(CA)!;
    expect(incomeTax(s, 78_538, "joint")).toBeCloseTo(221.58 + 607.4 + 597.2 - 306, 1);
    expect(incomeTax("none", 500_000)).toBe(0);
    expect(incomeTax(s, 5_000, "joint")).toBe(0); // under the deduction, the credit can't go negative
  });
});

describe("Taxes on the real data", () => {
  const root = process.cwd();
  const laws = parseLawPayload(JSON.parse(readFileSync(join(root, "public/data/laws.json"), "utf8")));
  const base = applyStateLaws(
    parseCountyPayload(JSON.parse(readFileSync(join(root, "public/data/counties.json"), "utf8"))),
    laws,
  );
  const schedules = taxSchedules(laws);
  const at = (fips: string) => base.indexByFips.get(fips)!;

  it("every state has a schedule", () => {
    expect(Object.values(schedules).filter((v) => v && parseSchedule(v) !== null)).toHaveLength(51);
  });

  it("Jackson Hole's low rate on $1.4M homes is a big bill; Wyoming elsewhere is cheap", () => {
    const sched = (st: string) => parseSchedule(schedules[st]);
    const teton = countyTaxes(base, at("56039"), sched("WY"))!;
    const laramie = countyTaxes(base, at("56021"), sched("WY"))!;
    expect(teton.income).toBe(0);
    expect(teton.property).toBeGreaterThan(4_000);
    expect(laramie.total).toBeLessThan(teton.total / 2);
  });

  it("a budget replaces the typical home; renters pay no property tax directly", () => {
    const wy = parseSchedule(schedules.WY);
    const onBudget = countyTaxes(base, at("56039"), wy, { tenure: "buy", budget: 400_000 })!;
    expect(onBudget.home).toBe(400_000);
    const renting = countyTaxes(base, at("56039"), wy, { tenure: "rent", budget: 2_000 })!;
    expect(renting.property).toBe(0);
    expect(renting.householdIncome).toBe(US_MEDIAN_HOUSEHOLD_INCOME);
  });

  it("fills the column for nearly every county", () => {
    const data = withTaxes(base, schedules);
    const known = data.values.taxes.filter((v) => Number.isFinite(v)).length;
    expect(known / data.n).toBeGreaterThan(0.99);
  });
});
