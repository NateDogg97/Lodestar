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
