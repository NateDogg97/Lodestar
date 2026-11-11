import { describe, expect, it } from "vitest";
import type { Topology } from "topojson-specification";

import { placeShapes } from "./place-shapes";

// Three unit squares in a row (A | B | C), sharing their vertical edges.
const topo = {
  type: "Topology",
  arcs: [
    [[1, 0], [0, 0], [0, 1], [1, 1]], // A's outer three sides
    [[1, 0], [1, 1]], // A | B
    [[1, 1], [2, 1]], // B top
    [[2, 0], [1, 0]], // B bottom
    [[2, 0], [2, 1]], // B | C
    [[2, 1], [3, 1], [3, 0], [2, 0]], // C's outer three sides
  ],
  objects: {
    tracts: {
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", arcs: [[0, -2]], properties: { GEOID: "A" } },
        { type: "Polygon", arcs: [[1, 2, -5, 3]], properties: { GEOID: "B" } },
        { type: "Polygon", arcs: [[4, 5]], properties: { GEOID: "C" } },
      ],
    },
  },
} as unknown as Topology;

describe("placeShapes", () => {
  it("keeps only the place's areas and merges them into one outline", () => {
    const s = placeShapes([topo], new Set(["A", "B"]));
    expect(s.areas.features.map((f) => f.properties.GEOID)).toEqual(["A", "B"]);
    expect(s.outline.features).toHaveLength(1);
    // One ring around both squares: the shared edge is gone.
    const rings = s.outline.features[0].geometry.coordinates;
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(1);
    expect(s.bounds).toEqual([0, 0, 2, 1]);
  });
  it("outlines areas that don't touch as separate shapes", () => {
    const s = placeShapes([topo], new Set(["A", "C"]));
    expect(s.outline.features[0].geometry.coordinates).toHaveLength(2);
    expect(s.bounds).toEqual([0, 0, 3, 1]);
  });
  it("has nothing for a place with no shapes", () => {
    const s = placeShapes([topo], new Set(["Z"]));
    expect(s.areas.features).toEqual([]);
    expect(s.outline.features).toEqual([]);
    expect(s.bounds).toBeNull();
  });
});
