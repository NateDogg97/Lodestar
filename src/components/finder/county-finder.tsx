"use client";

import dynamic from "next/dynamic";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

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

import { BottomSheet, SHEET_SNAPS } from "./bottom-sheet";
import { PreferencesPanel, type MetricRange } from "./preferences-panel";
import { MenuToggle, PanelMenu } from "./panel-menu";
import {
  DEFAULT_PREFERENCES,
  EMPTY_PREFERENCES,
  excludedStates,
  loadPreferences,
  OPTIONAL_STATES,
  savePreferences,
  toScoringInput,
  type Preferences,
} from "./preferences";
import { ResultsList } from "./results-list";
import { SelectedCounty } from "./selected-county";
import { SidePanel } from "./side-panel";
import { useCountyData, useLawData } from "./use-county-data";

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

// Phones get their own layout (map behind a draggable results sheet); the
// breakpoint matches Tailwind's `md`.
const WIDE_QUERY = "(min-width: 768px)";
function subscribeWide(onChange: () => void) {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const useIsWide = () =>
  useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true);

/** Where the phone sheet opens, and where it goes when a county is picked. */
const SHEET_START = 1; // 50%

function Finder({ data }: { data: CountyDataset }) {
  const wide = useIsWide();
  const laws = useLawData();
  // The search is remembered between sessions (localStorage; plan Phase 7 adds the URL).
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  useEffect(() => savePreferences(prefs), [prefs]);
  const [resetKey, setResetKey] = useState(0);
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  // Bumped by a pick in the list: the map zooms to that county every time.
  const [focus, setFocus] = useState<{ fips: string; n: number } | null>(null);

  // Desktop panels (plan §9 Phase 4, decision 2): each collapses on its own.
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(true);
  const mapMaximized = !filtersOpen && !resultsOpen;
  const [restore, setRestore] = useState({ filters: true, results: true });

  // Phone layout: filters open over the map from the top bar; results are a
  // bottom sheet. The map needs the sheet's height to keep counties above it.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [sheetSnap, setSheetSnap] = useState(SHEET_START);
  const [sheetScrollKey, setSheetScrollKey] = useState(0);
  const area = useRef<HTMLDivElement>(null);
  const [areaHeight, setAreaHeight] = useState(0);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    setAreaHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setAreaHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [wide]);
  const bottomInset = wide ? 0 : Math.round(SHEET_SNAPS[sheetSnap] * areaHeight);

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
    if (!fips) return;
    if (wide) {
      if (!resultsOpen) setResultsOpen(true);
    } else {
      // Half-height sheet: the county card on the bottom, the county above it.
      setMobileFiltersOpen(false);
      setSheetSnap(SHEET_START);
      setSheetScrollKey((k) => k + 1);
    }
  };
  const selectFromList = (fips: string) => {
    select(fips);
    setFocus((f) => ({ fips, n: (f?.n ?? 0) + 1 }));
  };

  const toggleMaximize = () => {
    if (mapMaximized) {
      // Bring back what was open; if that was nothing, show the results.
      setResultsOpen(restore.results || !restore.filters);
      setFiltersOpen(restore.filters);
    } else {
      setRestore({ filters: filtersOpen, results: resultsOpen });
      setFiltersOpen(false);
      setResultsOpen(false);
    }
  };

  // A selected county in a state that was just turned off is simply unselected.
  const selected = selectedFips ? (scoresByFips.get(selectedFips) ?? null) : null;

  const weightedCount = Object.values(prefs.weights).filter((w) => (w ?? 0) > 0).length;
  const limitCount = Object.values(prefs.limits).filter((l) => l && (l.min !== undefined || l.max !== undefined)).length;

  const filtersMenu = (
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
  );
  const filterActions = (
    <div className="flex gap-3 text-xs">
      <button type="button" onClick={() => reset(DEFAULT_PREFERENCES)} className="text-neutral-500 hover:underline">
        Defaults
      </button>
      <button type="button" onClick={() => reset(EMPTY_PREFERENCES)} className="text-neutral-500 hover:underline">
        Clear all
      </button>
    </div>
  );
  const filtersBody = (
    <div className="px-3 py-3">
      <p className="mb-4 px-1 text-xs text-neutral-500 dark:text-neutral-400">
        Weights rank counties. Limits rule counties out entirely. A county with no data for a
        limit is kept as <em>unknown</em> rather than guessed. Your settings are saved on this device.
      </p>
      <PreferencesPanel prefs={prefs} onChange={setPrefs} ranges={ranges} resetKey={resetKey} />
    </div>
  );

  const resultsBadge = counts.match ? `(${ranked.length.toLocaleString()})` : undefined;
  const resultsMenu = (
    <PanelMenu label="Result settings">
      <MenuToggle
        label={`Show unknown (${counts.unknown.toLocaleString()})`}
        hint="Counties with no data for one of your limits — kept and shown grey, never guessed."
        checked={prefs.includeUnknown}
        onChange={(on) => setPrefs({ ...prefs, includeUnknown: on })}
      />
    </PanelMenu>
  );
  const resultsBody = (
    <>
      {selected && (
        <SelectedCounty
          score={selected}
          data={scoped}
          rank={rankByFips.get(selected.fips) ?? null}
          total={ranked.length}
          rel={relative.get(selected.fips)}
          laws={laws}
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
          onSelect={selectFromList}
        />
      </div>
    </>
  );

  const map = (
    <CountyMap
      data={data}
      scoresByFips={scoresByFips}
      rankByFips={rankByFips}
      relative={relative}
      selectedFips={selectedFips}
      focus={focus}
      bottomInset={bottomInset}
      onSelect={select}
    />
  );

  if (!wide) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen((o) => !o)}
            aria-expanded={mobileFiltersOpen}
            aria-controls="filters-panel"
            className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium ${
              mobileFiltersOpen
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                : "border-neutral-300 dark:border-neutral-700"
            }`}
          >
            <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4h12M4 8h8M6 12h4" strokeLinecap="round" />
            </svg>
            Filters
            <span className={mobileFiltersOpen ? "opacity-70" : "text-neutral-500"}>
              {weightedCount} weighted{limitCount > 0 && ` · ${limitCount} limit${limitCount > 1 ? "s" : ""}`}
            </span>
          </button>
          <span className="truncate text-xs font-semibold tracking-tight text-neutral-500">New Home Finder</span>
        </div>

        <div ref={area} className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute inset-0">{map}</div>

          <BottomSheet
            id="results-panel"
            label="Results"
            snap={sheetSnap}
            onSnap={setSheetSnap}
            areaHeight={areaHeight}
            scrollTopKey={sheetScrollKey}
            header={
              <div className="flex items-center gap-1 px-4 pb-2">
                <h2 className="text-sm font-semibold">Results</h2>
                {resultsBadge && <span className="text-sm text-neutral-500">{resultsBadge}</span>}
                {resultsMenu}
              </div>
            }
          >
            {resultsBody}
          </BottomSheet>

          {mobileFiltersOpen && (
            <section
              id="filters-panel"
              aria-label="Filters"
              className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-neutral-950"
            >
              <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
                <div className="flex items-center gap-1">
                  <h2 className="text-sm font-semibold">Filters</h2>
                  {filtersMenu}
                </div>
                <div className="flex items-center gap-4">
                  {filterActions}
                  <button
                    type="button"
                    onClick={() => setMobileFiltersOpen(false)}
                    className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                  >
                    Done
                  </button>
                </div>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto">{filtersBody}</div>
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      <SidePanel
        id="filters-panel"
        title="Filters"
        open={filtersOpen}
        onToggle={() => setFiltersOpen((o) => !o)}
        widthClass="md:w-80"
        menu={filtersMenu}
        headerExtra={filterActions}
      >
        {filtersBody}
      </SidePanel>

      <SidePanel
        id="results-panel"
        title="Results"
        badge={resultsBadge}
        open={resultsOpen}
        onToggle={() => setResultsOpen((o) => !o)}
        widthClass="md:w-96"
        menu={resultsMenu}
      >
        {resultsBody}
      </SidePanel>

      <div className="relative min-w-0 flex-1">
        {map}
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
