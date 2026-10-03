"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type LngLatBoundsLike,
  type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

import type { CountyDataset, CountyScore } from "@/lib/scoring";

import { interpolateViridis } from "d3-scale-chromatic";

import { SCORE_STOPS, UNKNOWN_COLOR } from "./score-colors";

export const BOUNDARIES_URL = "/data/counties.topo.json";

// MapLibre looks for its worker beside its own module, which the bundler
// moves; serve it from public/ instead (scripts/copy-maplibre-worker.mjs).
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

// Online basemap (plan §9 Phase 4, decision 1): OpenFreeMap — free, no key.
const BASEMAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
const BASEMAP_TIMEOUT_MS = 4000;

/** Offline fallback: no tiles, just a background — the county and state lines still draw. */
function fallbackStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": dark ? "#0a0a0a" : "#f5f5f4" } },
    ],
  };
}

const CONTIGUOUS_US: LngLatBoundsLike = [
  [-125, 24.3],
  [-66.9, 49.5],
];

type CountyProps = { GEOID: string };

interface Shapes {
  counties: FeatureCollection<Geometry, CountyProps>;
  states: FeatureCollection;
  bounds: Map<string, [number, number, number, number]>;
}

function bbox(f: Feature): [number, number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    if (typeof (c as Position)[0] === "number") {
      const [x, y] = c as Position;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else for (const inner of c as unknown[]) walk(inner);
  };
  const g = f.geometry;
  if (g && "coordinates" in g) walk(g.coordinates);
  return [minX, minY, maxX, maxY];
}

let shapesPromise: Promise<Shapes> | null = null;
function loadShapes(): Promise<Shapes> {
  shapesPromise ??= fetch(BOUNDARIES_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Could not load county shapes (HTTP ${r.status})`);
      return r.json() as Promise<Topology>;
    })
    .then((topo) => {
      const counties = feature(
        topo,
        topo.objects.counties as GeometryCollection<CountyProps>,
      ) as FeatureCollection<Geometry, CountyProps>;
      const states = feature(topo, topo.objects.states as GeometryCollection) as FeatureCollection;
      const bounds = new Map(counties.features.map((f) => [f.properties.GEOID, bbox(f)]));
      return { counties, states, bounds };
    })
    .catch((err: unknown) => {
      shapesPromise = null;
      throw err;
    });
  return shapesPromise;
}

/**
 * OpenFreeMap's dark style draws labels and roads in greys a few steps above
 * a near-black background, which is hard to read. Lift them (by layer id; a
 * layer the style no longer has is skipped) so places and roads read at a
 * glance while staying quieter than the county colors on top.
 */
const DARK_OVERRIDES: Record<string, Record<string, unknown>> = {
  background: { "background-color": "#161616" },
  water: { "fill-color": "#1c2a38" },
  waterway: { "line-color": "#1c2a38" },
  landcover_wood: { "fill-color": "#1d211d" },
  landuse_park: { "fill-color": "#1d211d" },
  landuse_residential: { "fill-color": "#1b1b1b" },
  highway_path: { "line-color": "#2e2e2e" },
  highway_minor: { "line-color": "#333333" },
  highway_major_inner: { "line-color": "#3d3d3d" },
  highway_major_subtle: { "line-color": "#404040" },
  highway_motorway_subtle: { "line-color": "#4a4a4a" },
  boundary_state: { "line-color": "#5c5c5c" },
  "boundary_country_z0-4": { "line-color": "#6b6b6b" },
  "boundary_country_z5-": { "line-color": "#6b6b6b" },
  water_name: { "text-color": "#7f9cb8", "text-halo-color": "#161616" },
  highway_name_other: { "text-color": "#9a9a9a", "text-halo-color": "#161616" },
  highway_name_motorway: { "text-color": "#a8a8a8" },
};
const DARK_PLACE_LABEL = { "text-color": "#d4d4d4", "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.2 };

function brightenDark(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((l) => {
      const extra = DARK_OVERRIDES[l.id] ?? (l.type === "symbol" && l.id.startsWith("place_") ? DARK_PLACE_LABEL : null);
      return extra ? ({ ...l, paint: { ...(l as { paint?: object }).paint, ...extra } } as typeof l) : l;
    }),
  };
}

async function pickStyle(dark: boolean): Promise<{ style: string | StyleSpecification; online: boolean }> {
  const url = dark ? BASEMAP_STYLES.dark : BASEMAP_STYLES.light;
  if (typeof navigator !== "undefined" && !navigator.onLine) return { style: fallbackStyle(dark), online: false };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(BASEMAP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(String(res.status));
    const style = (await res.json()) as StyleSpecification;
    return { style: dark ? brightenDark(style) : style, online: true };
  } catch {
    return { style: fallbackStyle(dark), online: false };
  }
}

// Only the top results are filled (decided 2026-09-26), colored red → yellow →
// green by `rel`: their position relative to each other (see topRelativeScores).
// A top result with no score is grey — never a guessed color (plan §6 item 7).
// Every other county is unfilled; faint county lines keep the geography readable.
const FILL_COLOR = [
  "case",
  ["==", ["typeof", ["feature-state", "rel"]], "number"],
  ["interpolate", ["linear"], ["feature-state", "rel"], ...SCORE_STOPS],
  UNKNOWN_COLOR,
] as unknown as ExpressionSpecification;
const FILL_OPACITY: ExpressionSpecification = [
  "case",
  ["!", ["boolean", ["feature-state", "top"], false]],
  0,
  ["==", ["typeof", ["feature-state", "rel"]], "number"],
  0.85,
  0.6,
];

/**
 * Areas inside a county (plan §9 Phase 8b): tract shapes drawn over the
 * county, colored by one measure's position within the county (0–1, viridis
 * — a neutral scale: nothing is being judged good or bad yet).
 */
export interface InsideLayer {
  fips: string;
  shapes: Topology;
  values: Map<string, number | null>;
  labels: Map<string, string>;
  /** "score": values are each area's match position, 0–100, on the red→green score
   * scale (plan §9 Phase 8e). "measure": a measure's rank, 0–1, on neutral viridis. */
  palette: "score" | "measure";
  legend: { title: string; low: string; high: string };
  selected: string | null;
  /** Areas to outline while the pointer is over them in the list (a town: all its areas). */
  highlight: string[];
  /** A pick from the list: zoom to that area. A new object re-zooms. */
  focus: { geoid: string; n: number } | null;
  onSelectArea: (geoid: string) => void;
}

const AREA_STOPS = [0, 0.2, 0.4, 0.6, 0.8, 1].flatMap((t) => [t, interpolateViridis(t)]);
const AREA_FILL = [
  "case",
  ["==", ["typeof", ["feature-state", "v"]], "number"],
  ["interpolate", ["linear"], ["feature-state", "v"], ...AREA_STOPS],
  UNKNOWN_COLOR,
] as unknown as ExpressionSpecification;
const AREA_SCORE_FILL = [
  "case",
  ["==", ["typeof", ["feature-state", "v"]], "number"],
  ["interpolate", ["linear"], ["feature-state", "v"], ...SCORE_STOPS],
  UNKNOWN_COLOR,
] as unknown as ExpressionSpecification;

function bboxOf(geometry: Geometry): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  if ("coordinates" in geometry) walk(geometry.coordinates);
  return [x0, y0, x1, y1];
}

interface Props {
  /** Every county (names and FIPS), including ones toggled out of scoring. */
  data: CountyDataset;
  /** Scores for the counties in scope; a county missing here is toggled off. */
  scoresByFips: Map<string, CountyScore>;
  /** Rank (1-based) by FIPS, for the hover label. */
  rankByFips: Map<string, number>;
  /** The top results to fill: FIPS → 0–100 relative to each other, or null if unscored. */
  relative: Map<string, number | null>;
  selectedFips: string | null;
  /** A pick from the results list: zoom to that county. A new object re-zooms, even to the same county. */
  focus: { fips: string } | null;
  /** Height of whatever covers the bottom of the map (the phone results sheet), in px. */
  bottomInset: number;
  /** Dark basemap and line colors. Changing it rebuilds the map in place. */
  dark: boolean;
  /** Areas inside the open county, when exploring inside (Phase 8b). */
  inside?: InsideLayer | null;
  onSelect: (fips: string | null) => void;
}

export default function CountyMap({
  data,
  scoresByFips,
  rankByFips,
  relative,
  selectedFips,
  focus,
  bottomInset,
  dark,
  inside = null,
  onSelect,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const shapesRef = useRef<Shapes | null>(null);
  const [ready, setReady] = useState(false);
  const [basemapOnline, setBasemapOnline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Latest props for map event handlers, which are registered once.
  const latest = useRef({ data, scoresByFips, rankByFips, onSelect, bottomInset, inside });
  useEffect(() => {
    latest.current = { data, scoresByFips, rankByFips, onSelect, bottomInset, inside };
  });

  // Where the camera was when the map was last torn down (a theme switch), so
  // the rebuilt map opens on the same view.
  const camera = useRef<{ center: [number, number]; zoom: number } | null>(null);

  // Create the map, and again when the theme changes.
  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;

    Promise.all([pickStyle(dark), loadShapes()]).then(
      ([{ style, online }, shapes]) => {
        if (cancelled || !container.current) return;
        setBasemapOnline(online);
        shapesRef.current = shapes;
        map = new MapLibreMap({
          container: container.current,
          style,
          ...(camera.current ?? { bounds: CONTIGUOUS_US, fitBoundsOptions: { padding: 20 } }),
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
        mapRef.current = map;
        // Development only: lets the browser console (and automated checks)
        // inspect layers and state without rendering.
        if (process.env.NODE_ENV === "development") (window as unknown as { __lodestarMap?: MapLibreMap }).__lodestarMap = map;

        map.on("load", () => {
          const m = map!;
          // Draw counties above roads and water but under the place and road
          // labels, so names stay readable and roads show faintly through the
          // color. (Styles put a water-name label early; skip past it.)
          const layers = m.getStyle().layers;
          const lastShape = layers.findLastIndex((l) => l.type !== "symbol");
          const firstLabel = layers.slice(lastShape + 1).find((l) => l.type === "symbol")?.id;
          m.addSource("counties", { type: "geojson", data: shapes.counties, promoteId: "GEOID" });
          m.addSource("states", { type: "geojson", data: shapes.states });
          m.addLayer(
            { id: "county-fill", type: "fill", source: "counties", paint: { "fill-color": FILL_COLOR, "fill-opacity": FILL_OPACITY } },
            firstLabel,
          );
          m.addLayer(
            {
              id: "county-line",
              type: "line",
              source: "counties",
              paint: {
                "line-color": dark ? "#a3a3a3" : "#737373",
                "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.1, 8, 0.6],
                "line-opacity": ["case", ["boolean", ["feature-state", "top"], false], 0.7, 0.18],
              },
            },
            firstLabel,
          );
          m.addLayer(
            {
              id: "state-line",
              type: "line",
              source: "states",
              paint: { "line-color": dark ? "#d4d4d4" : "#404040", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.5] },
            },
            firstLabel,
          );
          m.addLayer({
            id: "county-selected",
            type: "line",
            source: "counties",
            paint: {
              "line-color": dark ? "#fff" : "#111",
              "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 0],
            },
          });
          setReady(true);
        });

        const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
        // Over an area inside the explored county, the area layer handles it.
        const onArea = (e: { point: { x: number; y: number } }) =>
          !!map!.getLayer("tract-fill") &&
          map!.queryRenderedFeatures([e.point.x, e.point.y], { layers: ["tract-fill"] }).length > 0;
        map.on("mousemove", "tract-fill", (e) => {
          const geoid = e.features?.[0]?.properties?.GEOID as string | undefined;
          const label = geoid && latest.current.inside?.labels.get(geoid);
          if (!label) return;
          map!.getCanvas().style.cursor = "pointer";
          const el = document.createElement("div");
          el.className = "text-xs text-neutral-900";
          const name = document.createElement("strong");
          name.textContent = label;
          el.append(name);
          popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map!);
        });
        map.on("click", "tract-fill", (e) => {
          const geoid = e.features?.[0]?.properties?.GEOID as string | undefined;
          if (geoid) latest.current.inside?.onSelectArea(geoid);
        });
        map.on("mousemove", "county-fill", (e) => {
          if (onArea(e)) return;
          const fips = e.features?.[0]?.properties?.GEOID as string | undefined;
          if (!fips) return;
          const { data: d, scoresByFips: byFips, rankByFips: ranks } = latest.current;
          const i = d.indexByFips.get(fips);
          if (i === undefined) return;
          const sc = byFips.get(fips);
          const rank = ranks.get(fips);
          const line = !sc
            ? `${d.state[i] === "AK" ? "Alaska" : d.state[i] === "HI" ? "Hawaii" : "This state"} is turned off in Filters`
            : sc.status === "excluded"
              ? "Ruled out by a limit"
              : sc.score === null
                ? sc.status === "unknown" ? "Unknown for a limit" : "No score"
                : `Score ${Math.round(sc.score)}${rank ? ` · #${rank.toLocaleString()}` : " · hidden"}${sc.status === "unknown" ? " · unknown for a limit" : ""}`;
          map!.getCanvas().style.cursor = "pointer";
          const el = document.createElement("div");
          el.className = "text-xs text-neutral-900";
          const name = document.createElement("strong");
          name.textContent = `${d.countyName[i]}, ${d.state[i]}`;
          const detail = document.createElement("div");
          detail.textContent = line;
          el.append(name, detail);
          popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map!);
        });
        map.on("mouseleave", "county-fill", () => {
          map!.getCanvas().style.cursor = "";
          popup.remove();
        });
        map.on("click", "county-fill", (e) => {
          if (onArea(e)) return;
          const fips = e.features?.[0]?.properties?.GEOID as string | undefined;
          // Only counties in scope can be selected; a turned-off state has no score.
          if (fips && latest.current.scoresByFips.has(fips)) latest.current.onSelect(fips);
        });
      },
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    );

    return () => {
      cancelled = true;
      if (map) {
        const c = map.getCenter();
        camera.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
      }
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [dark]);

  // Areas inside the explored county: add the tract layers, zoom to the county;
  // remove them on the way out.
  const insideFips = inside?.fips ?? null;
  const insideShapes = inside?.shapes ?? null;
  const tractFeatures = useRef<Map<string, Geometry>>(new Map());
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !insideFips || !insideShapes) return;
    const obj = insideShapes.objects.tracts as GeometryCollection;
    const fc = feature(insideShapes, obj) as unknown as FeatureCollection<Geometry, { GEOID: string }>;
    tractFeatures.current = new Map(fc.features.map((f) => [f.properties.GEOID, f.geometry]));
    const layers = map.getStyle().layers;
    const lastShape = layers.findLastIndex((l) => l.type !== "symbol");
    const firstLabel = layers.slice(lastShape + 1).find((l) => l.type === "symbol")?.id;
    map.addSource("tracts", { type: "geojson", data: fc, promoteId: "GEOID" });
    map.addLayer({ id: "tract-fill", type: "fill", source: "tracts",
      paint: { "fill-color": AREA_FILL, "fill-opacity": 0.8 } }, firstLabel);
    map.addLayer({ id: "tract-line", type: "line", source: "tracts",
      paint: { "line-color": dark ? "#0a0a0a" : "#ffffff", "line-width": 0.6, "line-opacity": 0.8 } }, firstLabel);
    map.addLayer({ id: "tract-hover", type: "line", source: "tracts",
      paint: { "line-color": dark ? "#fff" : "#111",
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0] } });
    map.addLayer({ id: "tract-selected", type: "line", source: "tracts",
      paint: { "line-color": dark ? "#fff" : "#111",
        "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 0] } });
    const b = shapesRef.current?.bounds.get(insideFips);
    if (b) {
      const inset = latest.current.bottomInset;
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 30, left: 30, right: 30, bottom: inset + 30 }, duration: 600 });
    }
    return () => {
      for (const id of ["tract-selected", "tract-hover", "tract-line", "tract-fill"]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource("tracts")) map.removeSource("tracts");
      tractFeatures.current = new Map();
    };
  }, [ready, insideFips, insideShapes, dark]);

  // Area colors: match scores, or a measure when no filter varies inside the county.
  const insideValues = inside?.values ?? null;
  const insidePalette = inside?.palette ?? "measure";
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !insideValues || !map.getSource("tracts")) return;
    map.setPaintProperty("tract-fill", "fill-color", insidePalette === "score" ? AREA_SCORE_FILL : AREA_FILL);
    for (const [geoid, v] of insideValues) map.setFeatureState({ source: "tracts", id: geoid }, { v });
  }, [ready, insideValues, insidePalette, insideFips, insideShapes, dark]);

  // The selected area's outline.
  const insideSelected = inside?.selected ?? null;
  const prevArea = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getSource("tracts")) return;
    if (prevArea.current) map.setFeatureState({ source: "tracts", id: prevArea.current }, { selected: false });
    prevArea.current = insideSelected;
    if (insideSelected) map.setFeatureState({ source: "tracts", id: insideSelected }, { selected: true });
  }, [ready, insideSelected, insideFips, insideShapes, dark]);

  // Outline what the pointer is over in the area list.
  const insideHighlight = inside?.highlight;
  const prevHighlight = useRef<string[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getSource("tracts")) return;
    for (const id of prevHighlight.current) map.setFeatureState({ source: "tracts", id }, { hover: false });
    prevHighlight.current = insideHighlight ?? [];
    for (const id of prevHighlight.current) map.setFeatureState({ source: "tracts", id }, { hover: true });
  }, [ready, insideHighlight, insideFips, insideShapes, dark]);

  // A pick from the area list zooms to it.
  const insideFocus = inside?.focus ?? null;
  const zoomedArea = useRef<typeof insideFocus>(null);
  useEffect(() => {
    const map = mapRef.current;
    const g = insideFocus && tractFeatures.current.get(insideFocus.geoid);
    if (!ready || !map || !g || zoomedArea.current === insideFocus) return;
    zoomedArea.current = insideFocus;
    const [x0, y0, x1, y1] = bboxOf(g);
    const inset = Math.min(latest.current.bottomInset, map.getContainer().clientHeight * 0.6);
    map.fitBounds([[x0, y0], [x1, y1]], { padding: { top: 60, left: 60, right: 60, bottom: inset + 60 }, maxZoom: 13, duration: 600 });
  }, [ready, insideFocus]);

  // Recolor on every re-score: feature state only, geometry is never re-uploaded.
  // Every county is written so a county that drops out of the top is cleared.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const fips of data.fips) {
      const rel = relative.get(fips);
      map.setFeatureState({ source: "counties", id: fips }, { top: rel !== undefined, rel: rel ?? null });
    }
  }, [ready, data, relative]);

  // Highlight the selected county.
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (prevSelected.current) map.setFeatureState({ source: "counties", id: prevSelected.current }, { selected: false });
    prevSelected.current = selectedFips;
    if (!selectedFips) return;
    map.setFeatureState({ source: "counties", id: selectedFips }, { selected: true });
  }, [ready, selectedFips]);

  // A pick from the list always zooms to the county — kept above the phone
  // sheet, which may cover most of the map.
  // Each pick zooms once — not again when a theme switch rebuilds the map.
  const zoomedFor = useRef<typeof focus>(null);
  useEffect(() => {
    const map = mapRef.current;
    const b = focus && shapesRef.current?.bounds.get(focus.fips);
    if (!ready || !map || !b || zoomedFor.current === focus) return;
    zoomedFor.current = focus;
    const height = map.getContainer().clientHeight;
    const inset = Math.min(latest.current.bottomInset, height * 0.6);
    const pad = Math.max(16, Math.min(60, (height - inset) / 6));
    map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding: { top: pad, left: pad, right: pad, bottom: inset + pad }, maxZoom: 8, duration: 600 },
    );
  }, [ready, focus]);

  // Panels opening or closing change the map's size.
  useEffect(() => {
    const map = mapRef.current;
    const el = container.current;
    if (!map || !el) return;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  return (
    // --map-inset lifts the map's own corner controls above the phone sheet.
    <div className="map-inset relative h-full w-full" style={{ "--map-inset": `${bottomInset}px` } as CSSProperties}>
      <div ref={container} className="h-full w-full" aria-label="Map of counties colored by score" role="region" />
      {!ready && !error && (
        <p className="absolute inset-0 grid place-items-center text-sm text-neutral-500">Loading map…</p>
      )}
      {error && (
        <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-rose-700 dark:text-rose-400">
          {error}
        </p>
      )}
      {ready && inside ? <AreaLegend {...inside.legend} palette={inside.palette} /> : ready && relative.size > 0 && <Legend count={relative.size} />}
      {basemapOnline === false && (
        <p className="pointer-events-none absolute bottom-[calc(var(--map-inset)+0.5rem)] left-2 rounded bg-white/85 px-2 py-1 text-caption text-neutral-700 dark:bg-neutral-900/85 dark:text-neutral-300">
          Offline — showing county lines only
        </p>
      )}
    </div>
  );
}

function AreaLegend({ title, low, high, palette }: { title: string; low: string; high: string; palette: "score" | "measure" }) {
  const stops = palette === "score" ? SCORE_STOPS : AREA_STOPS;
  return (
    <div className="pointer-events-none absolute right-2 bottom-[calc(var(--map-inset)+2rem)] w-52 rounded-md bg-white/90 px-2.5 py-2 text-caption text-neutral-700 shadow-sm dark:bg-neutral-900/90 dark:text-neutral-300">
      <p className="font-medium">{title}</p>
      <div
        className="mt-1 h-2 rounded-sm"
        style={{ background: `linear-gradient(to right, ${stops.filter((_, i) => i % 2 === 1).join(", ")})` }}
      />
      <div className="mt-0.5 flex justify-between text-neutral-500">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function Legend({ count }: { count: number }) {
  return (
    <div className="pointer-events-none absolute right-2 bottom-[calc(var(--map-inset)+2rem)] w-48 rounded-md bg-white/90 px-2.5 py-2 text-caption text-neutral-700 shadow-sm dark:bg-neutral-900/90 dark:text-neutral-300">
      <p className="font-medium">Top {count} results</p>
      <div
        className="mt-1 h-2 rounded-sm"
        style={{ background: `linear-gradient(to right, ${SCORE_STOPS.filter((_, i) => i % 2 === 1).join(", ")})` }}
      />
      <div className="mt-0.5 flex justify-between text-neutral-500">
        <span>weakest of these</span>
        <span>best</span>
      </div>
    </div>
  );
}
