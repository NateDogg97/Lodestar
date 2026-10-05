/**
 * Sanity checks against the real published dataset: do the rankings agree
 * with what anyone would say about these places? If one of these fails after
 * an ETL rebuild, suspect the data before the test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  explainScore,
  parseCountyPayload,
  prepareDataset,
  rankCounties,
  scoreCounties,
  subsetDataset,
  type CountyDataset,
  type CountyScore,
  type ScoringInput,
} from ".";

const all = parseCountyPayload(
  JSON.parse(readFileSync(join(process.cwd(), "public/data/counties.json"), "utf8")),
);
const scope = (excluded: string[]) => subsetDataset(all, (i) => !excluded.includes(all.state[i]));
// The app's default scope: Alaska and Hawaii off. Every test below uses it
// unless it says otherwise.
const data = scope(["AK", "HI"]);
const prepared = prepareDataset(data);

const SAN_FRANCISCO = "06075";
const CUYAHOGA = "39035"; // Cleveland
const MIAMI_DADE = "12086";
const TRAVIS = "48453"; // Austin
const HOWARD_MD = "24027";
const BALTIMORE_CITY = "24510";

function run(input: ScoringInput) {
  const scores = scoreCounties(prepared, input);
  const ranked = rankCounties(scores);
  const get = (fips: string): CountyScore => scores[data.indexByFips.get(fips)!];
  const rankOf = (fips: string) => ranked.findIndex((r) => r.fips === fips) + 1;
  return { scores, ranked, get, rankOf };
}

describe("the dataset and the Alaska / Hawaii toggles", () => {
  it("the published data covers all 50 states and DC", () => {
    expect(new Set(all.state).size).toBe(51);
    expect(all.state).toContain("AK");
    expect(all.state).toContain("HI");
  });

  it("the default scope is the lower 48 and DC only", () => {
    expect(new Set(data.state).size).toBe(49);
    expect(data.state).not.toContain("AK");
    expect(data.state).not.toContain("HI");
  });

  it("turning Hawaii on puts it at the top for warm winters; off, it's absent", () => {
    const withHawaii = scope(["AK"]);
    const ranked = rankCounties(scoreCounties(prepareDataset(withHawaii), { weights: { coldest_month_low_f: 5 } }));
    expect(ranked.slice(0, 5).some((r) => withHawaii.state[r.index] === "HI")).toBe(true);
  });

  it("an excluded state does not move anyone else's percentile", () => {
    // Hawaii's winters are the warmest in the country. With it included,
    // every other county slips down the warm-winter percentiles; with it
    // excluded, they must not — that's what 'doesn't count' means.
    const pct = (d: CountyDataset) => {
      const s = scoreCounties(prepareDataset(d), { weights: { coldest_month_low_f: 1 } });
      return s[d.indexByFips.get(MIAMI_DADE)!].contributions[0].rawPercentile!;
    };
    expect(pct(data)).toBe(pct(scope(["AK", "HI", "ZZ"]))); // same scope, same answer
    expect(pct(scope(["AK"]))).toBeLessThan(pct(data)); // Hawaii in: Miami slips down
  });
});

describe("who lives here (display only, 2026-10-04)", () => {
  it("parses race shares, the diversity index and the Gini index, and keeps them through a subset", () => {
    const sf = all.indexByFips.get(SAN_FRANCISCO)!;
    expect(all.info.asian_share[sf]).toBeGreaterThan(30);
    expect(all.info.diversity_index[sf]).toBeGreaterThan(60);
    expect(all.info.gini_index[sf]).toBeGreaterThan(0.45);
    const shares = (["white_share", "hispanic_share", "black_share", "asian_share", "other_race_share"] as const).reduce(
      (s, k) => s + all.info[k][sf], 0);
    expect(shares).toBeCloseTo(100, 0);
    expect(data.info.diversity_index[data.indexByFips.get(SAN_FRANCISCO)!]).toBe(all.info.diversity_index[sf]);
  });

  it("racial equality ranks the most segregated big counties low", () => {
    const { rankOf } = run({ weights: { racial_equality: 1 } });
    // Detroit (Wayne) and Chicago (Cook): among the most segregated US metros by every measure.
    expect(rankOf("26163")).toBeGreaterThan(1500);
    expect(rankOf("17031")).toBeGreaterThan(1500);
    expect(rankOf(SAN_FRANCISCO)).toBeLessThan(rankOf("26163"));
  });
});

describe("rankings agree with common knowledge", () => {
  it("cost of living: Cleveland beats San Francisco, and the SF metro is dead last", () => {
    const { get, ranked } = run({ weights: { rpp_all: 5 } });
    expect(get(CUYAHOGA).score!).toBeGreaterThan(get(SAN_FRANCISCO).score!);
    expect(get(SAN_FRANCISCO).score!).toBeLessThan(5);
    // BEA 2024: San Francisco-Oakland-Fremont is the priciest metro (its five
    // counties tie), then Miami, then Los Angeles.
    const bottom5 = ranked.slice(-5).map((r) => data.fips[r.index]).sort();
    expect(bottom5).toEqual(["06001", "06013", "06041", "06075", "06081"]);
  });

  it("schools: Howard County MD is near the top, Baltimore city near the bottom", () => {
    const { get } = run({ weights: { school_achievement: 5 } });
    expect(get(HOWARD_MD).score!).toBeGreaterThan(95);
    expect(get(BALTIMORE_CITY).score!).toBeLessThan(10);
  });

  it("warm winters: the top 15 are all Florida or South Texas", () => {
    const { ranked } = run({ weights: { coldest_month_low_f: 5 } });
    const states = new Set(ranked.slice(0, 15).map((r) => data.state[r.index]));
    expect([...states].every((s) => s === "FL" || s === "TX")).toBe(true);
  });

  it("warm winters: Miami beats Austin beats Cleveland", () => {
    const { rankOf } = run({ weights: { coldest_month_low_f: 5 } });
    expect(rankOf(MIAMI_DADE)).toBeLessThan(rankOf(TRAVIS));
    expect(rankOf(TRAVIS)).toBeLessThan(rankOf(CUYAHOGA));
  });

  it("flipping a direction flips the ranking", () => {
    const warm = run({ weights: { coldest_month_low_f: 5 } });
    const cold = run({ weights: { coldest_month_low_f: 5 }, directions: { coldest_month_low_f: "lower" } });
    expect(cold.get(CUYAHOGA).score!).toBeGreaterThan(warm.get(CUYAHOGA).score!);
    expect(cold.rankOf(MIAMI_DADE)).toBeGreaterThan(cold.ranked.length - 50);
  });

  it("cheap with good schools: San Francisco is nowhere near the top", () => {
    const { rankOf, ranked } = run({ weights: { rpp_all: 3, school_achievement: 3 } });
    expect(rankOf(SAN_FRANCISCO)).toBeGreaterThan(ranked.length / 2);
  });
});

describe("climate: the two ends of the year plus uncomfortable days", () => {
  const PHOENIX = "04013";
  const SEATTLE = "53033";

  it("measures climate where people live — San Francisco's September peak is about 70°F", () => {
    // Measured from the 2020 population center: SF's hottest month is
    // September at ~69.5°F, 3°F above its Jun–Aug average. (From the old
    // geographic point, out in the Pacific, it read ~73°F off a station 29 mi away.)
    const sf = data.indexByFips.get(SAN_FRANCISCO)!;
    expect(data.values.hottest_month_high_f[sf]).toBeGreaterThan(68);
    expect(data.values.hottest_month_high_f[sf]).toBeLessThan(72);
  });

  it("San Diego reads as coastal, not as its inland geographic middle", () => {
    const sd = data.indexByFips.get("06073")!;
    expect(data.values.days_above_90f[sd]).toBeLessThan(30);
    expect(data.values.nights_below_32f[sd]).toBeLessThan(5);
  });

  it("ceiling and floor together keep mild places and rule out both extremes", () => {
    const { get } = run({
      weights: {},
      filters: [
        { metric: "hottest_month_high_f", max: 90 },
        { metric: "coldest_month_low_f", min: 30 },
      ],
    });
    expect(get(SAN_FRANCISCO).status).toBe("match");
    expect(get(PHOENIX).status).toBe("excluded"); // too hot
    expect(get(CUYAHOGA).status).toBe("excluded"); // too cold
  });

  it("day-counts rank as expected: Phoenix has the hot days, Seattle the rainy ones", () => {
    const hot = run({ weights: { days_above_90f: 5 } });
    expect(hot.get(PHOENIX).score!).toBeLessThan(5);
    expect(hot.get(SAN_FRANCISCO).score!).toBeGreaterThan(hot.get(TRAVIS).score!);
    const dry = run({ weights: { rainy_days: 5 } });
    expect(dry.get(PHOENIX).score!).toBeGreaterThan(dry.get(SEATTLE).score!);
    expect(dry.get(SEATTLE).score!).toBeLessThan(10);
  });

  it("'average is better' rainy days: Seattle (very wet) and Phoenix (very dry) both lose to a typical county", () => {
    const { get, ranked } = run({ weights: { rainy_days: 5 }, directions: { rainy_days: "middle" } });
    expect(get(SEATTLE).score!).toBeLessThan(10);
    expect(get(PHOENIX).score!).toBeLessThan(25);
    // the winners sit near the national median number of rainy days
    const rainy = data.values.rainy_days;
    const sorted = Array.from(rainy).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    for (const r of ranked.slice(0, 20)) expect(Math.abs(rainy[r.index] - median)).toBeLessThan(2);
  });

  it("'average is better' snowfall: some snow beats none (Miami) and a lot (Cleveland)", () => {
    const { get, ranked } = run({ weights: { annual_snow_in: 5 }, directions: { annual_snow_in: "middle" } });
    const topSnow = data.values.annual_snow_in[ranked[0].index];
    expect(topSnow).toBeGreaterThan(5);
    expect(topSnow).toBeLessThan(25);
    expect(get(MIAMI_DADE).score!).toBeLessThan(50);
    expect(get(CUYAHOGA).score!).toBeLessThan(50);
  });

  it("Alaska's climate gaps are only its known remote areas", () => {
    const ak = scope([]);
    const missing = ak.fips.filter((_, i) => Number.isNaN(ak.values.hottest_month_high_f[i]));
    expect(missing.every((f) => f.startsWith("02"))).toBe(true);
    expect(missing.length).toBeLessThanOrEqual(5);
  });

  it("every county in the default scope has every climate column", () => {
    // Nye County NV lacked snowfall until the search started from its
    // population center (Pahrump), which has snow-reporting stations nearby.
    for (const key of [
      "hottest_month_high_f", "coldest_month_low_f", "days_above_90f", "nights_below_32f",
      "rainy_days", "snow_days", "annual_snow_in", "annual_precip_in",
    ] as const) {
      expect(data.values[key].some(Number.isNaN)).toBe(false);
    }
  });
});

describe("filters and unknowns on real data", () => {
  it("a no-snow filter keeps Miami and drops Cleveland", () => {
    const { get } = run({ weights: {}, filters: [{ metric: "annual_snow_in", max: 1 }] });
    expect(get(MIAMI_DADE).status).toBe("match");
    expect(get(CUYAHOGA).status).toBe("excluded");
  });

  it("Connecticut is unknown for schools, not excluded, and scored on what it has", () => {
    const { scores } = run({
      weights: { school_achievement: 5, rpp_all: 1 },
      filters: [{ metric: "school_achievement", min: 0 }],
    });
    const ct = scores.filter((s) => data.state[s.index] === "CT");
    expect(ct).toHaveLength(9);
    expect(ct.every((s) => s.status === "unknown")).toBe(true);
    expect(ct.every((s) => s.missingMetrics.includes("school_achievement"))).toBe(true);
    expect(ct.every((s) => s.score !== null)).toBe(true);
  });
});

describe("score decomposition on real data", () => {
  it("explains a Miami ranking with warmth as a strength and cost as a weakness", () => {
    const { get } = run({ weights: { coldest_month_low_f: 3, rpp_all: 3, school_achievement: 1 } });
    const { strengths, weaknesses } = explainScore(get(MIAMI_DADE));
    expect(strengths[0].metric).toBe("coldest_month_low_f");
    expect(weaknesses.map((w) => w.metric)).toContain("rpp_all");
  });
});

describe("performance", () => {
  it("re-scores the whole country fast enough for a slider drag", () => {
    const input: ScoringInput = {
      weights: { rpp_all: 3, school_achievement: 4, coldest_month_low_f: 2, annual_snow_in: 1, median_home_value: 2 },
      filters: [{ metric: "population", min: 20_000 }],
    };
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) rankCounties(scoreCounties(prepared, input));
    const perRun = (performance.now() - t0) / 20;
    expect(perRun).toBeLessThan(16); // one frame
  });
});

describe("the States filter", () => {
  it("keeps only the states picked, without changing anyone's score", () => {
    const weights = { rpp_all: 3 };
    const base = run({ weights });
    const only = run({ weights, categoryFilters: [{ category: "state", accept: ["TX", "MD"] }] });
    expect(new Set(only.ranked.map((r) => data.state[r.index]))).toEqual(new Set(["TX", "MD"]));
    expect(only.get(TRAVIS).score).toBe(base.get(TRAVIS).score);
    expect(only.get(SAN_FRANCISCO).status).toBe("excluded");
  });
});
