/**
 * Parse the published county file into a columnar in-memory dataset.
 *
 * The ETL publishes `{format, columns, rows}` (see `etl/build.py`,
 * `to_app_payload`). Scoring works column-by-column — percentiles are per
 * metric — so the rows are transposed once here into one typed array per
 * metric. Missing values are `NaN`, never 0: a missing value is unknown.
 */

import { METRIC_KEYS, type MetricKey } from "./metrics";

export const PAYLOAD_FORMAT = "counties-columnar-v1";

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
  /** Row index by FIPS. */
  indexByFips: Map<string, number>;
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
  const required = ["fips", "county_name", "state", ...METRIC_KEYS];
  const missing = required.filter((c) => !col.has(c));
  if (missing.length) {
    throw new Error(`County data is missing columns: ${missing.join(", ")}`);
  }

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
    const i = col.get(key)!;
    const arr = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      const v = rows[r][i];
      arr[r] = typeof v === "number" && Number.isFinite(v) ? v : NaN;
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
    indexByFips: new Map(fips.map((f, i) => [f, i])),
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
  const fips = pick(data.fips);
  return {
    n: idx.length,
    fips,
    countyName: pick(data.countyName),
    state: pick(data.state),
    rppGeoLevel: pick(data.rppGeoLevel),
    values,
    indexByFips: new Map(fips.map((f, i) => [f, i])),
  };
}
