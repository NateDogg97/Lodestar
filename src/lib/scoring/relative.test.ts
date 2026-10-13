import { describe, expect, it } from "vitest";

import { rankLabels, topRelativeScores, type CountyScore } from ".";

const county = (fips: string, score: number | null): CountyScore => ({
  index: 0, fips, score, status: "match", failedFilters: [], unknownFilters: [], missingMetrics: [], contributions: [],
});

describe("topRelativeScores", () => {
  it("stretches the top n across 0–100 relative to each other", () => {
    const ranked = [county("a", 90), county("b", 70), county("c", 60), county("d", 10)];
    const rel = topRelativeScores(ranked, 3);
    expect([...rel.keys()]).toEqual(["a", "b", "c"]);
    expect(rel.get("a")).toBe(100);
    expect(rel.get("b")).toBeCloseTo(100 / 3);
    expect(rel.get("c")).toBe(0);
    expect(rel.has("d")).toBe(false); // outside the top n: not drawn
  });

  it("doesn't paint a narrow spread red to green (Phase 10f)", () => {
    // Eight points apart: the weakest fades to 60, not to red.
    const rel = topRelativeScores([county("a", 96), county("b", 92), county("c", 88)], 3);
    expect([...rel.values()]).toEqual([100, 80, 60]);
  });

  it("keeps an unscored county in the top n but uncolored (null → grey)", () => {
    const rel = topRelativeScores([county("a", 70), county("b", 50), county("c", null)], 3);
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

describe("rankLabels", () => {
  it("shares a rank between scores that read the same, and skips past them", () => {
    expect(rankLabels([96.7, 95.6, 95.5, 94.9, 90])).toEqual(["1", "=2", "=2", "4", "5"]);
    expect(rankLabels([100, 100, 99])).toEqual(["=1", "=1", "3"]);
    expect(rankLabels([NaN, NaN])).toEqual(["1", "2"]);
  });
});
