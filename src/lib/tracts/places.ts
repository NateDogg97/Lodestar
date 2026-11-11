/**
 * Looking a place up by name (plan §9 Phase 12): counties, and the cities,
 * neighborhoods and ZIP codes that areas are named after.
 *
 * No new data: counties come from counties.json, and the rest is read off every
 * area's label in areas.json ("Zilker, Austin · 78704", "Pflugerville · 78660",
 * "Near Manor · 78653"; etl/tracts/names.py). A city, neighborhood or ZIP is the
 * group of areas that carry its name. Pure: no UI imports.
 */

import { categoryLabel } from "@/lib/scoring";

import type { NationalAreas } from "./national";

export type PlaceKind = "county" | "city" | "neighborhood" | "zip";

export interface Place {
  /** Stable within one index: kind and name. */
  key: string;
  kind: PlaceKind;
  /** "Travis County", "Austin", "Zilker", "78704" */
  name: string;
  /** Where it is, for telling same-named places apart: "TX", "Austin, TX". */
  where: string;
  state: string;
  /** Counties only. */
  fips?: string;
  /** Its areas (indexes into the national areas); empty for a county. */
  areas: number[];
  /** A city no area sits inside: these are the areas beside it ("Near Manor"). */
  near: boolean;
  population: number;
  /** West, south, east, north of its areas' population centers; null when none is located. */
  bounds: [number, number, number, number] | null;
  /** Normalized name, and the words that may follow it in a query (state, city). */
  norm: string;
  /** A county's name without "County" ("travis"), so the bare name is an exact match too. */
  short?: string;
  context: string[];
}

export interface PlaceCounties {
  fips: string[];
  countyName: string[];
  state: string[];
  population: ArrayLike<number>;
}

/** What a label says about its area. */
export interface LabelParts {
  neighborhood: string | null;
  city: string | null;
  /** The city is the nearest one, not the one the area is in. */
  near: boolean;
  zip: string | null;
}

export function parseLabel(label: string): LabelParts {
  const bits = label.split(" · ");
  const zip = bits.length > 1 && /^\d{5}$/.test(bits[bits.length - 1]) ? bits.pop()! : null;
  const head = bits.join(" · ").trim();
  if (!head) return { neighborhood: null, city: null, near: false, zip };
  // The city is after the last comma ("Caddo Heights, South Highlands, Shreveport"); a
  // neighborhood can itself start with "Near" ("Near Northeast, Washington").
  const cut = head.lastIndexOf(", ");
  if (cut >= 0) {
    return { neighborhood: head.slice(0, cut), city: head.slice(cut + 2).replace(/^Near /, ""), near: false, zip };
  }
  if (head.startsWith("Near ")) return { neighborhood: null, city: head.slice(5), near: true, zip };
  return { neighborhood: null, city: head, near: false, zip };
}

const ALIASES: Record<string, string> = { saint: "st", sainte: "ste", mount: "mt", fort: "ft" };

/** Lower case, no accents or punctuation, common abbreviations folded ("Saint" = "St."). */
export function normalizePlace(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => ALIASES[w] ?? w)
    .join(" ");
}

/** New York City's boroughs are counties under other names. */
const COUNTY_ALSO: Record<string, string> = { "36047": "Brooklyn", "36061": "Manhattan", "36085": "Staten Island" };

const COUNTY_SUFFIX = / (county|parish|borough|census area|municipality|city and borough|city)$/;

const stateWords = (state: string) => (state ? normalizePlace(`${state} ${categoryLabel("state", state)}`).split(" ") : []);

interface Group {
  kind: PlaceKind;
  name: string;
  state: string;
  city: string | null;
  areas: number[];
  nearAreas: number[];
}

/**
 * Every place that can be looked up. Counties are always there; cities, neighborhoods
 * and ZIP codes once the national areas have loaded. An area whose county isn't in
 * `counties` (a state that's switched off) is left out, like the county.
 */
export function buildPlaceIndex(counties: PlaceCounties, areas: NationalAreas | null): Place[] {
  const out: Place[] = [];
  const stateOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  counties.fips.forEach((fips, i) => {
    const state = counties.state[i];
    const name = counties.countyName[i];
    stateOf.set(fips, state);
    nameOf.set(fips, name);
    const pop = counties.population[i];
    const norm = normalizePlace(name);
    const county: Place = {
      key: `county:${fips}`, kind: "county", name, where: state, state, fips, areas: [], near: false,
      population: Number.isFinite(pop) ? pop : 0, bounds: null, norm, short: norm.replace(COUNTY_SUFFIX, ""), context: stateWords(state),
    };
    out.push(county);
    const also = COUNTY_ALSO[fips];
    if (also) out.push({ ...county, key: `county:${fips}:${also}`, name: also, where: `${name}, ${state}`, norm: normalizePlace(also), short: undefined });
  });
  if (!areas) return out;

  const groups = new Map<string, Group>();
  const add = (kind: PlaceKind, name: string, state: string, city: string | null, i: number, near = false) => {
    const key = `${kind}:${name}|${city ?? ""}|${state}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { kind, name, state, city, areas: [], nearAreas: [] }));
    (near ? g.nearAreas : g.areas).push(i);
  };
  for (let i = 0; i < areas.n; i++) {
    const state = stateOf.get(areas.county[i]);
    if (state === undefined) continue;
    const p = parseLabel(areas.label[i]);
    if (p.city) add("city", p.city, state, null, i, p.near);
    if (p.neighborhood && p.city) add("neighborhood", p.neighborhood, state, p.city, i);
    // A ZIP code can cross a state line: one entry, placed by where most of its people are.
    if (p.zip) add("zip", p.zip, "", null, i);
  }

  const pop = (i: number) => (Number.isFinite(areas.population[i]) ? areas.population[i] : 0);
  for (const [key, g] of groups) {
    const near = g.areas.length === 0;
    const idx = near ? g.nearAreas : g.areas;
    let population = 0;
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    // Where most of its people are: the county (and, for a ZIP, the city) to show beside it.
    const byCounty = new Map<string, number>();
    const byCity = new Map<string, number>();
    for (const i of idx) {
      population += pop(i);
      byCounty.set(areas.county[i], (byCounty.get(areas.county[i]) ?? 0) + pop(i) + 1);
      if (g.kind === "zip") {
        const city = parseLabel(areas.label[i]).city;
        if (city) byCity.set(city, (byCity.get(city) ?? 0) + pop(i) + 1);
      }
      const [lat, lon] = [areas.lat[i], areas.lon[i]];
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        w = Math.min(w, lon);
        e = Math.max(e, lon);
        s = Math.min(s, lat);
        n = Math.max(n, lat);
      }
    }
    const most = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
    const fips = most(byCounty)!;
    const state = g.state || stateOf.get(fips) || "";
    const city = g.kind === "zip" ? (most(byCity) ?? null) : g.city;
    // A city says which county it's in (there are many Springfields), and when it spans more.
    const more = byCounty.size - 1;
    const where =
      g.kind === "city"
        ? `${nameOf.get(fips) ?? ""}${more > 0 ? ` + ${more} more` : ""}, ${state}`
        : city
          ? `${city}, ${state}`
          : state;
    out.push({
      key, kind: g.kind, name: g.name, where, state, areas: idx, near, population,
      bounds: Number.isFinite(w) ? [w, s, e, n] : null,
      norm: normalizePlace(g.name),
      context: [...(city ? normalizePlace(city).split(" ") : []), ...stateWords(state)],
    });
  }
  return out;
}

const wordStarts = (text: string, token: string) => text.startsWith(token) || text.includes(` ${token}`);

/**
 * How well a place answers a query, 0 (not at all) to 3: the name is the query (3),
 * starts with it (2), or has its words (1). Words after the name may say where —
 * "austin tx", "springfield illinois", "zilker austin" — and must all fit.
 */
function matchPlace(p: Place, tokens: string[]): number {
  if (!wordStarts(p.norm, tokens[0])) return 0;
  for (let k = tokens.length; k >= 1; k--) {
    const rest = tokens.slice(k);
    if (!rest.every((t) => p.context.some((c) => c.startsWith(t)))) continue;
    const name = tokens.slice(0, k).join(" ");
    if (p.norm === name || p.short === name) return 3;
    if (p.norm.startsWith(name)) return 2;
    if (tokens.slice(0, k).every((t) => wordStarts(p.norm, t))) return 1;
  }
  return 0;
}

/** The best matches for what's typed, best first: closest name, then most people. */
export function searchPlaces(index: Place[], query: string, limit = 8): Place[] {
  const q = normalizePlace(query);
  if (q.length < 2) return [];
  const tokens = q.split(" ");
  const hits: { p: Place; m: number }[] = [];
  for (const p of index) {
    const m = matchPlace(p, tokens);
    if (m) hits.push({ p, m });
  }
  hits.sort((a, b) => b.m - a.m || b.p.population - a.p.population || a.p.name.localeCompare(b.p.name));
  return hits.slice(0, limit).map((h) => h.p);
}

/** "City", "Neighborhood"… for the row's tag. */
export const PLACE_KIND_LABEL: Record<PlaceKind, string> = {
  county: "County",
  city: "City",
  neighborhood: "Neighborhood",
  zip: "ZIP code",
};
