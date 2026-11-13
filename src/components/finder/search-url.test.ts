import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES, EMPTY_PREFERENCES, type Preferences } from "./preferences";
import { decodeSearch, encodeSearch, summarizeSearch } from "./search-url";

const decode = (q: string) => decodeSearch(new URLSearchParams(q));

describe("search URLs", () => {
  it("round-trip a full search and a county", () => {
    const prefs: Preferences = {
      weights: { rpp_all: 3, school_achievement: 5, population: 1 },
      directions: { population: "middle", days_above_90f: "higher" },
      limits: { median_gross_rent: { max: 2000 }, population: { min: 10000 }, hottest_month_high_f: { min: 70.5, max: 92 } },
      categories: { koppen: ["Cfa", "Dfa"], marijuana_status: ["medical", "recreational"] },
      includeUnknown: false,
      includeStates: { AK: false, HI: true },
      area: {
        weights: { walkability: 4, kids_share: 2 },
        directions: { density_per_sq_mi: "higher" },
        limits: { kids_share: { max: 40 } },
      },
      household: { tenure: "buy", budget: 450_000, income: 95_000, filing: "single" },
    };
    const q = encodeSearch(prefs, "24027");
    // Budget and income stay on the device (Phase 10c): never in a link.
    expect(q).not.toMatch(/450000|95000|budget|income|buy/);
    expect(q).toBe(
      "v=1&w=population:1,rpp_all:3,school_achievement:5&dir=population:middle,days_above_90f:higher" +
        "&lim=population:10000~,median_gross_rent:~2000,hottest_month_high_f:70.5~92" +
        "&cat=koppen:Cfa.Dfa,marijuana_status:medical.recreational" +
        "&aw=walkability:4,kids_share:2&adir=density_per_sq_mi:higher&alim=kids_share:~40&unk=0&inc=HI&place=24027",
    );
    // Reading it back moves the county stand-ins for area measures to the area level (Phase 8f).
    expect(decode(q)).toEqual({
      prefs: {
        ...prefs,
        household: {},
        weights: { rpp_all: 3, population: 1 },
        limits: { population: { min: 10000 }, hottest_month_high_f: { min: 70.5, max: 92 } },
        area: {
          weights: { walkability: 4, kids_share: 2, nearby_school_pctl: 5 },
          directions: { density_per_sq_mi: "higher" },
          limits: { kids_share: { max: 40 }, median_gross_rent: { max: 2000 } },
        },
      },
      place: "24027",
    });
  });

  it("load an old link with a crime priority or must-have, crime left out (2026-11-13)", () => {
    // Crime left the filters: a link from before keeps everything else and opens the same area.
    const old = decode(
      "v=1&w=rpp_all:3&aw=violent_rate:2,property_rate:1,walkability:4&adir=violent_rate:higher" +
        "&alim=violent_rate:~400,property_rate:~3000,walkability:8~&place=17031740100",
    );
    expect(old?.place).toBe("17031740100");
    expect(old?.prefs.weights).toEqual({ rpp_all: 3 });
    expect(old?.prefs.area).toEqual({ weights: { walkability: 4 }, directions: {}, limits: { walkability: { min: 8 } } });
    // Re-shared, it no longer carries crime; its name in the Searches list doesn't either.
    const again = encodeSearch(old!.prefs, old!.place);
    expect(again).not.toMatch(/violent|property_rate/);
    expect(summarizeSearch(old!.prefs)).toBe("Walkability, Cost of living · 1 must-have");
  });

  it("drop directions that match the default (they change nothing)", () => {
    const q = encodeSearch({ ...DEFAULT_PREFERENCES, directions: { rpp_all: "lower" } });
    expect(q).not.toContain("dir=");
  });

  it("keep a category with nothing allowed", () => {
    const prefs = { ...EMPTY_PREFERENCES, categories: { koppen: [] } };
    expect(encodeSearch(prefs)).toBe("v=1&cat=koppen:");
    expect(decode("v=1&cat=koppen:")?.prefs.categories).toEqual({ koppen: [] });
  });

  it("ignore links without a search, and drop anything malformed", () => {
    expect(decode("")).toBeNull();
    expect(decode("place=24027")).toBeNull();
    const out = decode("v=1&w=rpp_all:9,nope:3,school_achievement:x&lim=rpp_all:abc~,,junk&cat=koppen:Cfa.XX&place=123");
    expect(out?.prefs.weights).toEqual({ rpp_all: 5 });
    expect(out?.prefs.limits).toEqual({});
    expect(out?.prefs.categories).toEqual({ koppen: ["Cfa"] });
    expect(out?.place).toBeNull();
  });

  it("carry an area inside a county (an 11-digit tract) as the place", () => {
    expect(decode("v=1&place=48453001309")?.place).toBe("48453001309");
    expect(encodeSearch(EMPTY_PREFERENCES, "48453001309")).toBe("v=1&place=48453001309");
    expect(decode("v=1&place=484530013")?.place).toBeNull();
  });

  it("summarize a search", () => {
    expect(summarizeSearch(EMPTY_PREFERENCES)).toBe("No priorities");
    expect(
      summarizeSearch({
        ...EMPTY_PREFERENCES,
        weights: { rpp_all: 2, population: 1 },
        limits: { rpp_all: { max: 100 } },
        area: { weights: { nearby_school_pctl: 5 }, directions: {}, limits: { walkability: { min: 10 } } },
      }),
    ).toBe("Schools, Cost of living +1 · 2 must-haves");
  });
});
