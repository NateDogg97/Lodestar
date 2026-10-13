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
/** The "typical" band's points: a doubted value can't score above it. */
export const PM25_DOUBT_CAP = 50;
export const WHO_PM25 = 5;
export const EPA_PM25 = 9;

export const SMOKE_BEST = 5;
export const SMOKE_WORST = 30;
export const LEAD_WORST = 60;

/** EPA's radon action level is 4 pCi/L; Watch out names an area where this % of homes is above it. */
export const RADON_WATCH = 30;

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
  if (v <= 12) return "Above the federal standard";
  return "High";
}
