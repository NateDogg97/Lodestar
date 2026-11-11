import { describe, expect, it } from "vitest";

import { distinctNames, type NationalAreas } from "./national";
import { buildPlaceIndex, normalizePlace, parseLabel, searchPlaces } from "./places";

const counties = {
  fips: ["48453", "48491", "48015", "17167", "11001", "36047"],
  countyName: ["Travis County", "Williamson County", "Austin County", "Sangamon County", "District of Columbia", "Kings County"],
  state: ["TX", "TX", "TX", "IL", "DC", "NY"],
  population: [1_300_000, 650_000, 30_000, 195_000, 680_000, 2_600_000],
};

// geoid, label, population, lat, lon
const ROWS: [string, string, number, number, number][] = [
  ["48453001309", "Zilker, Austin · 78704", 5000, 30.26, -97.77],
  ["48453001310", "Bouldin Creek, Austin · 78704", 4000, 30.25, -97.76],
  ["48491020000", "Austin · 78717", 6000, 30.49, -97.75], // Austin reaches into Williamson County
  ["48453031500", "Near Manor · 78653", 3000, 30.35, -97.52],
  ["48453044300", "Pflugerville · 78660", 6000, 30.44, -97.62],
  ["48015760100", "Near Sealy · 77474", 2500, 29.78, -96.16],
  ["17167000100", "Springfield · 62701", 7000, 39.8, -89.65],
  ["11001004701", "Near Northeast, Washington · 20002", 4500, 38.9, -76.99],
  ["02020000100", "Anchorage · 99501", 5000, 61.2, -149.9], // its county isn't in play
  ["48453980000", "St. Elmo, Austin", 800, 30.21, -97.76], // no ZIP
  ["48491020100", "Travis, Round Rock · 78664", 900, 30.5, -97.68], // a neighborhood named like a county
];

function areas(): NationalAreas {
  const label = ROWS.map((r) => r[1]);
  const lat = Float64Array.from(ROWS.map((r) => r[3]));
  const lon = Float64Array.from(ROWS.map((r) => r[4]));
  return {
    n: ROWS.length,
    geoid: ROWS.map((r) => r[0]),
    county: ROWS.map((r) => r[0].slice(0, 5)),
    label,
    name: distinctNames(label, lat, lon),
    lowConfidence: ROWS.map(() => []),
    population: Float64Array.from(ROWS.map((r) => r[2])),
    lat,
    lon,
    values: new Map(),
  };
}

describe("parseLabel", () => {
  it("reads the neighborhood, city and ZIP", () => {
    expect(parseLabel("Zilker, Austin · 78704")).toEqual({ neighborhood: "Zilker", city: "Austin", near: false, zip: "78704" });
    expect(parseLabel("Pflugerville · 78660")).toEqual({ neighborhood: null, city: "Pflugerville", near: false, zip: "78660" });
  });
  it("tells an area beside a town from one inside it", () => {
    expect(parseLabel("Near Manor · 78653")).toEqual({ neighborhood: null, city: "Manor", near: true, zip: "78653" });
    expect(parseLabel("Near Anniston")).toEqual({ neighborhood: null, city: "Anniston", near: true, zip: null });
  });
  it("keeps a neighborhood whose own name starts with Near, or has commas", () => {
    expect(parseLabel("Near Northeast, Washington · 20002")).toMatchObject({ neighborhood: "Near Northeast", city: "Washington", near: false });
    expect(parseLabel("Caddo Heights, South Highlands, Shreveport · 71104")).toMatchObject({
      neighborhood: "Caddo Heights, South Highlands",
      city: "Shreveport",
    });
    expect(parseLabel("Greater Pinellas Point, Near St. Petersburg")).toMatchObject({ city: "St. Petersburg", zip: null });
  });
});

describe("normalizePlace", () => {
  it("ignores case, accents and punctuation, and folds Saint/St.", () => {
    expect(normalizePlace("  St. Elmo ")).toBe("st elmo");
    expect(normalizePlace("Saint Elmo")).toBe("st elmo");
    expect(normalizePlace("Doña Ana County")).toBe("dona ana county");
    expect(normalizePlace("O'Fallon")).toBe("ofallon");
  });
});

describe("buildPlaceIndex", () => {
  const index = buildPlaceIndex(counties, areas());
  const find = (kind: string, name: string) => index.find((p) => p.kind === kind && p.name === name);

  it("lists counties alone until the areas load", () => {
    const only = buildPlaceIndex(counties, null);
    expect(only).toHaveLength(counties.fips.length + 1); // Kings County is also Brooklyn
    expect(only.every((p) => p.kind === "county")).toBe(true);
  });
  it("groups a city's areas across counties, placed in the county with most of its people", () => {
    const austin = find("city", "Austin")!;
    expect(austin.areas).toEqual([0, 1, 2, 9]);
    expect(austin.population).toBe(15_800);
    expect(austin.where).toBe("Travis County + 1 more, TX");
    expect(find("city", "Pflugerville")!.where).toBe("Travis County, TX");
    expect(austin.bounds).toEqual([-97.77, 30.21, -97.75, 30.49]);
  });
  it("gives a town with no area inside it the areas beside it", () => {
    const manor = find("city", "Manor")!;
    expect(manor.near).toBe(true);
    expect(manor.areas).toEqual([3]);
  });
  it("groups neighborhoods and ZIP codes", () => {
    expect(find("neighborhood", "Zilker")).toMatchObject({ areas: [0], where: "Austin, TX" });
    expect(find("zip", "78704")).toMatchObject({ areas: [0, 1], where: "Austin, TX", state: "TX" });
  });
  it("leaves out areas whose county isn't in play", () => {
    expect(find("city", "Anchorage")).toBeUndefined();
    expect(find("zip", "99501")).toBeUndefined();
  });
});

describe("searchPlaces", () => {
  const index = buildPlaceIndex(counties, areas());
  const names = (q: string) => searchPlaces(index, q).map((p) => `${p.kind}:${p.name}`);

  it("needs two characters", () => {
    expect(searchPlaces(index, "a")).toEqual([]);
    expect(searchPlaces(index, "  ")).toEqual([]);
  });
  it("matches the start of a name, and puts an exact name first", () => {
    expect(names("pfluger")).toEqual(["city:Pflugerville"]);
    // "Travis" is the neighborhood's whole name; "Travis County" only starts with "travis c".
    expect(names("travis c")).toEqual(["county:Travis County"]);
    expect(names("wash")).toEqual(["city:Washington"]);
    expect(names("sangamon il")[0]).toBe("county:Sangamon County");
  });
  it("finds a county with or without the word County, ahead of smaller places of that name", () => {
    expect(names("travis")).toEqual(["county:Travis County", "neighborhood:Travis"]);
    expect(names("Travis County")).toEqual(["county:Travis County"]);
    // Both exact: the county has more people than these few areas of the city.
    expect(names("austin")).toEqual(["county:Austin County", "city:Austin"]);
  });
  it("knows New York City's boroughs by name", () => {
    expect(searchPlaces(index, "brooklyn")[0]).toMatchObject({ kind: "county", fips: "36047", where: "Kings County, NY" });
  });
  it("takes a state after the name, abbreviated or spelled out", () => {
    expect(names("springfield il")).toEqual(["city:Springfield"]);
    expect(names("Springfield, Illinois")).toEqual(["city:Springfield"]);
    expect(names("springfield tx")).toEqual([]);
  });
  it("takes a city after a neighborhood", () => {
    expect(names("zilker austin")).toEqual(["neighborhood:Zilker"]);
  });
  it("finds ZIP codes by their first digits", () => {
    expect(names("787")).toEqual(["zip:78704", "zip:78717"]);
    expect(names("78653")).toEqual(["zip:78653"]);
  });
  it("matches a later word, and Saint as St.", () => {
    expect(names("creek")).toEqual(["neighborhood:Bouldin Creek"]);
    expect(names("saint elmo")).toEqual(["neighborhood:St. Elmo"]);
    expect(names("near northeast")).toEqual(["neighborhood:Near Northeast"]);
  });
  it("ranks same-quality matches by population", () => {
    expect(names("pf")).toEqual(["city:Pflugerville"]);
    expect(searchPlaces(index, "wa", 1)[0].name).toBe("Washington");
  });
});
