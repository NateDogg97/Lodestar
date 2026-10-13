/**
 * Pollution: anchored points, not percentiles (plan §9 Phase 11, "How it scores").
 *
 * Harm follows dose, and most US areas sit within the PM2.5 model's own error of each
 * other (the middle half spans 2 µg/m³; the error is 1.7–2.3), so a percentile would turn
 * model noise into a 50-point gap. Each ranked measure instead earns points against fixed
 * anchors (decided 2026-10-13, 11c/11d):
 *
 * - PM2.5 (`pm25`): bands at WHO's 5, 7, EPA's 9 and 12 µg/m³ worth 100/75/50/25/0, scored
 *   as the *expected* band points given the estimate ± the model's out-of-sample error
 *   (σ = 1.7), so 8.99 and 9.01 aren't 25 points apart. Where most residents live near an
 *   EPA monitor reading well above the model (the "pm25" low-confidence flag,
 *   etl/pollution/doubt.py), points are capped at the "typical" band's 50: the monitor
 *   only doubts the model, it never gives the area a value.
 * - Wildfire smoke (`smoke_days_thick`, Medium/Heavy plume days a year, 2015–2024): 100 at
 *   5 days or fewer, 0 at 30 or more, linear between.
 * - Older housing (`pre1960_share`, % of homes built before 1960 — lead-paint risk): 100
 *   at 0%, 0 at 60% or more, linear.
 *
 * Radon is shown and cautioned about, never ranked: its ZIP model's error is wider than
 * most gaps between places, and radon is per house (11d).
 *
 * Pure: no UI imports.
 */

export const PM25_BANDS = [5, 7, 9, 12] as const;
export const PM25_BAND_POINTS = [100, 75, 50, 25, 0] as const;
/** ACAG V6.GL.03's out-of-sample RMSE for annual North American PM2.5, µg/m³. */
export const PM25_SIGMA = 1.7;
/** % of residents near a monitor reading above the model that makes a place's PM2.5 doubted (etl/pollution/doubt.py DOUBTED_SHARE). */
export const DOUBTED_SHARE = 50;
/** The "typical" band's points: a doubted value can't score above it. */
export const PM25_DOUBT_CAP = 50;
export const WHO_PM25 = 5;
export const EPA_PM25 = 9;

export const SMOKE_BEST = 5;
export const SMOKE_WORST = 30;
export const LEAD_WORST = 60;

/**
 * Watch out names an area where this % of home radon tests read above EPA's 4 pCi/L. 40 is
 * the worst ~5% of US areas (5.6%), like the other cautions; 30 (11d's first choice) flagged
 * 17% — one result in six — which reads as noise.
 */
export const RADON_WATCH = 40;

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** PM2.5 points, 0–100: the expected band points under N(value, σ). */
export function pm25Points(value: number, doubted = false, sigma = PM25_SIGMA): number {
  if (!Number.isFinite(value)) return NaN;
  let pts = 0;
  let below = 0;
  for (let k = 0; k < PM25_BAND_POINTS.length; k++) {
    const upTo = k < PM25_BANDS.length ? normalCdf((PM25_BANDS[k] - value) / sigma) : 1;
    pts += PM25_BAND_POINTS[k] * (upTo - below);
    below = upTo;
  }
  return doubted ? Math.min(pts, PM25_DOUBT_CAP) : pts;
}

const linear = (value: number, best: number, worst: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, (100 * (worst - value)) / (worst - best))) : NaN;

export const smokePoints = (days: number) => linear(days, SMOKE_BEST, SMOKE_WORST);
export const leadPoints = (share: number) => linear(share, 0, LEAD_WORST);

/**
 * Area columns scored on anchors instead of percentiles, with what the points need:
 * the value, and whether the value is doubted (its own low-confidence flag).
 */
export const ANCHORED: Readonly<Record<string, (value: number, flagged: boolean) => number>> = {
  pm25: (v, flagged) => pm25Points(v, flagged),
  smoke_days_thick: (v) => smokePoints(v),
  pre1960_share: (v) => leadPoints(v),
};

export const isAnchored = (column: string) => column in ANCHORED;

/** Plain words for a PM2.5 value, by band. */
export function pm25Word(v: number): string {
  if (v <= WHO_PM25) return "Very clean";
  if (v <= 7) return "Clean";
  if (v <= EPA_PM25) return "Typical";
  if (v <= 12) return "Somewhat polluted";
  return "Polluted";
}

/**
 * The Pollution section's one line: the air, then what stands out. "Typical air (PM2.5
 * 8.1) · 22 smoke days a year · radon: test any home".
 */
export function pollutionVerdict(v: {
  pm25: number | null;
  doubted?: boolean;
  smoke: number | null;
  radon: number | null;
}): string {
  const parts: string[] = [];
  // A doubted value gets no verdict word: a monitor nearby says the model reads it too clean.
  if (v.pm25 !== null) parts.push(v.doubted ? `Air quality uncertain (model PM2.5 ${v.pm25.toFixed(1)})` : `${pm25Word(v.pm25)} air (PM2.5 ${v.pm25.toFixed(1)})`);
  if (v.smoke !== null) parts.push(`${Math.round(v.smoke)} smoke days a year`);
  if (v.radon !== null && v.radon >= RADON_WATCH) parts.push("radon: test any home");
  return parts.length ? parts.join(" · ") : "No pollution data";
}

/**
 * How old the area pollution data is (etl/pollution/carry.py, pollution.json beside the
 * area files). The monthly refresh downloads each pollution source; one that's down keeps
 * last month's figures (`carried`) so the rest of the refresh still ships. The figures are
 * multi-year averages, so a month's delay changes little — but it's said, not hidden.
 */
export interface PollutionSourceStatus {
  /** The day this source's figures were computed (YYYY-MM-DD); null if never recorded. */
  computed: string | null;
  /** The last refresh couldn't reach this source and kept the figures from `computed`. */
  carried: boolean;
}

export interface PollutionStatus {
  sources: Partial<Record<PollutionSource, PollutionSourceStatus>>;
}

export type PollutionSource = "pm25" | "smoke" | "radon";

export const POLLUTION_SOURCE_LABELS: Record<PollutionSource, string> = {
  pm25: "Fine particles (PM2.5)",
  smoke: "Wildfire smoke",
  radon: "Radon",
};

/** Older than this, a source's figures are overdue even if no refresh said so (two missed monthly runs). */
export const POLLUTION_STALE_DAYS = 62;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** pollution.json, or null if it isn't one (never trusted blindly: it comes over the network). */
export function parsePollutionStatus(raw: unknown): PollutionStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const src = (raw as { sources?: unknown }).sources;
  if (!src || typeof src !== "object") return null;
  const sources: PollutionStatus["sources"] = {};
  for (const key of Object.keys(POLLUTION_SOURCE_LABELS) as PollutionSource[]) {
    const s = (src as Record<string, unknown>)[key];
    if (!s || typeof s !== "object") continue;
    const computed = (s as { computed?: unknown }).computed;
    sources[key] = {
      computed: typeof computed === "string" && ISO_DAY.test(computed) ? computed : null,
      carried: (s as { carried?: unknown }).carried === true,
    };
  }
  return Object.keys(sources).length ? { sources } : null;
}

export interface PollutionFreshness {
  /** The latest day any source was computed: "updated" for the section. */
  updated: string | null;
  /** Sources whose figures are older than they should be, and since when. */
  stale: { source: PollutionSource; label: string; since: string | null; unavailable: boolean }[];
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** What to say about the data's age, as of `today` (YYYY-MM-DD). */
export function pollutionFreshness(status: PollutionStatus, today: string): PollutionFreshness {
  let updated: string | null = null;
  const stale: PollutionFreshness["stale"] = [];
  for (const key of Object.keys(POLLUTION_SOURCE_LABELS) as PollutionSource[]) {
    const s = status.sources[key];
    if (!s) continue;
    if (s.computed && (!updated || s.computed > updated)) updated = s.computed;
    const overdue = s.computed !== null && dayNumber(today) - dayNumber(s.computed) > POLLUTION_STALE_DAYS;
    if (s.carried || overdue) {
      stale.push({ source: key, label: POLLUTION_SOURCE_LABELS[key], since: s.computed, unavailable: s.carried });
    }
  }
  return { updated, stale };
}

/** "Nov 3, 2026" for a YYYY-MM-DD day (no time zone shift: it's a calendar day). */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}
