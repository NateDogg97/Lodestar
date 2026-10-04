"use client";

import { useEffect, useState } from "react";

import {
  areaLimitResults,
  explainArea,
  formatArea,
  tradeOff,
  type AreaPart,
  type CountyResult,
  type NationalAreas,
  type NationalScores,
  type NationalSearch,
  type ResultBadges,
} from "@/lib/tracts";
import { formatValue, type CountyScore, type MetricKey } from "@/lib/scoring";

import { isGold, scoreColor } from "./score-colors";

/**
 * Areas as the results (plan §9 Phase 8f; mockups 2026-10-03): the best areas
 * nationwide, or the counties holding them by their best area. A result's
 * summary compares — a fingerprint (one bar per priority), a trade-off sentence
 * from the top 3 priorities, badges — while the area page explains in full.
 */

export const RESULT_CAPS = [100, 250, 500] as const;
export type ResultCap = (typeof RESULT_CAPS)[number];

interface Common {
  areas: NationalAreas;
  scores: NationalScores;
  search: NationalSearch;
  countyScores: Map<string, CountyScore>;
  countyName: (fips: string) => string;
  onOpenArea: (i: number) => void;
  /** Show an area on the map; `fly` moves the map there (a summary opened by hand). */
  onPreview: (i: number | null, fly: boolean) => void;
}

/** "Areas | Counties" and "Top 100 · 250 · 500". */
export function ResultsHeader({
  view,
  onView,
  cap,
  onCap,
  areaCount,
  countyCount,
}: {
  view: "areas" | "counties";
  onView: (v: "areas" | "counties") => void;
  cap: ResultCap;
  onCap: (c: ResultCap) => void;
  areaCount: number;
  countyCount: number;
}) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div role="group" aria-label="Show results as" className="grid grid-cols-2 rounded-full bg-neutral-100 p-1 dark:bg-neutral-900">
          {(["areas", "counties"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => onView(v)}
              className={`rounded-full px-3.5 py-1.5 text-label font-semibold ${
                view === v ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              {v === "areas" ? "Areas" : "Counties"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-label">
          <span className="text-neutral-500">Top</span>
          {RESULT_CAPS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cap === c}
              onClick={() => onCap(c)}
              className={`min-w-11 rounded-full border px-2 py-1 font-semibold tabular-nums ${
                cap === c
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <p className="text-caption text-neutral-500">
        {view === "areas"
          ? `Your top ${areaCount.toLocaleString()} areas nationwide, best match first — in ${countyCount.toLocaleString()} ${countyCount === 1 ? "county" : "counties"}.`
          : `The ${countyCount.toLocaleString()} ${countyCount === 1 ? "county" : "counties"} holding your top ${areaCount.toLocaleString()} areas, by their best area.`}
      </p>
    </div>
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg aria-hidden viewBox="0 0 16 16" className={`h-4.5 w-4.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6l4 4 4-4" />
  </svg>
);

export function ScoreNumber({ score }: { score: number }) {
  return (
    <span className="font-bold tabular-nums" style={{ color: isGold(score) ? "#8a6500" : scoreColor(score) }}>
      {Math.round(score)}
    </span>
  );
}

/** A bar's fill: the score's color, gold with a glow at the top 1%. */
function Fill({ points }: { points: number }) {
  return (
    <span
      className="block h-full rounded-full"
      style={{
        width: `${Math.max(4, points)}%`,
        backgroundColor: scoreColor(points),
        boxShadow: isGold(points) ? "0 0 6px rgba(212,160,23,.7)" : undefined,
      }}
    />
  );
}

/**
 * The fingerprint (owner's favorite): one bar per priority, most important first,
 * no words. Up to 4 priorities as short bars; more as tiny columns, so 11 still fit.
 */
export function Fingerprint({ parts }: { parts: AreaPart[] }) {
  const known = parts.filter((p) => p.points !== null);
  const label = known.map((p) => `${p.label} ${Math.round(p.points!)}`).join(", ");
  if (parts.length <= 4) {
    return (
      <span role="img" aria-label={label} className="mt-1 flex items-center gap-1">
        {parts.map((p) => (
          <span key={p.key} className="block h-1.5 w-9 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            {p.points !== null && <Fill points={p.points} />}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} className="mt-1 flex h-5 items-end gap-[3px]">
      {parts.map((p) => (
        <span
          key={p.key}
          className="block w-2 rounded-t-sm"
          style={{
            height: `${Math.max(3, Math.round(((p.points ?? 0) / 100) * 20))}px`,
            backgroundColor: p.points === null ? "#d4d4d4" : scoreColor(p.points),
          }}
        />
      ))}
    </span>
  );
}

function Badges({ badges, first }: { badges: ResultBadges | undefined; first: boolean }) {
  return (
    <>
      {first && (
        <span className="rounded-full bg-neutral-900 px-2 py-px text-caption font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
          #1 best match
        </span>
      )}
      {badges?.top1.map((b) => (
        <span key={b} className="inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-50 px-2 py-px text-caption font-semibold text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200">
          <svg aria-hidden viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor">
            <path d="M8 1.2l2 4.3 4.7.5-3.5 3.2 1 4.6L8 11.4l-4.2 2.4 1-4.6L1.3 6l4.7-.5z" />
          </svg>
          {b}
        </span>
      ))}
      {badges?.best.map((b) => (
        <span key={b} className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-px text-caption font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {b}
        </span>
      ))}
    </>
  );
}

const partValue = (p: AreaPart) =>
  p.level === "county" ? formatValue(p.key as MetricKey, p.value) : formatArea(p.key, p.value);

/** The open summary: the trade-off, the 3 priorities that moved the score most, must-haves. */
function Summary({ i, parts, common }: { i: number; parts: AreaPart[]; common: Common }) {
  const [all, setAll] = useState(false);
  const byImpact = [...parts].filter((p) => p.impact !== null).sort((a, b) => Math.abs(b.impact!) - Math.abs(a.impact!));
  const top = byImpact.slice(0, 3);
  const rest = parts.filter((p) => !top.includes(p));
  const limits = areaLimitResults(common.areas, i, common.search.limits);
  const failedLimits = limits.filter((l) => l.state !== "pass");
  const name = common.areas.label[i].split(" · ")[0];
  const bars = (list: AreaPart[]) =>
    list.map((p) => (
      <li key={p.key} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-2.5 text-label">
        <span className="truncate text-neutral-600 dark:text-neutral-400">{p.label}</span>
        <span className="block h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          {p.points !== null && <Fill points={p.points} />}
        </span>
        <span className="text-right font-medium tabular-nums">{partValue(p)}</span>
      </li>
    ));
  return (
    <div className="mt-1 mb-3 ml-8 mr-2 space-y-2.5">
      <p className="text-body font-medium">{tradeOff(parts)}</p>
      {parts.length > 3 && <p className="text-caption text-neutral-500">The 3 priorities that moved its score most:</p>}
      <ul className="space-y-1.5">{bars(top)}</ul>
      {rest.length > 0 && parts.length > 3 && (
        <>
          <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className="text-label font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            {all ? `Hide the other ${rest.length}` : `Show the other ${rest.length} ${rest.length === 1 ? "priority" : "priorities"}`}
          </button>
          {all && <ul className="space-y-1.5">{bars(rest)}</ul>}
        </>
      )}
      {limits.length > 0 && (
        <p className="flex items-center gap-1.5 text-caption text-neutral-600 dark:text-neutral-400">
          <span aria-hidden className={failedLimits.length ? "text-neutral-400" : "text-emerald-600"}>{failedLimits.length ? "?" : "✓"}</span>
          {failedLimits.length
            ? `No data for: ${failedLimits.map((l) => l.label).join(", ")}`
            : `Passes ${limits.length === 1 ? "your must-have" : `all ${limits.length} must-haves`}`}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption text-neutral-500">Shown on the map</span>
        <button type="button" onClick={() => common.onOpenArea(i)} className="text-label font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
          Open {name} →
        </button>
      </div>
    </div>
  );
}

export function AreaResultsList({
  top,
  badges,
  ...common
}: Common & { top: number[]; badges: Map<number, ResultBadges> }) {
  // One summary open at a time; the #1 result starts open (owner, 2026-10-03).
  const [open, setOpen] = useState<number | null>(top[0] ?? null);
  const toggle = (i: number) => {
    const next = open === i ? null : i;
    setOpen(next);
    common.onPreview(next, true);
  };
  // The open summary's area is shown on the map, the #1 included (it starts open).
  const { onPreview } = common;
  const first = top[0] ?? null;
  useEffect(() => onPreview(first, false), [onPreview, first]);
  if (top.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-label text-neutral-500 dark:border-neutral-700">
        No area passes every must-have. Loosen one in Filters to see results.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {top.map((i, rank) => {
        const parts = explainArea(common.areas, i, common.search, common.countyScores.get(common.areas.county[i]));
        const isOpen = open === i;
        return (
          <li key={common.areas.geoid[i]} className={isOpen ? "bg-neutral-50 dark:bg-neutral-900/50" : ""}>
            <div className="flex items-start gap-2 py-3 pl-1">
              <span className="w-7 pt-0.5 text-label tabular-nums text-neutral-500">{rank + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => common.onOpenArea(i)}
                    className="text-left text-body font-semibold underline decoration-neutral-300 underline-offset-[3px] hover:decoration-neutral-600 dark:decoration-neutral-700"
                  >
                    {common.areas.name[i]}
                  </button>
                  <Badges badges={badges.get(i)} first={rank === 0} />
                </div>
                <p className="text-caption text-neutral-500">{common.countyName(common.areas.county[i])}</p>
                <Fingerprint parts={parts} />
              </div>
              <span className="pt-0.5">
                <ScoreNumber score={common.scores.score[i]} />
              </span>
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
                aria-label={isOpen ? "Hide summary" : "Show summary"}
                className="-mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <Chevron open={isOpen} />
              </button>
            </div>
            {isOpen && <Summary i={i} parts={parts} common={common} />}
          </li>
        );
      })}
    </ol>
  );
}

export function CountyResultsList({
  counties,
  onOpenCounty,
  ...common
}: Common & { counties: CountyResult[]; onOpenCounty: (fips: string) => void }) {
  const [open, setOpen] = useState<string | null>(counties[0]?.fips ?? null);
  // An open county shows its best area on the map.
  const { onPreview } = common;
  const first = counties[0]?.areas[0] ?? null;
  useEffect(() => onPreview(first, false), [onPreview, first]);
  const toggle = (c: CountyResult) => {
    const next = open === c.fips ? null : c.fips;
    setOpen(next);
    onPreview(next ? c.areas[0] : null, true);
  };
  if (counties.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-label text-neutral-500 dark:border-neutral-700">
        No area passes every must-have. Loosen one in Filters to see results.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {counties.map((c, rank) => {
        const isOpen = open === c.fips;
        return (
          <li key={c.fips} className={isOpen ? "bg-neutral-50 dark:bg-neutral-900/50" : ""}>
            <div className="flex items-start gap-2 py-3 pl-1">
              <span className="w-7 pt-0.5 text-label tabular-nums text-neutral-500">{rank + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenCounty(c.fips)}
                    className="text-left text-body font-semibold underline decoration-neutral-300 underline-offset-[3px] hover:decoration-neutral-600 dark:decoration-neutral-700"
                  >
                    {common.countyName(c.fips)}
                  </button>
                  {rank === 0 && (
                    <span className="rounded-full bg-neutral-900 px-2 py-px text-caption font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
                      #1 best match
                    </span>
                  )}
                </div>
                <p className="text-caption text-emerald-700 dark:text-emerald-400">
                  {c.areas.length} of your top areas · best: {common.areas.name[c.areas[0]]}
                </p>
              </div>
              <span className="pt-0.5">
                <ScoreNumber score={c.bestScore} />
              </span>
              <button
                type="button"
                onClick={() => toggle(c)}
                aria-expanded={isOpen}
                aria-label={isOpen ? "Hide its best areas" : "Show its best areas"}
                className="-mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <Chevron open={isOpen} />
              </button>
            </div>
            {isOpen && (
              <div className="mt-1 mb-3 ml-8 mr-2 space-y-1">
                <p className="text-caption font-semibold text-neutral-500">Its best areas for you</p>
                <ul>
                  {c.areas.slice(0, 5).map((i) => {
                    const parts = explainArea(common.areas, i, common.search, common.countyScores.get(c.fips));
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => common.onOpenArea(i)}
                          className="flex w-full items-center justify-between gap-3 rounded px-1 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-label font-medium">{common.areas.name[i]}</span>
                            <Fingerprint parts={parts} />
                          </span>
                          <ScoreNumber score={common.scores.score[i]} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button type="button" onClick={() => onOpenCounty(c.fips)} className="pt-1 text-label font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
                  Open {common.countyName(c.fips).split(",")[0]} →
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}


/**
 * A county's page in area mode leads with its best areas for you (owner,
 * 2026-10-03): the county facts follow, since the results are areas.
 */
export function CountyBestAreas({
  areas,
  scores,
  search,
  county,
  matches,
  countyLabel,
  onOpenArea,
  onSeeAll,
}: {
  areas: NationalAreas;
  scores: NationalScores;
  search: NationalSearch;
  county: CountyScore | undefined;
  matches: number[];
  countyLabel: string;
  onOpenArea: (i: number) => void;
  onSeeAll: () => void;
}) {
  return (
    <section className="rounded-lg border border-emerald-600/40 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-950/40">
      <h3 className="text-label font-semibold text-emerald-800 dark:text-emerald-300">
        {matches.length === 0
          ? `No area in ${countyLabel} meets your must-haves`
          : `Its best areas for you · ${matches.length.toLocaleString()} match`}
      </h3>
      {matches.length > 0 && (
        <ul className="mt-1">
          {matches.slice(0, 3).map((i) => {
            const parts = explainArea(areas, i, search, county);
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onOpenArea(i)}
                  className="flex w-full items-center justify-between gap-3 rounded px-1 py-1.5 text-left hover:bg-emerald-100 dark:hover:bg-emerald-950"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-label font-medium">{areas.name[i]}</span>
                    <span className="block truncate text-caption text-neutral-600 dark:text-neutral-400">{tradeOff(parts)}</span>
                    <Fingerprint parts={parts} />
                  </span>
                  <ScoreNumber score={scores.score[i]} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={onSeeAll}
        className="mt-1 px-1 text-label font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
      >
        {matches.length > 3 ? `See all ${matches.length.toLocaleString()} matching areas →` : `Explore inside ${countyLabel} →`}
      </button>
    </section>
  );
}
