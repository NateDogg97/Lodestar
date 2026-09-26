import { describe, expect, it } from "vitest";

import { formatValue, ordinal } from "./format";

describe("formatValue", () => {
  it("formats each unit the way a person would say it", () => {
    expect(formatValue("median_home_value", 425400)).toBe("$425,400");
    expect(formatValue("median_gross_rent", 1450)).toBe("$1,450/mo");
    expect(formatValue("hottest_month_high_f", 91.34)).toBe("91°F");
    expect(formatValue("days_above_90f", 94.8)).toBe("95 days");
    expect(formatValue("nights_below_32f", 0.2)).toBe("0 nights");
    expect(formatValue("rent_to_income", 0.1687)).toBe("17%");
    expect(formatValue("home_value_to_income", 2.826)).toBe("2.8×");
    expect(formatValue("rpp_all", 114.155)).toBe("114.2");
    expect(formatValue("population", 1307625)).toBe("1,307,625");
  });

  it("signs school achievement relative to the national average", () => {
    expect(formatValue("school_achievement", 0.5)).toBe("+0.50 grades");
    expect(formatValue("school_achievement", -0.069)).toBe("−0.07 grades");
    expect(formatValue("school_achievement", 0)).toBe("0.00 grades");
  });

  it("says 'No data' for unknowns rather than showing a number", () => {
    expect(formatValue("school_achievement", null)).toBe("No data");
    expect(formatValue("annual_snow_in", NaN)).toBe("No data");
  });
});

describe("ordinal", () => {
  it("handles the teens and the 1st/2nd/3rd endings", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 94, 100].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "94th", "100th",
    ]);
  });

  it("rounds to a whole percentile", () => {
    expect(ordinal(93.6)).toBe("94th");
  });
});
