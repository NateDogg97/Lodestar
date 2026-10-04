/**
 * One color scale for scores everywhere (owner, 2026-10-03): deep red at the
 * bottom, yellow around 75, deep green at the top. Gold marks the top 1% only on
 * the bars (fingerprints, breakdowns) and badges — never on the map or a score
 * number, where the best is deep green (owner, 2026-10-04).
 */

const STOPS: [number, [number, number, number]][] = [
  [0, [165, 0, 38]],
  [25, [224, 69, 43]],
  [50, [240, 150, 55]],
  [75, [226, 205, 59]],
  [90, [118, 184, 64]],
  [99, [26, 127, 55]],
];

/** A score's color on the map and for numbers: red → yellow → deep green. */
export function scoreColor(score: number): string {
  const p = Math.min(100, Math.max(0, score));
  let i = 0;
  while (i < STOPS.length - 2 && p > STOPS[i + 1][0]) i++;
  const [p0, c0] = STOPS[i];
  const [p1, c1] = STOPS[i + 1];
  const t = Math.max(0, Math.min(1, (p - p0) / (p1 - p0)));
  return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(",")})`;
}

/**
 * True for a bar that shows gold: 100 points as shown, i.e. 99.5 and up (owner,
 * 2026-10-04; briefly 99). Where
 * it's drawn, gold is the `gold-bar` / `gold-col` class (globals.css): metallic gold
 * with a gently glowing gold rim.
 */
export const isGold = (score: number) => Math.round(score) >= 100;

/** A bar's track: a gold bar's rim and glow reach outside it, so it mustn't clip them. */
export const trackOverflow = (points: number | null) => (points !== null && isGold(points) ? "overflow-visible" : "overflow-hidden");

/** The map's scale as MapLibre `interpolate` stops: [0, c0, 10, c1, …, 99, deep green, 100, deep green]. */
export const SCORE_STOPS: (number | string)[] = [
  ...Array.from({ length: 10 }, (_, i) => [i * 10, scoreColor(i * 10)]).flat(),
  99, scoreColor(99), 100, scoreColor(100),
];

/** No data for a limit, or nothing to score: grey, never a guessed color (plan §6 item 7). */
export const UNKNOWN_COLOR = "#9ca3af";
