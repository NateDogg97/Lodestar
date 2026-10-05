import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES, sanitizePreferences } from "./preferences";

describe("sanitizePreferences", () => {
  it("round-trips a valid saved search", () => {
    const prefs = {
      ...DEFAULT_PREFERENCES,
      directions: { days_above_90f: "higher" as const },
      limits: { rpp_all: { max: 100 } },
      categories: { permitless_carry: ["false"], marijuana_status: ["recreational", "medical"] },
      includeUnknown: false,
      includeStates: { AK: false, HI: true },
    };
    expect(sanitizePreferences(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
  });

  it("drops unknown metrics and bad values, and clamps weights", () => {
    const out = sanitizePreferences({
      weights: { rpp_all: 9, not_a_metric: 3, school_achievement: "high" },
      directions: { rpp_all: "sideways", snow_days: "middle" },
      limits: { rpp_all: { min: "x" }, snow_days: { min: 0, max: null } },
      includeStates: { AK: "yes", HI: true, TX: true },
      categories: { marijuana_status: ["medical", "legal-ish", 3, "medical"], not_a_law: ["x"], abortion_access: "banned" },
      area: { weights: { walkability: 7, rpp_all: 2 }, directions: { violent_rate: "up" }, limits: { violent_rate: { max: 300 } } },
    });
    expect(out).toEqual({
      weights: { rpp_all: 5 },
      directions: { snow_days: "middle" },
      limits: { snow_days: { min: 0 } },
      categories: { marijuana_status: ["medical"] },
      includeUnknown: true,
      includeStates: { AK: false, HI: true },
      // Area-only priorities: only known area keys; a county metric isn't one.
      area: { weights: { walkability: 5 }, directions: {}, limits: { violent_rate: { max: 300 } } },
    });
  });

  it("moves county stand-ins for area measures to the area level (Phase 8f)", () => {
    const out = sanitizePreferences({
      weights: { rpp_all: 3, median_home_value: 4, school_achievement: 5 },
      directions: { median_home_value: "higher" },
      limits: { median_home_value: { max: 850000 }, school_achievement: { min: 0.1 } },
      area: { weights: { median_home_value: 2 }, directions: {}, limits: {} },
    });
    expect(out?.weights).toEqual({ rpp_all: 3 });
    expect(out?.limits).toEqual({});
    // An area setting already there wins; a grade-level limit has no area equivalent.
    expect(out?.area).toEqual({
      weights: { median_home_value: 2, nearby_school_pctl: 5 },
      directions: { median_home_value: "higher" },
      limits: { median_home_value: { max: 850000 } },
    });
  });

  it("drops measures that aren't filters any more; a cost-of-living part becomes Cost of living", () => {
    const p = sanitizePreferences({
      weights: { rpp_rents: 4, rpp_utilities: 2, real_income: 3, price_to_rent: 2, racial_equality: 5, days_above_90f: 1 },
      directions: { rent_to_income: "higher" },
      limits: { home_value_to_income: { max: 4 }, electricity_price_cents_kwh: { max: 15 } },
      area: { weights: { commute_minutes: 3, walkability: 2 }, directions: {}, limits: { commute_minutes: { max: 30 } } },
    })!;
    expect(p.weights).toEqual({ days_above_90f: 1, rpp_all: 4 });
    expect(p.directions).toEqual({});
    expect(p.limits).toEqual({});
    expect(p.area.weights).toEqual({ walkability: 2 });
    expect(p.area.limits).toEqual({});
    // Cost of living already set: the part doesn't override it.
    expect(sanitizePreferences({ weights: { rpp_all: 1, rpp_goods: 5 } })!.weights).toEqual({ rpp_all: 1 });
  });

  it("rejects non-objects", () => {
    expect(sanitizePreferences(null)).toBeNull();
    expect(sanitizePreferences([1, 2])).toBeNull();
    expect(sanitizePreferences("x")).toBeNull();
  });
});
