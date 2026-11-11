/**
 * A looked-up place's shape on the map (plan §9 Phase 12): its areas' tract shapes,
 * and their merged outline. A city, neighborhood or ZIP code is the set of areas named
 * after it (./places.ts), so this is the outline of those census tracts — close to the
 * legal boundary, never exactly it. Pure: no UI imports.
 */

import { feature, merge } from "topojson-client";
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type { GeometryCollection, Polygon as TopoPolygon, MultiPolygon as TopoMultiPolygon, Topology } from "topojson-specification";

export interface PlaceShapes {
  /** One feature per area, `GEOID` in its properties. */
  areas: FeatureCollection<Polygon | MultiPolygon, { GEOID: string }>;
  /** The place's edge: one merged shape per county it's in (county files don't share lines). */
  outline: FeatureCollection<MultiPolygon>;
  /** West, south, east, north; null when no area has a shape. */
  bounds: [number, number, number, number] | null;
}

type TractGeometry = (TopoPolygon<{ GEOID: string }> | TopoMultiPolygon<{ GEOID: string }>);

/** The shapes of `geoids`, from their counties' tract files (`{fips}.topo.json`). */
export function placeShapes(topologies: Iterable<Topology>, geoids: Set<string>): PlaceShapes {
  const areas: PlaceShapes["areas"] = { type: "FeatureCollection", features: [] };
  const outline: PlaceShapes["outline"] = { type: "FeatureCollection", features: [] };
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    if (typeof (c as Position)[0] === "number") {
      const [x, y] = c as Position;
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    } else for (const inner of c as unknown[]) walk(inner);
  };
  for (const topo of topologies) {
    const all = (topo.objects.tracts as GeometryCollection<{ GEOID: string }> | undefined)?.geometries ?? [];
    const mine = all.filter(
      (g): g is TractGeometry => (g.type === "Polygon" || g.type === "MultiPolygon") && geoids.has(g.properties?.GEOID ?? ""),
    );
    if (mine.length === 0) continue;
    const fc = feature(topo, { type: "GeometryCollection", geometries: mine }) as FeatureCollection<
      Polygon | MultiPolygon,
      { GEOID: string }
    >;
    areas.features.push(...fc.features);
    const edge: Feature<MultiPolygon> = { type: "Feature", properties: {}, geometry: merge(topo, mine) };
    outline.features.push(edge);
    walk(edge.geometry.coordinates);
  }
  return { areas, outline, bounds: Number.isFinite(w) ? [w, s, e, n] : null };
}
