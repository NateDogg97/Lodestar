import { describe, expect, it } from "vitest";

import {
  directionalScore,
  explainScore,
  METRIC_KEYS,
  parseCountyPayload,
  PAYLOAD_FORMAT,
  percentileRanks,
  prepareDataset,
  rankCounties,
  subsetDataset,
  scoreCounties,
  type MetricKey,
} from ".";

/** Build a published-format payload from a few rows; unlisted metrics are null. */
function payload(rows: ({ fips: string } & Partial<Record<MetricKey, number | null>>)[]) {
  const columns = ["fips", "county_name", "state", "rpp_geo_level", ...METRIC_KEYS];
  return {
    format: PAYLOAD_FORMAT,
    columns,
    rows: rows.map((r) => [
      r.fips,
      `County ${r.fips}`,
      "ZZ",
      "metro",
      ...METRIC_KEYS.map((k) => r[k] ?? null),
    ]),
  };
}

function setup(rows: Parameters<typeof payload>[0]) {
  return prepareDataset(parseCountyPayload(payload(rows)));
}

describe("percentileRanks", () => {
  it("spreads distinct values evenly from 0 to 100", () => {
    expect(Array.from(percentileRanks(Float64Array.from([30, 10, 20])))).toEqual([100, 0, 50]);
  });

  it("gives tied values the same, averaged percentile", () => {
    // ranks 0, (1+2)/2, 3 out of 3
    expect(Array.from(percentileRanks(Float64Array.from([1, 5, 5, 9])))).toEqual([0, 50, 50, 100]);
  });

  it("leaves unknowns unknown and ranks only the known values", () => {
    const p = percentileRanks(Float64Array.from([NaN, 2, 1]));
    expect(p[0]).toBeNaN();
    expect([p[1], p[2]]).toEqual([100, 0]);
  });

  it("puts a lone known value at 50", () => {
    expect(Array.from(percentileRanks(Float64Array.from([NaN, 7])))).toEqual([NaN, 50]);
  });

  it("is immune to outliers, unlike min-max", () => {
    const p = percentileRanks(Float64Array.from([100, 200, 300, 1_000_000]));
    expect(Array.from(p).map(Math.round)).toEqual([0, 33, 67, 100]);
  });
});

describe("parseCountyPayload", () => {
  it("rejects a file in the wrong format", () => {
    expect(() => parseCountyPayload([{ fips: "01001" }])).toThrow(/shape/);
    expect(() => parseCountyPayload({ ...payload([]), format: "records" })).toThrow(/format/);
  });

  it("rejects a file missing a metric column", () => {
    const p = payload([{ fips: "01001" }]);
    p.columns = p.columns.filter((c) => c !== "school_achievement");
    expect(() => parseCountyPayload(p)).toThrow(/school_achievement/);
  });

  it("keeps FIPS as strings and reads null as unknown (NaN), not zero", () => {
    const d = parseCountyPayload(payload([{ fips: "06075", median_gross_rent: 2100 }]));
    expect(d.fips).toEqual(["06075"]);
    expect(d.values.median_gross_rent[0]).toBe(2100);
    expect(d.values.school_achievement[0]).toBeNaN();
    expect(d.indexByFips.get("06075")).toBe(0);
  });
});

describe("scoreCounties", () => {
  const rows = [
    { fips: "00001", school_achievement: 0.5, median_gross_rent: 900 },
    { fips: "00002", school_achievement: 0.0, median_gross_rent: 1200 },
    { fips: "00003", school_achievement: -0.5, median_gross_rent: 1500 },
  ];

  it("scores higher-is-better metrics by percentile", () => {
    const s = scoreCounties(setup(rows), { weights: { school_achievement: 1 } });
    expect(s.map((x) => x.score)).toEqual([100, 50, 0]);
  });

  it("flips lower-is-better metrics", () => {
    const s = scoreCounties(setup(rows), { weights: { median_gross_rent: 1 } });
    expect(s.map((x) => x.score)).toEqual([100, 50, 0]);
  });

  it("lets the user override a metric's direction", () => {
    const s = scoreCounties(setup(rows), {
      weights: { median_gross_rent: 1 },
      directions: { median_gross_rent: "higher" },
    });
    expect(s.map((x) => x.score)).toEqual([0, 50, 100]);
  });

  it("scores 'average is better' by closeness to the typical county, symmetrically", () => {
    const data = setup([10, 20, 30, 40, 50].map((v, i) => ({ fips: `0000${i + 1}`, rainy_days: v })));
    const s = scoreCounties(data, { weights: { rainy_days: 1 }, directions: { rainy_days: "middle" } });
    // percentiles 0, 25, 50, 75, 100 -> points 0, 50, 100, 50, 0
    expect(s.map((x) => x.score)).toEqual([0, 50, 100, 50, 0]);
    expect(s[2].contributions[0]).toMatchObject({ direction: "middle", rawPercentile: 50, percentile: 100 });
  });

  it("directionalScore maps a percentile to points for each direction", () => {
    expect([directionalScore(80, "higher"), directionalScore(80, "lower"), directionalScore(80, "middle")])
      .toEqual([80, 20, 40]);
    expect(directionalScore(20, "middle")).toBe(directionalScore(80, "middle"));
  });

  it("computes Σ(weight × percentile) / Σ(weight)", () => {
    const data = setup([
      { fips: "00001", school_achievement: 1, coldest_month_low_f: 10 },
      { fips: "00002", school_achievement: 0, coldest_month_low_f: 50 },
    ]);
    // county 1: schools 100 (w3), winter 0 (w1) -> 300/4 = 75
    const s = scoreCounties(data, { weights: { school_achievement: 3, coldest_month_low_f: 1 } });
    expect(s[0].score).toBe(75);
    expect(s[1].score).toBe(25);
  });

  it("clamps weights to 0-5 and ignores zero weights", () => {
    const data = setup(rows);
    const a = scoreCounties(data, { weights: { school_achievement: 99, median_gross_rent: 0 } });
    expect(a[0].contributions).toHaveLength(1);
    expect(a[0].contributions[0].weight).toBe(5);
  });

  it("gives no score when nothing is weighted", () => {
    const s = scoreCounties(setup(rows), { weights: {} });
    expect(s.every((x) => x.score === null && x.status === "match")).toBe(true);
  });

  it("drops a missing weighted metric from that county's average and flags it", () => {
    const data = setup([
      { fips: "00001", school_achievement: null, coldest_month_low_f: 50 },
      { fips: "00002", school_achievement: 1, coldest_month_low_f: 10 },
      { fips: "00003", school_achievement: 0, coldest_month_low_f: 30 },
    ]);
    const s = scoreCounties(data, { weights: { school_achievement: 5, coldest_month_low_f: 1 } });
    // county 1 is scored on winter alone (100th percentile), not dragged to 0 by the gap
    expect(s[0].score).toBe(100);
    expect(s[0].missingMetrics).toEqual(["school_achievement"]);
    expect(s[0].contributions.find((c) => c.metric === "school_achievement")!.impact).toBeNull();
    expect(s[1].missingMetrics).toEqual([]);
  });

  it("gives no score when every weighted metric is missing", () => {
    const data = setup([{ fips: "00001" }, { fips: "00002", annual_snow_in: 3 }]);
    const s = scoreCounties(data, { weights: { annual_snow_in: 1 } });
    expect(s[0].score).toBeNull();
    expect(s[0].status).toBe("match");
  });
});

describe("hard filters", () => {
  const data = setup([
    { fips: "00001", annual_snow_in: 0 },
    { fips: "00002", annual_snow_in: 40 },
    { fips: "00003", annual_snow_in: null },
    { fips: "00004", annual_snow_in: 10 },
  ]);
  const filters = [{ metric: "annual_snow_in" as const, max: 10 }];

  it("excludes counties outside the range, with bounds inclusive", () => {
    const s = scoreCounties(data, { weights: { annual_snow_in: 1 }, filters });
    expect(s.map((x) => x.status)).toEqual(["match", "excluded", "unknown", "match"]);
    expect(s[1].failedFilters).toEqual(["annual_snow_in"]);
    expect(s[1].score).toBeNull();
  });

  it("marks a county with no data for a filter as unknown, neither passed nor failed", () => {
    const s = scoreCounties(data, { weights: {}, filters });
    expect(s[2].status).toBe("unknown");
    expect(s[2].unknownFilters).toEqual(["annual_snow_in"]);
    expect(s[2].failedFilters).toEqual([]);
  });

  it("applies min and max together", () => {
    const s = scoreCounties(data, {
      weights: {},
      filters: [{ metric: "annual_snow_in", min: 5, max: 20 }],
    });
    expect(s.map((x) => x.status)).toEqual(["excluded", "excluded", "unknown", "match"]);
  });

  it("does not let a filter change anyone's percentile", () => {
    const unfiltered = scoreCounties(data, { weights: { annual_snow_in: 1 } });
    const filtered = scoreCounties(data, { weights: { annual_snow_in: 1 }, filters });
    expect(filtered[0].score).toBe(unfiltered[0].score);
    expect(filtered[3].score).toBe(unfiltered[3].score);
  });
});

describe("rankCounties", () => {
  const data = setup([
    { fips: "00001", annual_snow_in: 5, school_achievement: 0 },
    { fips: "00002", annual_snow_in: 50, school_achievement: 1 },
    { fips: "00003", annual_snow_in: null, school_achievement: 2 },
    { fips: "00004", annual_snow_in: 1, school_achievement: null },
  ]);
  const input = {
    weights: { school_achievement: 1 },
    filters: [{ metric: "annual_snow_in" as const, max: 10 }],
  };

  it("sorts best first, drops excluded, keeps unknowns by default, unscored last", () => {
    const ranked = rankCounties(scoreCounties(data, input));
    expect(ranked.map((r) => r.fips)).toEqual(["00003", "00001", "00004"]);
  });

  it("can hide unknowns", () => {
    const ranked = rankCounties(scoreCounties(data, input), { includeUnknown: false });
    expect(ranked.map((r) => r.fips)).toEqual(["00001", "00004"]);
  });

  it("breaks score ties by FIPS so the order is stable", () => {
    const tied = setup([
      { fips: "00009", rpp_all: 100 },
      { fips: "00002", rpp_all: 100 },
    ]);
    const ranked = rankCounties(scoreCounties(tied, { weights: { rpp_all: 1 } }));
    expect(ranked.map((r) => r.fips)).toEqual(["00002", "00009"]);
  });
});

describe("explainScore", () => {
  it("returns the top positive and bottom negative contributors by weight × (percentile − 50)", () => {
    const data = setup([
      { fips: "00001", school_achievement: 1, coldest_month_low_f: 0, median_gross_rent: 500, annual_snow_in: 10 },
      { fips: "00002", school_achievement: 0, coldest_month_low_f: 60, median_gross_rent: 2000, annual_snow_in: 10 },
    ]);
    const [s] = scoreCounties(data, {
      weights: { school_achievement: 2, coldest_month_low_f: 5, median_gross_rent: 1, annual_snow_in: 3 },
    });
    const { strengths, weaknesses } = explainScore(s);
    // schools 100 × w2 = +100; rent 100 × w1 = +50; winter 0 × w5 = −250; snow tied at 50 = 0
    expect(strengths.map((c) => [c.metric, c.impact])).toEqual([
      ["school_achievement", 100],
      ["median_gross_rent", 50],
    ]);
    expect(weaknesses.map((c) => [c.metric, c.impact])).toEqual([["coldest_month_low_f", -250]]);
  });

  it("leaves unknown metrics out of the explanation", () => {
    const data = setup([
      { fips: "00001", school_achievement: null, coldest_month_low_f: 60 },
      { fips: "00002", school_achievement: 1, coldest_month_low_f: 0 },
    ]);
    const [s] = scoreCounties(data, { weights: { school_achievement: 5, coldest_month_low_f: 1 } });
    const { strengths, weaknesses } = explainScore(s);
    expect([...strengths, ...weaknesses].map((c) => c.metric)).toEqual(["coldest_month_low_f"]);
  });
});

describe("subsetDataset (Alaska / Hawaii toggles)", () => {
  const data = parseCountyPayload(payload([
    { fips: "01001", coldest_month_low_f: 20 },
    { fips: "15001", coldest_month_low_f: 65 }, // an excluded state's county, warmest of all
    { fips: "01003", coldest_month_low_f: 40 },
    { fips: "01005", coldest_month_low_f: 30 },
  ]));
  const without15 = subsetDataset(data, (i) => !data.fips[i].startsWith("15"));

  it("drops the excluded counties and re-indexes the rest", () => {
    expect(without15.fips).toEqual(["01001", "01003", "01005"]);
    expect(without15.indexByFips.get("01005")).toBe(2);
    expect(Array.from(without15.values.coldest_month_low_f)).toEqual([20, 40, 30]);
  });

  it("computes percentiles without the excluded counties", () => {
    const s = scoreCounties(prepareDataset(without15), { weights: { coldest_month_low_f: 1 } });
    // Among 20, 40, 30 alone: 0th, 100th, 50th. With the 65 included, the
    // 40 would only be at 67th — the excluded county would have leaked in.
    expect(s.map((x) => x.score)).toEqual([0, 100, 50]);
  });
});
