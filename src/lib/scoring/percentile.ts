/**
 * Percentile ranks, 0–100, over the counties that have a value.
 *
 * Percentile rather than min–max: one county with a $1.4M median home value
 * would otherwise squash every other county into the bottom sliver of the
 * range (Working Master Plan §6).
 *
 * - The lowest value gets 0, the highest 100; `rank / (count - 1) * 100`.
 * - Ties share the average of their ranks, so equal values score equally.
 *   This matters: every county in a metro carries the same cost-of-living
 *   figure, and they must not be ordered by accident of row position.
 * - `NaN` (unknown) stays `NaN` and does not count toward anyone's rank.
 * - A lone known value gets 50 — there is nothing to be better or worse than.
 */
export function percentileRanks(values: Float64Array): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);

  const known: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (!Number.isNaN(values[i])) known.push(i);
  }
  const m = known.length;
  if (m === 0) return out;
  if (m === 1) {
    out[known[0]] = 50;
    return out;
  }

  known.sort((a, b) => values[a] - values[b]);

  let start = 0;
  while (start < m) {
    let end = start;
    while (end + 1 < m && values[known[end + 1]] === values[known[start]]) end++;
    const avgRank = (start + end) / 2;
    const pct = (avgRank / (m - 1)) * 100;
    for (let k = start; k <= end; k++) out[known[k]] = pct;
    start = end + 1;
  }
  return out;
}

/** For each value, the percentile of the lowest and highest rank its tie group spans. */
export interface PercentileBounds {
  /** Share of known values strictly below this one, 0–100. */
  lo: Float64Array;
  /** Share of known values at or below this one (its group's top rank), 0–100. */
  hi: Float64Array;
}

/**
 * Tie-aware ranks for points (results audit, 2026-10-04): a value scores as "at least as
 * good as" every value it ties with. The middle rank above would give "no hurricane risk",
 * shared by most US areas, only ~60 points and a 0% income tax 91 — the best possible value
 * must score 100. Higher-is-better uses `hi`, lower-is-better `100 − lo`; same
 * conventions as `percentileRanks` for unknowns and a lone value (both 50).
 */
export function percentileBounds(values: Float64Array): PercentileBounds {
  const lo = new Float64Array(values.length).fill(NaN);
  const hi = new Float64Array(values.length).fill(NaN);
  const known: number[] = [];
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i])) known.push(i);
  const m = known.length;
  if (m === 0) return { lo, hi };
  if (m === 1) {
    lo[known[0]] = 50;
    hi[known[0]] = 50;
    return { lo, hi };
  }
  known.sort((a, b) => values[a] - values[b]);
  let start = 0;
  while (start < m) {
    let end = start;
    while (end + 1 < m && values[known[end + 1]] === values[known[start]]) end++;
    const l = (start / (m - 1)) * 100;
    const h = (end / (m - 1)) * 100;
    for (let k = start; k <= end; k++) {
      lo[known[k]] = l;
      hi[known[k]] = h;
    }
    start = end + 1;
  }
  return { lo, hi };
}
