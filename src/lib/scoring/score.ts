/**
 * The scoring model (Working Master Plan §6).
 *
 *   score = Σ(weight × percentile) / Σ(weight)
 *
 * over the metrics the user has weighted, where each percentile is first
 * turned into "points" by the metric's direction (see `directionalScore`).
 * Hard filters remove a county outright rather than lowering its score.
 *
 * MISSING DATA IS UNKNOWN, NEVER GUESSED (§6 item 7):
 * - A filter on a metric the county has no value for neither passes nor
 *   fails it. The county's status becomes "unknown" (grey on the map), and
 *   the UI can show or hide unknowns.
 * - A weighted metric the county has no value for drops out of that county's
 *   average — its weight leaves both sums — and is listed in `missingMetrics`
 *   so the UI can mark the score as partial.
 *
 * Percentiles are national: computed once over every county, not over the
 * ones that survive the filters. So tightening a filter never changes the
 * score of a county that was already on screen.
 */

import { getCategory, isCategoryKey, type CategoryKey } from "./categories";
import type { CountyDataset } from "./dataset";
import { getMetric, METRIC_KEYS, type Direction, type MetricKey } from "./metrics";
import { percentileRanks } from "./percentile";

export const MAX_WEIGHT = 5;

/**
 * Turn a raw percentile (higher value → higher percentile) into 0–100 points
 * where higher is always better:
 * - higher: p
 * - lower:  100 − p
 * - middle: 100 − 2·|p − 50| — the median county gets 100, the 25th and 75th
 *   get 50, the extremes get 0. Symmetric in percentile terms, so "a bit more
 *   rain than typical" and "a bit less" cost the same.
 */
export function directionalScore(percentile: number, direction: Direction): number {
  switch (direction) {
    case "higher":
      return percentile;
    case "lower":
      return 100 - percentile;
    case "middle":
      return 100 - 2 * Math.abs(percentile - 50);
  }
}

export interface RangeFilter {
  metric: MetricKey;
  /** Inclusive lower bound, in the metric's own units. */
  min?: number;
  /** Inclusive upper bound, in the metric's own units. */
  max?: number;
}

/**
 * A policy filter: the county's value must be one of `accept`. An empty
 * list rules everything out; leave the filter off for "don't care".
 */
export interface CategoryFilter {
  category: CategoryKey;
  accept: readonly string[];
}

/** What a filter is on: a metric (range limit) or a policy category. */
export type FilterKey = MetricKey | CategoryKey;

export function filterLabel(key: FilterKey): string {
  return isCategoryKey(key) ? getCategory(key).label : getMetric(key).label;
}

export interface ScoringInput {
  /** 0–5 per metric. Absent or 0 means the metric does not count. */
  weights: Partial<Record<MetricKey, number>>;
  /** Override what "better" means for a metric, e.g. hot summers, or typical rainfall. */
  directions?: Partial<Record<MetricKey, Direction>>;
  filters?: RangeFilter[];
  categoryFilters?: CategoryFilter[];
}

/**
 * - `match`: passes every filter it has data for, and has data for all of them.
 * - `unknown`: fails none, but lacks data for at least one filter.
 * - `excluded`: fails at least one filter.
 */
export type CountyStatus = "match" | "unknown" | "excluded";

export interface MetricContribution {
  metric: MetricKey;
  /** Raw value in the metric's units, or null if unknown. */
  value: number | null;
  direction: Direction;
  /** Where the value sits nationally, 0–100 (higher value → higher). Null if unknown. */
  rawPercentile: number | null;
  /** 0–100 points after applying the direction, so higher is always better. Null if unknown. */
  percentile: number | null;
  weight: number;
  /** weight × (percentile − 50): how far this metric pushed the score up or down. Null if unknown. */
  impact: number | null;
}

export interface CountyScore {
  index: number;
  fips: string;
  /** 0–100, or null when excluded or when no weighted metric has data. */
  score: number | null;
  status: CountyStatus;
  failedFilters: FilterKey[];
  unknownFilters: FilterKey[];
  /** Weighted metrics this county has no data for; non-empty means the score is partial. */
  missingMetrics: MetricKey[];
  /** One entry per weighted metric, in the order they were weighted. */
  contributions: MetricContribution[];
}

/** A dataset plus its per-metric percentiles, computed once. */
export interface PreparedDataset {
  data: CountyDataset;
  /** Percentile of the raw value (higher value → higher percentile), NaN if unknown. */
  percentiles: Record<MetricKey, Float64Array>;
}

export function prepareDataset(data: CountyDataset): PreparedDataset {
  const percentiles = {} as Record<MetricKey, Float64Array>;
  for (const key of METRIC_KEYS) percentiles[key] = percentileRanks(data.values[key]);
  return { data, percentiles };
}

function clampWeight(w: number | undefined): number {
  if (w === undefined || !Number.isFinite(w)) return 0;
  return Math.min(MAX_WEIGHT, Math.max(0, w));
}

/** Score every county, in dataset order. Excluded counties are included, with status "excluded". */
export function scoreCounties(prepared: PreparedDataset, input: ScoringInput): CountyScore[] {
  const { data, percentiles } = prepared;

  const weighted: { metric: MetricKey; weight: number; direction: Direction }[] = [];
  for (const key of METRIC_KEYS) {
    const weight = clampWeight(input.weights[key]);
    if (weight === 0) continue;
    const direction = input.directions?.[key] ?? getMetric(key).defaultDirection;
    weighted.push({ metric: key, weight, direction });
  }
  const filters = input.filters ?? [];
  const categoryFilters = (input.categoryFilters ?? []).map((f) => ({ ...f, accept: new Set(f.accept) }));

  const out: CountyScore[] = new Array(data.n);
  for (let i = 0; i < data.n; i++) {
    const failedFilters: FilterKey[] = [];
    const unknownFilters: FilterKey[] = [];
    for (const f of filters) {
      const v = data.values[f.metric][i];
      if (Number.isNaN(v)) unknownFilters.push(f.metric);
      else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) {
        failedFilters.push(f.metric);
      }
    }
    // Policy filters follow the same rule: no value is unknown, never a guess.
    for (const f of categoryFilters) {
      const v = data.categories[f.category][i];
      if (v === null) unknownFilters.push(f.category);
      else if (!f.accept.has(v)) failedFilters.push(f.category);
    }
    const status: CountyStatus = failedFilters.length
      ? "excluded"
      : unknownFilters.length
        ? "unknown"
        : "match";

    const contributions: MetricContribution[] = [];
    const missingMetrics: MetricKey[] = [];
    let sumWeighted = 0;
    let sumWeights = 0;
    for (const { metric, weight, direction } of weighted) {
      const raw = data.values[metric][i];
      const p = percentiles[metric][i];
      if (Number.isNaN(p)) {
        missingMetrics.push(metric);
        contributions.push({
          metric, value: null, direction, rawPercentile: null, percentile: null, weight, impact: null,
        });
        continue;
      }
      const pct = directionalScore(p, direction);
      sumWeighted += weight * pct;
      sumWeights += weight;
      contributions.push({
        metric, value: raw, direction, rawPercentile: p, percentile: pct, weight,
        impact: weight * (pct - 50),
      });
    }

    out[i] = {
      index: i,
      fips: data.fips[i],
      score: status === "excluded" || sumWeights === 0 ? null : sumWeighted / sumWeights,
      status,
      failedFilters,
      unknownFilters,
      missingMetrics,
      contributions,
    };
  }
  return out;
}

export interface RankOptions {
  /** Keep counties whose status is "unknown". Default true — gaps stay visible. */
  includeUnknown?: boolean;
}

/**
 * Drop excluded counties (and unknowns, if asked), then sort best first.
 * Counties without a score sort last; ties break on FIPS so order is stable.
 */
export function rankCounties(scores: CountyScore[], options: RankOptions = {}): CountyScore[] {
  const includeUnknown = options.includeUnknown ?? true;
  return scores
    .filter((s) => s.status === "match" || (includeUnknown && s.status === "unknown"))
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.fips.localeCompare(b.fips);
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score || a.fips.localeCompare(b.fips);
    });
}

export interface ScoreExplanation {
  /** Up to n metrics that pushed the score up, strongest first. */
  strengths: MetricContribution[];
  /** Up to n metrics that pulled it down, strongest first. */
  weaknesses: MetricContribution[];
}

/**
 * "Why is this place here?" — the metrics that moved the score most, by
 * weight × (percentile − 50). Deterministic; no generated text (§6).
 */
export function explainScore(score: CountyScore, n = 3): ScoreExplanation {
  const known = score.contributions.filter(
    (c): c is MetricContribution & { impact: number } => c.impact !== null,
  );
  return {
    strengths: known
      .filter((c) => c.impact > 0)
      .sort((a, b) => b.impact - a.impact)
      .slice(0, n),
    weaknesses: known
      .filter((c) => c.impact < 0)
      .sort((a, b) => a.impact - b.impact)
      .slice(0, n),
  };
}
