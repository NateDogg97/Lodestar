"use client";

import { useMemo, useState } from "react";

import {
  isAllZero,
  MONTHS,
  summarize,
  type ClimateData,
  type ClimateSummary,
  type CountyClimate,
  type MeasureKey,
} from "@/lib/climate";
import type { CountyDataset } from "@/lib/scoring";

import { MonthChart, type ChartSeries } from "./month-chart";
import { useClimateData } from "./use-county-data";

/**
 * The place view's Climate tab (plan Phase 6): NOAA 1991–2020 monthly normals
 * as a set of one-measure charts, key yearly numbers, and an optional second
 * county to compare against. Chart / Table switch — no collapsible sections.
 */

interface Props {
  fips: string;
  /** Names for the place and the compare picker. */
  data: CountyDataset;
  compareFips: string | null;
  onCompare: (fips: string | null) => void;
}

const STATION_CAUTION_MI = 25;

const temp = (v: number) => `${Math.round(v)}°`;
const inches = (v: number) => (v < 10 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v).toString());
const days = (v: number) => (v > 0 && v < 1 ? "<1" : v < 10 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v).toString());

const CHARTS: { key: MeasureKey | "temp"; title: string; format: (v: number) => string; hideIfZero?: boolean }[] = [
  { key: "temp", title: "Temperature — average high and low (°F)", format: temp },
  { key: "precip_in", title: "Precipitation (inches)", format: inches },
  { key: "rainy_days", title: "Rainy days (≥ 0.01 in)", format: days },
  { key: "snow_in", title: "Snowfall (inches)", format: inches, hideIfZero: true },
  { key: "snow_days", title: "Snowy days (≥ 1 in)", format: days, hideIfZero: true },
  { key: "days_above_90f", title: "Days above 90°F", format: days, hideIfZero: true },
  { key: "nights_below_32f", title: "Nights below freezing", format: days, hideIfZero: true },
];

const TILES: { key: keyof ClimateSummary; label: string; format: (v: number) => string }[] = [
  { key: "hottestHigh", label: "Hottest month's high", format: (v) => `${Math.round(v)}°F` },
  { key: "coldestLow", label: "Coldest month's low", format: (v) => `${Math.round(v)}°F` },
  { key: "daysAbove90", label: "Days above 90°F", format: (v) => `${Math.round(v)}` },
  { key: "nightsBelow32", label: "Nights below freezing", format: (v) => `${Math.round(v)}` },
  { key: "rainyDays", label: "Rainy days", format: (v) => `${Math.round(v)}` },
  { key: "snowDays", label: "Snowy days", format: (v) => `${Math.round(v)}` },
  { key: "precip", label: "Precipitation", format: (v) => `${v.toFixed(1)} in` },
  { key: "snow", label: "Snowfall", format: (v) => `${v.toFixed(1)} in` },
];

export function ClimateTab({ fips, data, compareFips, onCompare }: Props) {
  const state = useClimateData();
  const [view, setView] = useState<"chart" | "table">("chart");

  if (state.status === "loading") return <p className="py-6 text-center text-sm text-neutral-500">Loading climate…</p>;
  if (state.status === "error") {
    return (
      <p role="alert" className="py-6 text-center text-sm text-rose-700 dark:text-rose-400">
        {state.message}
      </p>
    );
  }
  const climate = state.data;
  const here = climate.byFips.get(fips);
  if (!here) {
    return (
      <p className="py-6 text-center text-sm text-neutral-500">
        No climate normals for this county — no weather station reports close enough.
      </p>
    );
  }

  const name = (f: string) => {
    const i = data.indexByFips.get(f);
    return i === undefined ? f : `${data.countyName[i]}, ${data.state[i]}`;
  };
  const other = compareFips && compareFips !== fips ? climate.byFips.get(compareFips) : undefined;
  const counties: { name: string; color: string; c: CountyClimate }[] = [
    { name: name(fips), color: "var(--viz-s1)", c: here },
    ...(other && compareFips ? [{ name: name(compareFips), color: "var(--viz-s2)", c: other }] : []),
  ];

  return (
    <div className="viz-root space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ComparePicker data={data} currentFips={fips} compareFips={other ? compareFips : null} name={name} onCompare={onCompare} />
        <div role="group" aria-label="Show as" className="inline-flex rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 capitalize first:rounded-l-md last:rounded-r-md ${
                view === v
                  ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {counties.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
          {counties.map((c) => (
            <li key={c.name} className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: c.color }} />
              {c.name}
            </li>
          ))}
        </ul>
      )}

      <KeyNumbers counties={counties} />

      {view === "chart" ? <Charts counties={counties} /> : <ClimateTable counties={counties} />}

      <SourceLine climate={climate} fips={fips} compareFips={other ? compareFips : null} name={name} />
    </div>
  );
}

function KeyNumbers({ counties }: { counties: { name: string; color: string; c: CountyClimate }[] }) {
  const sums = counties.map((c) => summarize(c.c));
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {TILES.map((t) => (
        <div key={t.key}>
          <dt className="text-[11px] text-neutral-500">{t.label}</dt>
          {sums.map((s, k) => {
            const v = s[t.key];
            return (
              <dd key={k} className={`flex items-center gap-1.5 ${k === 0 ? "text-base font-semibold" : "text-xs text-neutral-600 dark:text-neutral-400"}`}>
                {counties.length > 1 && (
                  <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: counties[k].color }} />
                )}
                {v === null ? "No data" : t.format(v)}
                {counties.length > 1 && <span className="sr-only"> — {counties[k].name}</span>}
              </dd>
            );
          })}
        </div>
      ))}
    </dl>
  );
}

function Charts({ counties }: { counties: { name: string; color: string; c: CountyClimate }[] }) {
  const none: string[] = [];
  const charts = CHARTS.flatMap((ch) => {
    if (ch.key === "temp") {
      const series: ChartSeries[] = counties.map((c) => ({ name: c.name, color: c.color, values: c.c.tmax_f, low: c.c.tmin_f }));
      return [<MonthChart key="temp" title={ch.title} kind="range" series={series} format={ch.format} />];
    }
    const key = ch.key;
    if (ch.hideIfZero && counties.every((c) => isAllZero(c.c[key]))) {
      none.push(ch.title.replace(/ \(.*\)$/, "").toLowerCase());
      return [];
    }
    const series: ChartSeries[] = counties.map((c) => ({ name: c.name, color: c.color, values: c.c[key] }));
    return [<MonthChart key={key} title={ch.title} kind="columns" series={series} format={ch.format} />];
  });
  return (
    <div className="space-y-4">
      {charts}
      {none.length > 0 && (
        <p className="text-xs text-neutral-500">
          None all year{counties.length > 1 ? " in either county" : ""}: {none.join(", ")}.
        </p>
      )}
    </div>
  );
}

function ClimateTable({ counties }: { counties: { name: string; color: string; c: CountyClimate }[] }) {
  const rows: { label: string; key: MeasureKey; format: (v: number) => string }[] = [
    { label: "Average high (°F)", key: "tmax_f", format: (v) => `${Math.round(v)}` },
    { label: "Average low (°F)", key: "tmin_f", format: (v) => `${Math.round(v)}` },
    { label: "Precipitation (in)", key: "precip_in", format: (v) => v.toFixed(1) },
    { label: "Rainy days", key: "rainy_days", format: (v) => v.toFixed(1) },
    { label: "Snowfall (in)", key: "snow_in", format: (v) => v.toFixed(1) },
    { label: "Snowy days", key: "snow_days", format: (v) => v.toFixed(1) },
    { label: "Days above 90°F", key: "days_above_90f", format: (v) => v.toFixed(1) },
    { label: "Nights below 32°F", key: "nights_below_32f", format: (v) => v.toFixed(1) },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <caption className="sr-only">Monthly climate normals</caption>
        <thead>
          <tr className="text-neutral-500">
            <th scope="col" className="sticky left-0 bg-white py-1 pr-2 text-left font-normal dark:bg-neutral-950">
              Measure
            </th>
            {MONTHS.map((m) => (
              <th key={m} scope="col" className="px-1.5 py-1 text-right font-normal">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r) =>
            counties.map((c, k) => (
              <tr key={`${r.key}-${k}`} className={k === 0 ? "border-t border-neutral-200 dark:border-neutral-800" : ""}>
                <th scope="row" className="sticky left-0 bg-white py-1 pr-2 text-left font-normal dark:bg-neutral-950">
                  {k === 0 ? r.label : <span className="text-neutral-500">{c.name}</span>}
                  {counties.length > 1 && k === 0 && <span className="block text-[10px] text-neutral-500">{c.name}</span>}
                </th>
                {c.c[r.key].map((v, i) => (
                  <td key={i} className={`px-1.5 py-1 text-right ${k > 0 ? "text-neutral-500" : ""}`}>
                    {v === null ? "—" : r.format(v)}
                  </td>
                ))}
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function ComparePicker({
  data,
  currentFips,
  compareFips,
  name,
  onCompare,
}: {
  data: CountyDataset;
  currentFips: string;
  compareFips: string | null;
  name: (fips: string) => string;
  onCompare: (fips: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: string[] = [];
    for (let i = 0; i < data.n && out.length < 8; i++) {
      const f = data.fips[i];
      if (f !== currentFips && `${data.countyName[i]}, ${data.state[i]}`.toLowerCase().includes(q)) out.push(f);
    }
    return out;
  }, [query, data, currentFips]);

  if (compareFips) {
    return (
      <p className="flex items-center gap-2 text-xs">
        <span className="text-neutral-500">Compared with</span>
        <span className="font-medium">{name(compareFips)}</span>
        <button
          type="button"
          onClick={() => onCompare(null)}
          className="rounded px-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Stop comparing"
        >
          <span aria-hidden>×</span>
          <span className="sr-only">Stop comparing</span>
        </button>
      </p>
    );
  }

  const choose = (f: string) => {
    onCompare(f);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className="relative min-w-0 flex-1">
      <input
        type="search"
        value={query}
        placeholder="Compare with another county…"
        aria-label="Compare with another county"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls="compare-options"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, matches.length - 1));
          if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
          if (e.key === "Enter" && matches[cursor]) choose(matches[cursor]);
          if (e.key === "Escape") setOpen(false);
        }}
        className="w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs placeholder:text-neutral-400 dark:border-neutral-700"
      />
      {open && matches.length > 0 && (
        <ul
          id="compare-options"
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-neutral-200 bg-white text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {matches.map((f, k) => (
            <li
              key={f}
              role="option"
              aria-selected={k === cursor}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(f);
              }}
              className={`cursor-pointer px-2 py-1.5 ${k === cursor ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
            >
              {name(f)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceLine({
  climate,
  fips,
  compareFips,
  name,
}: {
  climate: ClimateData;
  fips: string;
  compareFips: string | null;
  name: (fips: string) => string;
}) {
  const far = [fips, compareFips]
    .filter((f): f is string => f !== null)
    .map((f) => ({ f, mi: climate.stationMi.get(f) }))
    .filter((s): s is { f: string; mi: number } => s.mi !== undefined && s.mi > STATION_CAUTION_MI);
  const mi = climate.stationMi.get(fips);
  return (
    <div className="border-t border-neutral-200 pt-2 text-[11px] leading-snug text-neutral-500 dark:border-neutral-800">
      <p>
        Source:{" "}
        <a href={climate.source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-300 underline-offset-2">
          {climate.source.name}
        </a>
        {mi !== undefined && <> · nearest temperature station {mi.toFixed(1)} mi from where people live</>}.
        Normals are 30-year averages, not a forecast.
      </p>
      {far.map(({ f, mi: d }) => (
        <p key={f} className="mt-1 text-amber-800 dark:text-amber-300">
          {name(f)}: the nearest station is {Math.round(d)} mi away — local climate may differ.
        </p>
      ))}
    </div>
  );
}
