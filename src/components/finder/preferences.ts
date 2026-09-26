import type { Direction, MetricKey, RangeFilter, ScoringInput } from "@/lib/scoring";

/**
 * What the person has set in the panel. Kept separate from `ScoringInput` so
 * limits can be edited per metric; `toScoringInput` flattens it for the engine.
 * (Phase 7 will mirror this into the URL for shareable searches.)
 */
export interface Preferences {
  weights: Partial<Record<MetricKey, number>>;
  directions: Partial<Record<MetricKey, Direction>>;
  limits: Partial<Record<MetricKey, { min?: number; max?: number }>>;
  /** Show counties whose data is missing for a limit (grey, "unknown"). */
  includeUnknown: boolean;
}

/**
 * A starting point so the first screen is a ranking, not a blank table.
 * Deliberately modest and easy to change: cost, schools, and the two
 * "uncomfortable days" counts from the climate model (plan §6).
 */
export const DEFAULT_PREFERENCES: Preferences = {
  weights: {
    rpp_all: 3,
    school_achievement: 3,
    days_above_90f: 2,
    nights_below_32f: 2,
  },
  directions: {},
  limits: {},
  includeUnknown: true,
};

export const EMPTY_PREFERENCES: Preferences = {
  weights: {},
  directions: {},
  limits: {},
  includeUnknown: true,
};

export function toScoringInput(prefs: Preferences): ScoringInput {
  const filters: RangeFilter[] = [];
  for (const [metric, limit] of Object.entries(prefs.limits) as [MetricKey, { min?: number; max?: number }][]) {
    if (limit.min !== undefined || limit.max !== undefined) filters.push({ metric, ...limit });
  }
  return { weights: prefs.weights, directions: prefs.directions, filters };
}
