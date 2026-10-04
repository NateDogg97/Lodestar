"use client";

import { formatValue, getMetric, type CountyDataset, type CountyScore, type MetricContribution } from "@/lib/scoring";
import { locationVerdict, tradeOff, type AreaPart } from "@/lib/tracts";

import { AreaSection, HazardsSection, Note, PlaceRow, PriorityBar } from "./area-detail";
import { scoreColor } from "./score-colors";

interface Props {
  score: CountyScore;
  data: CountyDataset;
}

/** A county priority's contribution in the shape the area page's bars draw. */
const asPart = (c: MetricContribution): AreaPart => ({
  key: c.metric,
  label: getMetric(c.metric).label,
  level: "county",
  direction: c.direction,
  weight: c.weight,
  value: c.value,
  rawPercentile: c.rawPercentile,
  points: c.percentile,
  impact: c.impact,
});

/**
 * The place view's Overview tab, in the area page's section style (owner, 2026-10-04):
 * how its county-wide priorities scored (grows in place), where it is, and its natural
 * hazards. A note shows only when the county is ruled out or unknown.
 */
export function PlaceOverview({ score: s, data }: Props) {
  const i = s.index;
  const parts = s.contributions.map(asPart).sort((a, b) => Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0));
  const rest = Math.max(0, parts.length - 3);
  const num = (v: number) => (Number.isNaN(v) ? null : v);
  const metroMi = num(data.values.dist_metro_mi[i]);
  const airportMi = num(data.values.dist_airport_mi[i]);
  const coastMi = num(data.values.dist_coast_mi[i]);
  const mi = (v: number | null) => (v === null ? "—" : formatValue("dist_airport_mi", v));

  return (
    <div>
      <StatusLine score={s} />

      <AreaSection
        id="county.scored"
        icon="star"
        tone="amber"
        title="How it’s scored"
        lead={parts.length ? tradeOff(parts) : "No county-wide priority is weighted"}
        right={
          s.score !== null && (
            <span className="text-title font-bold tabular-nums" style={{ color: scoreColor(s.score) }}>
              {Math.round(s.score)}
            </span>
          )
        }
        expandable={rest > 0}
        detailsLabel={`Show the other ${rest} ${rest === 1 ? "priority" : "priorities"}`}
        lessLabel="Show less"
      >
        {(more: boolean) =>
          parts.length === 0 ? (
            <Note>Add county-wide priorities (cost of living, climate, taxes…) in Filters to score counties.</Note>
          ) : (
            <>
              {(more ? parts : parts.slice(0, 3)).map((c) => (
                <PriorityBar key={c.key} c={c} full={more} showLevel={false} />
              ))}
              {more && (
                <Note>
                  Each county-wide priority gives 0–100 points by where this county sits among all US counties. The score is
                  the weighted average of the points; effect = weight × (points − 50).
                </Note>
              )}
            </>
          )
        }
      </AreaSection>

      {(metroMi !== null || airportMi !== null || coastMi !== null) && (
        <AreaSection
          id="county.location"
          icon="route"
          title="Location"
          lead={locationVerdict(metroMi, data.text.nearest_metro[i])}
          details={
            coastMi !== null ? (
              <>
                <PlaceRow name="Coast" sub="Ocean, bays, tidal water" value={mi(coastMi)} />
                <Note>
                  Straight-line miles from where people in the county live. Airports: OurAirports (large, scheduled
                  service). Coast: Natural Earth.
                </Note>
              </>
            ) : undefined
          }
        >
          {metroMi !== null && (
            <PlaceRow
              name={data.text.nearest_metro[i]?.split(",")[0] ?? "Big metro"}
              sub="Nearest metro of 500k+"
              value={mi(metroMi)}
            />
          )}
          {airportMi !== null && (
            <PlaceRow name={data.text.nearest_airport[i] ?? "Major airport"} sub="Nearest major airport" value={mi(airportMi)} />
          )}
        </AreaSection>
      )}

      <HazardsSection
        id="county.hazards"
        get={(k) => {
          const col = data.values[k as keyof typeof data.values];
          return col ? num(col[i]) : null;
        }}
      />
    </div>
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
