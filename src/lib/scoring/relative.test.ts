import { describe, expect, it } from "vitest";

import { topRelativeScores, type CountyScore } from ".";

const county = (fips: string, score: number | null): CountyScore => ({
  index: 0, fips, score, status: "match", failedFilters: [], unknownFilters: [], missingMetrics: [], contributions: [],
});

describe("topRelativeScores", () => {
  it("stretches the top n across 0–100 relative to each other", () => {
    const ranked = [county("a", 90), county("b", 85), county("c", 80), county("d", 10)];
    const rel = topRelativeScores(ranked, 3);
    expect([...rel.entries()]).toEqual([["a", 100], ["b", 50], ["c", 0]]);
    expect(rel.has("d")).toBe(false); // outside the top n: not drawn
  });

  it("keeps an unscored county in the top n but uncolored (null → grey)", () => {
    const rel = topRelativeScores([county("a", 70), county("b", 60), county("c", null)], 3);
    expect(rel.get("c")).toBeNull();
    expect(rel.get("a")).toBe(100);
    expect(rel.get("b")).toBe(0);
  });

  it("colors everyone as best when there is nothing to separate them", () => {
    expect([...topRelativeScores([county("a", 50), county("b", 50)]).values()]).toEqual([100, 100]);
    expect([...topRelativeScores([county("a", 42)]).values()]).toEqual([100]);
  });

  it("defaults to the top 50", () => {
    const ranked = Array.from({ length: 80 }, (_, i) => county(String(i).padStart(5, "0"), 100 - i));
    expect(topRelativeScores(ranked).size).toBe(50);
  });
});
