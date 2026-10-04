"use client";

import { useState, type ReactNode } from "react";

import type { LawData } from "@/lib/laws";
import {
  categoryLabel,
  climateFamily,
  formatValue,
  type CountyDataset,
  type CountyScore,
  type MetricKey,
} from "@/lib/scoring";

import { InfoTip } from "@/components/ui/info-tip";

import { ClimateIcon } from "./climate-icons";
import { ClimateTab } from "./climate-tab";
import { LawsSection } from "./laws-section";
import { PlaceOverview } from "./place-overview";
import { StatusBadges } from "./results-list";
import { scoreColor } from "./score-colors";

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
  /** The county the Climate tab compares against, if any (remembered across places). */
  compareFips: string | null;
  onCompare: (fips: string | null) => void;
  onBack: () => void;
  /** Present when this county has area data (Phase 8): opens "Explore inside". */
  onExploreInside?: () => void;
  /** How many areas the county has, for the button. */
  areaCount?: number;
  /** When the results are areas (Phase 8f): the county's best areas, first on the page. */
  bestAreas?: ReactNode;
  /** …and its best area's score, which ranks the county then (shown instead of its own). */
  bestScore?: number;
}

/**
 * Back link, name and rank, laid out like an area's (Phase 8f, owner 2026-10-04):
 * the rank on the right, colored as the map colors ranks. On phones this is the
 * sheet's drag header.
 */
export function PlaceIdentity({ score: s, data, rank, total, onBack }: PlaceProps) {
  const people = data.values.population[s.index];
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 rounded px-1 text-label font-medium text-emerald-700 hover:underline dark:text-emerald-400"
      >
        ← Results
      </button>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-heading font-semibold">{data.countyName[s.index]}</h2>
          <p className="mt-0.5 text-label text-neutral-500">
            {categoryLabel("state", data.state[s.index])}
            {!Number.isNaN(people) && ` · ${Math.round(people).toLocaleString()} people`}
            <StatusBadges score={s} />
          </p>
        </div>
        <div className="shrink-0 text-right">
          {s.status !== "excluded" && rank !== null ? (
            <>
              <span
                className="block text-heading font-bold tabular-nums"
                style={{ color: scoreColor(total > 1 ? 100 * (1 - (rank - 1) / (total - 1)) : 100) }}
              >
                #{rank.toLocaleString()}
              </span>
              <span className="block text-caption text-neutral-500">
                of {total.toLocaleString()} {total === 1 ? "county" : "counties"}
              </span>
            </>
          ) : (
            <span className="block max-w-28 text-caption text-neutral-500">
              {s.status === "excluded" ? "Ruled out by a must-have" : "Hidden: no data for a must-have"}
            </span>
          )}
        </div>
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
  const { score: s, data, laws, compareFips, onCompare, withIdentity } = props;
  const [tab, setTab] = useState<PlaceTab>("overview");
  const facts = QUICK_FACTS.map((f) => ({ ...f, value: data.values[f.metric][s.index] })).filter(
    (f) => !Number.isNaN(f.value),
  );
  const koppen = data.categories.koppen[s.index];

  return (
    <div>
      <div className="px-gutter pt-4">
        {withIdentity && <PlaceIdentity {...props} />}
        {/* First under the name: on phones the sheet opens half-way, and below the facts
            this was out of sight until you scrolled. */}
        {props.bestAreas && <div className={withIdentity ? "mt-4" : ""}>{props.bestAreas}</div>}
        {props.onExploreInside && !props.bestAreas && (
          <button
            type="button"
            onClick={props.onExploreInside}
            className={`flex w-full items-center justify-between gap-3 rounded-lg border border-emerald-600/40 bg-emerald-50 px-3 py-2.5 text-left hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:hover:bg-emerald-950 ${withIdentity ? "mt-4" : ""}`}
          >
            <span>
              <span className="block text-label font-semibold text-emerald-800 dark:text-emerald-300">
                Explore inside {data.countyName[s.index]}
              </span>
              <span className="block text-caption text-emerald-800/80 dark:text-emerald-300/80">
                {props.areaCount ? `${props.areaCount} areas` : "Its towns and neighborhoods"}: schools, home values,
                walkability, distances
              </span>
            </span>
            <span aria-hidden className="text-title text-emerald-700 dark:text-emerald-400">→</span>
          </button>
        )}
        {(facts.length > 0 || koppen) && (
          <dl className={`grid grid-cols-2 gap-2 ${withIdentity || props.onExploreInside || props.bestAreas ? "mt-4" : ""}`}>
            {facts.map((f) => (
              <Stat
                key={f.metric}
                label={f.label}
                tip={f.metric === "rpp_all" ? <CostOfLivingNote value={f.value} data={data} index={s.index} /> : undefined}
              >
                <span className="tabular-nums">{formatValue(f.metric, f.value)}</span>
              </Stat>
            ))}
            {koppen && (
              <Stat label="Climate" wide>
                <ClimateSummary code={koppen} />
              </Stat>
            )}
          </dl>
        )}
      </div>

      <div
        role="tablist"
        aria-label="County details"
        className="sticky top-0 z-10 mt-4 grid grid-cols-3 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
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
            className={`-mb-px border-b-2 px-2 py-3 text-center text-label font-medium ${
              tab === t.id
                ? "border-emerald-600 text-neutral-900 dark:text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="place-tabpanel" role="tabpanel" aria-labelledby={`place-tab-${tab}`} className="px-gutter py-4">
        {tab === "overview" && <PlaceOverview score={s} data={data} />}
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

function Stat({
  label,
  wide = false,
  tip,
  children,
}: {
  label: string;
  wide?: boolean;
  /** An explanation behind an "i" beside the label. */
  tip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-lg bg-neutral-100 px-3 py-2 dark:bg-neutral-900 ${wide ? "col-span-2" : ""}`}>
      <dt className="flex items-center gap-1 text-caption text-neutral-500 dark:text-neutral-400">
        {label}
        {tip && <InfoTip label={label}>{tip}</InfoTip>}
      </dt>
      <dd className="mt-0.5 text-body font-semibold">{children}</dd>
    </div>
  );
}

/**
 * What the cost-of-living number is: BEA's Regional Price Parity, an index
 * where 100 is the US average price level — read here as a percentage.
 */
function CostOfLivingNote({ value, data, index }: { value: number; data: CountyDataset; index: number }) {
  const diff = Math.round(Math.abs(value - 100) * 10) / 10;
  const where = data.rppGeoLevel[index] === "metro" ? "metro" : "state";
  const area = data.text.rpp_source_geo[index];
  return (
    <>
      <p>
        An index of local prices where <strong>100 = the US average</strong>.{" "}
        {diff < 0.5 ? (
          <>Prices here are about the same as the US average.</>
        ) : (
          <>
            {formatValue("rpp_all", value)} means prices here are about <strong>{diff}% {value > 100 ? "above" : "below"}</strong>{" "}
            the US average.
          </>
        )}
      </p>
      <p className="mt-2">
        Covers rent, goods, utilities and services (BEA Regional Price Parities, 2024). BEA publishes it for metro
        areas and states only;{" "}
        {where === "metro"
          ? `this county uses its metro’s figure${area ? ` (${area})` : ""}.`
          : `this county isn’t in a metro, so it uses ${area ?? "its state"}’s statewide figure, which runs high for rural areas.`}
      </p>
    </>
  );
}

/** "💧 Humid South · Hot, humid summers; mild winters", Köppen type underneath. */
function ClimateSummary({ code }: { code: string }) {
  const family = climateFamily(code);
  if (!family) return <>{categoryLabel("koppen", code)}</>;
  return (
    <span className="flex items-start gap-2">
      <ClimateIcon family={family.id} className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
      <span>
        {family.name}
        <span className="font-normal text-neutral-600 dark:text-neutral-400"> · {family.description}</span>
        <span className="block text-caption font-normal text-neutral-500">{categoryLabel("koppen", code)}</span>
      </span>
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-neutral-500">{children}</p>;
}
