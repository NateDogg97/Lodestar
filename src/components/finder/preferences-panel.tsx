"use client";

import { useState } from "react";

import {
  getMetric,
  MAX_WEIGHT,
  METRICS,
  type Direction,
  type MetricGroup,
  type MetricKey,
} from "@/lib/scoring";

import type { Preferences } from "./preferences";

const GROUPS: { id: MetricGroup; label: string }[] = [
  { id: "cost", label: "Cost of living" },
  { id: "housing", label: "Housing" },
  { id: "schools", label: "Schools" },
  { id: "climate", label: "Climate" },
  { id: "people", label: "People & income" },
];

export interface MetricRange {
  min: number;
  max: number;
}

interface Props {
  prefs: Preferences;
  onChange: (next: Preferences) => void;
  /** National min/max per metric, shown as placeholders for limits. */
  ranges: Partial<Record<MetricKey, MetricRange>>;
  /** Bumped on reset so uncontrolled limit inputs remount with the new values. */
  resetKey: number;
}

export function PreferencesPanel({ prefs, onChange, ranges, resetKey }: Props) {
  const setWeight = (key: MetricKey, weight: number) =>
    onChange({ ...prefs, weights: { ...prefs.weights, [key]: weight } });

  const setDirection = (key: MetricKey, direction: Direction) =>
    onChange({ ...prefs, directions: { ...prefs.directions, [key]: direction } });

  const setLimit = (key: MetricKey, bound: "min" | "max", value: number | undefined) =>
    onChange({
      ...prefs,
      limits: { ...prefs.limits, [key]: { ...prefs.limits[key], [bound]: value } },
    });

  return (
    <div className="space-y-6">
      {GROUPS.map((group) => (
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
            />
          ))}
        </fieldset>
      ))}
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
        <div role="group" aria-label={`What is better for ${def.label}`} className="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700">
          {(["lower", "higher"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDirection(d)}
              aria-pressed={direction === d}
              className={`px-2 py-0.5 first:rounded-l-md last:rounded-r-md ${
                direction === d
                  ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {d === "lower" ? "Lower is better" : "Higher is better"}
            </button>
          ))}
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
