"use client";

import {
  formatValue,
  getMetric,
  ordinal,
  type CountyDataset,
  type CountyScore,
  type MetricContribution,
} from "@/lib/scoring";

import { InfoTip } from "@/components/ui/info-tip";

import { barColor, isGold, scoreColor } from "./score-colors";

interface Props {
  score: CountyScore;
  data: CountyDataset;
}

/**
 * The place view's Overview tab: where the county is, its hazards, and how its
 * county-wide priorities scored — laid out like an area's breakdown (owner,
 * 2026-10-04: the old reasons and filter checklist are gone; a note shows only
 * when the county is ruled out or unknown).
 */
export function PlaceOverview({ score: s, data }: Props) {
  const rows = [...s.contributions].sort((a, b) => (b.impact ?? -Infinity) - (a.impact ?? -Infinity));

  return (
    <div className="space-y-5">
      <StatusLine score={s} />

      <LocationFacts data={data} index={s.index} />
      <HazardFacts data={data} index={s.index} />

      <section>
        <div className="flex items-start justify-between gap-3">
          <SectionTitle
            tip={
              rows.length > 0 &&
              "Each county-wide priority gives 0–100 points by where this county sits among all US counties (flipped when lower is better; closest to the typical county when average is better). The score is the weighted average of the points. Effect = weight × (points − 50): how far it pushed the score up or down."
            }
          >
            How it&rsquo;s scored
          </SectionTitle>
          {s.score !== null && (
            <span className="font-bold tabular-nums" style={{ color: scoreColor(s.score) }}>
              {Math.round(s.score)}
            </span>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-label text-neutral-500">No county-wide priority is weighted, so there is no county score to break down.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {rows.map((c) => (
              <ContributionRow key={c.metric} c={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Where it is: nearest major airport and big metro, and the coast. Always shown. */
function LocationFacts({ data, index: i }: { data: CountyDataset; index: number }) {
  const mi = (v: number) => (Number.isNaN(v) ? null : formatValue("dist_airport_mi", v));
  const rows = [
    { label: "Nearest major airport", name: data.text.nearest_airport[i], dist: mi(data.values.dist_airport_mi[i]) },
    { label: "Nearest metro of 500k+", name: data.text.nearest_metro[i], dist: mi(data.values.dist_metro_mi[i]) },
    { label: "Coast (ocean, bays, tidal water)", name: null, dist: mi(data.values.dist_coast_mi[i]) },
  ].filter((r) => r.dist !== null);
  if (rows.length === 0) return null;
  return (
    <section>
      <SectionTitle tip="Straight-line miles from where people in the county live. Airports: OurAirports (large, scheduled service). Coast: Natural Earth.">
        Location
      </SectionTitle>
      <ul className="space-y-1 text-label">
        {rows.map((r) => (
          <li key={r.label} className="flex items-baseline justify-between gap-3">
            <span className="text-neutral-600 dark:text-neutral-400">{r.label}</span>
            <span className="text-right">
              {r.name && <span className="mr-1.5">{r.name}</span>}
              <span className="font-medium tabular-nums">{r.dist}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const HAZARD_KEYS = [
  "hazard_risk",
  "hazard_hurricane",
  "hazard_wildfire",
  "hazard_inland_flood",
  "hazard_coastal_flood",
  "hazard_earthquake",
  "hazard_tornado",
] as const;

/** FEMA's five-step wording for a percentile. */
function hazardWord(p: number): string {
  return p < 20 ? "Very low" : p < 40 ? "Low" : p < 60 ? "Moderate" : p < 80 ? "High" : "Very high";
}

/** Natural hazards (FEMA NRI loss-rate percentiles), always shown, weighted or not. */
function HazardFacts({ data, index: i }: { data: CountyDataset; index: number }) {
  const rows = HAZARD_KEYS.map((k) => ({ k, v: data.values[k][i] })).filter((r) => !Number.isNaN(r.v));
  if (rows.length === 0) return null;
  return (
    <section>
      <SectionTitle tip="FEMA National Risk Index (Dec 2025): where the county ranks nationally on the share of its buildings, people and farms expected to be lost to each hazard in a typical year. “None” = the hazard doesn’t occur there.">
        Natural hazards
      </SectionTitle>
      <ul className="space-y-1 text-label">
        {rows.map(({ k, v }) => (
          <li key={k} className="flex items-baseline justify-between gap-3">
            <span className={k === "hazard_risk" ? "font-medium" : "text-neutral-600 dark:text-neutral-400"}>
              {getMetric(k).label}
            </span>
            <span className="text-right">
              <span className="mr-1.5">{v === 0 ? "None" : hazardWord(v)}</span>
              <span className="text-caption tabular-nums text-neutral-500">{v === 0 ? "" : formatValue(k, v)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Only when something's off: ruled out, or kept as unknown. */
function StatusLine({ score: s }: { score: CountyScore }) {
  if (s.status === "excluded") {
    const n = s.failedFilters.length;
    return (
      <p className="rounded-lg bg-rose-50 px-3 py-2 text-label text-rose-900 dark:bg-rose-950 dark:text-rose-200">
        Ruled out — fails {n === 1 ? "1 of your must-haves" : `${n} of your must-haves`}.
      </p>
    );
  }
  if (s.status === "unknown") {
    const n = s.unknownFilters.length;
    return (
      <p className="rounded-lg bg-neutral-100 px-3 py-2 text-label text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        No data for {n === 1 ? "1 of your must-haves" : `${n} of your must-haves`} — kept as unknown, not guessed.
      </p>
    );
  }
  return null;
}

/** Where the value stands, said the way the points read: "lower than 96% of US counties". */
function standing(c: MetricContribution): string {
  const raw = Math.round(c.rawPercentile ?? 0);
  if (c.direction === "lower") return `lower than ${Math.max(0, 100 - raw)}% of US counties`;
  if (c.direction === "higher") return `higher than ${raw}% of US counties`;
  return `${ordinal(raw)} percentile of US counties · typical is best`;
}

/** One priority's part of the score, drawn like an area's (barColor, gold at the top 1%). */
function ContributionRow({ c }: { c: MetricContribution }) {
  const def = getMetric(c.metric);
  return (
    <li className="py-2 text-label">
      <div className="flex items-baseline justify-between gap-3">
        <span>{def.label}</span>
        <span className="shrink-0 font-medium tabular-nums">{formatValue(c.metric, c.value)}</span>
      </div>
      {c.percentile === null ? (
        <p className="text-caption text-neutral-500">No data — left out of this county&rsquo;s score (weight {c.weight}).</p>
      ) : (
        <>
          <div className="mt-1 flex items-center gap-2">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
              role="img"
              aria-label={`${Math.round(c.percentile)} of 100 points`}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, c.percentile)}%`,
                  backgroundColor: barColor(c.percentile),
                  boxShadow: isGold(c.percentile) ? "0 0 6px rgba(212,160,23,.7)" : undefined,
                }}
              />
            </div>
            <span className="w-14 text-right text-caption tabular-nums text-neutral-500">{Math.round(c.percentile)} pts</span>
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
  );
}

/** A section heading, with an "i" for its explanation when there is one. */
function SectionTitle({ children, tip }: { children: React.ReactNode; tip?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1">
      <h3 className="text-caption font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{children}</h3>
      {tip && <InfoTip label={String(children)}>{tip}</InfoTip>}
    </div>
  );
}

