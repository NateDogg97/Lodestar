/**
 * Display formatting for metric values and percentiles. Pure, so the list,
 * the map panel and any future export all say the same thing.
 */

import { getMetric, type MetricKey } from "./metrics";

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDp = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** A metric value in its own units, or "No data" when unknown. */
export function formatValue(metric: MetricKey, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "No data";
  const { unit } = getMetric(metric);
  switch (unit) {
    case "$":
      return dollars.format(value);
    case "$/mo":
      return `${dollars.format(value)}/mo`;
    case "°F":
      return `${whole.format(value)}°F`;
    case "in":
      return `${whole.format(value)} in`;
    case "days/yr":
      return `${whole.format(value)} days`;
    case "nights/yr":
      return `${whole.format(value)} nights`;
    case "ratio":
      return `${whole.format(value * 100)}%`;
    case "×":
      return `${oneDp.format(value)}×`;
    case "index":
      return oneDp.format(value);
    case "grades": {
      const sign = value > 0 ? "+" : value < 0 ? "−" : "";
      return `${sign}${Math.abs(value).toFixed(2)} grades`;
    }
    default:
      return whole.format(value);
  }
}

/** 94 → "94th", 1 → "1st", 12 → "12th". Rounds to a whole percentile. */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const mod100 = r % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${r}th`;
  switch (r % 10) {
    case 1:
      return `${r}st`;
    case 2:
      return `${r}nd`;
    case 3:
      return `${r}rd`;
    default:
      return `${r}th`;
  }
}
