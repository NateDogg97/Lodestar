"use client";

import { useDeferredValue, useMemo, useState } from "react";

import {
  METRIC_KEYS,
  prepareDataset,
  rankCounties,
  scoreCounties,
  type CountyDataset,
  type MetricKey,
} from "@/lib/scoring";

import { PreferencesPanel, type MetricRange } from "./preferences-panel";
import { DEFAULT_PREFERENCES, EMPTY_PREFERENCES, toScoringInput, type Preferences } from "./preferences";
import { ResultsList } from "./results-list";
import { useCountyData } from "./use-county-data";

export function CountyFinder() {
  const state = useCountyData();

  if (state.status === "loading") {
    return <p className="py-16 text-center text-sm text-neutral-500">Loading county data…</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="py-16 text-center text-sm text-rose-700 dark:text-rose-400">
        {state.message}
      </p>
    );
  }
  return <Finder data={state.data} />;
}

function nationalRanges(data: CountyDataset): Partial<Record<MetricKey, MetricRange>> {
  const out: Partial<Record<MetricKey, MetricRange>> = {};
  for (const key of METRIC_KEYS) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of data.values[key]) {
      if (Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min <= max) out[key] = { min, max };
  }
  return out;
}

function Finder({ data }: { data: CountyDataset }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [resetKey, setResetKey] = useState(0);

  // Scoring 3,000 counties is ~1 ms, but deferring keeps slider drags smooth
  // on slow phones by letting the input update before the list re-renders.
  const deferred = useDeferredValue(prefs);

  const prepared = useMemo(() => prepareDataset(data), [data]);
  const ranges = useMemo(() => nationalRanges(data), [data]);
  const scores = useMemo(() => scoreCounties(prepared, toScoringInput(deferred)), [prepared, deferred]);
  const ranked = useMemo(
    () => rankCounties(scores, { includeUnknown: deferred.includeUnknown }),
    [scores, deferred.includeUnknown],
  );

  const counts = useMemo(() => {
    const c = { match: 0, unknown: 0, excluded: 0 };
    for (const s of scores) c[s.status]++;
    return c;
  }, [scores]);

  const anyWeight = Object.values(prefs.weights).some((w) => (w ?? 0) > 0);

  const reset = (to: Preferences) => {
    setPrefs(to);
    setResetKey((k) => k + 1);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
      <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-2">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">What matters to you</h2>
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => reset(DEFAULT_PREFERENCES)} className="text-neutral-500 hover:underline">
              Defaults
            </button>
            <button type="button" onClick={() => reset(EMPTY_PREFERENCES)} className="text-neutral-500 hover:underline">
              Clear all
            </button>
          </div>
        </div>
        <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
          Weights rank counties. Limits rule counties out entirely. A county with no data for a
          limit is kept as <em>unknown</em> rather than guessed.
        </p>
        <PreferencesPanel prefs={prefs} onChange={setPrefs} ranges={ranges} resetKey={resetKey} />
      </aside>

      <section aria-labelledby="results-heading" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="results-heading" className="text-lg font-semibold">
            Best matches
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs.includeUnknown}
              onChange={(e) => setPrefs({ ...prefs, includeUnknown: e.target.checked })}
              className="accent-emerald-600"
            />
            Show unknown ({counts.unknown.toLocaleString()})
          </label>
        </div>

        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400" aria-live="polite">
          {counts.match.toLocaleString()} counties match
          {counts.unknown > 0 && <>, {counts.unknown.toLocaleString()} unknown</>}
          {counts.excluded > 0 && <>, {counts.excluded.toLocaleString()} ruled out by limits</>}.
        </p>

        {!anyWeight && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Give at least one metric a weight to rank counties. Until then they’re listed by FIPS code.
          </p>
        )}

        <ResultsList key={resetKey} ranked={ranked} data={data} />
      </section>
    </div>
  );
}
