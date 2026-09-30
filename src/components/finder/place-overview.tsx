"use client";

import {
  categoryLabel,
  climateFamily,
  describeClimateFilter,
  describeLimit,
  explainScore,
  formatValue,
  getCategory,
  getMetric,
  ordinal,
  type CountyDataset,
  type CountyScore,
  type FilterKey,
  type MetricContribution,
  type ScoringInput,
} from "@/lib/scoring";

import { InfoTip } from "@/components/ui/info-tip";

import { Reasons } from "./results-list";

interface Props {
  score: CountyScore;
  data: CountyDataset;
  /** The search this county was scored against, to list its filters. */
  input: ScoringInput;
}

/**
 * The place view's Overview tab (plan Phase 6): does this county pass your
 * filters, why does it rank where it does, and how each weighted metric
 * counted. Rows rather than a table, so it fits a phone.
 */
export function PlaceOverview({ score: s, data, input }: Props) {
  const filterRows = [
    ...(input.filters ?? []).map((f) => ({
      key: f.metric as FilterKey,
      label: getMetric(f.metric).label,
      rule: describeLimit(f.metric, f),
      value: formatValue(f.metric, nanToNull(data.values[f.metric][s.index])),
    })),
    ...(input.categoryFilters ?? []).map((f) => {
      const def = getCategory(f.category);
      const v = data.categories[f.category][s.index];
      // Climate type speaks in families (the Must-haves cards), not Köppen codes.
      if (f.category === "koppen") {
        const present = new Set(data.categories.koppen.filter((k): k is string => k !== null));
        return {
          key: f.category as FilterKey,
          label: "Climate",
          rule: describeClimateFilter(f.accept, present),
          value: v === null ? "No data" : (climateFamily(v)?.name ?? v),
        };
      }
      return {
        key: f.category as FilterKey,
        label: def.label,
        rule:
          f.accept.length === 0
            ? "nothing allowed"
            : `${f.accept.length === 1 ? "must be" : "one of"} ${listLabels(f.accept.map((a) => categoryLabel(f.category, a)))}`,
        value: v === null ? "No data" : categoryLabel(f.category, v),
      };
    }),
  ];
  const failed = new Set(s.failedFilters);
  const unknown = new Set(s.unknownFilters);
  const { strengths, weaknesses } = explainScore(s);
  const rows = [...s.contributions].sort((a, b) => (b.impact ?? -Infinity) - (a.impact ?? -Infinity));

  return (
    <div className="space-y-5">
      <StatusLine score={s} filterCount={filterRows.length} />

      {(strengths.length > 0 || weaknesses.length > 0) && (
        <section>
          <SectionTitle>Why it ranks here</SectionTitle>
          <Reasons score={s} />
        </section>
      )}

      {filterRows.length > 0 && (
        <section>
          <SectionTitle>Your filters</SectionTitle>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {filterRows.map((f) => {
              const state = failed.has(f.key) ? "fail" : unknown.has(f.key) ? "unknown" : "pass";
              return (
                <li key={f.key} className="flex items-start gap-2 py-2 text-label">
                  <FilterIcon state={state} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>{f.label}</span>
                      <span
                        className={`shrink-0 text-right font-medium tabular-nums ${
                          state === "fail" ? "text-rose-700 dark:text-rose-400" : state === "unknown" ? "text-neutral-400" : ""
                        }`}
                      >
                        {f.value}
                      </span>
                    </div>
                    <p className="text-caption text-neutral-500">Yours: {f.rule}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <LocationFacts data={data} index={s.index} />
      <HazardFacts data={data} index={s.index} />

      <section>
        <SectionTitle
          tip={
            rows.length > 0 &&
            "Each weighted metric gives 0–100 points by where this county sits among all counties (flipped when lower is better; closest to the typical county when average is better). The score is the weighted average of the points. Effect = weight × (points − 50): how far that metric pushed the score up or down."
          }
        >
          How it&rsquo;s scored
        </SectionTitle>
        {rows.length === 0 ? (
          <p className="text-label text-neutral-500">Nothing is weighted yet, so there is no score to break down.</p>
        ) : (
          <>
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {rows.map((c) => (
                <ContributionRow key={c.metric} c={c} />
              ))}
            </ul>
          </>
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

function StatusLine({ score: s, filterCount }: { score: CountyScore; filterCount: number }) {
  if (s.status === "excluded") {
    const n = s.failedFilters.length;
    return (
      <p className="rounded-lg bg-rose-50 px-3 py-2 text-label text-rose-900 dark:bg-rose-950 dark:text-rose-200">
        Ruled out — fails {n === 1 ? "1 of your filters" : `${n} of your filters`}.
      </p>
    );
  }
  if (s.status === "unknown") {
    const n = s.unknownFilters.length;
    return (
      <p className="rounded-lg bg-neutral-100 px-3 py-2 text-label text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        No data for {n === 1 ? "1 of your filters" : `${n} of your filters`} — kept as unknown, not guessed.
      </p>
    );
  }
  if (filterCount === 0) return null;
  return (
    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-label text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
      Passes all {filterCount === 1 ? "1 of your filters" : `${filterCount} of your filters`}.
    </p>
  );
}

function ContributionRow({ c }: { c: MetricContribution }) {
  const def = getMetric(c.metric);
  const better = c.direction === "middle" ? "average is better" : c.direction === "lower" ? "lower is better" : "higher is better";
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
                className={`h-full rounded-full ${c.percentile >= 50 ? "bg-emerald-500" : "bg-rose-500"}`}
                style={{ width: `${Math.max(2, c.percentile)}%` }}
              />
            </div>
            <span className="w-14 text-right text-caption tabular-nums text-neutral-500">{Math.round(c.percentile)} pts</span>
          </div>
          <p className="mt-0.5 text-caption text-neutral-500">
            {ordinal(c.rawPercentile ?? 0)} percentile · {better} · weight {c.weight} ·{" "}
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

function FilterIcon({ state }: { state: "pass" | "fail" | "unknown" }) {
  const cls = {
    pass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    fail: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
    unknown: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  }[state];
  const label = { pass: "Passes", fail: "Fails", unknown: "No data" }[state];
  return (
    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-caption font-bold ${cls}`} title={label}>
      <span aria-hidden>{state === "pass" ? "✓" : state === "fail" ? "✕" : "?"}</span>
      <span className="sr-only">{label}</span>
    </span>
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

/** "A, B, C, D +3 more" — long accepted lists stay readable. */
function listLabels(labels: string[], max = 4): string {
  return labels.length <= max ? labels.join(", ") : `${labels.slice(0, max).join(", ")} +${labels.length - max} more`;
}

function nanToNull(v: number): number | null {
  return Number.isNaN(v) ? null : v;
}
