"use client";

import type { CountyDataset, CountyScore } from "@/lib/scoring";

import { Breakdown, Reasons, ScoreBadge, StatusBadges } from "./results-list";

interface Props {
  score: CountyScore;
  data: CountyDataset;
  /** 1-based position in the current ranking, or null if it isn't in it. */
  rank: number | null;
  total: number;
  rel: number | null | undefined;
  onClose: () => void;
}

/** The county picked on the map or in the list, with its full score breakdown. */
export function SelectedCounty({ score: s, data, rank, total, rel, onClose }: Props) {
  const where =
    s.status === "excluded"
      ? "Ruled out by a limit"
      : rank !== null
        ? `#${rank.toLocaleString()} of ${total.toLocaleString()}`
        : "Hidden (unknown for a limit)";

  return (
    <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">{where}</p>
          <h3 className="font-semibold">
            {data.countyName[s.index]}, {data.state[s.index]}
            <StatusBadges score={s} />
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <ScoreBadge score={s.score} rel={rel} />
          <button
            type="button"
            onClick={onClose}
            title="Clear selection"
            className="rounded px-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          >
            <span aria-hidden>×</span>
            <span className="sr-only">Clear selection</span>
          </button>
        </div>
      </div>
      {s.failedFilters.length > 0 && (
        <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">
          Fails your limit on {s.failedFilters.length === 1 ? "one metric" : `${s.failedFilters.length} metrics`}.
        </p>
      )}
      <Reasons score={s} />
      <div className="mt-3 max-h-64 overflow-y-auto">
        <Breakdown score={s} />
      </div>
    </div>
  );
}
