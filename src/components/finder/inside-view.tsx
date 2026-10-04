"use client";

import { useMemo, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/info-tip";
import {
  AREA_MEASURE,
  areaValue,
  flagLabel,
  formatArea,
  formatAreaValue,
  groupAreas,
  headlineFlags,
  explainArea,
  tradeOff,
  type Area,
  type CountyAreas,
  type NationalAreas,
  type NationalScores,
  type NationalSearch,
} from "@/lib/tracts";

import { getMetric, type CountyScore, type MetricKey } from "@/lib/scoring";

import { AreaDetail, bound } from "./area-detail";
import { Fingerprint } from "./area-results";
import { scoreColor } from "./score-colors";
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

/**
 * The back link and identity of what's open inside a county: the area's name and rank,
 * or "Inside <county>". On phones this is the sheet's drag header (like `PlaceIdentity`
 * for a county), so it isn't repeated in the body (full audit, 2026-10-04).
 */
export function InsideIdentity({ countyName, state, ranking, selected, onSelect, onBack, onBackToResults }: Props) {
  const areas = state.status === "ready" ? state.data.areas : null;
  const area = selected && areas ? (areas.byGeoid.get(selected) ?? null) : null;
  return (
    <>
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
    </>
  );
}

export function InsideView(props: Props & { withIdentity?: boolean }) {
  const { countyName, state, ranking, fallbackMeasure, onEditFilters, selected, onSelect, onHover, withIdentity = true } = props;
  const areas = state.status === "ready" ? state.data.areas : null;
  const area = selected && areas ? (areas.byGeoid.get(selected) ?? null) : null;

  return (
    <div>
      {withIdentity && (
        <div className="px-gutter pt-4">
          <InsideIdentity {...props} />
        </div>
      )}

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
                {parts.length > 0 && (
                  <span className="block truncate text-caption text-neutral-600 dark:text-neutral-400">{tradeOff(parts)}</span>
                )}
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
            <span className="block text-caption whitespace-nowrap text-neutral-500">Not in your top {rank.of}</span>
          )}
        </div>
      )}
    </div>
  );
}
