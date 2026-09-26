"use client";

import dynamic from "next/dynamic";
import { useDeferredValue, useMemo, useState } from "react";

import {
  MAP_TOP_N,
  METRIC_KEYS,
  prepareDataset,
  rankCounties,
  scoreCounties,
  subsetDataset,
  topRelativeScores,
  type CountyDataset,
  type MetricKey,
} from "@/lib/scoring";

import { PreferencesPanel, type MetricRange } from "./preferences-panel";
import { MenuToggle, PanelMenu } from "./panel-menu";
import {
  DEFAULT_PREFERENCES,
  EMPTY_PREFERENCES,
  excludedStates,
  OPTIONAL_STATES,
  toScoringInput,
  type Preferences,
} from "./preferences";
import { ResultsList } from "./results-list";
import { SelectedCounty } from "./selected-county";
import { SidePanel } from "./side-panel";
import { useCountyData } from "./use-county-data";

// MapLibre needs the browser (WebGL, window), so it never renders on the
// server, and it loads in its own chunk after the panels are usable.
const CountyMap = dynamic(() => import("./county-map"), {
  ssr: false,
  loading: () => <p className="grid h-full place-items-center text-sm text-neutral-500">Loading map…</p>,
});

export function CountyFinder() {
  const state = useCountyData();

  if (state.status === "loading") {
    return <p className="grid flex-1 place-items-center text-sm text-neutral-500">Loading county data…</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="grid flex-1 place-items-center text-sm text-rose-700 dark:text-rose-400">
        {state.message}
      </p>
    );
  }
  return <Finder data={state.data} />;
}

function nationalRanges(data: CountyDataset): Partial<Record<MetricKey, MetricRange>> {
  const out: Partial<Record<MetricKey, MetricRange>> = {};
  for (const key of METRIC_KEYS) {
    const known = Array.from(data.values[key]).filter((v) => !Number.isNaN(v));
    if (known.length === 0) continue;
    known.sort((a, b) => a - b);
    const mid = known.length >> 1;
    const median = known.length % 2 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
    out[key] = { min: known[0], max: known[known.length - 1], median };
  }
  return out;
}

const isWide = () => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches;

function Finder({ data }: { data: CountyDataset }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [resetKey, setResetKey] = useState(0);
  const [selectedFips, setSelectedFips] = useState<string | null>(null);

  // Panels (plan §9 Phase 4, decision 2): each collapses on its own. On a
  // phone an open panel covers the map, so start with only the results open.
  const [filtersOpen, setFiltersOpen] = useState(isWide);
  const [resultsOpen, setResultsOpen] = useState(true);
  const mapMaximized = !filtersOpen && !resultsOpen;
  const [restore, setRestore] = useState({ filters: true, results: true });

  // Scoring 3,000 counties is ~1 ms, but deferring keeps slider drags smooth
  // on slow phones by letting the input update before the list re-renders.
  const deferred = useDeferredValue(prefs);

  // Alaska / Hawaii toggles: cut the excluded states BEFORE percentiles are
  // computed, so they have no influence at all. Everything below works on
  // `scoped`; `data` (all counties) is only used by the map for names/shapes.
  const excludedKey = excludedStates(deferred).join(",");
  const scoped = useMemo(() => {
    const out = excludedKey ? excludedKey.split(",") : [];
    return out.length ? subsetDataset(data, (i) => !out.includes(data.state[i])) : data;
  }, [data, excludedKey]);

  const prepared = useMemo(() => prepareDataset(scoped), [scoped]);
  const ranges = useMemo(() => nationalRanges(scoped), [scoped]);
  const scores = useMemo(() => scoreCounties(prepared, toScoringInput(deferred)), [prepared, deferred]);
  const scoresByFips = useMemo(() => new Map(scores.map((s) => [s.fips, s])), [scores]);
  const ranked = useMemo(
    () => rankCounties(scores, { includeUnknown: deferred.includeUnknown }),
    [scores, deferred.includeUnknown],
  );
  const rankByFips = useMemo(() => new Map(ranked.map((s, i) => [s.fips, i + 1])), [ranked]);
  const anyWeight = Object.values(deferred.weights).some((w) => (w ?? 0) > 0);
  // Map shows only the top results, colored relative to each other — but only
  // once something is weighted; an unweighted "ranking" is just FIPS order.
  const relative = useMemo(
    () => (anyWeight ? topRelativeScores(ranked, MAP_TOP_N) : new Map<string, number | null>()),
    [ranked, anyWeight],
  );

  const counts = useMemo(() => {
    const c = { match: 0, unknown: 0, excluded: 0 };
    for (const s of scores) c[s.status]++;
    return c;
  }, [scores]);

  const reset = (to: Preferences) => {
    setPrefs(to);
    setResetKey((k) => k + 1);
  };

  const select = (fips: string | null) => {
    setSelectedFips(fips);
    if (fips && !resultsOpen) setResultsOpen(true);
    // On a phone the results panel covers the map; picking from the list
    // should reveal the map, picking on the map should reveal the card.
    if (fips && !isWide()) setFiltersOpen(false);
  };

  const toggleMaximize = () => {
    if (mapMaximized) {
      // Bring back what was open; if that was nothing, show the results.
      const results = restore.results || !restore.filters;
      setResultsOpen(results);
      // A phone has room for one panel, and the results win.
      setFiltersOpen(restore.filters && (isWide() || !results));
    } else {
      setRestore({ filters: filtersOpen, results: resultsOpen });
      setFiltersOpen(false);
      setResultsOpen(false);
    }
  };

  // On a phone only one panel fits; opening one closes the other.
  const toggleFilters = () => {
    if (!filtersOpen && !isWide()) setResultsOpen(false);
    setFiltersOpen((o) => !o);
  };
  const toggleResults = () => {
    if (!resultsOpen && !isWide()) setFiltersOpen(false);
    setResultsOpen((o) => !o);
  };

  // A selected county in a state that was just turned off is simply unselected.
  const selected = selectedFips ? (scoresByFips.get(selectedFips) ?? null) : null;

  return (
    <div className="relative flex min-h-0 flex-1">
      <SidePanel
        id="filters-panel"
        title="Filters"
        open={filtersOpen}
        onToggle={toggleFilters}
        widthClass="md:w-80"
        menu={
          <PanelMenu label="Filter settings">
            <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Include in results
            </p>
            {OPTIONAL_STATES.map(({ state, label }) => (
              <MenuToggle
                key={state}
                label={label}
                checked={prefs.includeStates[state]}
                onChange={(on) => setPrefs({ ...prefs, includeStates: { ...prefs.includeStates, [state]: on } })}
              />
            ))}
            <p className="mt-1 px-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              When off, they’re left out entirely — they don’t affect anyone’s percentiles.
            </p>
          </PanelMenu>
        }
        headerExtra={
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => reset(DEFAULT_PREFERENCES)} className="text-neutral-500 hover:underline">
              Defaults
            </button>
            <button type="button" onClick={() => reset(EMPTY_PREFERENCES)} className="text-neutral-500 hover:underline">
              Clear all
            </button>
          </div>
        }
      >
        <div className="px-3 py-3">
          <p className="mb-4 px-1 text-xs text-neutral-500 dark:text-neutral-400">
            Weights rank counties. Limits rule counties out entirely. A county with no data for a
            limit is kept as <em>unknown</em> rather than guessed.
          </p>
          <PreferencesPanel prefs={prefs} onChange={setPrefs} ranges={ranges} resetKey={resetKey} />
        </div>
      </SidePanel>

      <SidePanel
        id="results-panel"
        title="Results"
        badge={counts.match ? `(${ranked.length.toLocaleString()})` : undefined}
        open={resultsOpen}
        onToggle={toggleResults}
        widthClass="md:w-96"
        menu={
          <PanelMenu label="Result settings">
            <MenuToggle
              label={`Show unknown (${counts.unknown.toLocaleString()})`}
              hint="Counties with no data for one of your limits — kept and shown grey, never guessed."
              checked={prefs.includeUnknown}
              onChange={(on) => setPrefs({ ...prefs, includeUnknown: on })}
            />
          </PanelMenu>
        }
      >
        {selected && (
          <SelectedCounty
            score={selected}
            data={scoped}
            rank={rankByFips.get(selected.fips) ?? null}
            total={ranked.length}
            rel={relative.get(selected.fips)}
            onClose={() => setSelectedFips(null)}
          />
        )}
        <div className="px-3 py-3">
          <p className="mb-2 px-1 text-xs text-neutral-600 dark:text-neutral-400" aria-live="polite">
            {counts.match.toLocaleString()} match
            {counts.unknown > 0 && (
              <>, {counts.unknown.toLocaleString()} unknown{!prefs.includeUnknown && " (hidden)"}</>
            )}
            {counts.excluded > 0 && <>, {counts.excluded.toLocaleString()} ruled out</>}
          </p>
          {anyWeight ? (
            <p className="mb-2 px-1 text-[11px] text-neutral-500">
              The map colors the top {Math.min(MAP_TOP_N, ranked.length)} relative to each other.
            </p>
          ) : (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Give at least one filter a weight to rank counties and color the map.
            </p>
          )}
          <ResultsList
            key={resetKey}
            ranked={ranked}
            data={scoped}
            relative={relative}
            selectedFips={selectedFips}
            onSelect={select}
          />
        </div>
      </SidePanel>

      <div className="relative min-w-0 flex-1">
        <CountyMap
          data={data}
          scoresByFips={scoresByFips}
          rankByFips={rankByFips}
          relative={relative}
          selectedFips={selectedFips}
          onSelect={select}
        />
        <button
          type="button"
          onClick={toggleMaximize}
          aria-pressed={mapMaximized}
          className="absolute top-2 left-2 z-10 rounded-md bg-white/90 px-2.5 py-1.5 text-xs font-medium text-neutral-800 shadow-sm hover:bg-white dark:bg-neutral-900/90 dark:text-neutral-200 dark:hover:bg-neutral-900"
        >
          {mapMaximized ? "Show panels" : "Maximize map"}
        </button>
      </div>
    </div>
  );
}
