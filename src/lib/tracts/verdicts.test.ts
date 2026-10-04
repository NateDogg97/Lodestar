import { describe, expect, it } from "vitest";

import {
  aroundVerdict,
  hazardsVerdict,
  locationVerdict,
  marketVerdict,
  peopleVerdict,
  safetyVerdict,
  schoolsVerdict,
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
