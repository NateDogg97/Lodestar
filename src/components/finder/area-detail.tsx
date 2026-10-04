"use client";

import { useId, useSyncExternalStore, type ReactNode } from "react";

import { Icon } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/info-tip";
import {
  AREA_MEASURE,
  areaLimitResults,
  areaPriority,
  areaValue,
  aroundVerdict,
  explainArea,
  formatArea,
  formatAreaValue,
  hazardWord,
  hazardsVerdict,
  marketVerdict,
  peopleVerdict,
  safetyVerdict,
  schoolsVerdict,
  tradeOff,
  US_TYPICAL,
  type Area,
  type AreaLimit,
  type AreaPart,
  type CountyAreas,
  type School,
} from "@/lib/tracts";
import { formatValue, type MetricKey } from "@/lib/scoring";
import { ordinal } from "@/lib/scoring/format";

import type { AreaRankingView } from "./inside-view";
import { barColor, isGold, scoreColor } from "./score-colors";

/**
 * An area's page below its name (owner, 2026-10-04, mockup round 3 "C"): every
 * section has a header with a one-line takeaway, one or two headline visuals, and
 * "Show details" for the full analysis. Details start closed; which ones are open is
 * remembered on this device. (Sections don't fold: one toggle per section, owner.)
 */

// ---- Remembered folds (a per-device convenience: browser storage, never required) ----

const FOLDS_KEY = "lodestar.area-sections";
let folds: Record<string, boolean> | null = null;
const listeners = new Set<() => void>();

function readFolds(): Record<string, boolean> {
  if (folds) return folds;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FOLDS_KEY) ?? "{}");
    folds = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    folds = {};
  }
  return folds!;
}

function setFold(key: string, value: boolean) {
  folds = { ...readFolds(), [key]: value };
  try {
    window.localStorage.setItem(FOLDS_KEY, JSON.stringify(folds));
  } catch {
    // Storage blocked: it still works for this visit.
  }
  for (const l of listeners) l();
}

// Another tab on this device changed them: re-read, so neither tab overwrites the other.
function onStorage(e: StorageEvent) {
  if (e.key !== FOLDS_KEY && e.key !== null) return;
  folds = null;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(l);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function useFold(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const saved = useSyncExternalStore(
    subscribe,
    () => readFolds()[key],
    () => undefined,
  );
  return [saved ?? initial, (v) => setFold(key, v)];
}

// ---- Section shell ----

const ICONS = {
  star: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
  school: "M3 9l9-5 9 5-9 5-9-5zM7 11v5c3 2 7 2 10 0v-5",
  shield: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z",
  home: "M4 11l8-7 8 7M6 10v10h12V10",
  route: "M8 18h6a4 4 0 000-8h-4a4 4 0 010-8h6M4 18a2 2 0 104 0 2 2 0 10-4 0M16 6a2 2 0 104 0 2 2 0 10-4 0",
  chart: "M4 19h16M6 15l4-4 3 3 5-6",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
} as const;

function Chevron({ up, className = "h-4 w-4" }: { up: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d={up ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AreaSection({
  id,
  icon,
  title,
  lead,
  right,
  children,
  details,
  detailsLabel = "Show details",
  lessLabel = "Hide details",
  expandable = false,
  tone = "emerald",
}: {
  id: string;
  icon: keyof typeof ICONS;
  title: string;
  lead: ReactNode;
  /** Beside the title (a score). */
  right?: ReactNode;
  /** The headline visuals; or, for a section that grows in place, a render of either state. */
  children: ReactNode | ((more: boolean) => ReactNode);
  /** The full analysis, behind "Show details". */
  details?: ReactNode;
  detailsLabel?: string;
  lessLabel?: string;
  /** The section itself grows (children get `more`), instead of a details box. */
  expandable?: boolean;
  tone?: "emerald" | "amber";
}) {
  const [more, setMore] = useFold(`${id}.details`, false);
  const detailsId = useId();
  return (
    <section className="border-t border-neutral-200 py-5 first:border-t-0 dark:border-neutral-800">
      <div className="flex min-h-11 items-center gap-3">
        <span
          aria-hidden
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
            tone === "amber"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICONS[icon]} />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold">{title}</h3>
          <p className="text-label text-neutral-600 dark:text-neutral-400">{lead}</p>
        </div>
        {right}
      </div>
      <div id={detailsId} className="mt-4 space-y-4">
        {typeof children === "function" ? children(more) : children}
        {details && more && (
          <div className="space-y-4 rounded-xl bg-neutral-50 p-3.5 dark:bg-neutral-900/60">
            {details}
          </div>
        )}
        {(details || expandable) && (
          <button
            type="button"
            aria-expanded={more}
            aria-controls={detailsId}
            onClick={() => setMore(!more)}
            className="inline-flex min-h-8 items-center gap-1 text-label font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {more ? lessLabel : detailsLabel}
            <Chevron up={more} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </section>
  );
}

// ---- Visual pieces ----

function Track({ children }: { children: ReactNode }) {
  return <span className="relative block h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">{children}</span>;
}

/** A national percentile as a bar on the score scale (higher is better). */
function PctRow({ label, sub, p, flagged }: { label: ReactNode; sub?: ReactNode; p: number | null; flagged?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem_3rem] items-center gap-2.5 text-label">
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {sub && <span className="block text-caption text-neutral-500 dark:text-neutral-400">{sub}</span>}
      </span>
      <Track>
        {p !== null && <span className="block h-full rounded-full" style={{ width: `${Math.max(3, p)}%`, backgroundColor: scoreColor(p) }} />}
      </Track>
      <span className="text-right font-semibold tabular-nums">
        {p === null ? "—" : ordinal(Math.round(p))}
        <FlagMark on={flagged} />
      </span>
    </div>
  );
}

/**
 * A value against the typical US area: a bar to the value, a mark at the typical area.
 * Green when better than typical, orange when worse, yellow when about the same;
 * grey when neither end is better (`neutral`).
 */
function CompareBar({
  label,
  value,
  text,
  typical,
  typicalText,
  max,
  maxText,
  lowerIsBetter = true,
  neutral = false,
  flagged,
}: {
  label: string;
  value: number | null;
  text: string;
  typical: number;
  typicalText: string;
  max: number;
  maxText: string;
  lowerIsBetter?: boolean;
  neutral?: boolean;
  flagged?: boolean;
}) {
  const top = Math.max(max, (value ?? 0) * 1.1);
  const r = value === null ? 1 : value / typical;
  const better = lowerIsBetter ? r < 0.9 : r > 1.1;
  const worse = lowerIsBetter ? r > 1.1 : r < 0.9;
  const color = neutral ? "#94a3b8" : better ? scoreColor(92) : worse ? scoreColor(40) : scoreColor(72);
  const mark = (100 * typical) / top;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-label">
        <span className="font-medium">{label}</span>
        <span className="font-semibold tabular-nums">
          {text}
          <FlagMark on={flagged} />
        </span>
      </div>
      <span className="relative block">
        <Track>
          {value !== null && (
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (100 * value) / top)}%`, backgroundColor: color }} />
          )}
        </Track>
        <span aria-hidden className="absolute -top-1 h-4 w-0.5 bg-neutral-900 dark:bg-neutral-100" style={{ left: `${mark}%` }} />
      </span>
      <span className="relative block h-4 text-caption text-neutral-500 dark:text-neutral-400">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${Math.min(80, Math.max(20, mark))}%` }}>
          ▲ typical US area {typicalText}
        </span>
        <span className="absolute right-0">{maxText}</span>
      </span>
    </div>
  );
}

function SplitBar({ label, parts, note }: { label: string; parts: { name: string; pct: number; color: string }[]; note?: string }) {
  const shown = parts.filter((p) => p.pct > 0);
  return (
    <div className="space-y-1.5">
      <p className="text-label font-medium">{label}</p>
      <span className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={shown.map((p) => `${p.name} ${Math.round(p.pct)}%`).join(", ")}>
        {shown.map((p) => (
          <span key={p.name} className="block h-full" style={{ width: `${p.pct}%`, backgroundColor: p.color }} />
        ))}
      </span>
      <p className="flex flex-wrap gap-x-3 text-caption text-neutral-600 dark:text-neutral-400">
        {shown.map((p) => (
          <span key={p.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
            {p.name} {Math.round(p.pct)}%
          </span>
        ))}
      </p>
      {note && <p className="text-caption text-neutral-500 dark:text-neutral-400">{note}</p>}
    </div>
  );
}

function MiniStat({ label, value, typical }: { label: string; value: string; typical?: string }) {
  return (
    <div className="rounded-lg bg-neutral-100 px-3 py-2 dark:bg-neutral-900">
      <p className="text-caption text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="text-body font-semibold tabular-nums">{value}</p>
      {typical && <p className="text-caption text-neutral-500 dark:text-neutral-400">US typical {typical}</p>}
    </div>
  );
}

/** A FEMA risk percentile: longer and redder is more risk. */
function RiskRow({ label, p }: { label: string; p: number }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_6rem] items-center gap-2.5 text-label">
      <span className="font-medium">{label}</span>
      <Track>
        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, p)}%`, backgroundColor: scoreColor(100 - p) }} />
      </Track>
      <span className="text-right">
        <span className="font-semibold">{hazardWord(p)}</span>{" "}
        <span className="text-caption text-neutral-500 tabular-nums">{ordinal(Math.round(p))}</span>
      </span>
    </div>
  );
}

function PlaceRow({ name, sub, value }: { name: string; sub: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-label">
      <span className="min-w-0">
        <span className="block font-medium">{name}</span>
        <span className="block text-caption text-neutral-500 dark:text-neutral-400">{sub}</span>
      </span>
      <span className="shrink-0 font-semibold tabular-nums">{value}</span>
    </div>
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

function SubHead({ children }: { children: ReactNode }) {
  return <p className="text-caption font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{children}</p>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-caption text-neutral-500 dark:text-neutral-400">{children}</p>;
}

function FlagMark({ on }: { on?: boolean }) {
  if (!on) return null;
  return (
    <span className="ml-1 text-amber-500 dark:text-amber-400" title="Low confidence">
      <Icon name="warning" className="inline h-3.5 w-3.5" />
    </span>
  );
}

// ---- Why it ranks here ----

const BETTER = { lower: "lower is better", higher: "higher is better", middle: "typical is best" } as const;

/** Where the value stands, said the way the score reads: "lower than 98% of US areas". */
function standing(p: AreaPart): string {
  const of = p.level === "county" ? "US counties" : "US areas";
  const raw = Math.round(p.rawPercentile ?? 0);
  if (p.direction === "lower") return `lower than ${Math.max(0, 100 - raw)}% of ${of}`;
  if (p.direction === "higher") return `higher than ${raw}% of ${of}`;
  return `${ordinal(raw)} percentile of ${of} · ${BETTER.middle}`;
}

/** Home value and rent are scored at today's prices: Census by area × its ZIP's Zillow ratio. */
const SCORED_ON_CENSUS = new Set(["median_home_value", "median_gross_rent"]);

const partValue = (p: AreaPart) =>
  p.level === "county" ? formatValue(p.key as MetricKey, p.value) : formatArea(p.key, p.value);

/** "at least 10, at most $850,000" */
export const bound = (l: AreaLimit) =>
  [l.min !== undefined && `at least ${formatArea(l.column, l.min)}`, l.max !== undefined && `at most ${formatArea(l.column, l.max)}`]
    .filter(Boolean)
    .join(", ");

function PriorityBar({ c, full }: { c: AreaPart; full: boolean }) {
  const tag = c.level === "county" ? "county-wide" : SCORED_ON_CENSUS.has(c.key) ? "today’s prices" : null;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-label">
        <span className="min-w-0 font-medium">
          {c.label}
          {tag && <span className="font-normal text-caption text-neutral-500"> · {tag}</span>}
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{partValue(c)}</span>
      </div>
      {c.points === null ? (
        <Note>No data — left out of this area&rsquo;s score (weight {c.weight}).</Note>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-2.5">
            <span className="block h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800" role="img" aria-label={`${Math.round(c.points)} of 100 points`}>
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(2, c.points)}%`,
                  backgroundColor: barColor(c.points),
                  boxShadow: isGold(c.points) ? "0 0 6px rgba(212,160,23,.7)" : undefined,
                }}
              />
            </span>
            <span className="text-right text-caption tabular-nums text-neutral-500">{Math.round(c.points)} pts</span>
          </div>
          {full && (
            <Note>
              {standing(c)} · weight {c.weight} ·{" "}
              <span className={(c.impact ?? 0) >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
                effect {(c.impact ?? 0) >= 0 ? "+" : "−"}
                {Math.abs(Math.round(c.impact ?? 0))}
              </span>
            </Note>
          )}
        </>
      )}
    </div>
  );
}

/** The area's score, shaped like the other sections: the gist up front, every priority on tap. */
function WhyItRanks({ area, ranking, countyName }: { area: Area; ranking: AreaRankingView; countyName: string }) {
  const i = ranking.indexByGeoid.get(area.geoid);
  if (i === undefined) return null;
  const score = ranking.scores.score[i];
  const place = ranking.matches.indexOf(i);
  const parts = explainArea(ranking.areas, i, ranking.search, ranking.county);
  const limits = areaLimitResults(ranking.areas, i, ranking.search.limits);
  const byEffect = [...parts].sort((a, b) => Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0));
  const failed = limits.filter((l) => l.state === "fail").length;
  const unknown = limits.filter((l) => l.state === "unknown").length;
  const rest = Math.max(0, byEffect.length - 3);
  const where =
    place >= 0 ? `${ordinal(place + 1)} of ${ranking.matches.length} matching areas in ${countyName}` : "Doesn't pass your must-haves";
  return (
    <AreaSection
      id="why"
      icon="star"
      tone="amber"
      title="Why it ranks here"
      lead={where}
      right={
        !Number.isNaN(score) && (
          <span className="text-title font-bold tabular-nums" style={{ color: scoreColor(score) }}>
            {Math.round(score)}
          </span>
        )
      }
      expandable={rest > 0 || limits.length > 0}
      detailsLabel={
        rest > 0 && limits.length > 0
          ? `Show the other ${rest} ${rest === 1 ? "priority" : "priorities"} and your must-haves`
          : rest > 0
            ? `Show the other ${rest} ${rest === 1 ? "priority" : "priorities"}`
            : limits.length === 1
              ? "Show your must-have"
              : "Show your must-haves"
      }
      lessLabel="Show less"
    >
      {(more: boolean) => (
        <>
          <p className="text-body">{tradeOff(parts)}</p>
          {(more ? byEffect : byEffect.slice(0, 3)).map((c) => (
            <PriorityBar key={c.key} c={c} full={more} />
          ))}
          {limits.length > 0 && !more && (
            <p className="flex items-center gap-2 text-label">
              <span
                aria-hidden
                className={`grid h-5 w-5 place-items-center rounded-full text-caption font-bold ${
                  failed
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                    : unknown
                      ? "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                }`}
              >
                {failed ? "✕" : unknown ? "?" : "✓"}
              </span>
              {failed
                ? `Fails ${failed} of your must-haves`
                : unknown
                  ? `No data for ${unknown} of your must-haves`
                  : limits.length === 1
                    ? "Passes your must-have"
                    : `Passes all ${limits.length} must-haves`}
            </p>
          )}
          {limits.length > 0 && more && (
            <>
              <SubHead>Your must-haves</SubHead>
              {limits.map((l) => (
                <div key={l.column} className="flex items-baseline justify-between gap-3 text-label">
                  <span>
                    <span aria-hidden className={l.state === "pass" ? "text-emerald-600" : l.state === "fail" ? "text-rose-600" : "text-neutral-400"}>
                      {l.state === "pass" ? "✓" : l.state === "fail" ? "✕" : "?"}{" "}
                    </span>
                    {l.label}
                    {SCORED_ON_CENSUS.has(l.column) && <span className="text-caption text-neutral-500"> · today&rsquo;s prices</span>}
                    <span className="block text-caption text-neutral-500">Yours: {bound(l)}</span>
                  </span>
                  <span className={`shrink-0 font-medium tabular-nums ${l.state === "fail" ? "text-rose-700 dark:text-rose-400" : ""}`}>
                    {l.value === null ? "No data" : formatArea(l.column, l.value)}
                  </span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </AreaSection>
  );
}

// ---- The page ----

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
  ]
    .filter(Boolean)
    .join(" · ");
}

const HAZARDS = [
  { key: "hazard_tornado", label: "Tornadoes" },
  { key: "hazard_wildfire", label: "Wildfire" },
  { key: "hazard_hurricane", label: "Hurricanes" },
  { key: "hazard_inland_flood", label: "Inland flooding" },
  { key: "hazard_coastal_flood", label: "Coastal flooding" },
  { key: "hazard_earthquake", label: "Earthquakes" },
] as const;

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

export function AreaDetail({
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
  const schools = pick(area.nearbySchools).sort((a, b) => (b.pctl ?? -1) - (a.pctl ?? -1));
  const highSchools = pick(area.nearbyHighSchools).sort((a, b) => (b.pctl ?? -1) - (a.pctl ?? -1));
  const name = (s: School) => <span className="capitalize">{s.name.toLowerCase()}</span>;

  const schoolP = v("nearby_school_pctl");
  const owners = v("owner_share");
  const highrise = v("highrise_share");
  const single = v("single_family_share");
  const yoy = v("zhvi_yoy");
  const overall = v("hazard_risk");
  const hazards = HAZARDS.map((h): { label: string; p: number | null } => ({ label: h.label, p: v(h.key) }));
  const risky = hazards.filter((h): h is { label: string; p: number } => h.p !== null && h.p > 0).sort((a, b) => b.p - a.p);
  const none = hazards.filter((h) => h.p === 0).map((h) => h.label.toLowerCase());
  const overallWord = overall === null ? null : hazardWord(overall);

  return (
    <div className="px-gutter py-2">
      {ranking && <WhyItRanks area={area} ranking={ranking} countyName={countyName} />}

      {/* The headline numbers (owner audit, 2026-10-04): Zillow first for home value and
          rent, the Census as the backup; then income, safety, commute and walkability. */}
      <dl className="grid grid-cols-2 gap-2 py-3">
        <PriceStat area={area} ranking={ranking} label="Home value" census="median_home_value" zillow="zhvi" />
        <PriceStat area={area} ranking={ranking} label="Rent" census="median_gross_rent" zillow="zori" />
        <Stat k="median_household_income" text={formatAreaValue(area, "median_household_income")} flagged={flagged.has("median_household_income")} />
        <Stat k="violent_rate" text={formatAreaValue(area, "violent_rate")} flagged={flagged.has("crime")} />
        <Stat k="commute_minutes" text={formatAreaValue(area, "commute_minutes")} flagged={flagged.has("commute_minutes")} />
        <Stat k="walkability" text={formatAreaValue(area, "walkability")} flagged={flagged.has("walkability")} />
      </dl>

      <AreaSection
        id="schools"
        icon="school"
        title="Schools"
        lead={`${schoolsVerdict(schoolP)}${schoolP !== null ? ` · ${ordinal(Math.round(schoolP))} percentile nationally` : ""}`}
        details={
          <>
            <SubHead>Elementary &amp; middle</SubHead>
            {schools.length === 0 ? (
              <Note>No scored schools within 5 miles.</Note>
            ) : (
              schools.map((s) => <PctRow key={s.id} label={name(s)} sub={`${s.level} · ${where(s)}`} p={s.pctl} />)
            )}
            <SubHead>High schools · college-prep access</SubHead>
            {highSchools.length === 0 ? (
              <Note>No high school within 5 miles.</Note>
            ) : (
              highSchools.map((s) => <PctRow key={s.id} label={name(s)} sub={[apLine(s), where(s)].filter(Boolean).join(" · ")} p={s.pctl} />)
            )}
            <Note>
              The nearest schools to where people here live — not attendance zones. Elementary and middle: SEDA test scores
              (grades 3–8). High schools: AP participation and courses offered (Civil Rights Data Collection 2023–24).
              National percentiles.
            </Note>
          </>
        }
      >
        <PctRow label="Elementary & middle" sub={`${schools.length} nearest, average`} p={schoolP} />
        <PctRow label="High schools" sub="Nearest, college-prep access" p={v("nearby_hs_pctl")} />
        {r.district_name && (
          <p className="text-label text-neutral-600 dark:text-neutral-400">
            District:{" "}
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
              {String(r.district_name).replace(/ Independent School District$/, " ISD")}
            </span>
            {v("district_pctl") !== null && ` · ${ordinal(v("district_pctl")!)} percentile`}
            {v("district_rank") !== null && ` · ${ordinal(v("district_rank")!)} of ${v("district_count")} in county`}
          </p>
        )}
      </AreaSection>

      <AreaSection
        id="safety"
        icon="shield"
        title="Safety"
        lead={safetyVerdict(v("violent_rate"))}
        details={
          <>
            <CompareBar
              label="Property crime"
              value={v("property_rate")}
              text={`${formatArea("property_rate", v("property_rate"))}`}
              typical={US_TYPICAL.property_rate}
              typicalText={US_TYPICAL.property_rate.toLocaleString()}
              max={4000}
              maxText="4,000+"
              flagged={flagged.has("crime")}
            />
            <Note>
              {r.crime_agency ? `Reported for ${String(r.crime_agency)}, ${String(r.crime_year)} (FBI Crime Data Explorer). ` : ""}
              {AREA_MEASURE.get("violent_rate")?.note}
            </Note>
          </>
        }
      >
        <CompareBar
          label="Violent crime"
          value={v("violent_rate")}
          text={formatArea("violent_rate", v("violent_rate"))}
          typical={US_TYPICAL.violent_rate}
          typicalText={String(US_TYPICAL.violent_rate)}
          max={800}
          maxText="800+"
          flagged={flagged.has("crime")}
        />
      </AreaSection>

      <AreaSection
        id="people"
        icon="home"
        title="Homes & people"
        lead={peopleVerdict({ age: v("median_age"), owners, highrise, singleFamily: single })}
        details={
          <>
            {highrise !== null && single !== null && (
              <SplitBar
                label="Kind of home"
                parts={[
                  { name: "High-rise (20+ units)", pct: highrise, color: "#1d4ed8" },
                  { name: "Single-family", pct: single, color: "#93c5fd" },
                  { name: "Other", pct: Math.max(0, 100 - highrise - single), color: "#dbeafe" },
                ]}
                note={`A typical US area: ${Math.round(US_TYPICAL.single_family_share)}% single-family`}
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Households with kids" value={pct(v("kids_share"))} typical={`${Math.round(US_TYPICAL.kids_share)}%`} />
              <MiniStat
                label="People per sq mi"
                value={formatArea("density_per_sq_mi", v("density_per_sq_mi"))}
                typical={US_TYPICAL.density_per_sq_mi.toLocaleString()}
              />
              <MiniStat label="Income per person" value={formatArea("per_capita_income", v("per_capita_income"))} />
              <MiniStat label="Homes built (median)" value={v("median_year_built") === null ? "—" : String(Math.round(v("median_year_built")!))} />
            </div>
            <Row label="Home value (Census)">
              <span className="font-medium tabular-nums">{formatArea("median_home_value", v("median_home_value"))}</span>
              <FlagMark on={flagged.has("median_home_value")} />
            </Row>
            <Row label="Rent (Census)">
              <span className="font-medium tabular-nums">{formatArea("median_gross_rent", v("median_gross_rent"))}</span>
              <FlagMark on={flagged.has("median_gross_rent")} />
            </Row>
            <Note>Census, 2019–2023, before the today&rsquo;s-price adjustment.</Note>
          </>
        }
      >
        {owners !== null && (
          <SplitBar
            label="Own or rent"
            parts={[
              { name: "Own", pct: owners, color: "#0f766e" },
              { name: "Rent", pct: 100 - owners, color: "#99d5cc" },
            ]}
            note={`A typical US area: ${Math.round(US_TYPICAL.owner_share)}% own`}
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Median age" value={v("median_age") === null ? "—" : String(Math.round(v("median_age")!))} typical={String(Math.round(US_TYPICAL.median_age))} />
          <MiniStat label="Bachelor’s or more" value={pct(v("bachelors_share"))} typical={`${Math.round(US_TYPICAL.bachelors_share)}%`} />
        </div>
      </AreaSection>

      <AreaSection
        id="around"
        icon="route"
        title="Getting around"
        lead={aroundVerdict(v("dist_downtown_mi"), v("commute_minutes"))}
        details={
          <>
            <PlaceRow
              name={r.nearest_airport ? String(r.nearest_airport) : "Major airport"}
              sub="Nearest major airport"
              value={formatArea("dist_airport_mi", v("dist_airport_mi"))}
            />
            {v("dist_metro_mi") !== null && (
              <PlaceRow
                name={r.nearest_metro ? String(r.nearest_metro).split(",")[0] : "Big metro"}
                sub="Nearest metro of 500k+"
                value={formatArea("dist_metro_mi", v("dist_metro_mi"))}
              />
            )}
            {v("dist_coast_mi") !== null && <PlaceRow name="Coast" sub="Ocean, bays, tidal water" value={formatArea("dist_coast_mi", v("dist_coast_mi"))} />}
            <CompareBar
              label="Work from home"
              value={v("work_from_home_share")}
              text={pct(v("work_from_home_share"))}
              typical={US_TYPICAL.work_from_home_share}
              typicalText={`${Math.round(US_TYPICAL.work_from_home_share)}%`}
              max={30}
              maxText="30%+"
              neutral
              flagged={flagged.has("work_from_home_share")}
            />
          </>
        }
      >
        <PlaceRow
          name={r.nearest_downtown ? `Downtown ${String(r.nearest_downtown)}` : county.downtownMetro?.split(",")[0].split("-")[0] ?? "Downtown"}
          sub="Nearest downtown"
          value={formatArea("dist_downtown_mi", v("dist_downtown_mi"))}
        />
        <CompareBar
          label="Average commute"
          value={v("commute_minutes")}
          text={formatArea("commute_minutes", v("commute_minutes"))}
          typical={US_TYPICAL.commute_minutes}
          typicalText={`${Math.round(US_TYPICAL.commute_minutes)} min`}
          max={60}
          maxText="60 min"
          flagged={flagged.has("commute_minutes")}
        />
      </AreaSection>

      <AreaSection
        id="market"
        icon="chart"
        title="Housing market"
        lead={marketVerdict(yoy)}
        details={
          <>
            <Row label="Days on market">
              <span className="font-medium tabular-nums">{formatArea("days_on_market", v("days_on_market"))}</span>
            </Row>
            <Row label="Sale-to-list">
              <span className="font-medium tabular-nums">{formatArea("sale_to_list", v("sale_to_list"))}</span>
            </Row>
            <Row label="Homes sold">
              <span className="font-medium tabular-nums">{v("homes_sold") ?? "—"}</span>
              <FlagMark on={flagged.has("sale_price")} />
            </Row>
            <Note>
              By ZIP code. Zillow {String(r.zillow_month ?? "")} (home value and rent indexes) · Redfin to {String(r.redfin_period ?? "")}{" "}
              (latest 90 days of sales).
            </Note>
          </>
        }
      >
        {yoy === null ? (
          <Note>No recent home value index for this ZIP.</Note>
        ) : (
          <div className="flex items-center gap-3.5">
            <span className="text-heading font-bold tabular-nums">{signed(yoy)}</span>
            <span className="text-label">
              <span className="block font-medium">Home values, last 12 months</span>
              <span className="block text-caption text-neutral-500 dark:text-neutral-400">
                {area.zip ? `ZIP ${area.zip} (Zillow)` : "Zillow"} · a typical US area: {signed(US_TYPICAL.zhvi_yoy)}
              </span>
            </span>
          </div>
        )}
        {flagged.has("sale_price") && (
          <p className="flex items-center gap-1.5 text-caption text-neutral-600 dark:text-neutral-400">
            <Icon name="warning" className="h-3.5 w-3.5 text-amber-500" />
            Few recent sales: sale figures are rough.
          </p>
        )}
      </AreaSection>

      <AreaSection
        id="hazards"
        icon="alert"
        title="Natural hazards"
        lead={hazardsVerdict(overall, hazards)}
        details={
          risky.length > 1 || none.length > 0 ? (
            <>
              {risky.slice(1).map((h) => (
                <RiskRow key={h.label} label={h.label} p={h.p} />
              ))}
              {none.length > 0 && <Note>None: {none.join(", ")}.</Note>}
              <Note>{AREA_MEASURE.get("hazard_risk")?.note ?? "FEMA National Risk Index."} Longer bar = more risk.</Note>
            </>
          ) : undefined
        }
      >
        {overall !== null && overallWord && (
          <span
            className={`inline-flex rounded-full px-3 py-1 text-label font-semibold ${
              overall < 40
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : overall < 60
                  ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                  : "bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
            }`}
          >
            Overall: {overallWord.toLowerCase()} · {ordinal(Math.round(overall))} percentile
          </span>
        )}
        {risky[0] && <RiskRow label={risky[0].label} p={risky[0].p} />}
      </AreaSection>
    </div>
  );
}

// ---- Tiles ----

/**
 * Home value or rent. With your search loaded, this area's value at today's prices — the
 * one it's scored on (Census by area × its ZIP's Zillow ratio) — with Zillow's ZIP value
 * under it; otherwise Zillow's ZIP value, or the Census when there's none.
 */
function PriceStat({
  area,
  ranking,
  label,
  census,
  zillow,
}: {
  area: Area;
  ranking: AreaRankingView | null;
  label: string;
  census: "median_home_value" | "median_gross_rent";
  zillow: "zhvi" | "zori";
}) {
  const i = ranking?.indexByGeoid.get(area.geoid);
  const today = ranking && i !== undefined ? ranking.areas.values.get(census)?.[i] : undefined;
  const z = areaValue(area, zillow);
  const flagged = area.lowConfidence.includes(census);
  const zip = area.zip ? ` · ZIP ${area.zip}` : "";
  if (today !== undefined && !Number.isNaN(today)) {
    return (
      <Stat
        k={census}
        label={label}
        note={areaPriority(census)?.note}
        text={formatArea(census, today)}
        source={z !== null ? `Est. for this area · Zillow ${formatArea(zillow, z)}${zip}` : "Est. for this area"}
        flagged={flagged}
      />
    );
  }
  const k = z !== null ? zillow : census;
  return <Stat k={k} label={label} text={formatAreaValue(area, k)} source={z !== null ? `Zillow${zip}` : "Census"} flagged={flagged} />;
}

function Stat({
  k,
  label,
  text,
  note,
  source,
  flagged,
}: {
  k: string;
  /** Instead of the measure's own label ("Home value", not "Home value (Zillow, by ZIP)"). */
  label?: string;
  /** Instead of the measure's own "i" text. */
  note?: string;
  text: string;
  /** Where the number comes from, when it can come from more than one place. */
  source?: string;
  flagged: boolean;
}) {
  const m = AREA_MEASURE.get(k);
  return (
    <div className="rounded-lg bg-neutral-100 px-3 py-2 dark:bg-neutral-900">
      <dt className="flex items-center gap-1 text-caption text-neutral-500 dark:text-neutral-400">
        {label ?? m?.label ?? k}
        {(note ?? m?.note) && <InfoTip label={label ?? m?.label ?? k}>{note ?? m?.note}</InfoTip>}
      </dt>
      <dd className="mt-0.5 text-body font-semibold tabular-nums">
        {text}
        <FlagMark on={flagged} />
      </dd>
      {source && <dd className="text-caption text-neutral-500">{source}</dd>}
    </div>
  );
}
