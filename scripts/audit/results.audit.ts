/**
 * Results audit (owner, 2026-10-04: "the most important thing is that it actually works,
 * the data is accurate and the results are genuinely helpful, not misleading").
 *
 *   npm run audit:results    → scripts/audit/report.md (git-ignored)
 *
 * Runs realistic searches through the same scoring code the app uses, over the real
 * published data (public/data/counties.json, laws.json, tracts/areas.json), and writes
 * each search's top areas and counties with the values behind them, plus checks for
 * things that would make results misleading: missing data lifting a score, low-confidence
 * values near the top, tiny areas, one county or state crowding the list, must-haves
 * leaking through, ties at the top.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import { applyStateLaws, parseLawPayload } from "@/lib/laws";
import {
  formatValue,
  getMetric,
  parseCountyPayload,
  prepareDataset,
  rankCounties,
  scoreCounties,
  subsetDataset,
  type MetricKey,
} from "@/lib/scoring";
import {
  areaCriteria,
  countiesOf,
  countyParts,
  explainArea,
  formatArea,
  MATCH,
  parseNationalAreas,
  scoreNational,
  topAreas,
  UNKNOWN,
  type NationalAreas,
} from "@/lib/tracts";
import {
  DEFAULT_PREFERENCES,
  EMPTY_PREFERENCES,
  excludedStates,
  toAreaSearch,
  toScoringInput,
  type Preferences,
} from "@/components/finder/preferences";

const root = process.cwd();
const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));

const counties = applyStateLaws(parseCountyPayload(read("public/data/counties.json")), parseLawPayload(read("public/data/laws.json")));
const areas: NationalAreas = parseNationalAreas(read("public/data/tracts/areas.json"));

type Scenario = { name: string; intent: string; prefs: Preferences };

const P = (over: Partial<Preferences> & { area?: Partial<Preferences["area"]> }): Preferences => ({
  ...EMPTY_PREFERENCES,
  ...over,
  area: { ...EMPTY_PREFERENCES.area, ...(over.area ?? {}) },
});

const SCENARIOS: Scenario[] = [
  { name: "Default search", intent: "What a first-time visitor sees.", prefs: DEFAULT_PREFERENCES },
  {
    name: "Young family, mid budget",
    intent: "Strong nearby schools, low violent crime, lots of families, homes under $500k.",
    prefs: P({
      area: {
        weights: { nearby_school_pctl: 5, violent_rate: 4, kids_share: 3, median_home_value: 3 },
        directions: {},
        limits: { median_home_value: { max: 500_000 } },
      },
    }),
  },
  {
    name: "Walkable city life",
    intent: "Very walkable, close to downtown, short commute.",
    prefs: P({ area: { weights: { walkability: 5, dist_downtown_mi: 4, commute_minutes: 2 }, directions: {}, limits: {} } }),
  },
  {
    name: "Retire somewhere warm and affordable",
    intent: "Mild winters, low cost of living, low income tax; safe, low hazard risk, near an airport.",
    prefs: P({
      weights: { coldest_month_low_f: 4, rpp_all: 3, income_tax_top_rate: 2 },
      area: {
        weights: { hazard_risk: 3, violent_rate: 3, median_home_value: 3 },
        directions: {},
        limits: { dist_airport_mi: { max: 90 } },
      },
    }),
  },
  {
    name: "Remote worker: cheap and quiet, within reach of a city",
    intent: "Low cost of living, cheap homes, low density; within 120 mi of a 500k+ metro.",
    prefs: P({
      weights: { rpp_all: 4 },
      area: {
        weights: { median_home_value: 4, density_per_sq_mi: 3, nearby_school_pctl: 1 },
        directions: {},
        limits: { dist_metro_mi: { max: 120 } },
      },
    }),
  },
  {
    name: "Safety above all",
    intent: "Lowest violent and property crime.",
    prefs: P({ area: { weights: { violent_rate: 5, property_rate: 5 }, directions: {}, limits: {} } }),
  },
  {
    name: "Mild climate",
    intent: "Few hot days, few freezing nights, little snow; homes not too pricey.",
    prefs: P({
      weights: { days_above_90f: 4, nights_below_32f: 4, snow_days: 2 },
      area: { weights: { median_home_value: 2 }, directions: {}, limits: {} },
    }),
  },
  {
    name: "Beach life, low hurricane risk",
    intent: "Close to the coast, low hurricane and coastal-flood risk, homes under $900k.",
    prefs: P({
      area: {
        weights: { dist_coast_mi: 5, hazard_hurricane: 4, hazard_coastal_flood: 3 },
        directions: {},
        limits: { median_home_value: { max: 900_000 } },
      },
    }),
  },
  {
    name: "Must-haves only (no priorities)",
    intent: "Homes ≤ $300k, nearby schools ≥ 70th pctl, violent crime ≤ 200 — nothing weighted.",
    prefs: P({
      area: {
        weights: {},
        directions: {},
        limits: { median_home_value: { max: 300_000 }, nearby_school_pctl: { min: 70 }, violent_rate: { max: 200 } },
      },
    }),
  },
  {
    name: "Texas only: value and schools",
    intent: "States = TX; cheaper homes and strong schools.",
    prefs: P({
      categories: { state: ["TX"] },
      area: { weights: { median_home_value: 3, nearby_school_pctl: 4 }, directions: {}, limits: {} },
    }),
  },
  {
    name: "No state income tax, great schools",
    intent: "Lowest income tax; strong nearby schools.",
    prefs: P({
      weights: { income_tax_top_rate: 5 },
      area: { weights: { nearby_school_pctl: 4 }, directions: {}, limits: {} },
    }),
  },
  {
    name: "Typical-density suburb",
    intent: "Density near the typical US area (middle), good schools.",
    prefs: P({
      area: { weights: { density_per_sq_mi: 4, nearby_school_pctl: 3 }, directions: { density_per_sq_mi: "middle" }, limits: {} },
    }),
  },
  {
    name: "Big-city access on a budget",
    intent: "Within 25 mi of a 500k+ metro; cheapest homes; short commute.",
    prefs: P({
      area: {
        weights: { median_home_value: 5, commute_minutes: 3 },
        directions: {},
        limits: { dist_metro_mi: { max: 25 } },
      },
    }),
  },
  {
    name: "Recreational marijuana, low cost, low wildfire",
    intent: "Policy filter + county cost of living + area wildfire risk.",
    prefs: P({
      weights: { rpp_all: 3 },
      categories: { marijuana_status: ["recreational"] },
      area: { weights: { hazard_wildfire: 3, walkability: 2 }, directions: {}, limits: {} },
    }),
  },
  {
    name: "Counties only (no area priorities)",
    intent: "Low cost of living, low unemployment, few hot days — results are counties.",
    prefs: P({ weights: { rpp_all: 4, unemployment_rate: 3, days_above_90f: 2 } }),
  },
  {
    name: "Affluent, top high schools",
    intent: "High household income and strong high schools.",
    prefs: P({ area: { weights: { median_household_income: 4, nearby_hs_pctl: 4 }, directions: {}, limits: {} } }),
  },
];

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};

function run(sc: Scenario): string[] {
  const out: string[] = [`## ${sc.name}`, "", `*${sc.intent}*`, ""];
  const scoped = subsetDataset(counties, (i) => !excludedStates(sc.prefs).includes(counties.state[i]));
  const prepared = prepareDataset(scoped);
  const scores = scoreCounties(prepared, toScoringInput(sc.prefs));
  const area = areaCriteria(toAreaSearch(sc.prefs));
  const countyName = (fips: string) => {
    const i = counties.indexByFips.get(fips);
    return i === undefined ? fips : `${counties.countyName[i]}, ${counties.state[i]}`;
  };
  const countyCriteria = Object.entries(sc.prefs.weights).filter(([, w]) => (w ?? 0) > 0) as [MetricKey, number][];

  if (area.criteria.length === 0 && area.limits.length === 0) {
    const ranked = rankCounties(scores, { includeUnknown: sc.prefs.includeUnknown });
    out.push(`Results are **counties** (${ranked.length.toLocaleString()} ranked).`, "");
    out.push("| # | County | Score | " + countyCriteria.map(([k]) => getMetric(k).label).join(" | ") + " | Missing |");
    out.push("|---|---|---|" + countyCriteria.map(() => "---").join("|") + "|---|");
    ranked.slice(0, 15).forEach((s, r) => {
      const cells = countyCriteria.map(([k]) => {
        const c = s.contributions.find((x) => x.metric === k);
        return c ? `${formatValue(k, c.value)} (${c.percentile === null ? "—" : Math.round(c.percentile)})` : "—";
      });
      out.push(`| ${r + 1} | ${countyName(s.fips)} | ${s.score === null ? "—" : s.score.toFixed(1)} | ${cells.join(" | ")} | ${s.missingMetrics.join(", ") || ""} |`);
    });
    const states = new Map<string, number>();
    for (const s of ranked.slice(0, 50)) states.set(scoped.state[s.index], (states.get(scoped.state[s.index]) ?? 0) + 1);
    out.push("", `Top 50 by state: ${[...states].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(", ")}`, "");
    return out;
  }

  const search = { criteria: area.criteria, limits: area.limits, counties: countyParts(scores) };
  const ns = scoreNational(areas, search);
  const top = topAreas(areas, ns, 100, sc.prefs.includeUnknown);
  const byCounty = countiesOf(areas, top, ns);
  let matched = 0;
  let unknown = 0;
  for (let i = 0; i < areas.n; i++) {
    if (ns.status[i] === MATCH) matched++;
    else if (ns.status[i] === UNKNOWN) unknown++;
  }
  out.push(`Matching areas: ${matched.toLocaleString()} (+${unknown.toLocaleString()} unknown for a must-have). Top 100 span ${byCounty.length} counties.`, "");

  const cols = [
    ...countyCriteria.map(([k]) => ({ key: k as string, label: getMetric(k).label + " ·cty" })),
    ...area.criteria.map((c) => ({ key: c.column, label: c.label })),
  ];
  out.push("| # | Area | County | Pop | Score | " + cols.map((c) => c.label).join(" | ") + " | Flags |");
  out.push("|---|---|---|---|---|" + cols.map(() => "---").join("|") + "|---|");
  top.slice(0, 15).forEach((i, r) => {
    const parts = explainArea(areas, i, search, scores.find((s) => s.fips === areas.county[i]));
    const cells = cols.map((c) => {
      const p = parts.find((x) => x.key === c.key);
      if (!p) return "—";
      const v = p.level === "county" ? formatValue(p.key as MetricKey, p.value) : formatArea(p.key, p.value);
      return `${v} (${p.points === null ? "**missing**" : Math.round(p.points)})`;
    });
    const missing = parts.filter((p) => p.points === null).length;
    out.push(
      `| ${r + 1} | ${areas.name[i]} | ${countyName(areas.county[i])} | ${Math.round(areas.population[i]).toLocaleString()} | ${Number.isNaN(ns.score[i]) ? "—" : ns.score[i].toFixed(1)} | ${cells.join(" | ")} | ${[
        ...areas.lowConfidence[i],
        ns.status[i] === UNKNOWN ? "UNKNOWN must-have" : "",
        missing ? `${missing} missing` : "",
      ]
        .filter(Boolean)
        .join("; ")} |`,
    );
  });

  // Checks over the whole top 100.
  const missingAny = top.filter((i) => explainArea(areas, i, search, undefined).some((p) => p.level === "area" && p.points === null));
  const lowConf = top.filter((i) => areas.lowConfidence[i].length > 0);
  const pops = top.map((i) => areas.population[i]).filter((v) => !Number.isNaN(v));
  const tiny = top.filter((i) => areas.population[i] < 500);
  const leaks = top.filter((i) =>
    area.limits.some((l) => {
      const v = areas.values.get(l.column)?.[i] ?? NaN;
      return !Number.isNaN(v) && ((l.min !== undefined && v < l.min) || (l.max !== undefined && v > l.max));
    }),
  );
  const states = new Map<string, number>();
  for (const i of top) {
    const st = counties.state[counties.indexByFips.get(areas.county[i]) ?? -1] ?? "?";
    states.set(st, (states.get(st) ?? 0) + 1);
  }
  const best = ns.score[top[0]];
  const ties = top.filter((i) => Math.abs(ns.score[i] - best) < 1e-9).length;
  out.push(
    "",
    "**Checks (top 100):**",
    `- Missing a weighted area value (scored without it): ${missingAny.length}`,
    `- Low-confidence flags: ${lowConf.length} (${[...new Set(lowConf.flatMap((i) => areas.lowConfidence[i]))].join(", ") || "—"})`,
    `- Population: median ${Math.round(pct(pops, 0.5)).toLocaleString()}, p10 ${Math.round(pct(pops, 0.1)).toLocaleString()}; under 500 people: ${tiny.length}`,
    `- Biggest county share: ${byCounty[0] ? `${countyName(byCounty.slice().sort((a, b) => b.areas.length - a.areas.length)[0].fips)} with ${Math.max(...byCounty.map((c) => c.areas.length))}` : "—"}`,
    `- States: ${[...states].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `- Must-have leaks: ${leaks.length}`,
    `- Tied for #1: ${ties}${ties > 1 ? " ⚠" : ""}; score range ${ns.score[top[top.length - 1]]?.toFixed(1)}–${best?.toFixed(1)}`,
    "",
  );
  return out;
}

it("writes the results audit", () => {
  const lines = [
    "# Results audit",
    "",
    `Generated ${new Date().toISOString().slice(0, 10)} from public/data (areas.json ${areas.n.toLocaleString()} areas). Values are shown with their points (0–100) in parentheses.`,
    "",
  ];
  for (const sc of SCENARIOS) lines.push(...run(sc));
  writeFileSync(join(root, "scripts/audit/report.md"), lines.join("\n"));
});
