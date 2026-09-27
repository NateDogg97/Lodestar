import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCountyPayload } from "@/lib/scoring";

import {
  applyStateLaws,
  formatDay,
  formatLaw,
  isGap,
  isStale,
  lawSource,
  parseLawPayload,
  type LawDef,
  type LawFact,
} from ".";

const def = (over: Partial<LawDef>): LawDef => ({
  key: "x",
  name: "X",
  category: "tax",
  usage: "filter",
  type: "numeric",
  unit: "",
  allowed: [],
  order: [],
  cadence: "monthly",
  rubric: "",
  ...over,
});
const fact = (over: Partial<LawFact>): LawFact => ({
  v: "",
  status: "in_effect",
  confidence: "high",
  checked: "2026-09-27",
  sourceName: "S",
  sourceUrl: "https://s",
  sourceDate: "2026-07-01",
  ...over,
});

describe("formatLaw", () => {
  it("formats numbers in their units", () => {
    expect(formatLaw(def({ unit: "percent" }), fact({ v: "4.45", n: 4.45 }))).toBe("4.45%");
    expect(formatLaw(def({ unit: "percent" }), fact({ v: "8.201", n: 8.201 }))).toBe("8.2%");
    expect(formatLaw(def({ unit: "dollars per hour" }), fact({ v: "16.00", n: 16 }))).toBe("$16.00/hr");
    expect(formatLaw(def({ unit: "cents per kWh" }), fact({ v: "15.47", n: 15.47 }))).toBe("15.5¢/kWh");
  });

  it("says 'None' for a zero income tax", () => {
    expect(formatLaw(def({ key: "income_tax_top_rate", unit: "percent" }), fact({ v: "0", n: 0 }))).toBe("None");
  });

  it("labels categories in plain words", () => {
    expect(formatLaw(def({ key: "marijuana_status", type: "nominal" }), fact({ v: "cbd_only" }))).toBe(
      "Low-THC / CBD only",
    );
    expect(formatLaw(def({ key: "permitless_carry", type: "boolean" }), fact({ v: "true" }))).toBe(
      "Yes — no permit needed",
    );
    expect(formatLaw(def({ key: "unlisted", type: "nominal" }), fact({ v: "some_value" }))).toBe("some value");
  });
});

describe("dates", () => {
  it("formats calendar days without a timezone shift", () => {
    expect(formatDay("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("marks a value stale once it's past its cadence", () => {
    const monthly = def({ cadence: "monthly" });
    expect(isStale(monthly, { checked: "2026-09-27" }, new Date("2026-10-20T12:00:00Z"))).toBe(false);
    expect(isStale(monthly, { checked: "2026-09-27" }, new Date("2026-11-20T12:00:00Z"))).toBe(true);
    expect(isStale(def({ cadence: "annual" }), { checked: "2026-09-27" }, new Date("2027-06-01"))).toBe(false);
  });
});

describe("the published laws.json", () => {
  const data = parseLawPayload(
    JSON.parse(readFileSync(join(__dirname, "../../../public/data/laws.json"), "utf8")),
  );

  it("cites a source, its date, and a check date for every value", () => {
    for (const [state, facts] of Object.entries(data.states)) {
      for (const [key, f] of Object.entries(facts)) {
        expect(f.checked, `${state}/${key}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (isGap(f)) {
          expect(f.notes.length, `${state}/${key} gap has a reason`).toBeGreaterThan(10);
        } else {
          expect(f.sourceUrl, `${state}/${key}`).toMatch(/^https:\/\//);
          expect(f.sourceName, `${state}/${key}`).not.toBe("");
          expect(f.sourceDate, `${state}/${key}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    }
  });

  it("covers every state and DC", () => {
    expect(Object.keys(data.states)).toHaveLength(51);
  });

  it("only uses values its definitions allow", () => {
    const defs = new Map(data.laws.map((d) => [d.key, d]));
    for (const facts of Object.values(data.states)) {
      for (const [key, f] of Object.entries(facts)) {
        const d = defs.get(key);
        expect(d, key).toBeDefined();
        if (!isGap(f) && d!.allowed.length) expect(d!.allowed).toContain(f.v);
      }
    }
  });
});

describe("applyStateLaws on the real data", () => {
  const counties = parseCountyPayload(
    JSON.parse(readFileSync(join(__dirname, "../../../public/data/counties.json"), "utf8")),
  );
  const laws = parseLawPayload(JSON.parse(readFileSync(join(__dirname, "../../../public/data/laws.json"), "utf8")));
  const data = applyStateLaws(counties, laws);
  const at = (fips: string) => data.indexByFips.get(fips)!;

  it("gives every county its state's tax and electricity values", () => {
    const travis = at("48453"); // Texas
    expect(data.values.income_tax_top_rate[travis]).toBe(0);
    expect(data.values.sales_tax_combined[travis]).toBeCloseTo(8.2, 1);
    expect(data.values.electricity_price_cents_kwh[travis]).toBeGreaterThan(5);
    const sf = at("06075"); // California
    expect(data.values.income_tax_top_rate[sf]).toBeCloseTo(13.3, 1);
  });

  it("fills policy categories, and leaves a blanked state unknown", () => {
    expect(data.categories.permitless_carry[at("48453")]).toBe("true");
    expect(data.categories.permitless_carry[at("06075")]).toBe("false");
    const polk = at("19153"); // Iowa: NCSL and Wikipedia disagree on marijuana
    expect(data.categories.marijuana_status[polk]).toBeNull();
  });

  it("without law data, law values are unknown — not zero", () => {
    const none = applyStateLaws(counties, null);
    expect(none.values.income_tax_top_rate[at("48453")]).toBeNaN();
    expect(none.categories.abortion_access[at("48453")]).toBeNull();
  });

  it("names one source per law for the filter captions", () => {
    expect(lawSource(laws, "sales_tax_combined")?.sourceName).toBe("Tax Foundation");
    expect(lawSource(laws, "not_a_law")).toBeNull();
  });
});
