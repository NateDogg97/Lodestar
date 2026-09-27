/**
 * Monthly climate normals (public/data/climate.json, built by etl/climate.py)
 * for the place view's Climate tab. Pure: parsing and yearly summaries only.
 */

export const CLIMATE_FORMAT = "climate-monthly-v1";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const MEASURE_KEYS = [
  "tmax_f",
  "tmin_f",
  "precip_in",
  "snow_in",
  "days_above_90f",
  "nights_below_32f",
  "rainy_days",
  "snow_days",
] as const;
export type MeasureKey = (typeof MEASURE_KEYS)[number];

/** Twelve monthly values, January first; null where no station reports it. */
export type MonthlySeries = (number | null)[];
export type CountyClimate = Record<MeasureKey, MonthlySeries>;

export interface ClimateData {
  source: { name: string; url: string; method: string };
  byFips: Map<string, CountyClimate>;
  /** Distance from the county's search point to its nearest temperature station, miles. */
  stationMi: Map<string, number>;
}

export function parseClimatePayload(payload: unknown): ClimateData {
  const p = payload as {
    format?: unknown;
    source?: ClimateData["source"];
    measures?: { key: string }[];
    counties?: Record<string, unknown>;
    stationMi?: Record<string, number>;
  };
  if (!p || p.format !== CLIMATE_FORMAT || !Array.isArray(p.measures) || typeof p.counties !== "object") {
    throw new Error(`Climate data is not in the "${CLIMATE_FORMAT}" format. Rebuild it with \`python -m etl.build\`.`);
  }
  const order = p.measures.map((m) => m.key);
  const missing = MEASURE_KEYS.filter((k) => !order.includes(k));
  if (missing.length) throw new Error(`Climate data is missing measures: ${missing.join(", ")}`);

  const byFips = new Map<string, CountyClimate>();
  for (const [fips, raw] of Object.entries(p.counties ?? {})) {
    if (!Array.isArray(raw)) continue;
    const county = {} as CountyClimate;
    for (const key of MEASURE_KEYS) {
      const series = raw[order.indexOf(key)];
      county[key] =
        Array.isArray(series) && series.length === 12
          ? series.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
          : new Array<number | null>(12).fill(null);
    }
    byFips.set(fips, county);
  }
  return {
    source: p.source ?? { name: "NOAA climate normals", url: "", method: "" },
    byFips,
    stationMi: new Map(Object.entries(p.stationMi ?? {})),
  };
}

// ---------------------------------------------------------------------------
// Yearly summary — the same numbers the filters use, from the same months
// (the ETL checks they match the county columns).
// ---------------------------------------------------------------------------

export interface ClimateSummary {
  hottestHigh: number | null;
  coldestLow: number | null;
  precip: number | null;
  snow: number | null;
  daysAbove90: number | null;
  nightsBelow32: number | null;
  rainyDays: number | null;
  snowDays: number | null;
}

function known(s: MonthlySeries): number[] {
  return s.filter((v): v is number => v !== null);
}
const max = (s: MonthlySeries) => (known(s).length ? Math.max(...known(s)) : null);
const min = (s: MonthlySeries) => (known(s).length ? Math.min(...known(s)) : null);
/** A yearly total needs all 12 months; a partial sum would understate it. */
const sum = (s: MonthlySeries) => (known(s).length === 12 ? known(s).reduce((a, b) => a + b, 0) : null);

export function summarize(c: CountyClimate): ClimateSummary {
  return {
    hottestHigh: max(c.tmax_f),
    coldestLow: min(c.tmin_f),
    precip: sum(c.precip_in),
    snow: sum(c.snow_in),
    daysAbove90: sum(c.days_above_90f),
    nightsBelow32: sum(c.nights_below_32f),
    rainyDays: sum(c.rainy_days),
    snowDays: sum(c.snow_days),
  };
}

/** True when a series is (effectively) zero all year — e.g. snow in Miami. */
export function isAllZero(s: MonthlySeries): boolean {
  return known(s).every((v) => v < 0.05);
}
