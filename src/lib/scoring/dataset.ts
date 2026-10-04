/**
 * Parse the published county file into a columnar in-memory dataset.
 *
 * The ETL publishes `{format, columns, rows}` (see `etl/build.py`,
 * `to_app_payload`). Scoring works column-by-column — percentiles are per
 * metric — so the rows are transposed once here into one typed array per
 * metric. Missing values are `NaN`, never 0: a missing value is unknown.
 */

import { CATEGORY_KEYS, COUNTY_CATEGORY_KEYS, type CategoryKey } from "./categories";
import { METRIC_KEYS, STATE_METRIC_KEYS, type MetricKey } from "./metrics";

export const PAYLOAD_FORMAT = "counties-columnar-v1";

/** Text columns kept for display: the nearest major airport (IATA code) and 500k+ metro (name). */
// rpp_source_geo: the metro (or state) whose price parity a county carries.
export const TEXT_COLUMNS = ["nearest_airport", "nearest_metro", "rpp_source_geo"] as const;
export type TextColumn = (typeof TEXT_COLUMNS)[number];

/**
 * Numeric columns shown but never scored or filtered (2026-10-04): who lives here —
 * shares by race and Hispanic origin, the diversity index, the Gini index
 * (etl/demographics.py). NaN where unknown, or when the file predates them.
 */
export const INFO_COLUMNS = [
  "white_share", "hispanic_share", "black_share", "asian_share", "other_race_share", "diversity_index", "gini_index",
] as const;
export type InfoColumn = (typeof INFO_COLUMNS)[number];

export interface CountyDataset {
  /** Number of counties. */
  n: number;
  /** 5-character county FIPS, leading zeros kept. */
  fips: string[];
  countyName: string[];
  state: string[];
  /** `metro` when cost of living is the county's own metro; `state` when it is the statewide figure. */
  rppGeoLevel: (string | null)[];
  /** One array per metric, `NaN` where the value is unknown. */
  values: Record<MetricKey, Float64Array>;
  /** One array per policy category (a law value such as "medical"), null where unknown. */
  categories: Record<CategoryKey, (string | null)[]>;
  /** Descriptive text columns (not scored), null where unknown. */
  text: Record<TextColumn, (string | null)[]>;
  /** Descriptive numeric columns (not scored), NaN where unknown. */
  info: Record<InfoColumn, Float64Array>;
  /** Row index by FIPS. */
  indexByFips: Map<string, number>;
  /**
   * Metrics the file has no column for, read as unknown everywhere. Happens
   * for one page load after a deploy that adds a metric: the old service
   * worker still serves the old, cached data file to the new code.
   */
  missingColumns: MetricKey[];
}

interface Payload {
  format: string;
  columns: string[];
  rows: unknown[][];
}

function isPayload(x: unknown): x is Payload {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return typeof p.format === "string" && Array.isArray(p.columns) && Array.isArray(p.rows);
}

export function parseCountyPayload(payload: unknown): CountyDataset {
  if (!isPayload(payload)) {
    throw new Error("County data is not in the expected {format, columns, rows} shape");
  }
  if (payload.format !== PAYLOAD_FORMAT) {
    throw new Error(
      `County data format is "${payload.format}", expected "${PAYLOAD_FORMAT}". ` +
        "Rebuild it with `python -m etl.build`.",
    );
  }

  const col = new Map(payload.columns.map((name, i) => [name, i]));
  const required = ["fips", "county_name", "state"];
  const missing = required.filter((c) => !col.has(c));
  if (missing.length) {
    throw new Error(`County data is missing columns: ${missing.join(", ")}`);
  }
  // A missing metric is unknown for every county — never a crash. See `missingColumns`.
  // State-level metrics are never in this file; `applyStateLaws` fills them.
  const missingColumns = METRIC_KEYS.filter((k) => !col.has(k) && !STATE_METRIC_KEYS.includes(k));

  const rows = payload.rows;
  const n = rows.length;
  const text = (name: string): (string | null)[] => {
    const i = col.get(name);
    return rows.map((r) => (i === undefined || r[i] == null ? null : String(r[i])));
  };

  const fips = text("fips") as string[];
  if (fips.some((f) => f === null || f.length !== 5)) {
    throw new Error("County data has a FIPS code that is not a 5-character string");
  }

  const values = {} as Record<MetricKey, Float64Array>;
  for (const key of METRIC_KEYS) {
    const i = col.get(key);
    const arr = new Float64Array(n).fill(NaN);
    if (i !== undefined) {
      for (let r = 0; r < n; r++) {
        const v = rows[r][i];
        arr[r] = typeof v === "number" && Number.isFinite(v) ? v : NaN;
      }
    }
    values[key] = arr;
  }

  return {
    n,
    fips,
    countyName: text("county_name") as string[],
    state: text("state") as string[],
    rppGeoLevel: text("rpp_geo_level"),
    values,
    // County-level categories come from their column; state-level ones are
    // filled later from the law table (applyStateLaws).
    categories: Object.fromEntries(
      CATEGORY_KEYS.map((k) => [
        k,
        COUNTY_CATEGORY_KEYS.includes(k) && col.has(k) ? text(k) : new Array<string | null>(n).fill(null),
      ]),
    ) as Record<CategoryKey, (string | null)[]>,
    text: Object.fromEntries(TEXT_COLUMNS.map((c) => [c, text(c)])) as Record<TextColumn, (string | null)[]>,
    info: Object.fromEntries(
      INFO_COLUMNS.map((c) => {
        const i = col.get(c);
        return [c, Float64Array.from(rows, (r) => (i !== undefined && typeof r[i] === "number" ? (r[i] as number) : NaN))];
      }),
    ) as Record<InfoColumn, Float64Array>,
    indexByFips: new Map(fips.map((f, i) => [f, i])),
    missingColumns,
  };
}

/**
 * A copy of the dataset with only the counties `keep` accepts, re-indexed.
 *
 * Used for the Alaska / Hawaii toggles (plan §6): excluded places are cut
 * BEFORE `prepareDataset`, so they take no part in percentiles, "typical
 * county" medians, ranks or counts — not merely hidden from the results.
 */
export function subsetDataset(data: CountyDataset, keep: (index: number) => boolean): CountyDataset {
  const idx: number[] = [];
  for (let i = 0; i < data.n; i++) if (keep(i)) idx.push(i);
  const pick = <T,>(arr: T[]) => idx.map((i) => arr[i]);
  const values = {} as Record<MetricKey, Float64Array>;
  for (const key of METRIC_KEYS) values[key] = Float64Array.from(idx, (i) => data.values[key][i]);
  const categories = {} as Record<CategoryKey, (string | null)[]>;
  for (const key of CATEGORY_KEYS) categories[key] = pick(data.categories[key]);
  const fips = pick(data.fips);
  return {
    n: idx.length,
    fips,
    countyName: pick(data.countyName),
    state: pick(data.state),
    rppGeoLevel: pick(data.rppGeoLevel),
    values,
    categories,
    text: Object.fromEntries(TEXT_COLUMNS.map((c) => [c, pick(data.text[c])])) as Record<TextColumn, (string | null)[]>,
    info: Object.fromEntries(INFO_COLUMNS.map((c) => [c, Float64Array.from(idx, (i) => data.info[c][i])])) as Record<
      InfoColumn,
      Float64Array
    >,
    indexByFips: new Map(fips.map((f, i) => [f, i])),
    missingColumns: data.missingColumns,
  };
}
