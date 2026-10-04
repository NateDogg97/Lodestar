"use client";

import { useMemo, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/info-tip";
import {
  AREA_MEASURE,
  areaPriority,
  areaValue,
  flagLabel,
  formatArea,
  formatAreaValue,
  groupAreas,
  headlineFlags,
  areaLimitResults,
  explainArea,
  tradeOff,
  type Area,
  type AreaLimit,
  type AreaPart,
  type CountyAreas,
  type NationalAreas,
  type NationalScores,
  type NationalSearch,
  type School,
} from "@/lib/tracts";
import { ordinal } from "@/lib/scoring/format";

import { formatValue, getMetric, type CountyScore, type MetricKey } from "@/lib/scoring";

import { Fingerprint } from "./area-results";
import { barColor, isGold, scoreColor } from "./score-colors";
import type { CountyAreasState } from "./use-tract-data";

/** A county's areas ranked by the search (plan §9 Phase 8f), as county-finder computes it. */
export interface AreaRankingView {
  areas: NationalAreas;
  scores: NationalScores;
  search: NationalSearch;
  /** The county's own score: its county-level part of each area's. */
  county: CountyScore | undefined;
  /** National indices of the county's areas that pass the search, best first. */
  matches: number[];
  indexByGeoid: Map<string, number>;
  /**
   * What the list and map show (owner, 2026-10-04): the county's areas among your top
   * results (`cap`: 100, 250 or 500) — or every match, once revealed.
   */
  listed: number[];
  /** How many of the county's areas are in your top results. */
  inTop: number;
  /** Your top results nationwide, best first (national indices): an area's overall rank. */
  top: number[];
  cap: number;
  revealed: boolean;
  onReveal: (all: boolean) => void;
  /** National indices of the county's areas that fail the search (shown grey when revealed). */
  ruledOut: number[];
  /** The county's areas the search rules out (or unknown, when unknowns are hidden). */
  hiddenCount: number;
}

/**
 * "Explore inside" a county (plan §9 Phase 8b): its areas (census tracts),
 * grouped by city, town or community, with a detail view per area. Display
 * only — no filters inside the county yet (8e).
 */

interface Props {
  countyName: string;
  state: CountyAreasState;
  /** Null while loading. With no criteria, areas show `fallbackMeasure`. */
  ranking: AreaRankingView | null;
  fallbackMeasure: string;
  onEditFilters: () => void;
  selected: string | null;
  onSelect: (geoid: string | null) => void;
  /** The areas the pointer (or keyboard focus) is on in the list, for the map to outline. */
  onHover: (geoids: string[]) => void;
  onBack: () => void;
  /** From an area page, straight back to the results list (owner: no county detour). */
  onBackToResults: () => void;
}

export function InsideView({
  countyName,
  state,
  ranking,
  fallbackMeasure,
  onEditFilters,
  selected,
  onSelect,
  onHover,
  onBack,
  onBackToResults,
}: Props) {
  const areas = state.status === "ready" ? state.data.areas : null;
  const area = selected && areas ? (areas.byGeoid.get(selected) ?? null) : null;

  return (
    <div>
      <div className="px-gutter pt-4">
        <button
          type="button"
          onClick={area ? onBackToResults : onBack}
          className="-ml-1 rounded px-1 text-label font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          ← {area ? "Results" : countyName}
        </button>
        {area ? (
          <AreaHeader
            area={area}
            side={sideOf(ranking, area.geoid)}
            rank={overallRank(ranking, area.geoid)}
            countyName={countyName}
            onCounty={() => onSelect(null)}
          />
        ) : (
          <>
            <h2 className="mt-1 text-heading font-semibold">Inside {countyName}</h2>
            {areas && (
              <p className="mt-0.5 text-label text-neutral-500">
                {ranking
                  ? `${ranking.inTop.toLocaleString()} in your top ${ranking.cap} · ${ranking.matches.length.toLocaleString()} of ${areas.areas.length.toLocaleString()} areas match your search`
                  : `${areas.areas.length.toLocaleString()} areas · grouped by city, town or community`}
              </p>
            )}
          </>
        )}
      </div>

      {state.status === "loading" && <Note>Loading areas…</Note>}
      {state.status === "error" && <Note>{state.message}</Note>}
      {areas && !area && (
        <AreaList
          areas={areas}
          ranking={ranking}
          measure={fallbackMeasure}
          onEditFilters={onEditFilters}
          onSelect={onSelect}
          onHover={onHover}
        />
      )}
      {areas && area && <AreaDetail area={area} county={areas} countyName={countyName} ranking={ranking} />}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-gutter py-8 text-center text-label text-neutral-500">{children}</p>;
}

/** The yellow caution icon (owner, 2026-09-30): hover or tap for which values and why. */
export function Caution({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <InfoTip label="Low confidence" icon={<Icon name="warning" className="h-4 w-4" />}>
        <p className="font-semibold">Low confidence</p>
        <p className="mt-1">These values are uncertain:</p>
        <ul className="mt-1 list-disc pl-4">
          {flags.map((f) => (
            <li key={f}>{flagLabel(f)}</li>
          ))}
        </ul>
        <p className="mt-2 text-caption text-neutral-500 dark:text-neutral-400">
          Usually a small area sampled by the Census (a wide margin of error), a small police agency, or few home
          sales.
        </p>
      </InfoTip>
    </span>
  );
}

function AreaList({
  areas,
  ranking,
  measure,
  onEditFilters,
  onSelect,
  onHover,
}: {
  areas: CountyAreas;
  ranking: AreaRankingView | null;
  measure: string;
  onEditFilters: () => void;
  onSelect: (geoid: string) => void;
  onHover: (geoids: string[]) => void;
}) {
  return (
    <div className="px-gutter py-4">
      <div className="flex items-start justify-between gap-3">
        {/* A div: the "i" holds paragraphs and lists, which can't sit inside a <p>. */}
        <div className="flex items-center gap-1 text-label text-neutral-600 dark:text-neutral-400">
          {ranking ? "Ranked by your filters" : `${AREA_MEASURE.get(measure)?.label ?? measure} by area`}
          <InfoTip label="How areas are ranked">
            <RankingNote ranking={ranking} />
          </InfoTip>
        </div>
        <button
          type="button"
          onClick={onEditFilters}
          className="shrink-0 rounded px-1 text-label font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Edit filters
        </button>
      </div>
      {ranking ? (
        <MatchList areas={areas} ranking={ranking} onSelect={onSelect} onHover={onHover} />
      ) : (
        <>
          <p className="mt-1 text-caption text-neutral-500">
            None of your priorities vary by area. Add some in Filters (they&apos;re tagged &ldquo;by area&rdquo;).
          </p>
          <GroupedList areas={areas} measure={measure} onSelect={onSelect} onHover={onHover} />
        </>
      )}
    </div>
  );
}

/**
 * The county's matching areas, best first (plan §9 Phase 8f): 5 at a time, so the
 * list and the map stay on a few areas that fit (owner, 2026-10-03).
 */
function MatchList({
  areas,
  ranking,
  onSelect,
  onHover,
}: {
  areas: CountyAreas;
  ranking: AreaRankingView;
  onSelect: (geoid: string) => void;
  onHover: (geoids: string[]) => void;
}) {
  const { listed, revealed } = ranking;
  const toggle = (
    <button
      type="button"
      onClick={() => ranking.onReveal(!revealed)}
      className="mt-3 w-full rounded-lg border border-neutral-300 py-2 text-label font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
    >
      {revealed ? `Hide weaker results — only your top ${ranking.cap}` : "Reveal full county"}
    </button>
  );
  const row = (i: number, rank: number | null) => {
    const geoid = ranking.areas.geoid[i];
    const a = areas.byGeoid.get(geoid);
    const scored = rank !== null;
    const parts = scored ? explainArea(ranking.areas, i, ranking.search, ranking.county) : [];
    const score = ranking.scores.score[i];
    return (
      <li key={geoid} className="flex items-center gap-1 hover:bg-neutral-100 dark:hover:bg-neutral-900">
        <button
          type="button"
          onClick={() => onSelect(geoid)}
          onMouseEnter={() => onHover([geoid])}
          onFocus={() => onHover([geoid])}
          className="flex min-w-0 flex-1 items-start gap-2 py-3 text-left"
        >
          <span className="w-6 pt-0.5 text-label tabular-nums text-neutral-500">{scored ? rank + 1 : ""}</span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${scored ? "text-body font-semibold" : "text-label"}`}>{ranking.areas.name[i]}</span>
            {scored && (
              <>
                <span className="block truncate text-caption text-neutral-600 dark:text-neutral-400">{tradeOff(parts)}</span>
                <Fingerprint parts={parts} />
              </>
            )}
          </span>
          {scored && !Number.isNaN(score) && <MatchScore score={score} />}
        </button>
        {a && <Caution flags={headlineFlags(a)} />}
      </li>
    );
  };
  return (
    <>
      {listed.length === 0 && (
        <p className="py-6 text-center text-label text-neutral-500">
          {ranking.matches.length === 0
            ? "No area here meets your must-haves."
            : `None of its areas are in your top ${ranking.cap}. Reveal the county to see its ${ranking.matches.length.toLocaleString()} matching ${ranking.matches.length === 1 ? "area" : "areas"}.`}
        </p>
      )}
      {listed.length > 0 && (
        <ol className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800" onMouseLeave={() => onHover([])}>
          {listed.map((i, rank) => row(i, rank))}
        </ol>
      )}
      {revealed && ranking.ruledOut.length > 0 && (
        <>
          <h3 className="mt-5 text-label font-semibold text-neutral-500">
            {ranking.ruledOut.length.toLocaleString()} {ranking.ruledOut.length === 1 ? "area doesn't" : "areas don't"} pass
            your must-haves
          </h3>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800" onMouseLeave={() => onHover([])}>
            {[...ranking.ruledOut]
              .sort((x, y) => ranking.areas.name[x].localeCompare(ranking.areas.name[y]))
              .map((i) => row(i, null))}
          </ul>
        </>
      )}
      {(revealed || ranking.matches.length > listed.length || ranking.hiddenCount > 0) && toggle}
    </>
  );
}

function MatchScore({ score }: { score: number }) {
  return (
    <span className="pt-0.5 font-bold tabular-nums" style={{ color: scoreColor(score) }}>
      {Math.round(score)}
    </span>
  );
}

/** No area-level filter: the county's areas by town, with a measure (Census home value). */
function GroupedList({
  areas,
  measure,
  onSelect,
  onHover,
}: {
  areas: CountyAreas;
  measure: string;
  onSelect: (geoid: string) => void;
  onHover: (geoids: string[]) => void;
}) {
  const groups = useMemo(() => groupAreas(areas.areas), [areas]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map((g) => g.name)));
  const toggle = (name: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  const key = (a: Area) => areaValue(a, measure) ?? -Infinity;
  return (
    <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
      {groups.map((g) => {
        const values = g.areas.map((a) => areaValue(a, measure)).filter((v): v is number => v !== null);
        const median = values.length ? values.sort((a, b) => a - b)[values.length >> 1] : null;
        const isOpen = open.has(g.name);
        const all = g.areas.map((a) => a.geoid);
        // Hover or focus outlines on the map: a town, all its areas; one area, just it.
        const outline = (geoids: string[]) => ({
          onMouseEnter: () => onHover(geoids),
          onFocus: () => onHover(geoids),
        });
        // A town with a single area has nothing to expand: the row is the area.
        if (g.areas.length === 1) {
          const a = g.areas[0];
          return (
            <li key={g.name} onMouseLeave={() => onHover([])} onBlur={() => onHover([])}>
              <div className="flex items-center gap-1 hover:bg-neutral-100 dark:hover:bg-neutral-900">
                <button
                  type="button"
                  onClick={() => onSelect(a.geoid)}
                  {...outline(all)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate pl-[1.125rem] text-body font-semibold">{g.name}</span>
                    <span className="block pl-[1.125rem] text-caption text-neutral-500">
                      {a.zip ? `ZIP ${a.zip} · ` : ""}
                      {g.population.toLocaleString()} people
                    </span>
                  </span>
                  <span className="shrink-0 text-label tabular-nums">{formatAreaValue(a, measure)}</span>
                </button>
                <Caution flags={headlineFlags(a)} />
              </div>
            </li>
          );
        }
        return (
          <li key={g.name} onMouseLeave={() => onHover([])} onBlur={() => onHover([])}>
            <button
              type="button"
              onClick={() => toggle(g.name)}
              {...outline(all)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-3 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-body font-semibold">
                  <span aria-hidden className="mr-1.5 inline-block w-3 text-neutral-400">{isOpen ? "▾" : "▸"}</span>
                  {g.name}
                </span>
                <span className="block pl-[1.125rem] text-caption text-neutral-500">
                  {g.areas.length} areas · {g.population.toLocaleString()} people
                </span>
              </span>
              <span className="shrink-0 text-right text-label tabular-nums">
                {formatArea(measure, median)}
                <span className="block text-caption text-neutral-500">typical</span>
              </span>
            </button>
            {isOpen && (
              <ul className="mb-2 ml-[1.125rem] border-l border-neutral-200 dark:border-neutral-800" onMouseLeave={() => onHover(all)}>
                {[...g.areas]
                  .sort((a, b) => key(b) - key(a))
                  .map((a) => (
                    <li key={a.geoid}>
                      <div className="flex items-center gap-1 pl-3 hover:bg-neutral-100 dark:hover:bg-neutral-900">
                        <button
                          type="button"
                          onClick={() => onSelect(a.geoid)}
                          {...outline([a.geoid])}
                          className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left"
                        >
                          <span className="truncate text-label">{areaName(a)}</span>
                          <span className="shrink-0 text-label tabular-nums">{formatAreaValue(a, measure)}</span>
                        </button>
                        <Caution flags={headlineFlags(a)} />
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What ranks the areas and what rules them out, for the "i". */
function RankingNote({ ranking }: { ranking: AreaRankingView | null }) {
  const criteria = ranking?.search.criteria ?? [];
  const limits = ranking?.search.limits ?? [];
  const countyParts = ranking?.county?.contributions ?? [];
  const dir = { lower: "lower is better", higher: "higher is better", middle: "typical is best" } as const;
  if (!ranking) {
    return (
      <p>
        None of your priorities vary by area, so areas show Census home value. Priorities tagged &ldquo;by area&rdquo; in
        Filters — home value, schools, safety, walkability, distances… — rank areas.
      </p>
    );
  }
  return (
    <>
      <p className="font-semibold">Ranked by</p>
      <ul className="mt-1 list-disc pl-4">
        {criteria.map((c) => (
          <li key={c.column}>
            {c.label} — importance {c.weight}, {dir[c.direction]}
          </li>
        ))}
        {countyParts.map((c) => (
          <li key={c.metric}>
            {formatMetricLabel(c.metric)} (county-wide) — importance {c.weight}
          </li>
        ))}
      </ul>
      <p className="mt-2">
        Each area is compared with every US area on its own measures; county-wide ones count the same for every area
        here. Combined by importance, as for counties.
      </p>
      {limits.length > 0 && (
        <>
          <p className="mt-2 font-semibold">Must-haves</p>
          <ul className="mt-1 list-disc pl-4">
            {limits.map((l) => (
              <li key={l.column}>
                {l.label}: {bound(l)}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

const bound = (l: AreaLimit) =>
  [l.min !== undefined && `at least ${formatArea(l.column, l.min)}`, l.max !== undefined && `at most ${formatArea(l.column, l.max)}`]
    .filter(Boolean)
    .join(", ");

const formatMetricLabel = (m: MetricKey) => getMetric(m).label;

/** In a group's list: the neighborhood, else the ZIP (the group already names the town). */
function areaName(a: Area): string {
  if (a.neighborhood) return a.zip ? `${a.neighborhood} · ${a.zip}` : a.neighborhood;
  return a.zip ? `ZIP ${a.zip}` : a.label;
}

/** "north", when areas share this one's label (the results call it "… · north"). */
function sideOf(ranking: AreaRankingView | null, geoid: string): string | null {
  const i = ranking?.indexByGeoid.get(geoid);
  if (!ranking || i === undefined) return null;
  const { name, label } = ranking.areas;
  return name[i] === label[i] ? null : name[i].slice(label[i].length + 3);
}

/** The area's place in your top results nationwide (1-based), colored as the map colors ranks. */
function overallRank(ranking: AreaRankingView | null, geoid: string): { rank: number | null; of: number } | null {
  const i = ranking?.indexByGeoid.get(geoid);
  if (!ranking || i === undefined) return null;
  const at = ranking.top.indexOf(i);
  return { rank: at >= 0 ? at + 1 : null, of: ranking.cap };
}

function AreaHeader({
  area,
  side,
  rank,
  countyName,
  onCounty,
}: {
  area: Area;
  side: string | null;
  rank: { rank: number | null; of: number } | null;
  countyName: string;
  onCounty: () => void;
}) {
  return (
    <div className="mt-1 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-heading font-semibold">
          {area.neighborhood ?? area.group}
          {side && <span className="font-normal text-neutral-500"> · {side}</span>}
          {area.lowConfidence.length > 0 && (
            <span className="ml-1.5 inline-flex align-middle">
              <Caution flags={area.lowConfidence} />
            </span>
          )}
        </h2>
        <p className="mt-0.5 text-label text-neutral-500">
          {[area.neighborhood ? area.group : null, area.zip && `ZIP ${area.zip}`,
            area.population !== null && `${area.population.toLocaleString()} people`].filter(Boolean).join(" · ")}
          {" · in "}
          <button type="button" onClick={onCounty} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            {countyName}
          </button>
        </p>
      </div>
      {rank && (
        <div className="shrink-0 text-right">
          {rank.rank !== null ? (
            <>
              <span
                className="block text-heading font-bold tabular-nums"
                style={{ color: scoreColor(rank.of > 1 ? 100 * (1 - (rank.rank - 1) / (rank.of - 1)) : 100) }}
              >
                #{rank.rank}
              </span>
              <span className="block text-caption text-neutral-500">of your top {rank.of}</span>
            </>
          ) : (
            <span className="block max-w-24 text-caption text-neutral-500">Not in your top {rank.of}</span>
          )}
        </div>
      )}
    </div>
  );
}

const BETTER = { lower: "lower is better", higher: "higher is better", middle: "typical is best" } as const;

/** Where the value stands, said the way the score reads: "lower than 98% of US areas". */
function standing(p: AreaPart): string {
  const of = p.level === "county" ? "US counties" : "US areas";
  const raw = Math.round(p.rawPercentile ?? 0);
  if (p.direction === "lower") return `lower than ${Math.max(0, 100 - raw)}% of ${of}`;
  if (p.direction === "higher") return `higher than ${raw}% of ${of}`;
  return `${ordinal(raw)} percentile of ${of} · ${BETTER.middle}`;
}

/** Home value and rent are scored at today's prices: Census by area × its ZIP's Zillow ratio. */
const SCORED_ON_CENSUS = new Set(["median_home_value", "median_gross_rent"]);
const TODAY_TAG = <span className="text-caption text-neutral-500"> · today&rsquo;s prices</span>;

const partValue = (p: AreaPart) =>
  p.level === "county" ? formatValue(p.key as MetricKey, p.value) : formatArea(p.key, p.value);

/** The area's score, broken down like a county's (plan §9 Phase 8f): the detail the results summary leaves out. */
function WhyItRanks({ area, ranking, countyName }: { area: Area; ranking: AreaRankingView; countyName: string }) {
  const i = ranking.indexByGeoid.get(area.geoid);
  if (i === undefined) return null;
  const score = ranking.scores.score[i];
  const place = ranking.matches.indexOf(i);
  const parts = explainArea(ranking.areas, i, ranking.search, ranking.county);
  const limits = areaLimitResults(ranking.areas, i, ranking.search.limits);
  const rows = [...parts].sort((a, b) => (b.impact ?? -Infinity) - (a.impact ?? -Infinity));
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-label font-semibold uppercase tracking-wide text-neutral-500">Why it ranks here</h3>
          <p className="mt-0.5 text-label">
            {place >= 0
              ? `${ordinal(place + 1)} of ${ranking.matches.length} matching areas in ${countyName}`
              : "Doesn't pass your must-haves"}
          </p>
        </div>
        {!Number.isNaN(score) && <MatchScore score={score} />}
      </div>
      <p className="text-label text-neutral-700 dark:text-neutral-300">{tradeOff(parts)}</p>
      {rows.length > 0 && (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {rows.map((c) => (
            <li key={c.key} className="py-2 text-label">
              <div className="flex items-baseline justify-between gap-3">
                <span>
                  {c.label}
                  {c.level === "county" && <span className="text-caption text-neutral-500"> · county-wide</span>}
                  {SCORED_ON_CENSUS.has(c.key) && TODAY_TAG}
                </span>
                <span className="shrink-0 font-medium tabular-nums">{partValue(c)}</span>
              </div>
              {c.points === null ? (
                <p className="text-caption text-neutral-500">No data — left out of this area&rsquo;s score (weight {c.weight}).</p>
              ) : (
                <>
                  <div className="mt-1 flex items-center gap-2">
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
                      role="img"
                      aria-label={`${Math.round(c.points)} of 100 points`}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, c.points)}%`,
                          backgroundColor: barColor(c.points),
                          boxShadow: isGold(c.points) ? "0 0 6px rgba(212,160,23,.7)" : undefined,
                        }}
                      />
                    </div>
                    <span className="w-14 text-right text-caption tabular-nums text-neutral-500">{Math.round(c.points)} pts</span>
                  </div>
                  <p className="mt-0.5 text-caption text-neutral-500">
                    {standing(c)} · weight {c.weight} ·{" "}
                    <span className={(c.impact ?? 0) >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
                      effect {(c.impact ?? 0) >= 0 ? "+" : "−"}
                      {Math.abs(Math.round(c.impact ?? 0))}
                    </span>
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {limits.length > 0 && (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {limits.map((l) => (
            <li key={l.column} className="flex items-baseline justify-between gap-3 py-2 text-label">
              <span>
                <span aria-hidden className={l.state === "pass" ? "text-emerald-600" : l.state === "fail" ? "text-rose-600" : "text-neutral-400"}>
                  {l.state === "pass" ? "✓" : l.state === "fail" ? "✕" : "?"}{" "}
                </span>
                {l.label}
                {SCORED_ON_CENSUS.has(l.column) && TODAY_TAG}
                <span className="block text-caption text-neutral-500">Yours: {bound(l)}</span>
              </span>
              <span className={`shrink-0 font-medium tabular-nums ${l.state === "fail" ? "text-rose-700 dark:text-rose-400" : ""}`}>
                {l.value === null ? "No data" : formatArea(l.column, l.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AreaDetail({
  area,
  county,
  countyName,
  ranking,
}: {
  area: Area;
  county: CountyAreas;
  countyName: string;
  ranking: AreaRankingView | null;
}) {
  const v = (key: string) => areaValue(area, key);
  const flagged = new Set(area.lowConfidence);
  const r = area.row;
  const pick = (ids: string[]) => ids.map((id) => county.schools.get(id)).filter((s): s is School => !!s);
  const schools = pick(area.nearbySchools);
  const highSchools = pick(area.nearbyHighSchools);

  return (
    <div className="space-y-section px-gutter py-4">
      {ranking && <WhyItRanks area={area} ranking={ranking} countyName={countyName} />}
      {/* The headline numbers (owner audit, 2026-10-04): Zillow first for home value and
          rent — recent, and it covers more areas for home value — with the Census as the
          backup; then income, safety, commute and walkability. Schools have their own
          section right below. */}
      <dl className="grid grid-cols-2 gap-2">
        <PriceStat area={area} ranking={ranking} label="Home value" census="median_home_value" zillow="zhvi" />
        <PriceStat area={area} ranking={ranking} label="Rent" census="median_gross_rent" zillow="zori" />
        <Stat k="median_household_income" text={formatAreaValue(area, "median_household_income")} flagged={flagged.has("median_household_income")} />
        <Stat k="violent_rate" text={formatAreaValue(area, "violent_rate")} flagged={flagged.has("crime")} />
        <Stat k="commute_minutes" text={formatAreaValue(area, "commute_minutes")} flagged={flagged.has("commute_minutes")} />
        <Stat k="walkability" text={formatAreaValue(area, "walkability")} flagged={flagged.has("walkability")} />
      </dl>

      <Section
        title="Schools"
        tip="The nearest schools to where people here live — not attendance zones. Elementary and middle: SEDA test scores (grades 3–8). High schools: college-prep access from the Civil Rights Data Collection 2023–24 — AP participation and AP courses offered, compared nationally."
      >
        {r.district_name && (
          <Row label="School district">
            <span className="font-medium">{String(r.district_name).replace(/ Independent School District$/, " ISD")}</span>
            <span className="block text-caption text-neutral-500">
              {v("district_pctl") !== null && `${ordinal(v("district_pctl")!)} percentile nationally`}
              {v("district_rank") !== null && ` · ${ordinal(v("district_rank")!)} of ${v("district_count")} in ${countyName}`}
            </span>
          </Row>
        )}
        <SubHead>Elementary &amp; middle</SubHead>
        {schools.length === 0 ? (
          <p className="text-label text-neutral-500">No scored schools within 5 miles.</p>
        ) : (
          schools.map((s) => (
            <Row key={s.id} label={<span className="capitalize">{s.name.toLowerCase()}</span>}>
              <span className="font-medium">{s.pctl !== null ? `${ordinal(s.pctl)} pctl` : "—"}</span>
              <span className="block text-caption text-neutral-500">
                {s.level} · {where(s)}
              </span>
            </Row>
          ))
        )}
        <SubHead>High schools</SubHead>
        {highSchools.length === 0 ? (
          <p className="text-label text-neutral-500">No high school within 5 miles.</p>
        ) : (
          highSchools.map((s) => (
            <Row key={s.id} label={<span className="capitalize">{s.name.toLowerCase()}</span>}>
              <span className="font-medium">{s.pctl !== null ? `${ordinal(s.pctl)} pctl` : "—"}</span>
              <span className="block text-caption text-neutral-500">{where(s)}</span>
              <span className="block text-caption text-neutral-500">{apLine(s)}</span>
            </Row>
          ))
        )}
      </Section>

      <Section title="Homes and people">
        {["median_home_value", "median_gross_rent", "per_capita_income", "kids_share", "highrise_share",
          "single_family_share", "owner_share", "median_age", "bachelors_share", "density_per_sq_mi"].map((k) => (
          <MeasureRow key={k} k={k} value={v(k)} flagged={flagged.has(k)} />
        ))}
      </Section>

      <Section title="Getting around">
        <MeasureRow
          k="dist_downtown_mi"
          value={v("dist_downtown_mi")}
          extra={r.nearest_downtown ? String(r.nearest_downtown) : county.downtownMetro?.split(",")[0].split("-")[0]}
        />
        <MeasureRow k="dist_airport_mi" value={v("dist_airport_mi")} extra={r.nearest_airport ? String(r.nearest_airport) : undefined} />
        <MeasureRow k="commute_minutes" value={v("commute_minutes")} flagged={flagged.has("commute_minutes")} />
        <MeasureRow k="work_from_home_share" value={v("work_from_home_share")} flagged={flagged.has("work_from_home_share")} />
      </Section>

      <Section title="Safety" tip={AREA_MEASURE.get("violent_rate")?.note}>
        <MeasureRow k="violent_rate" value={v("violent_rate")} flagged={flagged.has("crime")} />
        <MeasureRow k="property_rate" value={v("property_rate")} flagged={flagged.has("crime")} />
        {r.crime_agency && (
          <p className="text-caption text-neutral-500">
            Reported for {String(r.crime_agency)}, {String(r.crime_year)} (FBI Crime Data Explorer)
          </p>
        )}
      </Section>

      <Section title="Housing market" tip="By ZIP code. Zillow (home value and rent indexes) and Redfin (latest 90 days of sales).">
        <MeasureRow k="zhvi_yoy" value={v("zhvi_yoy")} />
        <MeasureRow k="days_on_market" value={v("days_on_market")} />
        <MeasureRow k="sale_to_list" value={v("sale_to_list")} />
        <Row label="Homes sold">
          <span className="font-medium tabular-nums">{v("homes_sold") ?? "—"}</span>
          {flagged.has("sale_price") && <span className="ml-1 text-amber-500"><Icon name="warning" className="inline h-3.5 w-3.5" /></span>}
        </Row>
        <p className="text-caption text-neutral-500">
          Zillow {String(r.zillow_month ?? "")} · Redfin to {String(r.redfin_period ?? "")}
        </p>
      </Section>

      <Section title="Natural hazards" tip={AREA_MEASURE.get("hazard_risk")?.note}>
        <MeasureRow k="hazard_risk" value={v("hazard_risk")} />
        <MeasureRow k="hazard_wildfire" value={v("hazard_wildfire")} />
        <MeasureRow k="hazard_inland_flood" value={v("hazard_inland_flood")} />
      </Section>
    </div>
  );
}

/** "3rd of 47 high schools in county", or "in Williamson County" across the line. */
function where(s: School): string {
  if (!s.inCounty) return s.countyName ? `in ${s.countyName}` : "nearby county";
  const kind = s.level === "high" ? "high schools" : `${s.level} schools`;
  return s.countyRank !== null && s.countyCount !== null ? `${ordinal(s.countyRank)} of ${s.countyCount} ${kind} in county` : "";
}

/** "33 AP courses · 62% in AP · IB · 15% dual enrollment" */
function apLine(s: School): string {
  if (s.apCourses === 0) return "No AP courses";
  return [
    s.apCourses !== null && `${s.apCourses} AP courses`,
    s.apShare !== null && `${Math.round(s.apShare)}% in AP`,
    s.ib && "IB",
    s.dualShare !== null && s.dualShare > 0 && `${Math.round(s.dualShare)}% dual enrollment`,
  ].filter(Boolean).join(" · ");
}

function SubHead({ children }: { children: ReactNode }) {
  return <p className="pt-1 text-caption font-medium text-neutral-500 dark:text-neutral-400">{children}</p>;
}

function Section({ title, tip, children }: { title: string; tip?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-1">
        <h3 className="text-caption font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{title}</h3>
        {tip && <InfoTip label={title}>{tip}</InfoTip>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-label">
      <span className="min-w-0 text-neutral-600 dark:text-neutral-400">{label}</span>
      <span className="shrink-0 text-right">{children}</span>
    </div>
  );
}

function FlagMark({ on }: { on?: boolean }) {
  if (!on) return null;
  return (
    <span className="ml-1 text-amber-500 dark:text-amber-400" title="Low confidence">
      <Icon name="warning" className="inline h-3.5 w-3.5" />
    </span>
  );
}

function MeasureRow({ k, value, flagged, extra }: { k: string; value: number | null; flagged?: boolean; extra?: string }) {
  const m = AREA_MEASURE.get(k);
  return (
    <Row label={m?.label ?? k}>
      <span className="font-medium tabular-nums">{formatArea(k, value)}</span>
      {extra && <span className="ml-1 text-caption text-neutral-500">{extra}</span>}
      <FlagMark on={flagged} />
    </Row>
  );
}

/**
 * Home value or rent. With your search loaded, this area's value at today's prices — the
 * one it's scored on (Census by area × its ZIP's Zillow ratio) — with Zillow's ZIP value
 * under it; otherwise Zillow's ZIP value, or the Census when there's none.
 */
function PriceStat({
  area,
  ranking,
  label,
  census,
  zillow,
}: {
  area: Area;
  ranking: AreaRankingView | null;
  label: string;
  census: "median_home_value" | "median_gross_rent";
  zillow: "zhvi" | "zori";
}) {
  const i = ranking?.indexByGeoid.get(area.geoid);
  const today = ranking && i !== undefined ? ranking.areas.values.get(census)?.[i] : undefined;
  const z = areaValue(area, zillow);
  const flagged = area.lowConfidence.includes(census);
  const zip = area.zip ? ` · ZIP ${area.zip}` : "";
  if (today !== undefined && !Number.isNaN(today)) {
    return (
      <Stat
        k={census}
        label={label}
        note={areaPriority(census)?.note}
        text={formatArea(census, today)}
        source={z !== null ? `Est. for this area · Zillow ${formatArea(zillow, z)}${zip}` : "Est. for this area"}
        flagged={flagged}
      />
    );
  }
  const k = z !== null ? zillow : census;
  return (
    <Stat
      k={k}
      label={label}
      text={formatAreaValue(area, k)}
      source={z !== null ? `Zillow${zip}` : "Census"}
      flagged={flagged}
    />
  );
}

function Stat({
  k,
  label,
  text,
  note,
  source,
  flagged,
}: {
  k: string;
  /** Instead of the measure's own label ("Home value", not "Home value (Zillow, by ZIP)"). */
  label?: string;
  /** Instead of the measure's own "i" text. */
  note?: string;
  text: string;
  /** Where the number comes from, when it can come from more than one place. */
  source?: string;
  flagged: boolean;
}) {
  const m = AREA_MEASURE.get(k);
  return (
    <div className="rounded-lg bg-neutral-100 px-3 py-2 dark:bg-neutral-900">
      <dt className="flex items-center gap-1 text-caption text-neutral-500 dark:text-neutral-400">
        {label ?? m?.label ?? k}
        {(note ?? m?.note) && <InfoTip label={label ?? m?.label ?? k}>{note ?? m?.note}</InfoTip>}
      </dt>
      <dd className="mt-0.5 text-body font-semibold tabular-nums">
        {text}
        <FlagMark on={flagged} />
      </dd>
      {source && <dd className="text-caption text-neutral-500">{source}</dd>}
    </div>
  );
}
