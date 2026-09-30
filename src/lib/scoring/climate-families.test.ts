import { describe, expect, it } from "vitest";

import { getCategory } from "./categories";
import { CLIMATE_FAMILIES, climateFamily, climateLabel, describeClimateFilter } from "./climate-families";

const KOPPEN = getCategory("koppen").options.map((o) => o.value);

describe("climate families", () => {
  it("put every Köppen type in exactly one family", () => {
    const all = CLIMATE_FAMILIES.flatMap((f) => f.codes);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...KOPPEN].sort());
  });

  it("look up and label a code", () => {
    expect(climateFamily("Cfa")?.name).toBe("Humid South");
    expect(climateFamily("nope")).toBeNull();
    expect(climateLabel("Cfa")).toBe("Humid South (humid subtropical, Cfa)");
  });

  it("describe a filter by family, counting only codes counties have", () => {
    const present = new Set(["Cfa", "Dfa", "Dfb", "BSk", "BWh", "Csa", "Dsa", "Aw", "Dfc"]);
    const allPresent = [...present];
    expect(describeClimateFilter(allPresent, present)).toBe("any");
    expect(describeClimateFilter(allPresent.filter((c) => c !== "BWh" && c !== "Aw"), present)).toBe(
      "not Desert or Tropical",
    );
    expect(describeClimateFilter(["Cfa"], present)).toBe("only Humid South");
    expect(describeClimateFilter([], present)).toBe("nothing allowed");
  });
});
