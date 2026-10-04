/**
 * Areas inside a county — census tracts (plan §9 Phase 8). Pure data code: the
 * payload format written by `etl/tracts/publish.py`, the measures the app
 * shows, and their formatting. No UI imports.
 */

import { ordinal } from "@/lib/scoring/format";

export const TRACTS_FORMAT = "tracts-v1";

/**
 * Where tract files live. Locally `public/data/tracts/` (git-ignored, written
 * by the ETL); in production the R2 data host (plan §9 Phase 8, "Data
 * hosting"), set with NEXT_PUBLIC_DATA_URL.
 */
export const DATA_URL = (process.env.NEXT_PUBLIC_DATA_URL ?? "/data").replace(/\/$/, "");
export const tractIndexUrl = () => `${DATA_URL}/tracts/index.json`;
export const tractDataUrl = (fips: string) => `${DATA_URL}/tracts/${fips}.json`;
export const tractShapesUrl = (fips: string) => `${DATA_URL}/tracts/${fips}.topo.json`;
/** Every area's scoring columns, for ranking areas nationwide (Phase 8f). */
export const nationalAreasUrl = () => `${DATA_URL}/tracts/areas.json`;

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface TractIndex {
  counties: Record<string, { tracts: number; generated: string }>;
}

export interface Area {
  geoid: string;
  /** "Zilker, Austin · 78704" */
  label: string;
  /** The city, town or community — or "Near Manor" outside any — for grouping. */
  group: string;
  neighborhood: string | null;
  zip: string | null;
  population: number | null;
  /** Every column, as published. */
  row: Row;
  /** Columns whose values are low confidence (see LOW_CONFIDENCE_HEADLINE). */
  lowConfidence: string[];
  /** Census top-coded columns: the value means "this much or more". */
  topcoded: string[];
  /** Nearest scored elementary and middle schools (ids into CountyAreas.schools). */
  nearbySchools: string[];
  /** Nearest high schools. */
  nearbyHighSchools: string[];
}

export interface School {
  id: string;
  name: string;
  level: "elementary" | "middle" | "high";
  city: string | null;
  /** False for a nearby school just across the county line (no county rank). */
  inCounty: boolean;
  countyName: string | null;
  score: number | null;
  /** National percentile among schools of the same level. Elementary and middle:
   *  SEDA test scores. High: college-prep access (AP participation and courses, CRDC). */
  pctl: number | null;
  countyRank: number | null;
  countyCount: number | null;
  /** High schools only (CRDC 2023–24). */
  apCourses: number | null;
  apShare: number | null;
  dualShare: number | null;
  ib: boolean;
  enrollment: number | null;
}

export interface CountyAreas {
  county: string;
  generated: string;
  downtownMetro: string | null;
  areas: Area[];
  byGeoid: Map<string, Area>;
  schools: Map<string, School>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function rows(table: unknown, what: string): Row[] {
  if (!isObj(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    throw new Error(`Area data is missing its ${what} table`);
  }
  const cols = table.columns as string[];
  return (table.rows as Cell[][]).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? null])));
}

const str = (v: Cell): string | null => (v === null || v === "" ? null : String(v));
const num = (v: Cell): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseTractIndex(payload: unknown): TractIndex {
  if (!isObj(payload) || payload.format !== TRACTS_FORMAT || !isObj(payload.counties)) {
    throw new Error(`Area index is not in the "${TRACTS_FORMAT}" format`);
  }
  return { counties: payload.counties as TractIndex["counties"] };
}

export function parseCountyAreas(payload: unknown): CountyAreas {
  if (!isObj(payload) || payload.format !== TRACTS_FORMAT) {
    throw new Error(`Area data is not in the "${TRACTS_FORMAT}" format. Rebuild it with \`python -m etl.tracts.publish\`.`);
  }
  const areas: Area[] = rows(payload, "area").map((row) => {
    const place = str(row.place);
    const near = str(row.near_place);
    return {
      geoid: String(row.geoid),
      label: str(row.label) ?? String(row.geoid),
      group: place ?? (near ? `Near ${near}` : "Unincorporated"),
      neighborhood: str(row.neighborhood),
      zip: str(row.zip),
      population: num(row.population),
      row,
      lowConfidence: (str(row.low_confidence) ?? "").split(";").filter(Boolean),
      topcoded: (str(row.topcoded) ?? "").split(";").filter(Boolean),
      nearbySchools: (str(row.nearby_schools) ?? "").split(";").filter(Boolean),
      nearbyHighSchools: (str(row.nearby_high_schools) ?? "").split(";").filter(Boolean),
    };
  });
  const schools = new Map<string, School>();
  for (const r of rows(payload.schools, "schools")) {
    const id = String(r.school_id);
    schools.set(id, {
      id,
      name: str(r.name) ?? id,
      level: r.level === "middle" || r.level === "high" ? r.level : "elementary",
      city: str(r.city),
      inCounty: r.in_county !== false && r.in_county !== "False",
      countyName: str(r.county_name ?? null),
      score: num(r.score),
      pctl: num(r.pctl),
      countyRank: num(r.county_rank),
      countyCount: num(r.county_count),
      apCourses: num(r.ap_courses ?? null),
      apShare: num(r.ap_share ?? null),
      dualShare: num(r.dual_share ?? null),
      ib: r.ib === true || r.ib === "True",
      enrollment: num(r.enrollment ?? null),
    });
  }
  return {
    county: String(payload.county),
    generated: String(payload.generated ?? ""),
    downtownMetro: typeof payload.downtown_metro === "string" ? payload.downtown_metro : null,
    areas,
    byGeoid: new Map(areas.map((a) => [a.geoid, a])),
    schools,
  };
}

// ---------------------------------------------------------------------------
// Measures shown inside a county

export type AreaFormat = "dollars" | "percent" | "pctl" | "miles" | "number" | "minutes" | "rate" | "walk" | "change";

export interface AreaMeasure {
  key: string;
  label: string;
  format: AreaFormat;
  /** Short note for an "i" tip: where it comes from, what it means. */
  note?: string;
  /** Offered in "Color the map by". */
  colorable?: boolean;
}

export const AREA_MEASURES: AreaMeasure[] = [
  { key: "median_home_value", label: "Home value (Census)", format: "dollars", colorable: true,
    note: "Census median value of owner-occupied homes in this area, averaged over 2019–2023." },
  { key: "zhvi", label: "Home value (Zillow, by ZIP)", format: "dollars", colorable: true,
    note: "Zillow Home Value Index for the area's ZIP: the typical home, all types incl. condos. Recent." },
  { key: "zori", label: "Rent (Zillow, by ZIP)", format: "dollars", note: "Zillow Observed Rent Index for the ZIP: typical asking rent." },
  { key: "median_gross_rent", label: "Rent (Census)", format: "dollars", colorable: true,
    note: "Census median gross rent (incl. utilities), 2019–2023." },
  { key: "per_capita_income", label: "Income per person", format: "dollars", colorable: true,
    note: "Census, 2019–2023. Fairer than household income where households are small (downtowns)." },
  { key: "median_household_income", label: "Household income", format: "dollars" },
  { key: "nearby_school_pctl", label: "Nearby elementary & middle schools", format: "pctl", colorable: true,
    note: "Average national percentile of the nearest scored elementary and middle schools within 5 miles (SEDA test scores, grades 3–8). Not attendance zones." },
  { key: "nearby_hs_pctl", label: "Nearby high schools", format: "pctl", colorable: true,
    note: "Average national percentile of the 2 nearest high schools for college-prep access: AP participation and AP courses offered (Civil Rights Data Collection, 2023–24)." },
  { key: "district_pctl", label: "School district", format: "pctl", colorable: true,
    note: "National percentile of the area's school district (SEDA, grades 3–8)." },
  { key: "walkability", label: "Walkability", format: "walk", colorable: true,
    note: "EPA National Walkability Index, 1–20: street grid, transit nearby, mix of homes and jobs. 15+ is most walkable." },
  { key: "kids_share", label: "Households with kids", format: "percent", colorable: true },
  { key: "highrise_share", label: "High-rise homes", format: "percent", colorable: true,
    note: "Share of homes in buildings of 20 or more units." },
  { key: "single_family_share", label: "Single-family homes", format: "percent" },
  { key: "owner_share", label: "Owner-occupied", format: "percent" },
  { key: "median_age", label: "Median age", format: "number" },
  { key: "bachelors_share", label: "Bachelor's degree or more", format: "percent" },
  { key: "density_per_sq_mi", label: "People per sq mi", format: "number", colorable: true },
  { key: "dist_downtown_mi", label: "To downtown", format: "miles", colorable: true,
    note: "From where people in the area live to the nearest downtown of the metro's main cities (Dallas or Fort Worth, say): each one's densest cluster of jobs." },
  { key: "dist_airport_mi", label: "To a major airport", format: "miles", colorable: true },
  { key: "commute_minutes", label: "Average commute", format: "minutes" },
  { key: "work_from_home_share", label: "Work from home", format: "percent" },
  { key: "violent_rate", label: "Violent crime", format: "rate", colorable: true,
    note: "FBI, per 100,000 residents, for the police agency covering the area (city police or county sheriff) — not the neighborhood itself." },
  { key: "property_rate", label: "Property crime", format: "rate", note: "FBI, per 100,000 residents, for the covering police agency." },
  { key: "zhvi_yoy", label: "Home value, last 12 months (by ZIP)", format: "change", colorable: true },
  { key: "days_on_market", label: "Days on market", format: "number", note: "Redfin median for the ZIP, latest 90 days." },
  { key: "sale_to_list", label: "Sale-to-list", format: "percent", note: "Redfin average sale price as a share of list price." },
  { key: "hazard_risk", label: "Natural hazard risk", format: "pctl", colorable: true,
    note: "FEMA National Risk Index: national percentile of expected yearly losses as a share of what's there." },
  { key: "hazard_wildfire", label: "Wildfire risk", format: "pctl" },
  { key: "hazard_inland_flood", label: "Flood risk", format: "pctl" },
];

export const AREA_MEASURE = new Map(AREA_MEASURES.map((m) => [m.key, m]));

/**
 * Values that earn the caution icon in the LIST (owner, 2026-09-30): headline
 * measures only — a third of tracts have some uncertain value, ~7% a headline
 * one. The area's detail view marks every flagged value.
 */
export const LOW_CONFIDENCE_HEADLINE = new Set([
  "median_home_value", "per_capita_income", "median_household_income", "median_gross_rent", "sale_price", "crime",
]);

export const headlineFlags = (a: Area) => a.lowConfidence.filter((c) => LOW_CONFIDENCE_HEADLINE.has(c));

/** Plain words for a flagged column, for the caution icon's details. */
export function flagLabel(col: string): string {
  if (col === "crime") return "Crime rate";
  if (col === "sale_price") return "Sale price (few sales)";
  return AREA_MEASURE.get(col)?.label ?? col.replace(/_/g, " ");
}

export function areaValue(a: Area, key: string): number | null {
  return num(a.row[key] ?? null);
}

/** Like formatArea, with "+" on a Census top-coded value ("$3,501+" = that or more). */
export function formatAreaValue(a: Area, key: string): string {
  const text = formatArea(key, areaValue(a, key));
  return a.topcoded.includes(key) && text !== "—" ? `${text}+` : text;
}

export function formatArea(key: string, v: number | null): string {
  if (v === null) return "—";
  const f = AREA_MEASURE.get(key)?.format ?? "number";
  switch (f) {
    case "dollars":
      return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v).toLocaleString()}`;
    case "percent":
      return `${Math.round(v)}%`;
    case "pctl":
      return `${ordinal(Math.round(v))} pctl`;
    case "miles":
      return `${v < 10 ? v.toFixed(1) : Math.round(v)} mi`;
    case "minutes":
      return `${Math.round(v)} min`;
    case "rate":
      return `${Math.round(v).toLocaleString()} /100k`;
    case "walk":
      return `${v.toFixed(1)} / 20`;
    case "change":
      return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
    default:
      return Math.round(v).toLocaleString();
  }
}

/** Areas grouped by city / town / community, biggest group first. */
export function groupAreas(areas: Area[]): { name: string; areas: Area[]; population: number }[] {
  const groups = new Map<string, Area[]>();
  for (const a of areas) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
  return [...groups.entries()]
    .map(([name, list]) => ({ name, areas: list, population: list.reduce((s, a) => s + (a.population ?? 0), 0) }))
    .sort((x, y) => y.population - x.population);
}
export * from "./scoring";
export * from "./national";
