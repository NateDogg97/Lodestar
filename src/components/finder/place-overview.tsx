"use client";

import { formatValue, getMetric, type CountyDataset, type CountyScore, type MetricContribution } from "@/lib/scoring";
import { buyOrRentVerdict, locationVerdict, tradeOff, US_TYPICAL_COUNTY, type AreaPart } from "@/lib/tracts";

import { AreaSection, HazardsSection, Note, PeopleSection, PlaceRow, PriorityBar } from "./area-detail";
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
  beats: c.beats,
  flagged: false,
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

      <HousingCosts data={data} index={i} />

      <PeopleSection
        id="county.who"
        of="county"
        typical={US_TYPICAL_COUNTY}
        equality={{
          score: num(data.values.racial_equality[i]),
          parity: num(data.info.income_parity[i]),
          integration: num(data.info.integration[i]),
          typical: US_TYPICAL_COUNTY.racial_equality,
          county: data.countyName[i],
        }}
        get={(k) => {
          const col = data.info[k as keyof typeof data.info];
          return col && !Number.isNaN(col[i]) ? col[i] : null;
        }}
      />

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

/**
 * The county's housing costs against its own incomes (owner, 2026-10-04): context, not
 * filters — a mover's own income is what decides affordability, so these ratios say what
 * the place is like rather than rank it. Census county medians, 2019–2023.
 */
function HousingCosts({ data, index: i }: { data: CountyDataset; index: number }) {
  const v = (k: "median_home_value" | "median_gross_rent" | "price_to_rent" | "home_value_to_income" | "rent_to_income" | "property_tax_effective_rate") => {
    const x = data.values[k][i];
    return Number.isNaN(x) ? null : x;
  };
  const home = v("median_home_value");
  const rent = v("median_gross_rent");
  if (home === null && rent === null) return null;
  const ptr = v("price_to_rent");
  const hti = v("home_value_to_income");
  const rti = v("rent_to_income");
  const tax = v("property_tax_effective_rate");
  return (
    <AreaSection
      id="county.housing"
      icon="home"
      title="Housing costs"
      lead={buyOrRentVerdict(ptr)}
      details={
        <>
          {hti !== null && (
            <PlaceRow name="A home, in years of local income" sub="Median home value ÷ median household income · about 3 is typical" value={`${hti.toFixed(1)}×`} />
          )}
          {rti !== null && (
            <PlaceRow name="Rent, as a share of local income" sub="A year of median rent ÷ median household income · 30% is the usual ceiling" value={formatValue("rent_to_income", rti)} />
          )}
          {tax !== null && (
            <PlaceRow name="Property tax" sub="Taxes paid ÷ home values, owner-occupied" value={formatValue("property_tax_effective_rate", tax)} />
          )}
          <Note>
            Census county medians, 2019–2023: they describe the people who live here now. For the price of a home in a
            specific area at today&rsquo;s prices, open one of its areas.
          </Note>
        </>
      }
    >
      {home !== null && <PlaceRow name="Median home value" sub="Census, 2019–2023" value={formatValue("median_home_value", home)} />}
      {rent !== null && <PlaceRow name="Median rent" sub="Census, incl. utilities" value={formatValue("median_gross_rent", rent)} />}
    </AreaSection>
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
