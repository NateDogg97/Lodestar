import { describe, expect, it } from "vitest";

import type { CountyScore } from "@/lib/scoring";

import { areaWatchOuts, countyParts, explainArea, parseNationalAreas, scoreNational, type NationalSearch } from "./national";
import { leadPoints, pm25Points, PM25_DOUBT_CAP, pollutionVerdict, smokePoints } from "./pollution";
import { areaCriteria } from "./scoring";

const county = (fips: string): CountyScore => ({
  index: 0, fips, score: null, status: "match", failedFilters: [], unknownFilters: [], missingMetrics: [], contributions: [],
});

describe("pollution: anchored points (Phase 11)", () => {
  it("scores PM2.5 as expected band points, smooth across band edges", () => {
    // The plan's anchors: 5 -> 84, 7 -> 62, 8 -> 51, 9 -> 40, 10 -> 30, 12 -> 14, 15 -> 1.
    expect([5, 7, 8, 9, 10, 12, 15].map((v) => Math.round(pm25Points(v)))).toEqual([84, 62, 51, 40, 30, 14, 1]);
    // No cliff at EPA's 9: a hair either side is a hair apart, not a band (25 points).
    expect(Math.abs(pm25Points(8.99) - pm25Points(9.01))).toBeLessThan(0.5);
    expect(pm25Points(NaN)).toBeNaN();
  });

  it("caps a doubted PM2.5 at the typical band's points, and never raises one", () => {
    expect(pm25Points(4, true)).toBe(PM25_DOUBT_CAP);
    expect(pm25Points(11, true)).toBe(pm25Points(11));
  });

  it("gives a doubted PM2.5 no verdict word", () => {
    expect(pollutionVerdict({ pm25: 5.8, doubted: true, smoke: 19, radon: 5 })).toBe("Air quality uncertain (model PM2.5 5.8) · 19 smoke days a year");
    expect(pollutionVerdict({ pm25: 5.8, smoke: null, radon: 45 })).toBe("Clean air (PM2.5 5.8) · radon: test any home");
  });

  it("scores smoke days and older housing linearly between fixed anchors", () => {
    expect([0, 5, 17.5, 30, 60].map(smokePoints)).toEqual([100, 100, 50, 0, 0]);
    expect([0, 30, 60, 90].map(leadPoints)).toEqual([100, 50, 0, 0]);
  });
});

describe("pollution in area results", () => {
  // Three areas: clean but doubted (a monitor reads far above the model), clean, smoky.
  const areas = parseNationalAreas({
    format: "areas-v1",
    n: 3,
    columns: {
      geoid: ["06063000300", "06063000400", "06063000500"],
      label: ["Portola", "Quincy", "Chester"],
      low_confidence: ["pm25", "", ""],
      population: [2000, 2000, 2000],
      pm25: [5.0, 5.0, 11.0],
      smoke_days_thick: [20, 20, 40],
      pre1960_share: [10, 10, 70],
      radon_above4: [45, 35, null],
    },
  });
  const criteria = areaCriteria({ areaWeights: { pm25: 3 }, areaDirections: { pm25: "higher" }, areaLimits: {} }).criteria;
  const s: NationalSearch = { criteria, limits: [], counties: countyParts([county("06063")]) };

  it("ignores a stored 'higher is better' for a fixed-direction measure", () => {
    expect(criteria[0].direction).toBe("lower");
  });

  it("ranks the doubted clean area below the trusted clean one", () => {
    const sc = scoreNational(areas, s);
    expect(sc.score[0]).toBe(PM25_DOUBT_CAP);
    expect(sc.score[1]).toBeCloseTo(pm25Points(5), 6);
    expect(sc.score[1]).toBeGreaterThan(sc.score[0]);
  });

  it("makes no 'top 1%' claim on anchored points, and flags the doubted value", () => {
    const parts = explainArea(areas, 0, s, undefined);
    expect(parts[0].beats).toBeNull();
    expect(parts[0].flagged).toBe(true);
  });

  it("always cautions about radon at 40%+ (the worst ~5%), which nobody can weight", () => {
    const warn = (i: number) => areaWatchOuts(areas, i, s).filter((w) => w.key === "radon_above4");
    expect(warn(0).map((w) => w.text)).toEqual(["About 45% of home radon tests here read above EPA's action level — test any home"]);
    expect(warn(1)).toEqual([]);
    expect(warn(2)).toEqual([]); // unknown stays unknown: no caution, no all-clear
  });
});
