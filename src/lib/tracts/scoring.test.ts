import { describe, expect, it } from "vitest";

import { getMetric } from "@/lib/scoring";

import type { Area } from "./index";
import { areaCriteria, scoreAreas, topReasons, type AreaSearch } from "./scoring";

const area = (geoid: string, row: Record<string, number | null>): Area => ({
  geoid, label: geoid, group: "G", neighborhood: null, zip: null, population: 1000,
  row: { geoid, ...row }, lowConfidence: [], topcoded: [], nearbySchools: [], nearbyHighSchools: [],
});

const search = (over: Partial<AreaSearch>): AreaSearch => ({
  weights: {}, directions: {}, limits: {}, areaWeights: {}, areaDirections: {}, areaLimits: {}, ...over,
});

const criteriaOf = (s: AreaSearch) =>
  areaCriteria(s, (k) => getMetric(k).label, (k) => getMetric(k).defaultDirection);

const areas = [
  area("a", { median_home_value: 300_000, walkability: 15, violent_rate: 200, rpp_all: 100 }),
  area("b", { median_home_value: 500_000, walkability: 8, violent_rate: 100 }),
  area("c", { median_home_value: 900_000, walkability: null, violent_rate: 600 }),
];

describe("ranking areas inside a county", () => {
  it("carries county priorities that vary by area, not the rest", () => {
    const { criteria } = criteriaOf(search({ weights: { median_home_value: 3, rpp_all: 5, days_above_90f: 2 } }));
    expect(criteria.map((c) => c.column)).toEqual(["median_home_value"]);
    expect(criteria[0]).toMatchObject({ weight: 3, direction: "lower", from: "county" });
  });

  it("adds area-only priorities with their directions", () => {
    const { criteria } = criteriaOf(search({ areaWeights: { walkability: 4 }, areaDirections: { walkability: "lower" } }));
    expect(criteria).toEqual([expect.objectContaining({ column: "walkability", weight: 4, direction: "lower", from: "area" })]);
  });

  it("ranks within the county, weighting like counties", () => {
    const { criteria, limits } = criteriaOf(search({ weights: { median_home_value: 1 }, areaWeights: { violent_rate: 1 } }));
    const s = scoreAreas(areas, criteria, limits);
    // a: cheapest (100) + middle crime (50) = 75; b: 50 + safest 100 = 75; c: 0 + 0 = 0.
    expect(s.get("a")?.score).toBe(75);
    expect(s.get("b")?.score).toBe(75);
    expect(s.get("c")?.score).toBe(0);
    // Why: a is cheapest (+50 × 1) and middling on crime (0); its strongest push is home value.
    const why = s.get("a")!.contributions;
    expect(why.map((c) => [c.column, c.points, c.impact])).toEqual([["median_home_value", 100, 50], ["violent_rate", 50, 0]]);
    expect(topReasons(s.get("c"))).toMatchObject({ up: null, down: { column: "median_home_value" } });
  });

  it("scores on what an area has; nothing to rank by means no score", () => {
    const { criteria, limits } = criteriaOf(search({ areaWeights: { walkability: 2 } }));
    const s = scoreAreas(areas, criteria, limits);
    expect(s.get("a")?.score).toBe(100);
    expect(s.get("c")?.score).toBeNull();
    expect(scoreAreas(areas, [], []).get("a")?.score).toBeNull();
  });

  it("must-haves: same-unit county limits and area limits rule areas out; no value is unknown", () => {
    const s = search({ limits: { median_home_value: { max: 600_000 }, school_achievement: { min: 0.5 } },
      areaLimits: { walkability: { min: 10 } } });
    const { limits } = criteriaOf(s);
    // School achievement is in grade levels for counties, a percentile for areas: not carried.
    expect(limits.map((l) => l.column)).toEqual(["median_home_value", "walkability"]);
    const out = scoreAreas(areas, [], limits);
    expect(out.get("a")?.status).toBe("match");
    expect(out.get("b")).toMatchObject({ status: "excluded", failed: ["Walkability"] });
    expect(out.get("c")).toMatchObject({ status: "excluded", unknown: ["Walkability"] });
    expect(out.get("b")?.limits.map((l) => l.state)).toEqual(["pass", "fail"]);
  });
});
