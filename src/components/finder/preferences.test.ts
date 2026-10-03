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

  it("rejects non-objects", () => {
    expect(sanitizePreferences(null)).toBeNull();
    expect(sanitizePreferences([1, 2])).toBeNull();
    expect(sanitizePreferences("x")).toBeNull();
  });
});
