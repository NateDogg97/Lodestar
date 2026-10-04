import { describe, expect, it } from "vitest";

import {
  aroundVerdict,
  hazardsVerdict,
  locationVerdict,
  marketVerdict,
  peopleVerdict,
  safetyVerdict,
  schoolsVerdict,
  standing,
  buyOrRentVerdict,
  diversityVerdict,
  incomeGapWord,
} from "./verdicts";

describe("area page verdicts", () => {
  it("say what stands out, in words", () => {
    expect(schoolsVerdict(73)).toBe("Above average");
    expect(schoolsVerdict(null)).toBe("No scored schools nearby");
    expect(safetyVerdict(360)).toBe("More crime than a typical US area");
    expect(safetyVerdict(100)).toBe("Much safer than a typical US area");
    expect(peopleVerdict({ age: 31.8, owners: 25.9, highrise: 55.3, singleFamily: 18 })).toBe(
      "Young, mostly renters, mostly apartments",
    );
    expect(peopleVerdict({ age: 40, owners: 60, highrise: 2, singleFamily: 60 })).toBe("A mix of ages, owners and renters");
    expect(aroundVerdict(1.2, 15.9)).toBe("Close to downtown, short commute");
    expect(aroundVerdict(null, 40)).toBe("Long commute");
    expect(marketVerdict(7.6)).toBe("Prices up 7.6% in a year (typical +1.6%)");
    expect(locationVerdict(272, "Minneapolis-St. Paul-Bloomington, MN-WI")).toBe("Far from big metros · 272 mi to Minneapolis");
    expect(locationVerdict(10, "Austin-Round Rock-San Marcos, TX")).toBe("In or near the Austin metro");
    expect(locationVerdict(104, "Winston-Salem, NC")).toBe("Far from big metros · 104 mi to Winston-Salem");
    expect(locationVerdict(30, "Nashville-Davidson--Murfreesboro--Franklin, TN")).toBe("30 mi to Nashville");
  });

  it("say 'too little to rate' when the ETL withdrew a crime rate, 'no data' when there was none", () => {
    expect(safetyVerdict(null, "reported only 1 month of 2025: too little to rate")).toBe("Too little reported to rate");
    expect(safetyVerdict(null)).toBe("No crime data");
    expect(safetyVerdict(null, null)).toBe("No crime data");
    expect(safetyVerdict(0)).toBe("Much safer than a typical US area");
    expect(safetyVerdict(248)).toBe("About as safe as a typical US area");
    expect(safetyVerdict(600)).toBe("Much more crime than a typical US area");
  });

  it("word where a value stands so a tie is never claimed as a rarity", () => {
    const area = (over: Partial<Parameters<typeof standing>[0]>) => standing({
      level: "area", direction: "lower", points: 80, beats: 79.6, rawPercentile: 20, ...over,
    });
    expect(area({})).toBe("lower than 80% of US areas");
    expect(area({ direction: "higher", points: 95.2, beats: 95.1, rawPercentile: 95.2 })).toBe("higher than 95% of US areas");
    // The best value shared by most places: 100 points, but "as low as any", not "lower than 100%".
    expect(area({ points: 100, beats: 42 })).toBe("as low as any of the US areas");
    expect(area({ direction: "higher", points: 100, beats: 0 })).toBe("as high as any of the US areas");
    // A smaller tie: say it's a tie.
    expect(area({ points: 97, beats: 93 })).toBe("lower than or tied with 97% of US areas");
    // The only one at the best value: a real rarity.
    expect(area({ points: 100, beats: 99.9 })).toBe("lower than 100% of US areas");
    expect(area({ direction: "middle", points: 90, beats: null, rawPercentile: 45.2 })).toBe("45th percentile of US areas · typical is best");
    expect(area({ level: "county", points: null, beats: null, rawPercentile: null })).toBe("0th percentile of US counties · typical is best");
  });

  it("say whether buying or renting is the cheaper way into a county", () => {
    expect(buyOrRentVerdict(12.4)).toBe("Buying is cheap next to renting · a home costs 12 years of rent");
    expect(buyOrRentVerdict(17)).toBe("Buying and renting are about even · a home costs 17 years of rent");
    expect(buyOrRentVerdict(28.6)).toBe("Renting is cheap next to buying · a home costs 29 years of rent");
    expect(buyOrRentVerdict(null)).toBe("No housing data");
    expect(buyOrRentVerdict(20.2)).toBe("Buying and renting are about even · a home costs 20 years of rent");
    expect(buyOrRentVerdict(14.6)).toBe("Buying and renting are about even · a home costs 15 years of rent");
  });

  it("describe who lives here without grading it", () => {
    const shares = (w: number, h: number) => [
      { label: "White", pct: w },
      { label: "Hispanic or Latino", pct: h },
      { label: "Black", pct: null },
    ];
    expect(diversityVerdict(9.7, shares(95, 1))).toBe("Mostly one group · largest group White (95%)");
    expect(diversityVerdict(67.8, shares(43, 29))).toBe("Very diverse · largest group White (43%)");
    expect(diversityVerdict(45, shares(30, 52))).toBe("Diverse · largest group Hispanic or Latino (52%)");
    expect(diversityVerdict(null, [])).toBe("No data on who lives here");
    expect(incomeGapWord(0.33)).toBe("Incomes fairly even");
    expect(incomeGapWord(0.42)).toBe("A typical income gap");
    expect(incomeGapWord(0.5)).toBe("A wide income gap");
    expect(incomeGapWord(0.6)).toBe("A very wide income gap");
  });

  it("flag one standout hazard when the overall risk is lower", () => {
    const hz = [
      { label: "Tornadoes", p: 97.7 },
      { label: "Wildfire", p: 86.6 },
    ];
    expect(hazardsVerdict(11.1, hz)).toBe("Very low overall — but tornadoes");
    expect(hazardsVerdict(85, hz)).toBe("Very high risk overall");
  });
});
