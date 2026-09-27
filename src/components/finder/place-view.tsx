"use client";

import { useState, type ReactNode } from "react";

import type { LawData } from "@/lib/laws";
import { formatValue, type CountyDataset, type CountyScore, type MetricKey, type ScoringInput } from "@/lib/scoring";

import { ClimateTab } from "./climate-tab";
import { LawsSection } from "./laws-section";
import { PlaceOverview } from "./place-overview";
import { ScoreBadge, StatusBadges } from "./results-list";

/**
 * The place view (plan Phase 6): what the Results panel / sheet shows once a
 * county is selected — like a Google Maps place sheet. The header says which
 * county and how it ranks; tabs hold the detail. Always opens on Overview
 * (the parent remounts this per county).
 */

type PlaceTab = "overview" | "climate" | "laws";

const TABS: { id: PlaceTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "climate", label: "Climate" },
  { id: "laws", label: "Laws & taxes" },
];

/** A few headline numbers under the name. */
const QUICK_FACTS: { metric: MetricKey; label: string }[] = [
  { metric: "population", label: "Population" },
  { metric: "rpp_all", label: "Cost of living" },
  { metric: "median_home_value", label: "Home value" },
  { metric: "school_achievement", label: "Schools" },
];

export interface PlaceProps {
  score: CountyScore;
  /** The scored (scoped) dataset `score.index` points into. */
  data: CountyDataset;
  /** 1-based position in the current ranking, or null if it isn't in it. */
  rank: number | null;
  total: number;
  rel: number | null | undefined;
  laws: LawData | null;
  /** The search the county was scored against (for the Overview's filter list). */
  input: ScoringInput;
  /** The county the Climate tab compares against, if any (remembered across places). */
  compareFips: string | null;
  onCompare: (fips: string | null) => void;
  onBack: () => void;
}

/** Back link, name, rank and score. On phones this is the sheet's drag header. */
export function PlaceIdentity({ score: s, data, rank, total, rel, onBack }: PlaceProps) {
  const where =
    s.status === "excluded"
      ? "Ruled out by a filter"
      : rank !== null
        ? `#${rank.toLocaleString()} of ${total.toLocaleString()}`
        : "Hidden (unknown for a filter)";
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 rounded px-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
      >
        ← All results
      </button>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold leading-tight">
            {data.countyName[s.index]}, {data.state[s.index]}
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            {where}
            <StatusBadges score={s} />
          </p>
        </div>
        <ScoreBadge score={s.score} rel={rel} />
      </div>
    </div>
  );
}

/**
 * Everything below the identity: quick facts, the tab strip (sticky), and
 * the selected tab. `withIdentity` is false on phones, where the identity
 * lives in the sheet header instead.
 */
export function PlaceView(props: PlaceProps & { withIdentity: boolean }) {
  const { score: s, data, laws, input, compareFips, onCompare, withIdentity } = props;
  const [tab, setTab] = useState<PlaceTab>("overview");
  const facts = QUICK_FACTS.map((f) => ({ ...f, value: data.values[f.metric][s.index] })).filter(
    (f) => !Number.isNaN(f.value),
  );

  return (
    <div>
      <div className="px-4 pt-3">
        {withIdentity && <PlaceIdentity {...props} />}
        {facts.length > 0 && (
          <ul className={`flex flex-wrap gap-1.5 ${withIdentity ? "mt-3" : ""}`}>
            {facts.map((f) => (
              <li
                key={f.metric}
                className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs dark:bg-neutral-900"
              >
                <span className="text-neutral-500">{f.label}</span>{" "}
                <span className="font-medium tabular-nums">{formatValue(f.metric, f.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        role="tablist"
        aria-label="County details"
        className="sticky top-0 z-10 mt-3 flex border-b border-neutral-200 bg-white px-2 dark:border-neutral-800 dark:bg-neutral-950"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`place-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="place-tabpanel"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? "border-emerald-600 text-neutral-900 dark:text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="place-tabpanel" role="tabpanel" aria-labelledby={`place-tab-${tab}`} className="px-4 py-3">
        {tab === "overview" && <PlaceOverview score={s} data={data} input={input} />}
        {tab === "climate" && (
          <ClimateTab fips={s.fips} data={data} compareFips={compareFips} onCompare={onCompare} />
        )}
        {tab === "laws" &&
          (laws ? (
            <LawsSection laws={laws} data={data} index={s.index} />
          ) : (
            <Empty>Law and tax data couldn&rsquo;t be loaded.</Empty>
          ))}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-neutral-500">{children}</p>;
}
