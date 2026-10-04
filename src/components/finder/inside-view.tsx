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
  type Area,
  type AreaCriterion,
  type AreaLimit,
  type AreaScore,
  topReasons,
  type CountyAreas,
  type School,
} from "@/lib/tracts";
import { ordinal } from "@/lib/scoring/format";

import { ScoreBadge } from "./results-list";
import type { CountyAreasState } from "./use-tract-data";

/** Areas ranked by the search (plan §9 Phase 8e), as county-finder computes it. */
export interface AreaRankingView {
  criteria: AreaCriterion[];
  limits: AreaLimit[];
  scores: Map<string, AreaScore>;
  /** Position among the county's scored areas, 0–100: the color. */
  rel: Map<string, number>;
  /** Ruled out by a must-have (or unknown, when unknowns are hidden). */
  hidden: Set<string>;
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
}

export function InsideView({
  countyName,
  state,
  ranking,
  fallbackMeasure,
  onEditFilters,
  selected,
  onSelect,
  onHover,
  onBack,
}: Props) {
  const areas = state.status === "ready" ? state.data.areas : null;
  const area = selected && areas ? (areas.byGeoid.get(selected) ?? null) : null;

  return (
    <div>
      <div className="px-gutter pt-4">
        <button
          type="button"
          onClick={area ? () => onSelect(null) : onBack}
          className="-ml-1 rounded px-1 text-label font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          ← {area ? `All areas in ${countyName}` : countyName}
        </button>
        {area ? (
          <AreaHeader area={area} />
        ) : (
          <>
            <h2 className="mt-1 text-heading font-semibold">Inside {countyName}</h2>
            {areas && (
              <p className="mt-0.5 text-label text-neutral-500">
                {areas.areas.length.toLocaleString()} areas · grouped by city, town or community
              </p>
            )}
          </>
        )}
      </div>

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
  const ranked = ranking !== null && ranking.criteria.length > 0;
  const hiddenCount = ranking?.hidden.size ?? 0;
  const score = (a: Area) => (ranked ? (ranking!.scores.get(a.geoid)?.score ?? null) : null);
  // Higher first: match score when ranked, else the measure.
  const key = (a: Area) => (ranked ? score(a) : areaValue(a, measure)) ?? -Infinity;
  const groups = useMemo(() => {
    const g = groupAreas(areas.areas.filter((a) => !ranking?.hidden.has(a.geoid)));
    if (!ranked) return g;
    const best = (x: (typeof g)[number]) => Math.max(...x.areas.map((a) => score(a) ?? -Infinity));
    return [...g].sort((a, b) => best(b) - best(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, ranking]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map((g) => g.name)));
  const toggle = (name: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  const value = (a: Area) =>
    ranked ? (
      <ScoreBadge score={score(a)} rel={ranking!.rel.get(a.geoid)} />
    ) : (
      <span className="text-label tabular-nums">{formatAreaValue(a, measure)}</span>
    );

  return (
    <div className="px-gutter py-4">
      <div className="flex items-start justify-between gap-3">
        {/* A div: the "i" holds paragraphs and lists, which can't sit inside a <p>. */}
        <div className="flex items-center gap-1 text-label text-neutral-600 dark:text-neutral-400">
          {ranked ? "Ranked by your filters" : `${AREA_MEASURE.get(measure)?.label ?? measure} by area`}
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
      {!ranked && (
        <p className="mt-1 text-caption text-neutral-500">
          None of your priorities vary inside a county. Add some under Filters → Inside a county.
        </p>
      )}
      {hiddenCount > 0 && (
        <p className="mt-1 text-caption text-neutral-500">
          {hiddenCount} {hiddenCount === 1 ? "area" : "areas"} hidden by your must-haves
        </p>
      )}
      {groups.length === 0 && (
        <p className="py-8 text-center text-label text-neutral-500">No areas meet your must-haves.</p>
      )}

      <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
        {groups.map((g) => {
          const values = g.areas.map((a) => areaValue(a, measure)).filter((v): v is number => v !== null);
          const median = values.length ? values.sort((a, b) => a - b)[values.length >> 1] : null;
          const top = ranked ? [...g.areas].sort((a, b) => key(b) - key(a))[0] : null;
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
                      <span className="block pl-[1.125rem]">
                        <Reason s={ranked ? ranking!.scores.get(a.geoid) : undefined} />
                      </span>
                    </span>
                    <span className="shrink-0">{value(a)}</span>
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
                {top ? (
                  <span className="shrink-0 text-right">
                    {value(top)}
                    <span className="block text-caption text-neutral-500">best area</span>
                  </span>
                ) : (
                  <span className="shrink-0 text-right text-label tabular-nums">
                    {formatArea(measure, median)}
                    <span className="block text-caption text-neutral-500">typical</span>
                  </span>
                )}
              </button>
              {isOpen && (
                <ul
                  className="mb-2 ml-[1.125rem] border-l border-neutral-200 dark:border-neutral-800"
                  onMouseLeave={() => onHover(all)}
                >
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
                            <span className="min-w-0">
                              <span className="block truncate text-label">{areaName(a)}</span>
                              <Reason s={ranked ? ranking!.scores.get(a.geoid) : undefined} />
                            </span>
                            <span className="shrink-0">{value(a)}</span>
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
    </div>
  );
}

/** One line of why, under an area in the list: its strongest push up and down. */
function Reason({ s }: { s: AreaScore | undefined }) {
  const { up, down } = topReasons(s);
  if (!up && !down) return null;
  return (
    <span className="block truncate text-caption">
      {up && <span className="text-emerald-700 dark:text-emerald-400">↑ {up.label}</span>}
      {up && down && <span className="text-neutral-400"> · </span>}
      {down && <span className="text-rose-700 dark:text-rose-400">↓ {down.label}</span>}
    </span>
  );
}

/** What ranks the areas and what rules them out, for the "i". */
function RankingNote({ ranking }: { ranking: AreaRankingView | null }) {
  const criteria = ranking?.criteria ?? [];
  const limits = ranking?.limits ?? [];
  const dir = { lower: "lower is better", higher: "higher is better", middle: "typical is best" } as const;
  const bound = (l: AreaLimit) =>
    [l.min !== undefined && `at least ${formatArea(l.column, l.min)}`, l.max !== undefined && `at most ${formatArea(l.column, l.max)}`]
      .filter(Boolean)
      .join(", ");
  return (
    <>
      {criteria.length > 0 ? (
        <>
          <p className="font-semibold">Ranked by</p>
          <ul className="mt-1 list-disc pl-4">
            {criteria.map((c) => (
              <li key={c.column}>
                {c.label} — importance {c.weight}, {dir[c.direction]}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Each is ranked among this county&apos;s areas, then combined by importance, as for counties.
          </p>
        </>
      ) : (
        <p>
          None of your priorities vary inside a county, so areas show Census home value. Add priorities under Filters → Inside
          a county, or ones that vary by area: home value, rent, income, schools, hazards, airport distance.
        </p>
      )}
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
      <p className="mt-2 text-caption text-neutral-500 dark:text-neutral-400">
        Climate, taxes, cost of living and other county-wide measures are the same across the county, so they
        don&apos;t rank areas.
      </p>
    </>
  );
}

/** In a group's list: the neighborhood, else the ZIP (the group already names the town). */
function areaName(a: Area): string {
  if (a.neighborhood) return a.zip ? `${a.neighborhood} · ${a.zip}` : a.neighborhood;
  return a.zip ? `ZIP ${a.zip}` : a.label;
}

function AreaHeader({ area }: { area: Area }) {
  return (
    <div className="mt-1 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-heading font-semibold">{area.neighborhood ?? area.group}</h2>
        <p className="mt-0.5 text-label text-neutral-500">
          {[area.neighborhood ? area.group : null, area.zip && `ZIP ${area.zip}`,
            area.population !== null && `${area.population.toLocaleString()} people`].filter(Boolean).join(" · ")}
        </p>
      </div>
      <Caution flags={area.lowConfidence} />
    </div>
  );
}

const BETTER = { lower: "lower is better", higher: "higher is better", middle: "typical is best" } as const;

/** The area's score, broken down like a county's (plan §9 Phase 8e). */
function WhyItRanks({ area, ranking, countyName }: { area: Area; ranking: AreaRankingView; countyName: string }) {
  const s = ranking.scores.get(area.geoid);
  if (!s) return null;
  const ranked = [...ranking.scores.values()]
    .filter((x) => x.score !== null && !ranking.hidden.has(x.geoid))
    .sort((a, b) => b.score! - a.score!);
  const place = ranked.findIndex((x) => x.geoid === area.geoid);
  const { up, down } = topReasons(s);
  const rows = [...s.contributions].sort((a, b) => (b.impact ?? -Infinity) - (a.impact ?? -Infinity));
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-label font-semibold uppercase tracking-wide text-neutral-500">Why it ranks here</h3>
          <p className="mt-0.5 text-label">
            {s.status === "excluded"
              ? `Ruled out by your must-haves (${s.failed.join(", ") || s.unknown.join(", ")})`
              : place >= 0
                ? `${ordinal(place + 1)} of ${ranked.length} areas in ${countyName}`
                : "Not ranked: no data for your priorities"}
          </p>
        </div>
        {s.score !== null && <ScoreBadge score={s.score} rel={ranking.rel.get(area.geoid)} />}
      </div>
      {(up || down) && (
        <p className="text-label text-neutral-700 dark:text-neutral-300">
          {up && <>Stronger than most of the county on <strong>{up.label.toLowerCase()}</strong>. </>}
          {down && <>Weaker on <strong>{down.label.toLowerCase()}</strong>.</>}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {rows.map((c) => (
            <li key={c.column} className="py-2 text-label">
              <div className="flex items-baseline justify-between gap-3">
                <span>{c.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{formatArea(c.column, c.value)}</span>
              </div>
              {c.points === null ? (
                <p className="text-caption text-neutral-500">No data — left out of this area&rsquo;s score (weight {c.weight}).</p>
              ) : (
                <>
                  <div className="mt-1 flex items-center gap-2">
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
                      role="img"
                      aria-label={`${Math.round(c.points)} of 100 points`}
                    >
                      <div
                        className={`h-full rounded-full ${c.points >= 50 ? "bg-emerald-500" : "bg-rose-500"}`}
                        style={{ width: `${Math.max(2, c.points)}%` }}
                      />
                    </div>
                    <span className="w-14 text-right text-caption tabular-nums text-neutral-500">{Math.round(c.points)} pts</span>
                  </div>
                  <p className="mt-0.5 text-caption text-neutral-500">
                    {ordinal(Math.round(c.rawPercentile ?? 0))} percentile in the county · {BETTER[c.direction]} · weight {c.weight} ·{" "}
                    <span className={(c.impact ?? 0) >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
                      effect {(c.impact ?? 0) >= 0 ? "+" : "−"}
                      {Math.abs(Math.round(c.impact ?? 0))}
                    </span>
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {s.limits.length > 0 && (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {s.limits.map((l) => (
            <li key={l.column} className="flex items-baseline justify-between gap-3 py-2 text-label">
              <span>
                <span aria-hidden className={l.state === "pass" ? "text-emerald-600" : l.state === "fail" ? "text-rose-600" : "text-neutral-400"}>
                  {l.state === "pass" ? "✓" : l.state === "fail" ? "✕" : "?"}{" "}
                </span>
                {l.label}
                <span className="block text-caption text-neutral-500">
                  Yours: {[l.min !== undefined && `at least ${formatArea(l.column, l.min)}`, l.max !== undefined && `at most ${formatArea(l.column, l.max)}`].filter(Boolean).join(", ")}
                </span>
              </span>
              <span className={`shrink-0 font-medium tabular-nums ${l.state === "fail" ? "text-rose-700 dark:text-rose-400" : ""}`}>
                {l.value === null ? "No data" : formatArea(l.column, l.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AreaDetail({
  area,
  county,
  countyName,
  ranking,
}: {
  area: Area;
  county: CountyAreas;
  countyName: string;
  ranking: AreaRankingView | null;
}) {
  const v = (key: string) => areaValue(area, key);
  const flagged = new Set(area.lowConfidence);
  const r = area.row;
  const pick = (ids: string[]) => ids.map((id) => county.schools.get(id)).filter((s): s is School => !!s);
  const schools = pick(area.nearbySchools);
  const highSchools = pick(area.nearbyHighSchools);

  return (
    <div className="space-y-section px-gutter py-4">
      {ranking && (ranking.criteria.length > 0 || ranking.limits.length > 0) && (
        <WhyItRanks area={area} ranking={ranking} countyName={countyName} />
      )}
      <dl className="grid grid-cols-2 gap-2">
        {["zhvi", "median_home_value", "median_gross_rent", "per_capita_income", "walkability", "kids_share"].map((k) => (
          <Stat key={k} k={k} text={formatAreaValue(area, k)} flagged={flagged.has(k)} />
        ))}
      </dl>

      <Section
        title="Schools"
        tip="The nearest schools to where people here live — not attendance zones. Elementary and middle: SEDA test scores (grades 3–8). High schools: college-prep access from the Civil Rights Data Collection 2023–24 — AP participation and AP courses offered, compared nationally."
      >
        {r.district_name && (
          <Row label="School district">
            <span className="font-medium">{String(r.district_name).replace(/ Independent School District$/, " ISD")}</span>
            <span className="block text-caption text-neutral-500">
              {v("district_pctl") !== null && `${ordinal(v("district_pctl")!)} percentile nationally`}
              {v("district_rank") !== null && ` · ${ordinal(v("district_rank")!)} of ${v("district_count")} in ${countyName}`}
            </span>
          </Row>
        )}
        <SubHead>Elementary &amp; middle</SubHead>
        {schools.length === 0 ? (
          <p className="text-label text-neutral-500">No scored schools within 5 miles.</p>
        ) : (
          schools.map((s) => (
            <Row key={s.id} label={<span className="capitalize">{s.name.toLowerCase()}</span>}>
              <span className="font-medium">{s.pctl !== null ? `${ordinal(s.pctl)} pctl` : "—"}</span>
              <span className="block text-caption text-neutral-500">
                {s.level} · {where(s)}
              </span>
            </Row>
          ))
        )}
        <SubHead>High schools</SubHead>
        {highSchools.length === 0 ? (
          <p className="text-label text-neutral-500">No high school within 5 miles.</p>
        ) : (
          highSchools.map((s) => (
            <Row key={s.id} label={<span className="capitalize">{s.name.toLowerCase()}</span>}>
              <span className="font-medium">{s.pctl !== null ? `${ordinal(s.pctl)} pctl` : "—"}</span>
              <span className="block text-caption text-neutral-500">{where(s)}</span>
              <span className="block text-caption text-neutral-500">{apLine(s)}</span>
            </Row>
          ))
        )}
      </Section>

      <Section title="Homes and people">
        {["median_household_income", "zori", "highrise_share", "single_family_share", "owner_share", "median_age",
          "bachelors_share", "density_per_sq_mi"].map((k) => (
          <MeasureRow key={k} k={k} value={v(k)} flagged={flagged.has(k)} />
        ))}
      </Section>

      <Section title="Getting around">
        <MeasureRow
          k="dist_downtown_mi"
          value={v("dist_downtown_mi")}
          extra={r.nearest_downtown ? String(r.nearest_downtown) : county.downtownMetro?.split(",")[0].split("-")[0]}
        />
        <MeasureRow k="dist_airport_mi" value={v("dist_airport_mi")} extra={r.nearest_airport ? String(r.nearest_airport) : undefined} />
        <MeasureRow k="commute_minutes" value={v("commute_minutes")} flagged={flagged.has("commute_minutes")} />
        <MeasureRow k="work_from_home_share" value={v("work_from_home_share")} flagged={flagged.has("work_from_home_share")} />
      </Section>

      <Section title="Safety" tip={AREA_MEASURE.get("violent_rate")?.note}>
        <MeasureRow k="violent_rate" value={v("violent_rate")} flagged={flagged.has("crime")} />
        <MeasureRow k="property_rate" value={v("property_rate")} flagged={flagged.has("crime")} />
        {r.crime_agency && (
          <p className="text-caption text-neutral-500">
            Reported for {String(r.crime_agency)}, {String(r.crime_year)} (FBI Crime Data Explorer)
          </p>
        )}
      </Section>

      <Section title="Housing market" tip="By ZIP code. Zillow (home value and rent indexes) and Redfin (latest 90 days of sales).">
        <MeasureRow k="zhvi_yoy" value={v("zhvi_yoy")} />
        <MeasureRow k="days_on_market" value={v("days_on_market")} />
        <MeasureRow k="sale_to_list" value={v("sale_to_list")} />
        <Row label="Homes sold">
          <span className="font-medium tabular-nums">{v("homes_sold") ?? "—"}</span>
          {flagged.has("sale_price") && <span className="ml-1 text-amber-500"><Icon name="warning" className="inline h-3.5 w-3.5" /></span>}
        </Row>
        <p className="text-caption text-neutral-500">
          Zillow {String(r.zillow_month ?? "")} · Redfin to {String(r.redfin_period ?? "")}
        </p>
      </Section>

      <Section title="Natural hazards" tip={AREA_MEASURE.get("hazard_risk")?.note}>
        <MeasureRow k="hazard_risk" value={v("hazard_risk")} />
        <MeasureRow k="hazard_wildfire" value={v("hazard_wildfire")} />
        <MeasureRow k="hazard_inland_flood" value={v("hazard_inland_flood")} />
      </Section>
    </div>
  );
}

/** "3rd of 47 high schools in county", or "in Williamson County" across the line. */
function where(s: School): string {
  if (!s.inCounty) return s.countyName ? `in ${s.countyName}` : "nearby county";
  const kind = s.level === "high" ? "high schools" : `${s.level} schools`;
  return s.countyRank !== null && s.countyCount !== null ? `${ordinal(s.countyRank)} of ${s.countyCount} ${kind} in county` : "";
}

/** "33 AP courses · 62% in AP · IB · 15% dual enrollment" */
function apLine(s: School): string {
  if (s.apCourses === 0) return "No AP courses";
  return [
    s.apCourses !== null && `${s.apCourses} AP courses`,
    s.apShare !== null && `${Math.round(s.apShare)}% in AP`,
    s.ib && "IB",
    s.dualShare !== null && s.dualShare > 0 && `${Math.round(s.dualShare)}% dual enrollment`,
  ].filter(Boolean).join(" · ");
}

function SubHead({ children }: { children: ReactNode }) {
  return <p className="pt-1 text-caption font-medium text-neutral-500 dark:text-neutral-400">{children}</p>;
}

function Section({ title, tip, children }: { title: string; tip?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-1">
        <h3 className="text-caption font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{title}</h3>
        {tip && <InfoTip label={title}>{tip}</InfoTip>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-label">
      <span className="min-w-0 text-neutral-600 dark:text-neutral-400">{label}</span>
      <span className="shrink-0 text-right">{children}</span>
    </div>
  );
}

function FlagMark({ on }: { on?: boolean }) {
  if (!on) return null;
  return (
    <span className="ml-1 text-amber-500 dark:text-amber-400" title="Low confidence">
      <Icon name="warning" className="inline h-3.5 w-3.5" />
    </span>
  );
}

function MeasureRow({ k, value, flagged, extra }: { k: string; value: number | null; flagged?: boolean; extra?: string }) {
  const m = AREA_MEASURE.get(k);
  return (
    <Row label={m?.label ?? k}>
      <span className="font-medium tabular-nums">{formatArea(k, value)}</span>
      {extra && <span className="ml-1 text-caption text-neutral-500">{extra}</span>}
      <FlagMark on={flagged} />
    </Row>
  );
}

function Stat({ k, text, flagged }: { k: string; text: string; flagged: boolean }) {
  const m = AREA_MEASURE.get(k);
  return (
    <div className="rounded-lg bg-neutral-100 px-3 py-2 dark:bg-neutral-900">
      <dt className="flex items-center gap-1 text-caption text-neutral-500 dark:text-neutral-400">
        {m?.label ?? k}
        {m?.note && <InfoTip label={m.label}>{m.note}</InfoTip>}
      </dt>
      <dd className="mt-0.5 text-body font-semibold tabular-nums">
        {text}
        <FlagMark on={flagged} />
      </dd>
    </div>
  );
}
