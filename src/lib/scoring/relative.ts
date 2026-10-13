/**
 * Map coloring for the top results only (decided 2026-09-26).
 *
 * The map colors just the top N of the ranking, and the red → yellow → green
 * scale spans those N relative to each other: the best of them is fully
 * green, the weakest red — when they're at least `MIN_COLOR_SPAN` apart. Absolute scores still decide *which* counties
 * make the top N; this only decides how they are colored against each other,
 * so small differences at the top stay visible instead of all reading green.
 */

import type { CountyScore } from "./score";

export const MAP_TOP_N = 50;

/**
 * The smallest score span the colors stretch over (Phase 10f, 2026-10-12): with the top 50
 * eight points apart, best-to-worst was painted green to red, as if decided. Narrower
 * spans now keep their best green and fade only as far as the span earns.
 */
export const MIN_COLOR_SPAN = 20;

/**
 * FIPS → relative position 0–100 among the top `n` ranked counties (100 =
 * best of them). A top-n county with no score maps to null (drawn grey).
 * Counties outside the top n are absent.
 */
export function topRelativeScores(ranked: CountyScore[], n = MAP_TOP_N): Map<string, number | null> {
  const top = ranked.slice(0, n);
  let min = Infinity;
  let max = -Infinity;
  for (const s of top) {
    if (s.score === null) continue;
    if (s.score < min) min = s.score;
    if (s.score > max) max = s.score;
  }
  const span = Math.max(max - min, MIN_COLOR_SPAN);
  const out = new Map<string, number | null>();
  for (const s of top) {
    if (s.score === null) out.set(s.fips, null);
    // All equal (or a single county): nothing to separate them — all best.
    else out.set(s.fips, 100 - ((max - s.score) / span) * 100);
  }
  return out;
}
