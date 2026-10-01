import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatArea,
  formatAreaValue,
  groupAreas,
  headlineFlags,
  parseCountyAreas,
  parseTractIndex,
  TRACTS_FORMAT,
} from "./index";

const payload = {
  format: TRACTS_FORMAT,
  county: "48453",
  generated: "2026-09-30",
  downtown_metro: "Austin-Round Rock-San Marcos, TX",
  columns: ["geoid", "label", "place", "near_place", "neighborhood", "zip", "population", "zhvi",
    "low_confidence", "nearby_schools", "nearby_school_pctl", "nearby_high_schools"],
  rows: [
    ["48453001309", "Zilker, Austin · 78704", "Austin", null, "Zilker", "78704", 5000, 900000, "kids_share", "s1;s2", 72.5, "h1;h2"],
    ["48453031500", "Near Manor · 78653", null, "Manor", null, "78653", 3000, 300000, "median_home_value;crime", "", null, ""],
    ["48453044300", "Pflugerville · 78660", "Pflugerville", null, null, "78660", 6000, 365000, "", "s2", 60, "h1"],
  ],
  schools: {
    columns: ["school_id", "name", "level", "city", "county_name", "in_county", "score", "pctl", "county_rank",
      "county_count", "ap_courses", "ap_share", "dual_share", "ib", "enrollment"],
    rows: [
      ["s1", "Zilker Elementary", "elementary", "Austin", "Travis County", true, 0.9, 98.5, 4, 154, null, null, null, null, null],
      ["s2", "O Henry Middle", "middle", "Austin", "Travis County", true, 0.2, 70.1, 12, 50, null, null, null, null, null],
      ["h1", "Austin High", "high", "Austin", "Travis County", true, 90.1, 95.7, 9, 47, 25, 42.7, 22.6, false, 2296],
      ["h2", "Cedar Park High", "high", "Cedar Park", "Williamson County", false, 80, 88, null, null, 0, 0, null, false, 2000],
    ],
  },
};

describe("area data", () => {
  it("parses areas, groups and schools", () => {
    const c = parseCountyAreas(payload);
    expect(c.areas).toHaveLength(3);
    expect(c.byGeoid.get("48453031500")?.group).toBe("Near Manor");
    expect(c.byGeoid.get("48453001309")?.nearbySchools).toEqual(["s1", "s2"]);
    expect(c.schools.get("s1")).toMatchObject({ level: "elementary", countyRank: 4, countyCount: 154, inCounty: true });
    expect(c.byGeoid.get("48453001309")?.nearbyHighSchools).toEqual(["h1", "h2"]);
    expect(c.schools.get("h1")).toMatchObject({ level: "high", apCourses: 25, apShare: 42.7, ib: false });
    expect(c.schools.get("h2")).toMatchObject({ inCounty: false, countyName: "Williamson County", countyRank: null });
  });

  it("flags only headline values for the list's caution icon", () => {
    const c = parseCountyAreas(payload);
    expect(headlineFlags(c.byGeoid.get("48453001309")!)).toEqual([]); // kids_share isn't headline
    expect(headlineFlags(c.byGeoid.get("48453031500")!)).toEqual(["median_home_value", "crime"]);
  });

  it("groups by place, biggest first", () => {
    const groups = groupAreas(parseCountyAreas(payload).areas);
    expect(groups.map((g) => g.name)).toEqual(["Pflugerville", "Austin", "Near Manor"]);
  });

  it("formats values", () => {
    expect(formatArea("zhvi", 1_702_237)).toBe("$1.70M");
    expect(formatArea("zhvi", 540_000)).toBe("$540,000");
    expect(formatArea("nearby_school_pctl", 92.4)).toBe("92nd pctl");
    expect(formatArea("walkability", 16.24)).toBe("16.2 / 20");
    expect(formatArea("zhvi_yoy", -4.53)).toBe("-4.5%");
    expect(formatArea("dist_downtown_mi", 1.44)).toBe("1.4 mi");
    expect(formatArea("violent_rate", 422.3)).toBe("422 /100k");
    expect(formatArea("zhvi", null)).toBe("—");
    const area = parseCountyAreas({
      ...payload,
      columns: [...payload.columns, "median_gross_rent", "topcoded"],
      rows: payload.rows.map((r, i) => [...r, i === 0 ? 3501 : 1500, i === 0 ? "median_gross_rent" : ""]),
    }).areas;
    expect(formatAreaValue(area[0], "median_gross_rent")).toBe("$3,501+");
    expect(formatAreaValue(area[1], "median_gross_rent")).toBe("$1,500");
  });

  it("rejects other formats", () => {
    expect(() => parseCountyAreas({ ...payload, format: "tracts-v0" })).toThrow(/format/);
    expect(() => parseTractIndex({ format: "nope" })).toThrow(/format/);
  });
});

// The published Travis file is git-ignored (plan §9 Phase 8): check it when present.
const travis = join(process.cwd(), "public/data/tracts/48453.json");
describe.skipIf(!existsSync(travis))("published Travis County areas", () => {
  it("has every tract named and grouped, with schools resolvable", () => {
    const c = parseCountyAreas(JSON.parse(readFileSync(travis, "utf8")));
    expect(c.areas.length).toBeGreaterThan(250);
    expect(c.areas.every((a) => a.label && !a.label.includes("nan"))).toBe(true);
    const groups = groupAreas(c.areas).map((g) => g.name);
    expect(groups[0]).toBe("Austin");
    expect(groups).toEqual(expect.arrayContaining(["Pflugerville", "Lakeway", "Lago Vista"]));
    const missing = c.areas.flatMap((a) => [...a.nearbySchools, ...a.nearbyHighSchools]).filter((id) => !c.schools.has(id));
    expect(missing).toEqual([]);
    // High schools are in, Westlake among them, and some neighbors sit across the county line.
    const high = [...c.schools.values()].filter((s) => s.level === "high");
    expect(high.length).toBeGreaterThan(30);
    expect(high.some((s) => /WESTLAKE/i.test(s.name) && s.countyRank !== null && s.countyRank <= 3)).toBe(true);
    expect([...c.schools.values()].some((s) => !s.inCounty)).toBe(true);
  });
});
