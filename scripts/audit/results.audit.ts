/**
 * Results audit (owner, 2026-10-04: "the most important thing is that it actually works,
 * the data is accurate and the results are genuinely helpful, not misleading").
 *
 *   npm run audit:results    → scripts/audit/report.md (git-ignored)
 *
 * Runs realistic searches (`scenarios.ts`) through the same scoring code the app uses,
 * over the real published data (public/data/counties.json, laws.json, tracts/areas.json),
 * and writes each search's top results with the values and points behind them. Two
 * kinds of check (`checks.ts`), both printed in the report:
 * - automatic, on every search: every shown point re-derived from the raw column, the
 *   score re-derived from its parts, must-haves and policy filters verified against the
 *   data, badges verified by count, no non-residential places, no bad formatting;
 * - the scenario's own expectations — what a knowledgeable person would expect.
 * Any hard finding fails this test, so a regression can't hide in the report.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { parseLawPayload } from "@/lib/laws";
import { formatValue, getMetric, parseCountyPayload, type MetricKey } from "@/lib/scoring";
import { formatArea, parseNationalAreas, UNKNOWN, type NationalAreas } from "@/lib/tracts";

import { automaticChecks } from "./checks";
import { run, type RunResult } from "./run";
import { SCENARIOS, type Scenario } from "./scenarios";

const root = process.cwd();
const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));

const counties = parseCountyPayload(read("public/data/counties.json"));
const laws = parseLawPayload(read("public/data/laws.json"));
const areas: NationalAreas = parseNationalAreas(read("public/data/tracts/areas.json"));

interface Outcome {
  name: string;
  hard: string[];
  warn: string[];
  lines: string[];
}

function table(r: RunResult, rows: number): string[] {
  const out: string[] = [];
  if (!r.areaMode) {
    const ranked = r.rankedCounties;
    out.push(`Results are **counties** (${ranked.length.toLocaleString()} ranked).`, "");
    out.push("| # | County | Score | " + r.countyCriteria.map(([k]) => getMetric(k).label).join(" | ") + " | Missing |");
    out.push("|---|---|---|" + r.countyCriteria.map(() => "---").join("|") + "|---|");
    ranked.slice(0, rows).forEach((s, k) => {
      const cells = r.countyCriteria.map(([key]) => {
        const c = s.contributions.find((x) => x.metric === key);
        return c ? `${formatValue(key, c.value)} (${c.percentile === null ? "—" : Math.round(c.percentile)})` : "—";
      });
      out.push(`| ${k + 1} | ${r.countyName(s.fips)} | ${s.score === null ? "—" : s.score.toFixed(1)} | ${cells.join(" | ")} | ${s.missingMetrics.join(", ")} |`);
    });
    return out;
  }
  const ns = r.ns!;
  let matched = 0;
  let unknown = 0;
  for (let i = 0; i < areas.n; i++) {
    if (ns.status[i] === 0) matched++;
    else if (ns.status[i] === UNKNOWN) unknown++;
  }
  out.push(`Matching areas: ${matched.toLocaleString()} (+${unknown.toLocaleString()} unknown for a must-have). Top ${r.top.length} span ${r.byCounty.length} counties.`, "");
  if (r.top.length === 0) return out;
  const cols = [
    ...r.countyCriteria.map(([k]) => ({ key: k as string, label: getMetric(k).label + " ·cty" })),
    ...r.criteria.map((c) => ({ key: c.column, label: c.label })),
  ];
  out.push("| # | Area | County | Pop | Score | " + cols.map((c) => c.label).join(" | ") + " | Flags |");
  out.push("|---|---|---|---|---|" + cols.map(() => "---").join("|") + "|---|");
  r.top.slice(0, rows).forEach((i, k) => {
    const parts = r.parts(i);
    const cells = cols.map((c) => {
      const p = parts.find((x) => x.key === c.key);
      if (!p) return "—";
      const v = p.level === "county" ? formatValue(p.key as MetricKey, p.value) : formatArea(p.key, p.value);
      return `${v}${p.flagged ? " ⚠" : ""} (${p.points === null ? "**missing**" : Math.round(p.points)})`;
    });
    const badges = r.badges.get(i);
    out.push(
      `| ${k + 1} | ${areas.name[i]} | ${r.countyName(areas.county[i])} | ${Math.round(areas.population[i]).toLocaleString()} | ${Number.isNaN(ns.score[i]) ? "—" : ns.score[i].toFixed(1)} | ${cells.join(" | ")} | ${[
        ...(badges?.top1 ?? []).map((b) => `★ ${b}`),
        ...(badges?.best ?? []),
        ns.status[i] === UNKNOWN ? "UNKNOWN must-have" : "",
      ]
        .filter(Boolean)
        .join("; ")} |`,
    );
  });
  return out;
}

function runScenario(sc: Scenario, rows: number): Outcome {
  const r = run(sc.prefs, counties, laws, areas);
  const auto = automaticChecks(r);
  const own = sc.checks.flatMap((c) => c(r));
  const lines = [`## ${sc.name}`, "", `*${sc.intent}*`, "", `**Expected:** ${sc.expect}`, "", ...table(r, rows), ""];
  const hard = [...auto.hard, ...own];
  lines.push(`**Checks:** ${hard.length ? `❌ ${hard.length} failed` : "✅ passed"}${auto.warn.length ? ` · ⚠ ${auto.warn.length} to look at` : ""}`);
  for (const h of hard.slice(0, 25)) lines.push(`- ❌ ${h}`);
  if (hard.length > 25) lines.push(`- … ${hard.length - 25} more`);
  for (const w of auto.warn) lines.push(`- ⚠ ${w}`);
  for (const s of auto.stats) lines.push(`- ${s}`);
  lines.push("");
  return { name: sc.name, hard, warn: auto.warn, lines };
}

it("writes the results audit and finds nothing misleading", () => {
  const outcomes = SCENARIOS.map((sc, k) => runScenario(sc, k < 40 ? 15 : 8));
  const failed = outcomes.filter((o) => o.hard.length);
  const warned = outcomes.filter((o) => o.warn.length);
  const lines = [
    "# Results audit",
    "",
    `Generated ${new Date().toISOString().slice(0, 10)} from public/data (areas.json ${areas.n.toLocaleString()} areas, ${SCENARIOS.length} searches). Values are shown with their points (0–100) in parentheses; ⚠ marks a low-confidence value.`,
    "",
    `**${failed.length === 0 ? "All searches pass their checks." : `${failed.length} searches FAIL their checks.`}** ${warned.length} have something to look at.`,
    "",
    ...failed.map((o) => `- ❌ ${o.name}: ${o.hard.length} — ${o.hard[0]}`),
    ...warned.map((o) => `- ⚠ ${o.name}: ${o.warn.join("; ")}`),
    "",
  ];
  for (const o of outcomes) lines.push(...o.lines);
  writeFileSync(join(root, "scripts/audit/report.md"), lines.join("\n"));
  expect(failed.map((o) => `${o.name}: ${o.hard.slice(0, 3).join(" | ")}`)).toEqual([]);
});
