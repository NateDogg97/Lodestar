"use client";

import { useState } from "react";

import { formatDay, type LawSourceSummary } from "@/lib/laws";
import {
  CATEGORIES,
  DIRECTIONS,
  formatValue,
  getMetric,
  MAX_WEIGHT,
  METRICS,
  type CategoryDef,
  type CategoryKey,
  type Direction,
  type MetricGroup,
  type MetricKey,
} from "@/lib/scoring";

import type { Preferences } from "./preferences";

/** The Filters panel's two tabs: what a place is like, and its state's laws and taxes. */
export type FiltersTab = "place" | "laws";

const GROUPS: { id: MetricGroup; label: string; tab: FiltersTab }[] = [
  { id: "cost", label: "Cost of living", tab: "place" },
  { id: "housing", label: "Housing", tab: "place" },
  { id: "schools", label: "Schools", tab: "place" },
  { id: "climate", label: "Climate", tab: "place" },
  { id: "people", label: "People & income", tab: "place" },
  { id: "taxes", label: "Taxes", tab: "laws" },
];

/** How many law & tax filters are doing something — for the tab's badge. */
export function activeLawFilters(prefs: Preferences): number {
  let n = Object.values(prefs.categories).filter(Boolean).length;
  for (const m of METRICS) {
    if (m.group !== "taxes") continue;
    const limit = prefs.limits[m.key];
    if ((prefs.weights[m.key] ?? 0) > 0 || limit?.min !== undefined || limit?.max !== undefined) n++;
  }
  return n;
}

export interface MetricRange {
  min: number;
  max: number;
  /** The typical (median) county — the target when "Average" is chosen. */
  median: number;
}

const DIRECTION_LABELS: Record<Direction, string> = {
  lower: "Lower",
  middle: "Average",
  higher: "Higher",
};

interface Props {
  prefs: Preferences;
  onChange: (next: Preferences) => void;
  /** National min/max per metric, shown as placeholders for limits. */
  ranges: Partial<Record<MetricKey, MetricRange>>;
  /** Bumped on reset so uncontrolled limit inputs remount with the new values. */
  resetKey: number;
  tab: FiltersTab;
  /** Source and dates for each state-level metric and policy, keyed like the law table. */
  sources: Record<string, LawSourceSummary>;
  /** Per policy: how many states (and DC) have each value. */
  stateCounts: Partial<Record<CategoryKey, Record<string, number>>>;
}

export function PreferencesPanel({ prefs, onChange, ranges, resetKey, tab, sources, stateCounts }: Props) {
  const setWeight = (key: MetricKey, weight: number) =>
    onChange({ ...prefs, weights: { ...prefs.weights, [key]: weight } });

  const setDirection = (key: MetricKey, direction: Direction) =>
    onChange({ ...prefs, directions: { ...prefs.directions, [key]: direction } });

  const setLimit = (key: MetricKey, bound: "min" | "max", value: number | undefined) =>
    onChange({
      ...prefs,
      limits: { ...prefs.limits, [key]: { ...prefs.limits[key], [bound]: value } },
    });

  const setCategory = (key: CategoryKey, accept: string[] | undefined) => {
    const categories = { ...prefs.categories };
    if (accept === undefined) delete categories[key];
    else categories[key] = accept;
    onChange({ ...prefs, categories });
  };

  return (
    <div className="space-y-6">
      {GROUPS.filter((g) => g.tab === tab).map((group) => (
        <fieldset key={group.id} className="space-y-1">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {group.label}
          </legend>
          {METRICS.filter((m) => m.group === group.id).map((m) => (
            <MetricControl
              key={`${m.key}-${resetKey}`}
              metric={m.key}
              weight={prefs.weights[m.key] ?? 0}
              direction={prefs.directions[m.key] ?? m.defaultDirection}
              limit={prefs.limits[m.key]}
              range={ranges[m.key]}
              onWeight={(w) => setWeight(m.key, w)}
              onDirection={(d) => setDirection(m.key, d)}
              onLimit={(bound, v) => setLimit(m.key, bound, v)}
              source={sources[m.key]}
            />
          ))}
        </fieldset>
      ))}
      {tab === "laws" && (
        <fieldset className="space-y-1">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Policies
          </legend>
          <p className="mb-2 px-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            Not weighted — a county whose state isn&rsquo;t one you allow is ruled out. States with no
            value (sources disagree) are kept as unknown.
          </p>
          {CATEGORIES.map((def) => (
            <CategoryControl
              key={def.key}
              def={def}
              accept={prefs.categories[def.key]}
              counts={stateCounts[def.key] ?? {}}
              source={sources[def.key]}
              onChange={(accept) => setCategory(def.key, accept)}
            />
          ))}
        </fieldset>
      )}
    </div>
  );
}

/** "Source: Tax Foundation, as of Apr 28, 2026 · checked Sep 27, 2026" */
function SourceLine({ source }: { source: LawSourceSummary | undefined }) {
  if (!source) return null;
  return (
    <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
      Source:{" "}
      <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200">
        {source.sourceName}
      </a>
      , as of {formatDay(source.sourceDate)} · checked {formatDay(source.checked)}
    </p>
  );
}

/**
 * A policy filter. `accept` undefined = don't care.
 * - multi: checkboxes, all ticked by default; untick what you'd rule out.
 * - boolean: Any / require yes / require no.
 */
function CategoryControl({
  def,
  accept,
  counts,
  source,
  onChange,
}: {
  def: CategoryDef;
  accept: string[] | undefined;
  counts: Record<string, number>;
  source: LawSourceSummary | undefined;
  onChange: (accept: string[] | undefined) => void;
}) {
  const all = def.options.map((o) => o.value);
  const active = accept !== undefined;
  const groupId = `category-${def.key}`;

  return (
    <div className={`rounded-lg px-3 py-2 transition-colors ${active ? "bg-neutral-100 dark:bg-neutral-900" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span id={groupId} className="text-sm font-medium">
          {def.label}
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{active ? "Filtering" : "Any"}</span>
      </div>

      {def.control === "boolean" ? (
        <div role="group" aria-labelledby={groupId} className="mt-1.5 inline-flex rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
          {[
            { label: "Any", value: undefined },
            ...def.options.map((o) => ({ label: o.short ?? o.label, value: [o.value] })),
          ].map((choice) => {
            const pressed = JSON.stringify(choice.value) === JSON.stringify(accept);
            return (
              <button
                key={choice.label}
                type="button"
                aria-pressed={pressed}
                onClick={() => onChange(choice.value)}
                className={`px-2 py-0.5 first:rounded-l-md last:rounded-r-md ${
                  pressed
                    ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div role="group" aria-labelledby={groupId} className="mt-1 space-y-0.5">
          {def.options.map((o) => {
            const checked = accept === undefined || accept.includes(o.value);
            return (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const current = accept ?? all;
                    const next = e.target.checked ? [...current, o.value] : current.filter((v) => v !== o.value);
                    // Everything allowed again is the same as no filter.
                    onChange(all.every((v) => next.includes(v)) ? undefined : all.filter((v) => next.includes(v)));
                  }}
                  className="accent-emerald-600"
                />
                <span className="flex-1">{o.label}</span>
                <span className="tabular-nums text-neutral-400" title="States (and DC) with this value">
                  {counts[o.value] ?? 0}
                </span>
              </label>
            );
          })}
          {accept?.length === 0 && (
            <p className="text-[11px] text-rose-700 dark:text-rose-400">Nothing allowed — every county is ruled out.</p>
          )}
        </div>
      )}
      <SourceLine source={source} />
    </div>
  );
}

interface MetricControlProps {
  metric: MetricKey;
  weight: number;
  direction: Direction;
  limit: { min?: number; max?: number } | undefined;
  range: MetricRange | undefined;
  onWeight: (w: number) => void;
  onDirection: (d: Direction) => void;
  onLimit: (bound: "min" | "max", v: number | undefined) => void;
  /** Present for state-level metrics (from the law table). */
  source?: LawSourceSummary;
}

function MetricControl({
  metric,
  weight,
  direction,
  limit,
  range,
  onWeight,
  onDirection,
  onLimit,
  source,
}: MetricControlProps) {
  const def = getMetric(metric);
  const hasLimit = limit?.min !== undefined || limit?.max !== undefined;
  const [limitsOpen, setLimitsOpen] = useState(hasLimit);
  const active = weight > 0 || hasLimit;
  const sliderId = `weight-${metric}`;

  return (
    <div
      className={`rounded-lg px-3 py-2 transition-colors ${
        active ? "bg-neutral-100 dark:bg-neutral-900" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={sliderId} className="text-sm font-medium">
          {def.label}
        </label>
        <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          {weight === 0 ? "Ignored" : `Weight ${weight}`}
        </span>
      </div>

      <input
        id={sliderId}
        type="range"
        min={0}
        max={MAX_WEIGHT}
        step={1}
        value={weight}
        onChange={(e) => onWeight(Number(e.target.value))}
        className="mt-1 w-full accent-emerald-600"
        aria-valuetext={weight === 0 ? "Ignored" : `Weight ${weight} of ${MAX_WEIGHT}`}
      />

      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span id={`better-${metric}`} className="text-neutral-500 dark:text-neutral-400">
            Better:
          </span>
          <div
            role="group"
            aria-labelledby={`better-${metric} ${sliderId}`}
            className="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700"
          >
            {DIRECTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDirection(d)}
                aria-pressed={direction === d}
                title={
                  d === "middle"
                    ? "Closest to the typical (median) county scores best; both extremes score worst"
                    : `${DIRECTION_LABELS[d]} values score better`
                }
                className={`px-2 py-0.5 first:rounded-l-md last:rounded-r-md ${
                  direction === d
                    ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                {DIRECTION_LABELS[d]}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLimitsOpen((o) => !o)}
          aria-expanded={limitsOpen}
          className={`underline-offset-2 hover:underline ${
            hasLimit ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-neutral-500"
          }`}
        >
          {hasLimit ? "Limit set" : "Set limit"}
        </button>
      </div>

      {direction === "middle" && range && (
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          Aiming for the typical county: {formatValue(metric, range.median)}
        </p>
      )}

      {limitsOpen && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <LimitField
            label="Min"
            metric={metric}
            value={limit?.min}
            placeholder={range ? plainNumber(range.min) : undefined}
            onChange={(v) => onLimit("min", v)}
          />
          <LimitField
            label="Max"
            metric={metric}
            value={limit?.max}
            placeholder={range ? plainNumber(range.max) : undefined}
            onChange={(v) => onLimit("max", v)}
          />
        </div>
      )}
      <SourceLine source={source} />
    </div>
  );
}

/**
 * Placeholders show the national range in the units you type — not the
 * display format — so "rent share" reads 0.06, not 6%.
 */
function plainNumber(v: number): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return String(Number(v.toFixed(digits)));
}

function LimitField({
  label,
  metric,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  metric: MetricKey;
  value: number | undefined;
  placeholder: string | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const id = `limit-${metric}-${label.toLowerCase()}`;
  const unit = getMetric(metric).unit;
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] text-neutral-500 dark:text-neutral-400">
        {label} <span className="text-neutral-400">({unit})</span>
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        defaultValue={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          const text = e.target.value.trim();
          if (text === "") return onChange(undefined);
          const n = Number(text);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm tabular-nums placeholder:text-neutral-400 dark:border-neutral-700"
      />
    </div>
  );
}
