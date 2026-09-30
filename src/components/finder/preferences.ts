import {
  CATEGORIES,
  DIRECTIONS,
  METRIC_KEYS,
  type CategoryFilter,
  type CategoryKey,
  type Direction,
  type MetricKey,
  type RangeFilter,
  type ScoringInput,
} from "@/lib/scoring";

/**
 * Places that are opt-in (plan §6): off means cut from the data before
 * scoring, so they don't count toward anyone's percentiles.
 */
export const OPTIONAL_STATES = [
  { state: "AK", label: "Alaska" },
  { state: "HI", label: "Hawaii" },
] as const;
export type OptionalState = (typeof OPTIONAL_STATES)[number]["state"];

/**
 * What the person has set in the panel. Kept separate from `ScoringInput` so
 * limits can be edited per metric; `toScoringInput` flattens it for the engine.
 * Saved to localStorage between sessions (`savePreferences`); Phase 7 will
 * also mirror it into the URL for shareable searches.
 */
export interface Preferences {
  weights: Partial<Record<MetricKey, number>>;
  directions: Partial<Record<MetricKey, Direction>>;
  limits: Partial<Record<MetricKey, { min?: number; max?: number }>>;
  /** Policy filters: the values a county's state may have. Absent = don't care. */
  categories: Partial<Record<CategoryKey, string[]>>;
  /** Show counties whose data is missing for a limit (grey, "unknown"). */
  includeUnknown: boolean;
  /** Opt-in places; both off by default. */
  includeStates: Record<OptionalState, boolean>;
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
  categories: {},
  includeUnknown: true,
  includeStates: { AK: false, HI: false },
};

export const EMPTY_PREFERENCES: Preferences = {
  weights: {},
  directions: {},
  limits: {},
  categories: {},
  includeUnknown: true,
  includeStates: { AK: false, HI: false },
};

/** States left out of scoring entirely under these preferences. */
export function excludedStates(prefs: Preferences): string[] {
  return OPTIONAL_STATES.filter((o) => !prefs.includeStates[o.state]).map((o) => o.state);
}

export function toScoringInput(prefs: Preferences): ScoringInput {
  const filters: RangeFilter[] = [];
  for (const [metric, limit] of Object.entries(prefs.limits) as [MetricKey, { min?: number; max?: number }][]) {
    if (limit.min !== undefined || limit.max !== undefined) filters.push({ metric, ...limit });
  }
  const categoryFilters: CategoryFilter[] = [];
  for (const [category, accept] of Object.entries(prefs.categories) as [CategoryKey, string[] | undefined][]) {
    if (accept) categoryFilters.push({ category, accept });
  }
  return { weights: prefs.weights, directions: prefs.directions, filters, categoryFilters };
}

// ---------------------------------------------------------------------------
// Saving between sessions (decided 2026-09-26): a stopgap so a search survives
// a reload while tuning. localStorage only — per browser, per device. The URL
// (Phase 7) is the shareable version; accounts are out of scope for v1.

const STORAGE_KEY = "nhf.preferences.v1";

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Rebuilds preferences from untrusted saved JSON: unknown metrics, bad values
 * and missing fields are dropped or defaulted, so a stale save from an older
 * version (or a hand-edited one) can never break the app.
 */
export function sanitizePreferences(raw: unknown): Preferences | null {
  if (!isRecord(raw)) return null;
  const known = new Set<string>(METRIC_KEYS);
  const out: Preferences = {
    weights: {},
    directions: {},
    limits: {},
    categories: {},
    includeUnknown: typeof raw.includeUnknown === "boolean" ? raw.includeUnknown : true,
    includeStates: { AK: false, HI: false },
  };
  if (isRecord(raw.weights)) {
    for (const [k, w] of Object.entries(raw.weights)) {
      if (known.has(k) && isNumber(w)) out.weights[k as MetricKey] = Math.min(5, Math.max(0, w));
    }
  }
  if (isRecord(raw.directions)) {
    for (const [k, d] of Object.entries(raw.directions)) {
      if (known.has(k) && DIRECTIONS.includes(d as Direction)) out.directions[k as MetricKey] = d as Direction;
    }
  }
  if (isRecord(raw.limits)) {
    for (const [k, l] of Object.entries(raw.limits)) {
      if (!known.has(k) || !isRecord(l)) continue;
      const limit: { min?: number; max?: number } = {};
      if (isNumber(l.min)) limit.min = l.min;
      if (isNumber(l.max)) limit.max = l.max;
      if (limit.min !== undefined || limit.max !== undefined) out.limits[k as MetricKey] = limit;
    }
  }
  if (isRecord(raw.categories)) {
    for (const def of CATEGORIES) {
      const accept = raw.categories[def.key];
      if (!Array.isArray(accept)) continue;
      const allowed = new Set<string>(def.options.map((o) => o.value));
      out.categories[def.key] = [...new Set(accept.filter((v): v is string => typeof v === "string" && allowed.has(v)))];
    }
  }
  if (isRecord(raw.includeStates)) {
    for (const { state } of OPTIONAL_STATES) out.includeStates[state] = raw.includeStates[state] === true;
  }
  return out;
}

/** The last search saved on this device, or null if there is none (or storage is blocked). */
export function readSavedPreferences(): Preferences | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? sanitizePreferences(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

/** The saved search, or the defaults if there is none. */
export function loadPreferences(): Preferences {
  return readSavedPreferences() ?? DEFAULT_PREFERENCES;
}

export function savePreferences(prefs: Preferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or storage full: the search just isn't remembered.
  }
}
