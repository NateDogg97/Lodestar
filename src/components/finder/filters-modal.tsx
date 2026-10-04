"use client";

import { useRef, useState, type ReactNode } from "react";

import { formatDay, type LawSourceSummary } from "@/lib/laws";
import {
  CATEGORIES,
  CLIMATE_FAMILIES,
  DIRECTIONS,
  formatValue,
  MAX_WEIGHT,
  METRICS,
  NOT_IN_FILTERS,
  type CategoryDef,
  type CategoryKey,
  type Direction,
  type MetricKey,
} from "@/lib/scoring";

import { AREA_PRIORITIES, COUNTY_METRICS_NOW_AREA, type AreaGroup } from "@/lib/tracts";

import { InfoTip } from "@/components/ui/info-tip";
import { Modal } from "@/components/ui/modal";

import { Icon } from "@/components/ui/icons";

import { ClimateIcon } from "./climate-icons";
import { SavedSearches } from "./saved-searches";
import type { Preferences } from "./preferences";

/**
 * The two halves of a search (plan §9 Phase 7a): Priorities rank places
 * (importance and direction per metric); Must-haves rule them out
 * (min/max limits, policies, climate types).
 *
 * Each measure has one level (plan §9 Phase 8f): county-wide (climate, taxes,
 * cost of living…) or by area (home value, schools, safety, walkability…).
 * Both sit in the same topic sections, tagged.
 */
export type FiltersMode = "priorities" | "musts";

type SectionId = AreaGroup | "states" | "policies";

const SECTIONS: { id: SectionId; label: string; mustsOnly?: boolean }[] = [
  { id: "states", label: "States", mustsOnly: true },
  // Cost of living, housing and taxes are one section (owner, 2026-10-04: fewer filters,
  // grouped): what it costs to live here.
  { id: "housing", label: "Housing, costs & taxes" },
  { id: "schools", label: "Schools" },
  { id: "safety", label: "Safety" },
  { id: "climate", label: "Climate" },
  { id: "hazards", label: "Natural hazards" },
  { id: "location", label: "Location" },
  { id: "people", label: "People & income" },
  { id: "policies", label: "Policies", mustsOnly: true },
];

const SECTION_TIPS: Partial<Record<SectionId, string>> = {
  hazards:
    "FEMA National Risk Index (Dec 2025): where an area ranks nationally on the share of its buildings, people and farms expected to be lost to each hazard in a typical year.",
  safety: "FBI crime rates for the police agency covering each area.",
  states:
    "Rule out states, or keep only a few: tap a state to turn it off, or “None” and then pick the ones you want. Scores still compare places with the whole country. Alaska and Hawaii are turned on in Settings.",
  policies:
    "Policies are never weighted — a county whose state isn’t one you allow is ruled out. States with no value (their sources disagree) are kept as unknown.",
};

const MODE_TIPS: Record<FiltersMode, string> = {
  priorities:
    "Importance sets how much each measure counts toward a place’s score; Off leaves it out. “Better” sets which end scores well — Average favors the typical place, and both extremes score worst. Measures tagged “by area” compare each area with every US area; county-wide ones count the same for every area in a county. With any “by area” priority set, results are areas.",
  musts:
    "Limits and policies rule places out entirely: county-wide ones whole counties, “by area” ones single areas. A place with no data for one of them is kept as unknown (grey) rather than guessed.",
};

/** The "i" beside a county-wide measure, where its name doesn't say enough. */
const COUNTY_NOTES: Partial<Record<MetricKey, string>> = {
  population:
    "How many people live in the whole county: a rough sense of how much there is nearby — shops, jobs, hospitals. Neighborhood density, beside it, is how crowded the area itself feels.",
  rpp_all:
    "One index of local prices — rent, goods, utilities (electricity included) and services — where 100 is the US average (BEA Regional Price Parities). For the price of a home or rent in a specific area, use Housing.",
  unemployment_rate: "Share of the county's labor force looking for work (BLS, latest yearly average).",
};

const DIRECTION_LABELS: Record<Direction, string> = {
  lower: "Lower",
  middle: "Average",
  higher: "Higher",
};

const hasLimit = (l: { min?: number; max?: number } | undefined) => l?.min !== undefined || l?.max !== undefined;

function sectionCategories(id: SectionId): (typeof CATEGORIES)[number][] {
  if (id === "policies") return CATEGORIES.filter((c) => c.scope === "state");
  if (id === "climate") return CATEGORIES.filter((c) => c.key === "koppen");
  if (id === "states") return CATEGORIES.filter((c) => c.key === "state");
  return [];
}

/** How many filters in a section are doing something, in one mode. */
function sectionCount(prefs: Preferences, mode: FiltersMode, id: SectionId): number {
  const metrics = countyMetrics(id);
  const areas = areaMeasures(id);
  if (mode === "priorities") {
    return (
      metrics.filter((m) => (prefs.weights[m.key] ?? 0) > 0).length +
      areas.filter((d) => (prefs.area.weights[d.key] ?? 0) > 0).length
    );
  }
  return (
    metrics.filter((m) => hasLimit(prefs.limits[m.key])).length +
    areas.filter((d) => hasLimit(prefs.area.limits[d.key])).length +
    sectionCategories(id).filter((c) => prefs.categories[c.key] !== undefined).length
  );
}

/** The measure groups a section holds, in the order they're shown. */
const SECTION_GROUPS: Partial<Record<SectionId, readonly AreaGroup[]>> = { housing: ["cost", "housing", "taxes"] };
const groupsOf = (id: SectionId): readonly string[] => SECTION_GROUPS[id] ?? [id];

/** A section's county-wide measures: not the ones that are by area now, nor the ones that aren't filters. */
const countyMetrics = (id: SectionId) => {
  const groups = groupsOf(id);
  return METRICS.filter((m) => groups.includes(m.group) && !COUNTY_METRICS_NOW_AREA.has(m.key) && !NOT_IN_FILTERS.has(m.key)).sort(
    (a, b) => groups.indexOf(a.group) - groups.indexOf(b.group),
  );
};
const areaMeasures = (id: SectionId) => AREA_PRIORITIES.filter((d) => groupsOf(id).includes(d.group));

/** Active filters per mode — for the Filters button badge and the mode switch. */
export function countActiveFilters(prefs: Preferences): Record<FiltersMode, number> {
  const out = { priorities: 0, musts: 0 };
  for (const s of SECTIONS) {
    out.priorities += sectionCount(prefs, "priorities", s.id);
    out.musts += sectionCount(prefs, "musts", s.id);
  }
  return out;
}

export interface MetricRange {
  min: number;
  max: number;
  /** The typical (median) county — the target when "Average" is chosen. */
  median: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  prefs: Preferences;
  onChange: (next: Preferences) => void;
  onDefaults: () => void;
  onClearAll: () => void;
  /** Bumped on reset so uncontrolled limit inputs remount with the new values. */
  resetKey: number;
  /** Places the current search would list (live): counties, or areas when results are areas. */
  matchCount: number;
  matchNoun: "county" | "area";
  /** National min/max/median per metric: limit placeholders and the "Average" target. */
  ranges: Partial<Record<MetricKey, MetricRange>>;
  /** Source and dates for each state-level metric and policy, keyed like the law table. */
  sources: Record<string, LawSourceSummary>;
  /** Per category: how many states (policies) or counties (climate type) have each value. */
  categoryCounts: Partial<Record<CategoryKey, Record<string, number>>>;
  /** Open a saved or recent search from the Saved tab. */
  onOpenSearch: (prefs: Preferences) => void;
  /** This search's link, for Share on the Saved tab. */
  getShareUrl: () => string;
  /** The Saved page instead of the filters (held by the parent, so the tour can open it). */
  savedOpen: boolean;
  onSavedOpen: (open: boolean) => void;
}

export function FiltersModal({
  open,
  onClose,
  prefs,
  onChange,
  onDefaults,
  onClearAll,
  resetKey,
  matchCount,
  matchNoun,
  ranges,
  sources,
  categoryCounts,
  onOpenSearch,
  getShareUrl,
  savedOpen,
  onSavedOpen: setSavedOpen,
}: Props) {
  const [mode, setMode] = useState<FiltersMode>("priorities");
  // The Saved button swaps the body for saved and recent searches; the tabs,
  // or the button again, bring the filters back.
  const [section, setSection] = useState<SectionId>("housing");
  const pane = useRef<HTMLDivElement>(null);
  const active = countActiveFilters(prefs);

  const sections = SECTIONS.filter((s) => mode === "musts" || !s.mustsOnly);
  const current = sections.some((s) => s.id === section) ? section : sections[0].id;
  const currentDef = SECTIONS.find((s) => s.id === current)!;
  const go = (id: SectionId) => {
    setSection(id);
    pane.current?.scrollTo({ top: 0 });
  };

  const setCategory = (key: CategoryKey, accept: string[] | undefined) => {
    const categories = { ...prefs.categories };
    if (accept === undefined) delete categories[key];
    else categories[key] = accept;
    onChange({ ...prefs, categories });
  };

  const metrics = countyMetrics(current);
  const areas = areaMeasures(current);
  // Climate type gets its own picker (family cards) above the limits.
  // Climate type and states get their own pickers.
  const categories =
    mode === "musts" ? sectionCategories(current).filter((c) => c.key !== "koppen" && c.key !== "state") : [];
  const showClimatePicker = mode === "musts" && current === "climate";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <>
          <button type="button" onClick={onDefaults} className="text-label text-neutral-600 hover:underline dark:text-neutral-400">
            Defaults
          </button>
          <button type="button" onClick={onClearAll} className="text-label text-neutral-600 hover:underline dark:text-neutral-400">
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-full bg-neutral-900 px-5 py-2.5 text-label font-semibold text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            <span aria-live="polite">
              {matchCount === 0
                ? `No ${matchNoun === "area" ? "areas" : "counties"} match`
                : `Show ${matchCount.toLocaleString()} ${
                    matchNoun === "area" ? (matchCount === 1 ? "area" : "areas") : matchCount === 1 ? "county" : "counties"
                  }`}
            </span>
          </button>
        </>
      }
    >
      <div data-tour="filter-modes" className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-gutter py-3 md:px-6 dark:border-neutral-800">
        <div role="tablist" aria-label="Filter type" className="grid flex-1 grid-cols-2 rounded-full bg-neutral-100 p-1 md:max-w-sm md:flex-none dark:bg-neutral-900">
          {(["priorities", "musts"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m && !savedOpen}
              onClick={() => {
                setMode(m);
                setSavedOpen(false);
              }}
              className={`rounded-full px-2.5 py-1.5 text-label font-medium whitespace-nowrap sm:px-3 ${
                mode === m && !savedOpen
                  ? "bg-white shadow-sm dark:bg-neutral-700"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              }`}
            >
              {m === "priorities" ? "Priorities" : "Must-haves"}
              {active[m] > 0 && <Badge n={active[m]} />}
            </button>
          ))}
        </div>
        {/* Always there, on Saved too, so the bar doesn't shift. */}
        <InfoTip label={mode === "priorities" ? "priorities" : "must-haves"}>{MODE_TIPS[mode]}</InfoTip>
        <button
          type="button"
          onClick={() => setSavedOpen(!savedOpen)}
          aria-pressed={savedOpen}
          title="Saved and recent searches"
          className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1.5 text-label font-medium sm:px-3 ${
            savedOpen
              ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
              : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          }`}
        >
          <Icon name="bookmarks" className="h-5 w-5" />
          {/* Icon only on phones, where the tabs need the width. */}
          <span className="max-sm:sr-only">Saved</span>
        </button>
      </div>

      {savedOpen ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SavedSearches
            prefs={prefs}
            getShareUrl={getShareUrl}
            onOpen={(p) => {
              onOpenSearch(p);
              // Back to the filters, showing what was just opened.
              setSavedOpen(false);
              setMode("priorities");
            }}
          />
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Categories"
          className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-neutral-200 px-gutter py-2 md:w-56 md:flex-col md:gap-0.5 md:overflow-y-auto md:border-r md:border-b-0 md:px-3 md:py-4 dark:border-neutral-800"
        >
          {sections.map((s) => {
            const n = sectionCount(prefs, mode, s.id);
            const on = s.id === current;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => go(s.id)}
                aria-current={on ? "true" : undefined}
                className={`flex shrink-0 items-center justify-between gap-2 rounded-full px-3 py-1.5 text-label whitespace-nowrap md:rounded-lg md:py-2 ${
                  on
                    ? "bg-neutral-900 font-medium text-white md:bg-neutral-100 md:text-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 md:dark:bg-neutral-800 md:dark:text-neutral-100"
                    : "text-neutral-700 hover:bg-neutral-50 max-md:border max-md:border-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-900 max-md:dark:border-neutral-800"
                }`}
              >
                {s.label}
                {n > 0 && <Badge n={n} />}
              </button>
            );
          })}
        </nav>

        <div ref={pane} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter py-5 md:px-6">
          <div className="mb-4 flex items-center gap-1.5">
            <h3 className="text-title font-semibold">{currentDef.label}</h3>
            {SECTION_TIPS[current] && <InfoTip label={currentDef.label}>{SECTION_TIPS[current]}</InfoTip>}
          </div>
          {mode === "musts" && current === "states" && (
            <StatePicker
              accept={prefs.categories.state}
              counts={categoryCounts.state ?? {}}
              onChange={(accept) => setCategory("state", accept)}
            />
          )}
          {showClimatePicker && (
            <ClimatePicker
              accept={prefs.categories.koppen}
              counts={categoryCounts.koppen ?? {}}
              onChange={(accept) => setCategory("koppen", accept)}
            />
          )}
          {showClimatePicker && <h4 className="mt-6 mb-3 text-label font-semibold">Limits</h4>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
            {areas.map((d) =>
              mode === "priorities" ? (
                <PriorityCard
                  key={d.key}
                  id={`area-${d.key}`}
                  label={d.label}
                  level="area"
                  note={d.note}
                  weight={prefs.area.weights[d.key] ?? 0}
                  direction={prefs.area.directions[d.key] ?? d.defaultDirection}
                  typical="Aiming for the typical US area"
                  onWeight={(w) => onChange({ ...prefs, area: { ...prefs.area, weights: { ...prefs.area.weights, [d.key]: w } } })}
                  onDirection={(dir) =>
                    onChange({ ...prefs, area: { ...prefs.area, directions: { ...prefs.area.directions, [d.key]: dir } } })
                  }
                />
              ) : (
                <LimitCard
                  key={`area-${d.key}-${resetKey}`}
                  id={`area-${d.key}`}
                  label={d.label}
                  level="area"
                  note={d.note}
                  unit={d.unit}
                  limit={prefs.area.limits[d.key]}
                  onLimit={(bound, v) =>
                    onChange({
                      ...prefs,
                      area: { ...prefs.area, limits: { ...prefs.area.limits, [d.key]: { ...prefs.area.limits[d.key], [bound]: v } } },
                    })
                  }
                />
              ),
            )}
            {metrics.map((m) =>
              mode === "priorities" ? (
                <PriorityCard
                  key={m.key}
                  id={m.key}
                  label={m.label}
                  level="county"
                  note={COUNTY_NOTES[m.key]}
                  weight={prefs.weights[m.key] ?? 0}
                  direction={prefs.directions[m.key] ?? m.defaultDirection}
                  typical={ranges[m.key] ? `Aiming for the typical county: ${formatValue(m.key, ranges[m.key]!.median)}` : undefined}
                  source={sources[m.key]}
                  onWeight={(w) => onChange({ ...prefs, weights: { ...prefs.weights, [m.key]: w } })}
                  onDirection={(d) => onChange({ ...prefs, directions: { ...prefs.directions, [m.key]: d } })}
                />
              ) : (
                <LimitCard
                  key={`${m.key}-${resetKey}`}
                  id={m.key}
                  label={m.label}
                  level="county"
                  note={COUNTY_NOTES[m.key]}
                  unit={m.unit}
                  limit={prefs.limits[m.key]}
                  placeholders={ranges[m.key] ? [plainNumber(ranges[m.key]!.min), plainNumber(ranges[m.key]!.max)] : undefined}
                  source={sources[m.key]}
                  onLimit={(bound, v) =>
                    onChange({ ...prefs, limits: { ...prefs.limits, [m.key]: { ...prefs.limits[m.key], [bound]: v } } })
                  }
                />
              ),
            )}
            {categories.map((def) => (
              <CategoryCard
                key={def.key}
                def={def}
                accept={prefs.categories[def.key]}
                counts={categoryCounts[def.key] ?? {}}
                source={sources[def.key]}
                onChange={(accept) => setCategory(def.key, accept)}
              />
            ))}
          </div>
        </div>
      </div>
      )}
    </Modal>
  );
}

/**
 * States as a grid of toggles (2026-10-04): all on by default; tap to rule one out,
 * or "None" then pick a few to keep only those. Only states in scope are shown
 * (Alaska and Hawaii when turned on in Settings).
 */
function StatePicker({
  accept,
  counts,
  onChange,
}: {
  accept: string[] | undefined;
  counts: Record<string, number>;
  onChange: (accept: string[] | undefined) => void;
}) {
  const def = CATEGORIES.find((c) => c.key === "state")!;
  const visible = def.options.filter((o) => (counts[o.value] ?? 0) > 0);
  const all = visible.map((o) => o.value);
  const on = (v: string) => accept === undefined || accept.includes(v);
  const allowed = all.filter(on).length;
  const set = (next: string[]) => onChange(all.every((v) => next.includes(v)) ? undefined : all.filter((v) => next.includes(v)));
  const toggle = (v: string) => {
    const current = all.filter(on);
    set(on(v) ? current.filter((x) => x !== v) : [...current, v]);
  };
  const quick = "rounded-full border border-neutral-300 px-3 py-1 text-label font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-label text-neutral-600 dark:text-neutral-400" aria-live="polite">
          {allowed === all.length ? "All states" : allowed === 0 ? "No states — pick some" : `${allowed} of ${all.length} states`}
        </span>
        <button type="button" onClick={() => onChange(undefined)} className={quick}>
          All
        </button>
        <button type="button" onClick={() => onChange([])} className={quick}>
          None
        </button>
      </div>
      <div role="group" aria-label="States" className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-1.5">
        {visible.map((o) => {
          const pressed = on(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => toggle(o.value)}
              title={`${o.label}: ${counts[o.value]} counties`}
              className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-label ${
                pressed
                  ? "border-emerald-600/50 bg-emerald-50 text-neutral-900 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-neutral-100"
                  : "border-neutral-200 text-neutral-400 line-through dark:border-neutral-800 dark:text-neutral-600"
              }`}
            >
              <span className="truncate">{o.label}</span>
              <span className="text-caption tabular-nums opacity-70">{o.value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Climate type as plain-language family cards (decided 2026-09-30) instead
 * of 21 Köppen checkboxes. Every card starts on; tapping one rules that kind
 * of climate out. Underneath it is still the Köppen filter: a card toggles
 * all its codes that some county has. A card with only some of its codes
 * allowed (a search saved before the cards) shows as partly on; a tap turns
 * it fully on.
 */
function ClimatePicker({
  accept,
  counts,
  onChange,
}: {
  accept: string[] | undefined;
  counts: Record<string, number>;
  onChange: (accept: string[] | undefined) => void;
}) {
  const present = Object.keys(counts).filter((c) => (counts[c] ?? 0) > 0);
  const allowed = new Set(accept ?? present);
  const families = CLIMATE_FAMILIES.map((f) => {
    const codes = f.codes.filter((c) => present.includes(c));
    const on = codes.filter((c) => allowed.has(c)).length;
    return {
      ...f,
      codes,
      state: on === codes.length ? "on" : on === 0 ? "off" : "partly",
      count: codes.reduce((n, c) => n + (counts[c] ?? 0), 0),
    } as const;
  }).filter((f) => f.codes.length > 0);

  const toggle = (f: (typeof families)[number]) => {
    const next = new Set(allowed);
    for (const c of f.codes) {
      if (f.state === "on") next.delete(c);
      else next.add(c);
    }
    // Everything allowed again is the same as no filter.
    onChange(present.every((c) => next.has(c)) ? undefined : present.filter((c) => next.has(c)));
  };

  return (
    <section aria-labelledby="climate-picker">
      <div className="mb-1 flex items-center gap-1.5">
        <h4 id="climate-picker" className="text-label font-semibold">
          Climates you&rsquo;d live in
        </h4>
        <InfoTip label="climate types">
          Grouped from each county&rsquo;s{" "}
          <a
            href="https://en.wikipedia.org/wiki/K%C3%B6ppen_climate_classification"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Köppen–Geiger
          </a>{" "}
          type (codes on each card), computed from its 1991–2020 NOAA normals. A county near a boundary between types
          may differ from published maps. For finer control, use the limits below or the climate priorities.
        </InfoTip>
        {accept !== undefined && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="ml-auto text-label text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Allow all
          </button>
        )}
      </div>
      <p className="mb-3 text-caption text-neutral-500 dark:text-neutral-400">Tap a climate to rule it out.</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
        {families.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={f.state !== "off"}
            onClick={() => toggle(f)}
            className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
              f.state === "off"
                ? "border-dashed border-neutral-300 opacity-60 hover:opacity-80 dark:border-neutral-700"
                : "border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
            }`}
          >
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                f.state === "off"
                  ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-900"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              }`}
            >
              <ClimateIcon family={f.id} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className={`text-label font-semibold ${f.state === "off" ? "line-through" : ""}`}>{f.name}</span>
                <span
                  className="text-caption tabular-nums text-neutral-400"
                  title={`Counties with ${f.name.toLowerCase()} climates`}
                >
                  {f.count.toLocaleString()}
                </span>
              </span>
              <span className="block text-caption text-neutral-600 dark:text-neutral-400">{f.description}</span>
              <span className="mt-1 block text-caption text-neutral-500 dark:text-neutral-500">
                {f.state === "off" ? (
                  <span className="font-medium text-rose-700 dark:text-rose-400">Ruled out</span>
                ) : f.state === "partly" ? (
                  <span className="font-medium text-amber-700 dark:text-amber-400">Some types ruled out · tap to allow all</span>
                ) : (
                  <>Like {f.examples.slice(0, 3).join(" · ")}</>
                )}
              </span>
              <span className="mt-0.5 block text-caption text-neutral-400 dark:text-neutral-600">{f.codes.join(" · ")}</span>
            </span>
          </button>
        ))}
      </div>
      {families.every((f) => f.state === "off") && (
        <p className="mt-2 text-caption text-rose-700 dark:text-rose-400">Every climate is ruled out — no county can match.</p>
      )}
    </section>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="ml-1.5 inline-grid min-w-5 place-items-center rounded-full bg-emerald-600 px-1.5 text-caption font-semibold text-white">
      {n}
    </span>
  );
}

function Card({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        active
          ? "border-emerald-600/40 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-950/30"
          : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      {children}
    </div>
  );
}

type Level = "area" | "county";

function CardTitle({
  id,
  label,
  level,
  source,
  note,
}: {
  id?: string;
  label: string;
  level?: Level;
  source?: LawSourceSummary;
  note?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span id={id} className="text-label font-semibold">
        {label}
      </span>
      {note && <InfoTip label={label}>{note}</InfoTip>}
      {source && (
        <InfoTip label={`${label} source`}>
          <SourceNote source={source} />
        </InfoTip>
      )}
      {level && (
        <span
          className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-caption ${
            level === "area"
              ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
              : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
          }`}
        >
          {level === "area" ? "By area" : "County-wide"}
        </span>
      )}
    </div>
  );
}

/** "Tax Foundation, as of Apr 28, 2026 · checked Sep 27, 2026" */
function SourceNote({ source }: { source: LawSourceSummary }) {
  return (
    <>
      Source:{" "}
      <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        {source.sourceName}
      </a>
      , as of {formatDay(source.sourceDate)}. Checked {formatDay(source.checked)}.
    </>
  );
}

/** A row of equal buttons; one is pressed. Taps only — nothing drags. */
function Segmented<T extends string | number>({
  labelledBy,
  options,
  value,
  onChange,
  pressedClass,
}: {
  labelledBy: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  pressedClass: (v: T) => string;
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="grid overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`min-h-10 border-l border-neutral-300 px-1 py-1 text-label leading-tight first:border-l-0 dark:border-neutral-700 ${
            value === o.value
              ? pressedClass(o.value)
              : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const IMPORTANCE = Array.from({ length: MAX_WEIGHT + 1 }, (_, w) => ({
  value: w,
  label: w === 0 ? "Off" : String(w),
  title: w === 0 ? "Not part of the score" : `Importance ${w} of ${MAX_WEIGHT}`,
}));

function PriorityCard({
  id,
  label,
  level,
  note,
  weight,
  direction,
  typical,
  source,
  onWeight,
  onDirection,
}: {
  id: string;
  label: string;
  level?: Level;
  /** For the "i" beside the title (area-only measures). */
  note?: string;
  weight: number;
  direction: Direction;
  /** Shown when "Average" is chosen: what that aims for. */
  typical?: string;
  source?: LawSourceSummary;
  onWeight: (w: number) => void;
  onDirection: (d: Direction) => void;
}) {
  const titleId = `prio-${id}`;
  return (
    <Card active={weight > 0}>
      <CardTitle id={titleId} label={label} level={level} source={source} note={note} />
      <p id={`${titleId}-imp`} className="mt-3 mb-1.5 text-caption text-neutral-500 dark:text-neutral-400">
        Importance
      </p>
      <Segmented
        labelledBy={`${titleId} ${titleId}-imp`}
        options={IMPORTANCE}
        value={weight}
        onChange={onWeight}
        pressedClass={(w) =>
          w === 0
            ? "bg-neutral-800 font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900"
            : "bg-emerald-600 font-semibold text-white"
        }
      />
      {weight > 0 && (
        <>
          <p id={`${titleId}-dir`} className="mt-3 mb-1.5 text-caption text-neutral-500 dark:text-neutral-400">
            Better
          </p>
          <Segmented
            labelledBy={`${titleId} ${titleId}-dir`}
            options={DIRECTIONS.map((d) => ({
              value: d,
              label: DIRECTION_LABELS[d],
              title:
                d === "middle"
                  ? "Closest to the typical (median) county scores best; both extremes score worst"
                  : `${DIRECTION_LABELS[d]} values score better`,
            }))}
            value={direction}
            onChange={onDirection}
            pressedClass={() => "bg-neutral-800 font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900"}
          />
          {direction === "middle" && typical && (
            <p className="mt-2 text-caption text-neutral-500 dark:text-neutral-400">{typical}</p>
          )}
        </>
      )}
    </Card>
  );
}

function LimitCard({
  id,
  label,
  level,
  note,
  unit,
  limit,
  placeholders,
  source,
  onLimit,
}: {
  id: string;
  label: string;
  level?: Level;
  note?: string;
  unit: string;
  limit: { min?: number; max?: number } | undefined;
  /** [min, max] hints: the national range, in the units you type. */
  placeholders?: [string, string];
  source?: LawSourceSummary;
  onLimit: (bound: "min" | "max", v: number | undefined) => void;
}) {
  return (
    <Card active={hasLimit(limit)}>
      <CardTitle label={label} level={level} source={source} note={note} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <LimitField
          label="Min"
          id={id}
          unit={unit}
          value={limit?.min}
          placeholder={placeholders?.[0]}
          onChange={(v) => onLimit("min", v)}
        />
        <LimitField
          label="Max"
          id={id}
          unit={unit}
          value={limit?.max}
          placeholder={placeholders?.[1]}
          onChange={(v) => onLimit("max", v)}
        />
      </div>
    </Card>
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
  id: fieldOf,
  unit,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  id: string;
  unit: string;
  value: number | undefined;
  placeholder: string | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const id = `limit-${fieldOf}-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-caption text-neutral-500 dark:text-neutral-400">
        {label} <span className="text-neutral-400 dark:text-neutral-500">({unit})</span>
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
        // 16px on phones so iOS doesn't zoom into the field.
        className="h-10 w-full rounded-lg border border-neutral-300 bg-transparent px-3 text-body tabular-nums placeholder:text-neutral-400 md:text-label dark:border-neutral-700"
      />
    </div>
  );
}

/**
 * A category filter. `accept` undefined = don't care.
 * - multi: checkboxes, all ticked by default; untick what you'd rule out.
 * - boolean: Any / require yes / require no.
 */
function CategoryCard({
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
  // A county-level type no county has (e.g. ice cap) isn't worth a checkbox,
  // and isn't part of the filter: "all" means all the types that exist.
  const visible = def.options.filter((o) => def.scope === "state" || (counts[o.value] ?? 0) > 0);
  const all = visible.map((o) => o.value);
  const groupId = `category-${def.key}`;

  return (
    <Card active={accept !== undefined}>
      <CardTitle id={groupId} label={def.label} source={source} />
      <div className="mt-3">
        {def.control === "boolean" ? (
          <Segmented
            labelledBy={groupId}
            options={[
              { value: "", label: "Any" },
              ...def.options.map((o) => ({ value: o.value, label: o.short ?? o.label })),
            ]}
            value={accept?.[0] ?? ""}
            onChange={(v) => onChange(v === "" ? undefined : [v])}
            pressedClass={() => "bg-neutral-800 font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900"}
          />
        ) : (
          <div role="group" aria-labelledby={groupId} className="space-y-0.5">
            {visible.map((o) => {
              const checked = accept === undefined || accept.includes(o.value);
              return (
                <label
                  key={o.value}
                  className="-mx-2 flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 text-label hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const current = (accept ?? all).filter((v) => all.includes(v));
                      const next = e.target.checked ? [...current, o.value] : current.filter((v) => v !== o.value);
                      // Everything allowed again is the same as no filter.
                      onChange(all.every((v) => next.includes(v)) ? undefined : all.filter((v) => next.includes(v)));
                    }}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span className="flex-1">{o.label}</span>
                  <span
                    className="text-caption tabular-nums text-neutral-400"
                    title={def.scope === "state" ? "States (and DC) with this value" : "Counties with this climate type"}
                  >
                    {counts[o.value] ?? 0}
                  </span>
                </label>
              );
            })}
            {accept?.length === 0 && (
              <p className="pt-1 text-caption text-rose-700 dark:text-rose-400">Nothing allowed — every county is ruled out.</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
