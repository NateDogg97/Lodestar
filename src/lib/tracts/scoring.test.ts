import { describe, expect, it } from "vitest";

import type { CountyScore } from "@/lib/scoring";

import {
  areaLimitResults,
  countiesOf,
  countyParts,
  distinctNames,
  EXCLUDED,
  explainArea,
  MATCH,
  notResidential,
  OUT,
  parseNationalAreas,
  resultBadges,
  scoreNational,
  topAreas,
  tradeOff,
  UNKNOWN,
  type NationalSearch,
} from "./national";
import { areaCriteria, MOVED_TO_AREAS } from "./scoring";

// Four areas in two counties (48001: a, b; 48003: c, d).
const areas = parseNationalAreas({
  format: "areas-v1",
  n: 4,
  columns: {
    geoid: ["48001000100", "48001000200", "48003000100", "48003000200"],
    label: ["A · 1", "B · 2", "C · 3", "D · 4"],
    low_confidence: ["", "crime", "", ""],
    population: [1000, 2000, 3000, 4000],
    median_home_value: [300_000, 500_000, 900_000, 200_000],
    walkability: [15, 8, null, 12],
    violent_rate: [200, 100, 600, 300],
  },
});

const county = (fips: string, status: CountyScore["status"], points: number | null, weight = 0): CountyScore => ({
  index: 0, fips, score: points, status, failedFilters: [], unknownFilters: [], missingMetrics: [],
  contributions: weight
    ? [{ metric: "rpp_all", value: 100, direction: "lower", rawPercentile: 100 - (points ?? 0), percentile: points, weight,
        impact: points === null ? null : weight * (points - 50), beats: null }]
    : [],
});

const search = (over: Partial<NationalSearch> = {}): NationalSearch => ({
  criteria: [],
  limits: [],
  counties: countyParts([county("48001", "match", null), county("48003", "match", null)]),
  ...over,
});

describe("areas as the results (Phase 8f)", () => {
  it("parses the column-by-column file", () => {
    expect(areas.county).toEqual(["48001", "48001", "48003", "48003"]);
    expect(Number.isNaN(areas.values.get("walkability")![2])).toBe(true);
    expect(areas.lowConfidence[1]).toEqual(["crime"]);
    expect(() => parseNationalAreas({ format: "areas-v0" })).toThrow(/format/);
  });

  it("scores areas nationally, adding the county's share", () => {
    const { criteria } = areaCriteria({ areaWeights: { median_home_value: 1 }, areaDirections: {}, areaLimits: {} });
    // Cheapest first: d 100, a 66.7, b 33.3, c 0. A county-level priority at 50 points (weight 1) evens them out.
    const plain = scoreNational(areas, search({ criteria }));
    expect([...plain.score].map(Math.round)).toEqual([67, 33, 0, 100]);
    const withCounty = scoreNational(areas, search({
      criteria,
      counties: countyParts([county("48001", "match", 100, 1), county("48003", "match", 0, 1)]),
    }));
    expect([...withCounty.score].map(Math.round)).toEqual([83, 67, 0, 50]);
  });

  it("gates by county and by area must-haves; no value is unknown, an absent county is out", () => {
    const { criteria, limits } = areaCriteria({ areaWeights: { median_home_value: 1 }, areaDirections: {},
      areaLimits: { walkability: { min: 10 } } });
    const sc = scoreNational(areas, search({
      criteria, limits, counties: countyParts([county("48001", "match", null)]),
    }));
    expect([...sc.status]).toEqual([MATCH, EXCLUDED, OUT, OUT]);
    const sc2 = scoreNational(areas, search({ criteria, limits }));
    expect(sc2.status[2]).toBe(UNKNOWN);
    expect(areaLimitResults(areas, 1, limits)[0]).toMatchObject({ state: "fail", value: 8 });
  });

  it("takes the top N, then counties by their best area", () => {
    const { criteria } = areaCriteria({ areaWeights: { median_home_value: 1 }, areaDirections: {}, areaLimits: {} });
    const sc = scoreNational(areas, search({ criteria }));
    const top = topAreas(areas, sc, 3, true);
    expect(top).toEqual([3, 0, 1]);
    expect(countiesOf(areas, top, sc).map((c) => [c.fips, c.areas])).toEqual([["48003", [3]], ["48001", [0, 1]]]);
  });

  it("explains an area and says its trade-off from the top 3 priorities", () => {
    const { criteria } = areaCriteria({ areaWeights: { median_home_value: 3, walkability: 1, violent_rate: 2 },
      areaDirections: {}, areaLimits: {} });
    const s = search({ criteria });
    const parts = explainArea(areas, 3, s, undefined);
    expect(parts.map((p) => p.key)).toEqual(["median_home_value", "violent_rate", "walkability"]);
    // d: cheapest (+150), more crime than most (2 × (33.3 − 50)), walkability exactly middling (0).
    expect(tradeOff(parts)).toBe("Helped by cheap homes; held back by more violent crime.");
  });

  it("words county priorities by their direction", () => {
    const part = (key: string, direction: "lower" | "higher", impact: number) => ({
      key, label: key, level: "county" as const, direction, weight: 1, value: 1, rawPercentile: 50, points: 50, impact, beats: null,
    });
    expect(tradeOff([part("rpp_all", "lower", 40), part("days_above_90f", "lower", 30)])).toBe(
      "Helped by low cost of living and few days above 90°F.",
    );
    expect(tradeOff([part("dist_airport_mi", "lower", -20), part("hazard_tornado", "lower", -10)])).toBe(
      "Held back by the distance to a major airport and high risk of tornadoes.",
    );
    expect(tradeOff([part("hottest_month_high_f", "lower", 30)])).toBe("Helped by cooler summers.");
  });

  it("badges the one best result per priority, and gold for the US top 1%", () => {
    const { criteria } = areaCriteria({ areaWeights: { walkability: 1, violent_rate: 1 }, areaDirections: {}, areaLimits: {} });
    const s = search({ criteria });
    const top = [0, 1, 3];
    const b = resultBadges(areas, top, s);
    expect(b.get(0)?.best).toEqual(["Most walkable"]);
    expect(b.get(1)?.best).toEqual(["Safest"]);
    // Area b has the lowest violent crime of all four: the top 1% of these "US" areas.
    expect(b.get(1)?.top1).toEqual(["Top 1% safest in the US"]);
  });

  it("moves county stand-ins for area measures to the area level", () => {
    expect(MOVED_TO_AREAS.school_achievement).toEqual({ to: "nearby_school_pctl", keepLimit: false });
    expect(MOVED_TO_AREAS.median_home_value?.keepLimit).toBe(true);
  });
});

describe("area names", () => {
  it("tell apart areas that share a label by direction", () => {
    const lat = Float64Array.from([47.9, 48.0, 47.8, 47.9, 30]);
    const lon = Float64Array.from([-97.05, -97.05, -97.05, -97.0, -90]);
    const names = distinctNames(["G · 1", "G · 1", "G · 1", "G · 1", "Solo · 2"], lat, lon);
    expect(names).toEqual(["G · 1 · central", "G · 1 · north", "G · 1 · south", "G · 1 · east", "Solo · 2"]);
  });
});

describe("results audit rules (2026-10-04)", () => {
  // e: 20 people (a park); f: zero violent and zero property crime (no report).
  const a = parseNationalAreas({
    format: "areas-v1",
    n: 6,
    columns: {
      geoid: ["48001000100", "48001000200", "48001000300", "48001000400", "48001000500", "48001000600"],
      label: ["A", "B", "C", "D", "E", "F"],
      low_confidence: ["", "", "", "", "", "crime"],
      population: [1000, 5000, 3000, 2000, 20, 4000],
      walkability: [10, 18, null, 12, 20, 8],
      hazard_hurricane: [0, 0, 0, 0, 0, 40],
      median_home_value: [200_000, 300_000, 100_000, null, 50_000, 250_000],
      violent_rate: [100, 200, 300, 150, 0, 0],
      property_rate: [1000, 2000, 1500, 900, 0, 0],
    },
  });
  const s = (over: Partial<NationalSearch>) => ({
    criteria: [],
    limits: [],
    counties: countyParts([county("48001", "match", null)]),
    ...over,
  });

  it("counts a missing value as average, never dropping it", () => {
    const { criteria } = areaCriteria({ areaWeights: { walkability: 1, median_home_value: 1 }, areaDirections: {}, areaLimits: {} });
    const sc = scoreNational(a, s({ criteria }));
    // c: walkability unknown → 50; second-cheapest home of five → 75: 62.5, not 75.
    expect(sc.score[2]).toBeCloseTo(62.5);
  });

  it("leaves places nobody lives out of the results", () => {
    const sc = scoreNational(a, s({ criteria: areaCriteria({ areaWeights: { walkability: 1 }, areaDirections: {}, areaLimits: {} }).criteria }));
    expect(sc.status[4]).toBe(OUT);
    expect(topAreas(a, sc, 10, true)).not.toContain(4);
  });

  it("ranks areas unknown for a must-have after every verified match", () => {
    const { criteria, limits } = areaCriteria({
      areaWeights: { walkability: 1 },
      areaDirections: {},
      areaLimits: { median_home_value: { max: 400_000 } },
    });
    const sc = scoreNational(a, s({ criteria, limits }));
    expect(sc.status[3]).toBe(UNKNOWN);
    const top = topAreas(a, sc, 10, true);
    expect(top.at(-1)).toBe(3);
  });

  it("scores the best value 100 however many share it; 'beats' counts ties against", () => {
    const { criteria } = areaCriteria({ areaWeights: { hazard_hurricane: 1 }, areaDirections: {}, areaLimits: {} });
    const parts = explainArea(a, 0, s({ criteria }), undefined);
    expect(parts[0].points).toBe(100);
    expect(parts[0].beats).toBeLessThan(99); // tied with most areas: no "top 1%" claim
  });

  it("reads zero violent and zero property crime as no data", () => {
    expect(Number.isNaN(a.values.get("violent_rate")![5])).toBe(true);
    expect(Number.isNaN(a.values.get("property_rate")![5])).toBe(true);
  });

  it("lists must-have matches by population when nothing is weighted", () => {
    const { limits } = areaCriteria({ areaWeights: {}, areaDirections: {}, areaLimits: { walkability: { min: 9 } } });
    const sc = scoreNational(a, s({ limits }));
    expect(topAreas(a, sc, 10, false)).toEqual([1, 3, 0]);
  });
});

describe("not residential, and home values that aren't houses (results audit)", () => {
  const a = parseNationalAreas({
    format: "areas-v1",
    n: 3,
    columns: {
      geoid: ["48001000100", "48001000200", "48001000300"],
      label: ["Base", "Park", "Town"],
      low_confidence: ["", "mobile_homes", ""],
      population: [5000, 3000, 4000],
      group_quarters_share: [95, 0, 2],
      median_home_value: [null, 30_000, 200_000],
    },
  });
  const s = {
    criteria: areaCriteria({ areaWeights: { median_home_value: 1 }, areaDirections: {}, areaLimits: {} }).criteria,
    limits: [],
    counties: countyParts([county("48001", "match", null)]),
  };

  it("leaves out areas that are mostly group quarters", () => {
    expect(notResidential(a, 0)).toBe(true);
    expect(notResidential(a, 2)).toBe(false);
    expect(scoreNational(a, s).status[0]).toBe(OUT);
  });

  it("never gives a mobile-home park the 'cheapest homes' badge", () => {
    const top = topAreas(a, scoreNational(a, s), 10, true);
    expect(top).toEqual([1, 2]);
    expect(resultBadges(a, top, s).get(1)?.best).toEqual([]);
  });
});
