"use client";

import dynamic from "next/dynamic";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { applyStateLaws, lawSource, type LawData, type LawSourceSummary } from "@/lib/laws";
import {
  CATEGORY_KEYS,
  COUNTY_CATEGORY_KEYS,
  MAP_TOP_N,
  STATE_CATEGORY_KEYS,
  STATE_METRIC_KEYS,
  METRIC_KEYS,
  prepareDataset,
  rankCounties,
  scoreCounties,
  subsetDataset,
  topRelativeScores,
  type CategoryKey,
  type CountyDataset,
  type MetricKey,
} from "@/lib/scoring";

import { InfoTip } from "@/components/ui/info-tip";
import { LodestarLogo } from "@/components/ui/lodestar-logo";
import { useTheme } from "@/components/ui/theme";

import { BottomSheet, SHEET_SNAPS } from "./bottom-sheet";
import { markTourSeen, Tour, tourSeen, type TourStep } from "./tour";
import { countActiveFilters, FiltersModal, type MetricRange } from "./filters-modal";
import {
  DEFAULT_PREFERENCES,
  EMPTY_PREFERENCES,
  excludedStates,
  savePreferences,
  toAreaSearch,
  toScoringInput,
  type Preferences,
} from "./preferences";
import { InsideView } from "./inside-view";
import { ResultsList } from "./results-list";
import { addRecent, initialSearch } from "./searches-store";
import { encodeSearch } from "./search-url";
import { PlaceIdentity, PlaceView, type PlaceProps } from "./place-view";
import { SettingsModal } from "./settings-modal";
import { SidePanel } from "./side-panel";
import { useCountyData, useLawData } from "./use-county-data";
import { useCountyAreas, useNationalAreas, useTractIndex } from "./use-tract-data";
import type { InsideLayer, ResultMarks } from "./county-map";
import {
  AREA_MEASURE,
  areaCriteria,
  areaValue,
  countiesOf,
  countyMatches,
  notResidential,
  MATCH,
  UNKNOWN,
  countyParts,
  formatArea,
  resultBadges,
  scoreNational,
  topAreas,
  type ResultBadges,
} from "@/lib/tracts";
import { AreaResultsList, CountyBestAreas, CountyResultsList, ResultsHeader, type ResultCap } from "./area-results";
import type { AreaRankingView } from "./inside-view";

// MapLibre needs the browser (WebGL, window), so it never renders on the
// server, and it loads in its own chunk after the panels are usable.
const CountyMap = dynamic(() => import("./county-map"), {
  ssr: false,
  loading: () => <p className="grid h-full place-items-center text-sm text-neutral-500">Loading map…</p>,
});

export function CountyFinder() {
  const state = useCountyData();
  const laws = useLawData();
  // Each county takes its state's law values (taxes, electricity, policies).
  const data = useMemo(
    () => (state.status === "ready" && laws.settled ? applyStateLaws(state.data, laws.data) : null),
    [state, laws],
  );

  if (state.status === "loading" || (state.status === "ready" && !data)) {
    return <p className="grid flex-1 place-items-center text-sm text-neutral-500">Loading county data…</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="grid flex-1 place-items-center text-sm text-rose-700 dark:text-rose-400">
        {state.message}
      </p>
    );
  }
  return <Finder data={data!} laws={laws.data} />;
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

const COMPARE_KEY = "nhf.compareFips";

const isPlaceEntry = (state: unknown) => Boolean((state as { nhfPlace?: boolean } | null)?.nhfPlace);

/** Where the phone sheet opens, and where it goes when a county is picked. */
const SHEET_START = 1; // 50%

function Finder({ data, laws }: { data: CountyDataset; laws: LawData | null }) {
  const wide = useIsWide();
  // The search is remembered between sessions (localStorage) and lives in the
  // URL, so a link opens the same search and county; a link wins over the
  // saved search (plan Phase 7b).
  const [initial] = useState(() => {
    const { prefs, place } = initialSearch();
    // A place is a county (5 digits) or an area inside one (an 11-digit tract,
    // Phase 8): an area opens its county, explored inside, with the area picked.
    const county = place ? place.slice(0, 5) : null;
    const ok = county && data.indexByFips.has(county);
    return { prefs, place: ok ? county : null, area: ok && place!.length === 11 ? place : null };
  });
  const [prefs, setPrefs] = useState<Preferences>(initial.prefs);
  useEffect(() => savePreferences(prefs), [prefs]);
  const [resetKey, setResetKey] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Filters' Saved page (here so the tour can open it).
  const [filtersSaved, setFiltersSaved] = useState(false);
  const theme = useTheme();

  // Law sources and per-value state counts for the Filters modal.
  const lawSources = useMemo(() => {
    const out: Record<string, LawSourceSummary> = {};
    if (laws) {
      for (const key of [...STATE_METRIC_KEYS, ...CATEGORY_KEYS]) {
        const s = lawSource(laws, key);
        if (s) out[key] = s;
      }
    }
    return out;
  }, [laws]);
  const stateCounts = useMemo(() => {
    const out: Partial<Record<CategoryKey, Record<string, number>>> = {};
    for (const key of STATE_CATEGORY_KEYS) {
      const c: Record<string, number> = {};
      for (const facts of Object.values(laws?.states ?? {})) {
        const v = facts[key]?.v;
        if (typeof v === "string") c[v] = (c[v] ?? 0) + 1;
      }
      out[key] = c;
    }
    return out;
  }, [laws]);
  const [selectedFips, setSelectedFips] = useState<string | null>(initial.place);
  // The Climate tab's comparison county, kept across places and sessions
  // (a per-device convenience, like the saved search).
  const [compareFips, setCompareFips] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(COMPARE_KEY);
    } catch {
      return null;
    }
  });
  const compareWith = (fips: string | null) => {
    setCompareFips(fips);
    try {
      if (fips) window.localStorage.setItem(COMPARE_KEY, fips);
      else window.localStorage.removeItem(COMPARE_KEY);
    } catch {
      // storage blocked: the comparison just isn't remembered
    }
  };
  // The Results panel shows the ranked list or one county's place view (plan
  // Phase 6). Returning to the list keeps the county highlighted.
  const [view, setView] = useState<"list" | "place">(initial.place ? "place" : "list");
  // A history entry marks the place view, so the Back gesture returns to the list.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      setView(isPlaceEntry(e.state) ? "place" : "list");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Bumped by a pick in the list: the map zooms to that county every time.
  // A linked county is zoomed to once the map is ready.
  const [focus, setFocus] = useState<{ fips: string; n: number } | null>(
    initial.place ? { fips: initial.place, n: 1 } : null,
  );

  // Inside a county (plan §9 Phase 8b): its areas instead of its county view.
  const tractIndex = useTractIndex();
  const [insideFips, setInsideFips] = useState<string | null>(initial.area ? initial.place : null);
  const [selectedArea, setSelectedArea] = useState<string | null>(initial.area);
  // With no filter that varies inside the county, areas show Census home value
  // (it varies area by area; Zillow's is per ZIP).
  const areaMeasure = "median_home_value";
  const [areaFocus, setAreaFocus] = useState<{ geoid: string; n: number } | null>(
    initial.area ? { geoid: initial.area, n: 1 } : null,
  );

  // Desktop: the results panel collapses to give the map the whole width.
  const [resultsOpen, setResultsOpen] = useState(true);

  // Phone layout: results are a bottom sheet. The map needs the sheet's
  // height to keep counties above it.
  const [sheetSnap, setSheetSnap] = useState(SHEET_START);
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
  // Option counts beside each category filter: states for policies, counties for climate type.
  const categoryCounts = useMemo(() => {
    const out = { ...stateCounts };
    for (const key of COUNTY_CATEGORY_KEYS) {
      const c: Record<string, number> = {};
      for (const v of scoped.categories[key]) if (v !== null) c[v] = (c[v] ?? 0) + 1;
      out[key] = c;
    }
    return out;
  }, [stateCounts, scoped]);
  const ranges = useMemo(() => nationalRanges(scoped), [scoped]);
  const scoringInput = useMemo(() => toScoringInput(deferred), [deferred]);
  const scores = useMemo(() => scoreCounties(prepared, scoringInput), [prepared, scoringInput]);
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

  // Areas as the results (plan §9 Phase 8f): with any area-level filter, the best
  // areas nationwide are the results and counties rank by their best area.
  const areaSearch = useMemo(() => areaCriteria(toAreaSearch(deferred)), [deferred]);
  const hasAreaFilters = areaSearch.criteria.length > 0 || areaSearch.limits.length > 0;
  const nationalState = useNationalAreas(hasAreaFilters);
  const national = nationalState.status === "ready" ? nationalState.data : null;
  const nationalSearch = useMemo(
    () => ({ criteria: areaSearch.criteria, limits: areaSearch.limits, counties: countyParts(scores) }),
    [areaSearch, scores],
  );
  const nscores = useMemo(
    () => (national && hasAreaFilters ? scoreNational(national, nationalSearch) : null),
    [national, hasAreaFilters, nationalSearch],
  );
  const areaMode = nscores !== null;
  const matchingAreas = useMemo(() => {
    if (!nscores) return 0;
    let n = 0;
    for (const st of nscores.status) if (st === MATCH || (st === UNKNOWN && deferred.includeUnknown)) n++;
    return n;
  }, [nscores, deferred.includeUnknown]);
  const [resultCap, setResultCap] = useState<ResultCap>(100);
  const topIdx = useMemo(
    () => (national && nscores ? topAreas(national, nscores, resultCap, deferred.includeUnknown) : []),
    [national, nscores, resultCap, deferred.includeUnknown],
  );
  const countyResults = useMemo(
    () => (national && nscores ? countiesOf(national, topIdx, nscores) : []),
    [national, nscores, topIdx],
  );
  const badges = useMemo(
    () => (national ? resultBadges(national, topIdx, nationalSearch) : new Map<number, ResultBadges>()),
    [national, topIdx, nationalSearch],
  );
  const [viewChoice, setViewChoice] = useState<"areas" | "counties" | null>(null);
  const resultsView = viewChoice ?? (hasAreaFilters ? "areas" : "counties");
  // The map in area mode: the counties holding your top areas, colored by their best area.
  const mapRelative = useMemo(
    () =>
      areaMode
        ? new Map<string, number | null>(countyResults.map((c) => [c.fips, Number.isNaN(c.bestScore) ? null : c.bestScore]))
        : relative,
    [areaMode, countyResults, relative],
  );
  const mapRank = useMemo(
    () => (areaMode ? new Map(countyResults.map((c, i) => [c.fips, i + 1])) : rankByFips),
    [areaMode, countyResults, rankByFips],
  );
  const countyIndex = useMemo(() => new Map(data.fips.map((f, i) => [f, i])), [data]);
  const countyName = (fips: string) => {
    const i = countyIndex.get(fips);
    return i === undefined ? fips : `${data.countyName[i]}, ${data.state[i]}`;
  };
  // Where your top areas are, for the map by zoom: states, then counties, then areas.
  const resultMarks = useMemo<ResultMarks | null>(() => {
    if (!national || !nscores || topIdx.length === 0) return null;
    const group = (key: (i: number) => string) => {
      const g = new Map<string, number[]>();
      for (const i of topIdx) {
        const k = key(i);
        const list = g.get(k);
        if (list) list.push(i);
        else g.set(k, [i]);
      }
      return g;
    };
    const mean = (xs: number[], v: Float64Array) => xs.reduce((a, i) => a + v[i], 0) / xs.length;
    const located = topIdx.filter((i) => Number.isFinite(national.lat[i]) && Number.isFinite(national.lon[i]));
    const isLocated = new Set(located);
    const stateOf = (i: number) => data.state[countyIndex.get(national.county[i]) ?? -1] ?? national.county[i].slice(0, 2);
    return {
      states: [...group(stateOf)].map(([st, xs]) => {
        const at = xs.filter((i) => isLocated.has(i));
        const lats = at.map((i) => national.lat[i]);
        const lons = at.map((i) => national.lon[i]);
        return {
          key: st,
          label: st,
          lat: mean(at, national.lat),
          lon: mean(at, national.lon),
          count: xs.length,
          bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] as [number, number, number, number],
        };
      }).filter((m) => Number.isFinite(m.lat)),
      counties: [...group((i) => national.county[i])].map(([fips, xs]) => {
        const at = xs.filter((i) => isLocated.has(i));
        return { key: fips, label: countyName(fips), lat: mean(at, national.lat), lon: mean(at, national.lon), count: xs.length };
      }).filter((m) => Number.isFinite(m.lat)),
      areas: located.map((i) => ({
        geoid: national.geoid[i],
        label: national.name[i],
        lat: national.lat[i],
        lon: national.lon[i],
        score: nscores.score[i],
      })),
    };
    // countyName reads data and countyIndex, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [national, nscores, topIdx, data, countyIndex]);

  // The area whose summary is open in the results: the map shows where it is.
  const [previewArea, setPreviewArea] = useState<number | null>(null);
  const [previewFly, setPreviewFly] = useState(0);
  const preview = useCallback((i: number | null, fly: boolean) => {
    setPreviewArea(i);
    if (fly && i !== null) setPreviewFly((n) => n + 1);
  }, []);
  // Inside a county: its areas in your top results; "Reveal full county" shows every
  // area (owner, 2026-10-04).
  const [insideAll, setInsideAll] = useState(false);

  const reset = (to: Preferences) => {
    setPrefs(to);
    setResetKey((k) => k + 1);
  };

  const select = (fips: string | null) => {
    setSelectedFips(fips);
    if (fips !== insideFips) {
      // Another county: leave the one being explored.
      setInsideFips(null);
      setSelectedArea(null);
    }
    if (!fips) return;
    if (view !== "place") {
      window.history.pushState({ nhfPlace: true }, "");
      setView("place");
    }
    if (wide) {
      if (!resultsOpen) setResultsOpen(true);
    } else {
      // Half-height sheet: the place view below, the county above it.
      setSheetSnap(SHEET_START);
    }
  };
  const backToList = () => {
    // Consume our history entry so Back/Forward stay in step with the view.
    if (isPlaceEntry(window.history.state)) window.history.back();
    else setView("list");
  };
  const selectFromList = (fips: string) => {
    select(fips);
    setFocus((f) => ({ fips, n: (f?.n ?? 0) + 1 }));
  };

  // A selected county in a state that was just turned off is simply unselected.
  const selected = selectedFips ? (scoresByFips.get(selectedFips) ?? null) : null;
  const showPlace = view === "place" && selected !== null;
  const insideOpen = showPlace && insideFips !== null && insideFips === selectedFips;
  const areasState = useCountyAreas(insideOpen ? insideFips : null);
  const placeInUrl = insideOpen && selectedArea ? selectedArea : showPlace ? selectedFips : null;

  const [hoverAreas, setHoverAreas] = useState<string[]>([]);
  const selectArea = (geoid: string | null) => {
    setHoverAreas([]);
    setSelectedArea(geoid);
    if (geoid) setAreaFocus((f) => ({ geoid, n: (f?.n ?? 0) + 1 }));
  };
  const leaveInside = () => {
    setHoverAreas([]);
    setInsideAll(false);
    setInsideFips(null);
    setSelectedArea(null);
  };

  // Inside a county, ranked by the same national scores as the results (Phase 8f):
  // its areas among your top results, best first — or, revealed, all of them.
  const areaRanking = useMemo<AreaRankingView | null>(() => {
    if (!insideOpen || areasState.status !== "ready" || !national || !nscores) return null;
    const fips = areasState.data.areas.county;
    const matches = countyMatches(national, nscores, fips, deferred.includeUnknown);
    const indexByGeoid = new Map<string, number>();
    for (let i = 0; i < national.n; i++) if (national.county[i] === fips) indexByGeoid.set(national.geoid[i], i);
    const inTop = new Set(topIdx);
    const topHere = matches.filter((i) => inTop.has(i));
    const matching = new Set(matches);
    // Not a match — but places that aren't residential aren't listed at all (results audit).
    const ruledOut = [...indexByGeoid.values()].filter((i) => !matching.has(i) && !notResidential(national, i));
    return {
      areas: national,
      scores: nscores,
      search: nationalSearch,
      county: scoresByFips.get(fips),
      matches,
      indexByGeoid,
      listed: insideAll ? matches : topHere,
      inTop: topHere.length,
      top: topIdx,
      cap: resultCap,
      revealed: insideAll,
      onReveal: setInsideAll,
      ruledOut,
      hiddenCount: areasState.data.areas.areas.length - matches.length,
    };
  }, [insideOpen, areasState, national, nscores, nationalSearch, scoresByFips, deferred.includeUnknown, topIdx, resultCap, insideAll]);

  const baseInsideLayer = useMemo<Omit<InsideLayer, "highlight"> | null>(() => {
    if (!insideOpen || areasState.status !== "ready") return null;
    const { areas, shapes } = areasState.data;
    const common = {
      fips: areas.county,
      shapes,
      labels: new Map(areas.areas.map((a) => [a.geoid, a.label])),
      selected: selectedArea,
      focus: areaFocus,
      onSelectArea: selectArea,
    };
    if (areaRanking) {
      // Drawn: the areas listed — your top results here, or all when revealed; the rest
      // stay blank, like counties outside the results (owner, 2026-10-04). Colored by rank
      // among those drawn, best deep green, as counties are. Revealed, the areas that
      // fail a must-have are grey (-1).
      const drawn = areaRanking.listed;
      const values = new Map<string, number | null>(areas.areas.map((a) => [a.geoid, null]));
      drawn.forEach((i, rank) =>
        values.set(areaRanking.areas.geoid[i], drawn.length > 1 ? 100 * (1 - rank / (drawn.length - 1)) : 100),
      );
      if (areaRanking.revealed) for (const i of areaRanking.ruledOut) values.set(areaRanking.areas.geoid[i], -1);
      return {
        ...common,
        palette: "score" as const,
        values,
        legend: { title: "Your match", low: "Weaker", high: "Stronger" },
      };
    }
    const vals = areas.areas
      .map((a) => [a.geoid, areaValue(a, areaMeasure)] as const)
      .filter((x): x is readonly [string, number] => x[1] !== null)
      .sort((a, b) => a[1] - b[1]);
    const values = new Map<string, number | null>(areas.areas.map((a) => [a.geoid, null]));
    vals.forEach(([g], i) => values.set(g, vals.length > 1 ? i / (vals.length - 1) : 0.5));
    return {
      ...common,
      palette: "measure" as const,
      values,
      legend: {
        title: AREA_MEASURE.get(areaMeasure)?.label ?? areaMeasure,
        low: formatArea(areaMeasure, vals[0]?.[1] ?? null),
        high: formatArea(areaMeasure, vals.at(-1)?.[1] ?? null),
      },
    };
  }, [insideOpen, areasState, areaRanking, selectedArea, areaFocus]);
  // Hovering the list outlines areas on the map. Kept apart so a hover doesn't
  // rebuild the colors above (the map recolors when `values` changes).
  const insideLayer = useMemo<InsideLayer | null>(
    () => (baseInsideLayer ? { ...baseInsideLayer, highlight: hoverAreas } : null),
    [baseInsideLayer, hoverAreas],
  );

  // Keep the address bar on the current search, so it can be copied or
  // bookmarked as is. Debounced: Safari throttles rapid replaceState calls.
  useEffect(() => {
    const t = setTimeout(() => {
      const url = `${window.location.pathname}?${encodeSearch(prefs, placeInUrl)}${window.location.hash}`;
      if (url !== window.location.pathname + window.location.search + window.location.hash) {
        window.history.replaceState(window.history.state, "", url);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [prefs, placeInUrl]);
  const shareUrl = () => `${window.location.origin}${window.location.pathname}?${encodeSearch(prefs, placeInUrl)}`;

  // Opening a saved or recent search (Filters → Saved) keeps the one it
  // replaces in Recent.
  const openSearch = (next: Preferences) => {
    addRecent(prefs);
    addRecent(next);
    reset(next);
  };

  // Escape leaves the place view (unless typing in a field).
  useEffect(() => {
    if (!showPlace) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Escape" || t?.closest("input, textarea, select, [role=menu], dialog")) return;
      // Escape closes an open "i" popover first.
      if (document.querySelector(":popover-open")) return;
      // Then steps back one level: area -> areas -> county -> list.
      if (insideOpen && selectedArea) setSelectedArea(null);
      else if (insideOpen) leaveInside();
      else backToList();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // From the results: open an area's page, or a county's.
  const openArea = (i: number) => {
    if (!national) return;
    const fips = national.county[i];
    // Not selectFromList: that zooms to the county, and this zooms to the area.
    select(fips);
    setInsideFips(fips);
    // An area outside your top results (a county's best, say) shows the full county.
    setInsideAll(!topIdx.includes(i));
    selectArea(national.geoid[i]);
  };
  const openCounty = (fips: string) => {
    selectFromList(fips);
  };

  // A county's page in area mode leads with its best areas (Phase 8f).
  const selectedMatches = useMemo(
    () => (national && nscores && selectedFips ? countyMatches(national, nscores, selectedFips, deferred.includeUnknown) : null),
    [national, nscores, selectedFips, deferred.includeUnknown],
  );
  const placeProps: PlaceProps | null = selected
    ? {
        score: selected,
        data: scoped,
        rank: mapRank.get(selected.fips) ?? null,
        total: areaMode ? countyResults.length : ranked.length,
        rel: mapRelative.get(selected.fips),
        laws,
        compareFips,
        onCompare: compareWith,
        onBack: backToList,
        ...(tractIndex[selected.fips]
          ? { onExploreInside: () => setInsideFips(selected.fips), areaCount: tractIndex[selected.fips].tracts }
          : {}),
        ...(areaMode
          ? { topAreas: { count: countyResults.find((c) => c.fips === selected.fips)?.areas.length ?? 0, cap: resultCap } }
          : {}),
        ...(areaMode && national && nscores && selectedMatches && tractIndex[selected.fips]
          ? {
              bestScore: selectedMatches[0] !== undefined ? nscores.score[selectedMatches[0]] : undefined,
              bestAreas: (
                <CountyBestAreas
                  areas={national}
                  scores={nscores}
                  search={nationalSearch}
                  county={selected}
                  matches={selectedMatches}
                  inTop={countyResults.find((c) => c.fips === selected.fips)?.areas.length ?? 0}
                  cap={resultCap}
                  countyLabel={scoped.countyName[selected.index]}
                  onOpenArea={openArea}
                  onSeeAll={() => {
                    setInsideAll(false);
                    setInsideFips(selected.fips);
                  }}
                />
              ),
            }
          : {}),
      }
    : null;

  const active = countActiveFilters(prefs);
  const activeTotal = active.priorities + active.musts;

  const filtersButton = (
    <button
      type="button"
      onClick={() => setFiltersOpen(true)}
      aria-haspopup="dialog"
      data-tour="filters"
      className="flex shrink-0 items-center gap-2 rounded-full border border-neutral-300 px-3.5 py-1.5 text-label font-medium hover:bg-neutral-100 @max-[8rem]:gap-1.5 @max-[8rem]:px-2.5 dark:border-neutral-700 dark:hover:bg-neutral-900"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 4h12M4 8h8M6 12h4" strokeLinecap="round" />
      </svg>
      {/* On a phone whose header can't fit it beside a centered logo: icon and count only. */}
      <span className="@max-[8rem]:sr-only">Filters</span>
      {activeTotal > 0 && (
        <span className="grid min-w-5 place-items-center rounded-full bg-emerald-600 px-1.5 text-caption font-semibold text-white">
          {activeTotal}
          <span className="sr-only"> active</span>
        </span>
      )}
    </button>
  );

  const filtersModal = (
    <FiltersModal
      open={filtersOpen}
      onClose={() => {
        setFiltersOpen(false);
        addRecent(prefs);
      }}
      prefs={prefs}
      onChange={setPrefs}
      onDefaults={() => reset(DEFAULT_PREFERENCES)}
      onClearAll={() => reset(EMPTY_PREFERENCES)}
      resetKey={resetKey}
      matchCount={areaMode ? matchingAreas : ranked.length}
      matchNoun={areaMode ? "area" : "county"}
      ranges={ranges}
      sources={lawSources}
      categoryCounts={categoryCounts}
      onOpenSearch={openSearch}
      getShareUrl={shareUrl}
      savedOpen={filtersSaved}
      onSavedOpen={setFiltersSaved}
    />
  );

  const resultsBadge = areaMode
    ? `(${topIdx.length.toLocaleString()} areas)`
    : counts.match
      ? `(${ranked.length.toLocaleString()})`
      : undefined;
  const areaResults = hasAreaFilters ? (
    <div className="px-3 py-3">
      {nationalState.status === "error" ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-label text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {nationalState.message}
        </p>
      ) : !national || !nscores ? (
        <p className="py-8 text-center text-label text-neutral-500" aria-live="polite">Ranking areas nationwide…</p>
      ) : (
        <>
          <ResultsHeader
            view={resultsView}
            onView={setViewChoice}
            cap={resultCap}
            onCap={setResultCap}
            areaCount={topIdx.length}
            countyCount={countyResults.length}
            ranked={!(topIdx.length && nscores && Number.isNaN(nscores.score[topIdx[0]]))}
          />
          {resultsView === "areas" ? (
            <AreaResultsList
              key={`${resetKey}-${topIdx[0] ?? "none"}`}
              top={topIdx}
              badges={badges}
              areas={national}
              scores={nscores}
              search={nationalSearch}
              countyScores={scoresByFips}
              countyName={countyName}
              onOpenArea={openArea}
              onPreview={preview}
            />
          ) : (
            <CountyResultsList
              key={`${resetKey}-${countyResults[0]?.fips ?? "none"}`}
              counties={countyResults}
              onOpenCounty={openCounty}
              areas={national}
              scores={nscores}
              search={nationalSearch}
              countyScores={scoresByFips}
              countyName={countyName}
              onOpenArea={openArea}
              onPreview={preview}
            />
          )}
        </>
      )}
    </div>
  ) : null;
  const resultsList = areaResults ?? (
    <div className="px-3 py-3" data-tour="first-result">
      <div className="mb-2 flex items-center gap-1 px-1">
        <p className="text-caption text-neutral-500 dark:text-neutral-400" aria-live="polite">
          {ranked.length.toLocaleString()} {ranked.length === 1 ? "county" : "counties"}
          {anyWeight && <> · top {Math.min(MAP_TOP_N, ranked.length)} colored on the map</>}
        </p>
        <InfoTip label="these results">
          {counts.match.toLocaleString()} match
          {counts.unknown > 0 && (
            <>, {counts.unknown.toLocaleString()} unknown{!prefs.includeUnknown && " (hidden — see Settings)"}</>
          )}
          {counts.excluded > 0 && <>, {counts.excluded.toLocaleString()} ruled out by must-haves</>}. The map colors the
          top {MAP_TOP_N} relative to each other: green is the best of them, red the weakest of them.
        </InfoTip>
      </div>
      {!anyWeight && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2.5 text-label text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Set at least one priority to rank counties and color the map.{" "}
          <button type="button" onClick={() => setFiltersOpen(true)} className="font-semibold underline underline-offset-2">
            Set priorities
          </button>
        </div>
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
  );
  /**
   * List and place each scroll on their own. The list stays mounted (just
   * hidden) while a place is open, so "← All results" lands where you were.
   */
  const resultsBody = (withIdentity: boolean) => (
    <div className="relative h-full">
      <div
        className={`absolute inset-0 overflow-y-auto overscroll-contain ${showPlace ? "invisible" : ""}`}
        inert={showPlace}
      >
        {resultsList}
      </div>
      {showPlace && placeProps && !insideOpen && (
        <div key={placeProps.score.fips} className="absolute inset-0 overflow-y-auto overscroll-contain">
          <PlaceView {...placeProps} withIdentity={withIdentity} />
        </div>
      )}
      {insideOpen && placeProps && (
        <div key={`inside-${placeProps.score.fips}-${selectedArea ?? ""}`} className="absolute inset-0 overflow-y-auto overscroll-contain">
          <InsideView
            countyName={`${scoped.countyName[placeProps.score.index]}, ${scoped.state[placeProps.score.index]}`}
            state={areasState}
            ranking={areaRanking}
            fallbackMeasure={areaMeasure}
            onEditFilters={() => setFiltersOpen(true)}
            selected={selectedArea}
            onSelect={selectArea}
            onHover={setHoverAreas}
            onBack={leaveInside}
            onBackToResults={() => {
              leaveInside();
              backToList();
            }}
          />
        </div>
      )}
    </div>
  );

  const map = (
    <CountyMap
      data={data}
      scoresByFips={scoresByFips}
      rankByFips={mapRank}
      relative={mapRelative}
      selectedFips={selectedFips}
      focus={focus}
      bottomInset={bottomInset}
      dark={theme === "dark"}
      inside={insideLayer}
      pin={
        areaMode && national && previewArea !== null && !showPlace
          ? { lat: national.lat[previewArea], lon: national.lon[previewArea], fly: previewFly }
          : null
      }
      byBestArea={areaMode}
      marks={insideOpen ? null : resultMarks}
      onOpenArea={(geoid) => {
        const i = national?.geoid.indexOf(geoid) ?? -1;
        if (i >= 0) openArea(i);
      }}
      onSelect={select}
    />
  );

  const settingsButton = (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      aria-haspopup="dialog"
      data-tour="settings"
      aria-label="Settings"
      title="Settings"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
    >
      {/* Material Icons "settings" (Google, Apache 2.0). */}
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
      </svg>
    </button>
  );

  // The first-run tour (plan Phase 9): once per device, after the first results are in.
  // "auto": opens by itself on a first visit, once results are ready.
  const [tour, setTour] = useState<"auto" | "open" | "closed">(() =>
    typeof window === "undefined" || tourSeen() ? "closed" : "auto",
  );
  const resultsReady = !hasAreaFilters || nscores !== null || nationalState.status === "error";
  const tourOpen = tour === "open" || (tour === "auto" && resultsReady);
  const closeTour = () => {
    markTourSeen();
    setTour("closed");
    setFiltersOpen(false);
    setFiltersSaved(false);
    if (!wide) setSheetSnap(SHEET_START);
  };
  const startTour = () => {
    setSettingsOpen(false);
    if (showPlace) {
      leaveInside();
      backToList();
    }
    setTour("open");
  };
  // Phones: raise the results sheet to the step's height; wide: keep the panel open.
  const showSheet = (snap: number) => () => {
    setFiltersOpen(false);
    setFiltersSaved(false);
    if (wide) setResultsOpen(true);
    else setSheetSnap(snap);
  };
  const showFilters = (saved: boolean) => () => {
    setFiltersSaved(saved);
    setFiltersOpen(true);
  };
  const tourSteps: TourStep[] = [
    {
      title: "Welcome to Lodestar",
      body: "Find the US neighborhoods that fit what matters to you. Here’s a one-minute look around.",
      prepare: () => {
        setFiltersOpen(false);
        setFiltersSaved(false);
      },
    },
    {
      target: "filter-modes",
      title: "Tell it what matters",
      body: (
        <>
          <b>Priorities</b> rank places: give each an importance from 1 to 5. <b>Must-haves</b> rule places out — a price
          cap, certain states, a climate.
        </>
      ),
      prepare: showFilters(false),
    },
    {
      target: "first-result",
      title: "Your best matches",
      body: areaMode
        ? "The best areas nationwide for your search, best first. #1 is open: each bar is one of your priorities, red to deep green — gold means top 1% in the US."
        : "Counties ranked by your search, best first. Add a priority tagged “by area” (schools, safety, walkability…) to rank neighborhoods instead.",
      prepare: showSheet(2),
    },
    {
      target: "result-name",
      optional: true,
      title: "Open one for the full story",
      body: "Tap a name to see why it ranks where it does, then its schools, safety, prices and hazards.",
      prepare: showSheet(2),
    },
    {
      target: "map",
      title: "See where they are",
      body: "Zoomed out, bubbles count your results by state, then by county; zoom in to see the areas themselves. Tap one to open it.",
      prepare: showSheet(0),
    },
    {
      target: "view-toggle",
      optional: true,
      title: "Areas or counties",
      body: "Prefer to think in counties? Switch here — counties rank by their best area.",
      prepare: showSheet(2),
    },
    {
      target: "save-share",
      title: "Save and share",
      body: "Name and save a search to come back to it, or share it by email, text or link.",
      prepare: showFilters(true),
    },
    {
      target: "settings",
      title: "That’s all!",
      body: "You can replay this tour any time from Settings.",
      final: "Point the way",
      prepare: showSheet(1),
    },
  ];

  const modals = (
    <>
      {filtersModal}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={prefs}
        onChange={setPrefs}
        unknownCount={counts.unknown}
        laws={laws}
        onShowTour={startTour}
      />
      {tourOpen && <Tour steps={tourSteps} onClose={closeTour} />}
    </>
  );

  if (!wide) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Three columns, so the logo sits in the true middle whatever the sides hold. */}
        <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <div className="@container flex min-w-0 justify-start">{filtersButton}</div>
          <h1 className="flex justify-center">
            <LodestarLogo size="sm" />
          </h1>
          <div className="flex justify-end">{settingsButton}</div>
        </div>

        <div ref={area} className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute inset-0" data-tour="map">
            {map}
          </div>

          <BottomSheet
            id="results-panel"
            label="Results"
            snap={sheetSnap}
            onSnap={setSheetSnap}
            areaHeight={areaHeight}
            header={
              showPlace && placeProps ? (
                // At 25% the sheet still says which county this is.
                <div className="px-4 pb-2">
                  <PlaceIdentity {...placeProps} />
                </div>
              ) : (
                <div className="flex items-baseline gap-1.5 px-4 pb-2">
                  <h2 className="text-title font-semibold">Results</h2>
                  {resultsBadge && <span className="text-label text-neutral-500">{resultsBadge}</span>}
                </div>
              )
            }
          >
            {resultsBody(false)}
          </BottomSheet>
        </div>
        {modals}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <h1>
          <LodestarLogo />
        </h1>
        {filtersButton}
        <div className="ml-auto flex items-center gap-2">
          {settingsButton}
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <SidePanel
          id="results-panel"
          title="Results"
          badge={resultsBadge}
          open={resultsOpen}
          onToggle={() => setResultsOpen((o) => !o)}
          widthClass="md:w-[27.5rem]"
        >
          {resultsBody(true)}
        </SidePanel>
        <div className="relative min-w-0 flex-1" data-tour="map">
          {map}
        </div>
      </div>
      {modals}
    </div>
  );
}
