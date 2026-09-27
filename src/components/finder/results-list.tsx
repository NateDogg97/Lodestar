"use client";

import { useState } from "react";

import {
  explainScore,
  filterLabel,
  formatValue,
  getMetric,
  type CountyDataset,
  type CountyScore,
  type FilterKey,
  type MetricContribution,
} from "@/lib/scoring";

import { scoreColor, UNKNOWN_COLOR } from "./score-colors";

const PAGE_SIZE = 50;

interface ListProps {
  ranked: CountyScore[];
  data: CountyDataset;
  /** The map's top results, colored relative to each other (same colors as the map). */
  relative: Map<string, number | null>;
  selectedFips: string | null;
  onSelect: (fips: string) => void;
}

export function ResultsList({ ranked, data, relative, selectedFips, onSelect }: ListProps) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  if (ranked.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
        No county passes every limit. Loosen a limit to see results.
      </p>
    );
  }

  const shown = ranked.slice(0, visible);
  return (
    <div>
      <ol className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {shown.map((s, i) => (
          <ResultRow
            key={s.fips}
            rank={i + 1}
            score={s}
            data={data}
            rel={relative.get(s.fips)}
            selected={selectedFips === s.fips}
            onSelect={() => onSelect(s.fips)}
          />
        ))}
      </ol>
      {visible < ranked.length && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          className="mt-4 w-full rounded-lg border border-neutral-300 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Show {Math.min(PAGE_SIZE, ranked.length - visible)} more of {ranked.length.toLocaleString()}
        </button>
      )}
    </div>
  );
}

function ResultRow({
  rank,
  score: s,
  data,
  rel,
  selected,
  onSelect,
}: {
  rank: number;
  score: CountyScore;
  data: CountyDataset;
  rel: number | null | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li
      className={
        selected
          ? "bg-emerald-50 dark:bg-emerald-950/40"
          : s.status === "unknown"
            ? "bg-neutral-50 dark:bg-neutral-900/50"
            : ""
      }
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="grid w-full grid-cols-[2rem_1fr_auto] items-start gap-2 px-2 py-3 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900"
      >
        <span className="pt-0.5 text-sm tabular-nums text-neutral-500">{rank}</span>

        <span className="min-w-0">
          <span className="block font-medium">
            {data.countyName[s.index]}, {data.state[s.index]}
            <StatusBadges score={s} />
          </span>
          <Reasons score={s} />
        </span>

        <ScoreBadge score={s.score} rel={rel} />
      </button>
    </li>
  );
}

export function Reasons({ score }: { score: CountyScore }) {
  const { strengths, weaknesses } = explainScore(score);
  if (strengths.length === 0 && weaknesses.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5 text-xs">
      {strengths.map((c) => (
        <Reason key={c.metric} c={c} good />
      ))}
      {weaknesses.map((c) => (
        <Reason key={c.metric} c={c} good={false} />
      ))}
    </span>
  );
}

export function StatusBadges({ score: s }: { score: CountyScore }) {
  const names = (keys: readonly FilterKey[]) => keys.map(filterLabel).join(", ");
  return (
    <>
      {s.status === "unknown" && (
        <span
          title={`No data for: ${names(s.unknownFilters)}`}
          className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 align-middle text-[11px] font-normal text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
        >
          Unknown for a limit
        </span>
      )}
      {s.missingMetrics.length > 0 && (
        <span
          title={`Scored without: ${names(s.missingMetrics)}`}
          className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[11px] font-normal text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Partial data
        </span>
      )}
    </>
  );
}

function Reason({ c, good }: { c: MetricContribution; good: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 ${
        good
          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
      }`}
    >
      <span aria-hidden>{good ? "▲" : "▼"}</span> {getMetric(c.metric).label}{" "}
      <span className="opacity-70">{formatValue(c.metric, c.value)}</span>
    </span>
  );
}

/**
 * Bar length = the absolute score; bar color = the county's position among the
 * map's top results (`rel`), so a county is the same color here as on the map.
 * Outside the top results the bar is grey — it isn't colored on the map either.
 */
export function ScoreBadge({ score, rel }: { score: number | null; rel: number | null | undefined }) {
  if (score === null) {
    return <span className="pt-0.5 text-xs text-neutral-400">—</span>;
  }
  return (
    <span className="flex w-24 items-center gap-2 pt-1">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <span
          className="block h-full rounded-full"
          style={{ width: `${score}%`, backgroundColor: typeof rel === "number" ? scoreColor(rel) : UNKNOWN_COLOR }}
        />
      </span>
      <span className="w-7 text-right text-sm font-semibold tabular-nums">{Math.round(score)}</span>
    </span>
  );
}
