import { getMetric, METRICS, type MetricKey } from "@/lib/scoring";

import { OPTIONAL_STATES, sanitizePreferences, type Preferences } from "./preferences";

/**
 * A search as a readable, shareable query string (plan §9 Phase 7b):
 *
 *   ?v=1&w=rpp_all:3,school_achievement:3&dir=population:middle
 *     &lim=median_gross_rent:~2000,population:10000~&cat=koppen:Cfa.Dfa
 *     &unk=0&inc=AK&place=24027
 *
 * - w: importance per metric (only metrics that count)
 * - dir: "better" direction, only where it differs from the metric's default
 * - lim: min~max limits, either side may be empty
 * - cat: allowed values per category ("koppen:" alone = nothing allowed)
 * - unk=0: hide unknown counties; inc: opt-in states that are on
 * - place: the county being viewed (5-digit FIPS), or an area inside one (an
 *   11-digit census tract, Phase 8), opened and zoomed to on arrival
 *
 * Every key and value here is [A-Za-z0-9_.-], so the string is built by hand
 * and needs no percent-encoding. Decoding goes through `sanitizePreferences`,
 * so a hand-edited or out-of-date link can never break the app.
 */

export const SEARCH_VERSION = "1";

export interface SharedSearch {
  prefs: Preferences;
  place: string | null;
}

const SAFE = /^[A-Za-z0-9_.-]+$/;
const num = (n: number) => String(Number(n.toPrecision(12)));

/** The query string (no leading "?") for a search and, optionally, a county. */
export function encodeSearch(prefs: Preferences, place: string | null = null): string {
  const parts = [`v=${SEARCH_VERSION}`];

  const weights = METRICS.filter((m) => (prefs.weights[m.key] ?? 0) > 0).map((m) => `${m.key}:${prefs.weights[m.key]}`);
  if (weights.length) parts.push(`w=${weights.join(",")}`);

  const dirs = METRICS.filter((m) => {
    const d = prefs.directions[m.key];
    return d !== undefined && d !== m.defaultDirection;
  }).map((m) => `${m.key}:${prefs.directions[m.key]}`);
  if (dirs.length) parts.push(`dir=${dirs.join(",")}`);

  const limits = METRICS.flatMap((m) => {
    const l = prefs.limits[m.key];
    if (!l || (l.min === undefined && l.max === undefined)) return [];
    return [`${m.key}:${l.min === undefined ? "" : num(l.min)}~${l.max === undefined ? "" : num(l.max)}`];
  });
  if (limits.length) parts.push(`lim=${limits.join(",")}`);

  const cats = Object.entries(prefs.categories)
    .filter((e): e is [string, string[]] => Array.isArray(e[1]))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, accept]) => `${key}:${[...accept].sort().filter((v) => SAFE.test(v)).join(".")}`);
  if (cats.length) parts.push(`cat=${cats.join(",")}`);

  if (!prefs.includeUnknown) parts.push("unk=0");
  const inc = OPTIONAL_STATES.filter((o) => prefs.includeStates[o.state]).map((o) => o.state);
  if (inc.length) parts.push(`inc=${inc.join(".")}`);

  if (place && /^(\d{5}|\d{11})$/.test(place)) parts.push(`place=${place}`);
  return parts.join("&");
}

/** "key:value,key:value" → pairs; malformed pieces are skipped. */
function pairs(raw: string | null): [string, string][] {
  if (!raw) return [];
  return raw.split(",").flatMap((piece) => {
    const i = piece.indexOf(":");
    return i > 0 ? [[piece.slice(0, i), piece.slice(i + 1)] as [string, string]] : [];
  });
}

const toNumber = (s: string) => (s.trim() === "" ? undefined : Number(s));

/**
 * The search in a URL's query, or null if it doesn't carry one (no `v`).
 * Unknown metrics, bad numbers and unknown values are dropped.
 */
export function decodeSearch(params: URLSearchParams): SharedSearch | null {
  if (!params.has("v")) return null;

  const weights: Record<string, number> = {};
  for (const [k, v] of pairs(params.get("w"))) weights[k] = Number(v);

  const directions: Record<string, string> = {};
  for (const [k, v] of pairs(params.get("dir"))) directions[k] = v;

  const limits: Record<string, { min?: number; max?: number }> = {};
  for (const [k, v] of pairs(params.get("lim"))) {
    const [lo = "", hi = ""] = v.split("~");
    limits[k] = { min: toNumber(lo), max: toNumber(hi) };
  }

  const categories: Record<string, string[]> = {};
  for (const [k, v] of pairs(params.get("cat"))) categories[k] = v === "" ? [] : v.split(".");

  const inc = new Set((params.get("inc") ?? "").split("."));
  const prefs = sanitizePreferences({
    weights,
    directions,
    limits,
    categories,
    includeUnknown: params.get("unk") !== "0",
    includeStates: Object.fromEntries(OPTIONAL_STATES.map((o) => [o.state, inc.has(o.state)])),
  });
  if (!prefs) return null;

  const place = params.get("place");
  return { prefs, place: place && /^(\d{5}|\d{11})$/.test(place) ? place : null };
}

/**
 * A short name for a search, for the Searches list: its most important
 * priorities, then how many must-haves. "Cost of living, Schools +2 · 1 must-have"
 */
export function summarizeSearch(prefs: Preferences): string {
  const weighted = (Object.entries(prefs.weights) as [MetricKey, number][])
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1]);
  const names = weighted.slice(0, 2).map(([k]) => getMetric(k).label);
  const more = weighted.length - names.length;
  const musts =
    Object.values(prefs.limits).filter((l) => l && (l.min !== undefined || l.max !== undefined)).length +
    Object.values(prefs.categories).filter((a) => a !== undefined).length;

  const head = names.length ? `${names.join(", ")}${more > 0 ? ` +${more}` : ""}` : "No priorities";
  return musts ? `${head} · ${musts} must-have${musts > 1 ? "s" : ""}` : head;
}
