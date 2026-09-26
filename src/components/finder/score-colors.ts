import { interpolateRdYlGn } from "d3-scale-chromatic";

/**
 * One color scale for scores everywhere — list bars and map (plan §6:
 * `interpolateRdYlGn`, red = weak match, green = strong).
 */
export function scoreColor(score: number): string {
  return interpolateRdYlGn(Math.min(100, Math.max(0, score)) / 100);
}

/** The same scale as MapLibre `interpolate` stops: [0, c0, 10, c1, …, 100, c10]. */
export const SCORE_STOPS: (number | string)[] = Array.from({ length: 11 }, (_, i) => [
  i * 10,
  scoreColor(i * 10),
]).flat();

/** No data for a limit, or nothing to score: grey, never a guessed color (plan §6 item 7). */
export const UNKNOWN_COLOR = "#9ca3af";
