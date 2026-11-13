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
  agencyCoverage,
  agencyRates,
  cityCrimeNote,
  crimeLead,
  wideCrimeNote,
} from "./verdicts";
import type { AgencyFigure } from "./crime";

describe("area page verdicts", () => {
  it("say what stands out, in words", () => {
    expect(schoolsVerdict(73)).toBe("Above average");
    expect(schoolsVerdict(null)).toBe("No test scores for this district");
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
    expect(locationVerdict(0, "Austin-Round Rock-San Marcos, TX")).toBe("In the Austin metro");
    // Washtenaw, MI: 9.4 mi from the edge of Detroit's built-up area (31.7 to its center).
    expect(locationVerdict(9.4, "Detroit-Warren-Dearborn, MI")).toBe("Next to the Detroit metro · 9 mi from its edge");
    expect(locationVerdict(104, "Winston-Salem, NC")).toBe("Far from big metros · 104 mi to Winston-Salem");
    expect(locationVerdict(30, "Nashville-Davidson--Murfreesboro--Franklin, TN")).toBe("30 mi from the Nashville metro");
  });

  it("say 'too little to rate' when the ETL withdrew a crime rate, 'no data' when there was none", () => {
    expect(safetyVerdict(null, "reported only 1 month of 2025: too little to rate")).toBe("Too little reported to rate");
    expect(safetyVerdict(null)).toBe("No crime data");
    expect(safetyVerdict(null, null)).toBe("No crime data");
    expect(safetyVerdict(0)).toBe("Much safer than a typical US area");
    expect(safetyVerdict(248)).toBe("About as safe as a typical US area");
    expect(safetyVerdict(600)).toBe("Much more crime than a typical US area");
  });

  describe("crime, shown only where the area or its city has a figure (2026-11-13)", () => {
    const fig = (over: Partial<AgencyFigure>): AgencyFigure => ({
      agency: "Chicago", violent: 425, property: 3075, year: 2025, months: 12, people: 2715488, areas: 790,
      countyAgency: false, violentCrimes: 11540, ...over,
    });
    const chicago = fig({});
    const fairfax = fig({ agency: "Fairfax County (sheriff and State Police)", violent: 101, property: 1501,
      people: null, areas: 261, countyAgency: true });
    const sheriff = fig({ agency: "Washtenaw County (sheriff and State Police)", violent: 363, property: 658,
      people: 162060, areas: 39, countyAgency: true, violentCrimes: 588 });
    const chelsea = fig({ agency: "Chelsea", violent: 204, property: 781, people: 5379, areas: 2, violentCrimes: 11 });

    it("compare only an area's own rate with the typical US area", () => {
      expect(crimeLead({ kind: "own", figure: chelsea })).toBe("Safer than a typical US area");
      expect(crimeLead({ kind: "city", figure: chicago })).toBe("One figure for all of Chicago");
      expect(crimeLead({ kind: "city", figure: fairfax })).toBe(
        "One figure for everywhere Fairfax County (sheriff and State Police) polices",
      );
      expect(crimeLead({ kind: "nearby", covering: sheriff, others: [] })).toBe("No crime figure for this area or its city");
      expect(crimeLead({ kind: "none" })).toBe("No crime figures in this county");
    });

    it("say a big city's figure is the city's, with no ranking language", () => {
      const note = cityCrimeNote(chicago);
      expect(note).toBe(
        "Chicago reports one rate for all 2,715,488 people it serves, so all 790 areas it polices in this county carry " +
          "the same numbers. The FBI counts crime by police agency, not by neighborhood: this is the whole city’s " +
          "figure, not this area’s, and its neighborhoods can differ a lot.",
      );
      expect(note).not.toMatch(/rank|shade|safer|safest/i);
      expect(cityCrimeNote(fairfax)).toContain("one rate for everywhere it polices, so all 261 areas");
      expect(cityCrimeNote(fairfax)).toContain("this is the figure for everywhere it polices, not this area’s");
    });

    it("say why a sheriff's county-wide rate isn't the area's", () => {
      expect(wideCrimeNote(sheriff)).toBe(
        "Washtenaw County (sheriff and State Police) polices this area and reports one rate for all 39 areas it covers " +
          "in this county, from farmland to suburbs: the county’s figure, not this area’s.",
      );
    });

    it("list each agency's rates and what they cover, with the count where crimes are few", () => {
      expect(agencyRates(chicago)).toBe("425 violent · 3,075 property per 100,000 people a year");
      expect(agencyRates(fig({ property: null }))).toBe("425 violent · — property per 100,000 people a year");
      expect(agencyCoverage(chicago)).toBe("790 areas here · 2,715,488 people in all · 2025");
      expect(agencyCoverage(chelsea)).toBe("2 areas here · 5,379 people in all · 2025 · only about 11 violent crimes reported");
      expect(agencyCoverage(fig({ areas: 1, people: 1, months: 6, violentCrimes: 1 }))).toBe(
        "1 area here · 1 person in all · 2025 (6 months, scaled to a year) · only about 1 violent crime reported",
      );
    });
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
    expect(hazardsVerdict(11.1, hz)).toBe("Very low loss rate overall — but tornadoes");
    expect(hazardsVerdict(85, hz)).toBe("Very high loss rate overall");
  });

  it("names FEMA's own rating beside the loss rate (Washtenaw: 4th pctl, FEMA Relatively Moderate)", () => {
    expect(hazardsVerdict(4.2, [], "Relatively Moderate")).toBe("Very low loss rate overall · FEMA: Relatively Moderate");
  });
});
