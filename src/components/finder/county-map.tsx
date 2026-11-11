"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

import type { CountyDataset, CountyScore } from "@/lib/scoring";
import type { PlaceShapes } from "@/lib/tracts";

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
  // The county you're inside: its areas are drawn instead, and the blank ones stay blank.
  ["boolean", ["feature-state", "inside"], false],
  0,
  // A looked-up place's counties: its areas are drawn instead.
  ["boolean", ["feature-state", "lookup"], false],
  0,
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
   * scale (plan §9 Phase 8e). "measure": a measure's rank, 0–1, on neutral viridis.
   * "none": no shading, the areas' lines only (the default with no by-area filter). */
  palette: "score" | "measure" | "none";
  /** Null when nothing is shaded. */
  legend: { title: string; low: string; high: string } | null;
  /** A second line for the hover label: the shaded measure's value here. */
  details?: Map<string, string>;
  selected: string | null;
  /** Areas to outline while the pointer is over them in the list (a town: all its areas). */
  highlight: string[];
  /** A pick from the list: zoom to that area. A new object re-zooms. */
  focus: { geoid: string; n: number } | null;
  onSelectArea: (geoid: string) => void;
}

/** How solid a measure's shading is (score colors stay at 0.8). */
const MEASURE_OPACITY = 0.45;
const AREA_STOPS = [0, 0.2, 0.4, 0.6, 0.8, 1].flatMap((t) => [t, interpolateViridis(t)]);
const AREA_FILL = [
  "case",
  ["==", ["typeof", ["feature-state", "v"]], "number"],
  ["interpolate", ["linear"], ["feature-state", "v"], ...AREA_STOPS],
  UNKNOWN_COLOR,
] as unknown as ExpressionSpecification;
// Areas not listed aren't filled: focus (owner). Revealed, those failing a must-have
// are grey (-1).
const AREA_SCORE_FILL = [
  "case",
  ["!=", ["typeof", ["feature-state", "v"]], "number"],
  "rgba(0,0,0,0)",
  ["<", ["feature-state", "v"], 0],
  UNKNOWN_COLOR,
  ["interpolate", ["linear"], ["feature-state", "v"], ...SCORE_STOPS],
] as unknown as ExpressionSpecification;

/**
 * A place looked up by name (plan §9 Phase 12): its outline — the city, neighborhood or
 * ZIP code itself, not its county — and, while its list is showing, each of its areas.
 */
export interface LookupLayer {
  /** The place: a new key redraws and re-frames. */
  key: string;
  counties: string[];
  shapes: PlaceShapes;
  /** False while one of its areas is open: only the outline stays. */
  showAreas: boolean;
  /** By area: 0–100 on the score scale (its rank among the place's matches), or a `LOOKUP_*` code. */
  values: Map<string, number>;
  /** The hover label: the area's name, and how it does. */
  tips: Map<string, { label: string; detail: string }>;
  /** Areas to outline while the pointer is over them in the list. */
  highlight: string[];
  /** Null when nothing is weighted, so the colors aren't a scale. */
  legend: { title: string; low: string; high: string } | null;
}

/** Fails a must-have: grey. */
export const LOOKUP_RULED_OUT = -1;
/** Not a place to live (water, an airport, a campus): its shape, no fill. */
export const LOOKUP_UNLISTED = -2;
/** Passes, with nothing weighted to rank it by: one neutral color. */
export const LOOKUP_UNRANKED = -3;

const LOOKUP_FILL = [
  "case",
  ["!=", ["typeof", ["feature-state", "v"]], "number"],
  "rgba(0,0,0,0)",
  [">=", ["feature-state", "v"], 0],
  ["interpolate", ["linear"], ["feature-state", "v"], ...SCORE_STOPS],
  ["==", ["feature-state", "v"], LOOKUP_RULED_OUT],
  UNKNOWN_COLOR,
  ["==", ["feature-state", "v"], LOOKUP_UNRANKED],
  "#14b8a6",
  "rgba(0,0,0,0)",
] as unknown as ExpressionSpecification;

const LOOKUP_AREA_LAYERS = ["lookup-fill", "lookup-line", "lookup-hover"];

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
  /**
   * The area whose summary is open in the results (Phase 8f): a pin. The map goes
   * there when `fly` changes — a summary the person opened, not the #1 open on load.
   */
  pin?: { lat: number; lon: number; fly: number } | null;
  /** A looked-up place (west, south, east, north): the map goes there. A new object moves it again. */
  fit?: { bounds: [number, number, number, number] } | null;
  /** A looked-up place, drawn on the map. */
  lookup?: LookupLayer | null;
  /** Area mode: where your top areas are, by zoom. */
  marks?: ResultMarks | null;
  /** A tap on an area dot opens that area. */
  onOpenArea?: (geoid: string) => void;
  /** Area mode: counties are colored by their best area's match, not relative to each other. */
  byBestArea?: boolean;
  onSelect: (fips: string | null) => void;
}

/**
 * Areas as the results, by zoom (plan §9 Phase 8f): far out, each state's count of
 * your top areas; closer, each county's; closest, the areas themselves as dots.
 */
export interface ResultMarks {
  states: { key: string; label: string; lat: number; lon: number; count: number; bounds: [number, number, number, number] }[];
  counties: { key: string; label: string; lat: number; lon: number; count: number }[];
  areas: { geoid: string; label: string; lat: number; lon: number; score: number }[];
}

/** Below this zoom, state counts; from it to AREAS_FROM, county counts; then area dots. */
const COUNTIES_FROM = 5;
const AREAS_FROM = 7.5;

function bubble(count: number, title: string, kind: "state" | "county"): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.textContent = count.toLocaleString();
  el.className =
    "grid place-items-center rounded-full border-2 border-white bg-neutral-900 font-semibold text-white shadow-md " +
    "hover:bg-emerald-700 dark:border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 " +
    (kind === "state" ? "min-w-8 h-8 px-1.5 text-label" : "min-w-6 h-6 px-1 text-caption");
  return el;
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
  pin = null,
  fit = null,
  lookup = null,
  byBestArea = false,
  marks = null,
  onOpenArea,
  onSelect,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const shapesRef = useRef<Shapes | null>(null);
  const [ready, setReady] = useState(false);
  const [basemapOnline, setBasemapOnline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Latest props for map event handlers, which are registered once.
  const latest = useRef({ data, scoresByFips, rankByFips, relative, byBestArea, onSelect, bottomInset, inside, lookup, onOpenArea });
  useEffect(() => {
    latest.current = { data, scoresByFips, rankByFips, relative, byBestArea, onSelect, bottomInset, inside, lookup, onOpenArea };
  });

  // The lower 48 above the phone's results sheet (owner, 2026-10-04): the opening view
  // leaves the bottom `bottomInset` px for the sheet, so the whole country is visible.
  const home = useRef(true);
  const homePadding = (el: HTMLElement) => {
    const inset = Math.min(latest.current.bottomInset, el.clientHeight * 0.6);
    return { top: 20, left: 20, right: 20, bottom: 20 + inset };
  };

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
          ...(camera.current ?? { bounds: CONTIGUOUS_US, fitBoundsOptions: { padding: homePadding(container.current) } }),
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.touchZoomRotate.disableRotation();
        // The opening view follows the phone sheet until the person moves the map.
        map.on("movestart", (e) => {
          if ((e as { originalEvent?: Event }).originalEvent) home.current = false;
        });
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
        const onArea = (e: { point: { x: number; y: number } }) => {
          const layers = ["tract-fill", "lookup-fill", "result-areas"].filter((l) => map!.getLayer(l));
          return layers.length > 0 && map!.queryRenderedFeatures([e.point.x, e.point.y], { layers }).length > 0;
        };
        map.on("click", "result-areas", (e) => {
          const geoid = e.features?.[0]?.properties?.geoid as string | undefined;
          if (geoid) latest.current.onOpenArea?.(geoid);
        });
        map.on("mouseenter", "result-areas", () => (map!.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "result-areas", () => (map!.getCanvas().style.cursor = ""));
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
          const more = latest.current.inside?.details?.get(geoid);
          if (more) {
            const detail = document.createElement("div");
            detail.textContent = more;
            el.append(detail);
          }
          popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map!);
        });
        map.on("click", "tract-fill", (e) => {
          const geoid = e.features?.[0]?.properties?.GEOID as string | undefined;
          if (geoid) latest.current.inside?.onSelectArea(geoid);
        });
        // A looked-up place's areas: name each under the pointer, outline it, open it on a click.
        let over: string | null = null;
        const setOver = (geoid: string | null) => {
          if (geoid === over) return;
          if (over && map!.getSource("lookup-areas")) map!.setFeatureState({ source: "lookup-areas", id: over }, { over: false });
          over = geoid;
          if (over) map!.setFeatureState({ source: "lookup-areas", id: over }, { over: true });
        };
        map.on("mousemove", "lookup-fill", (e) => {
          const geoid = e.features?.[0]?.properties?.GEOID as string | undefined;
          const tip = geoid && latest.current.lookup?.tips.get(geoid);
          if (!geoid || !tip) return;
          setOver(geoid);
          map!.getCanvas().style.cursor = "pointer";
          const el = document.createElement("div");
          el.className = "text-xs text-neutral-900";
          const name = document.createElement("strong");
          name.textContent = tip.label;
          const detail = document.createElement("div");
          detail.textContent = tip.detail;
          el.append(name, detail);
          popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map!);
        });
        map.on("mouseleave", "lookup-fill", () => {
          setOver(null);
          map!.getCanvas().style.cursor = "";
          popup.remove();
        });
        map.on("click", "lookup-fill", (e) => {
          const geoid = e.features?.[0]?.properties?.GEOID as string | undefined;
          if (!geoid || !latest.current.lookup?.tips.has(geoid)) return;
          // Its page opens and these areas are hidden, so no mouseleave follows.
          setOver(null);
          popup.remove();
          latest.current.onOpenArea?.(geoid);
        });
        map.on("mousemove", "county-fill", (e) => {
          if (onArea(e)) return;
          const fips = e.features?.[0]?.properties?.GEOID as string | undefined;
          if (!fips) return;
          const { data: d, scoresByFips: byFips, rankByFips: ranks, relative: rel, byBestArea: areaMode } = latest.current;
          const i = d.indexByFips.get(fips);
          if (i === undefined) return;
          const sc = byFips.get(fips);
          const rank = ranks.get(fips);
          // Its rank in the results (owner, 2026-10-04: a county's own score is often
          // empty — an areas-only search ranks counties by their best area).
          const best = rel.get(fips);
          const line = !sc
            ? `${d.state[i] === "AK" ? "Alaska" : d.state[i] === "HI" ? "Hawaii" : "This state"} is turned off in Settings`
            : sc.status === "excluded"
              ? "Ruled out by a must-have"
              : rank
                ? `#${rank.toLocaleString()} of ${ranks.size.toLocaleString()} ${ranks.size === 1 ? "county" : "counties"}${
                    areaMode
                      ? typeof best === "number" ? ` · best area ${Math.round(best)}` : ""
                      : sc.score !== null ? ` · score ${Math.round(sc.score)}` : ""
                  }${sc.status === "unknown" ? " · unknown for a must-have" : ""}`
                : areaMode
                  ? "None of its areas are in your top results"
                  : sc.status === "unknown"
                    ? "Unknown for a must-have"
                    : "Not in the results";
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
  const insideFocus = inside?.focus ?? null;
  const zoomedArea = useRef<typeof insideFocus>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !insideFips || !insideShapes) return;
    const obj = insideShapes.objects.tracts as GeometryCollection;
    const fc = feature(insideShapes, obj) as unknown as FeatureCollection<Geometry, { GEOID: string }>;
    tractFeatures.current = new Map(fc.features.map((f) => [f.properties.GEOID, f.geometry]));
    const layers = map.getStyle().layers;
    const lastShape = layers.findLastIndex((l) => l.type !== "symbol");
    const firstLabel = layers.slice(lastShape + 1).find((l) => l.type === "symbol")?.id;
    map.setFeatureState({ source: "counties", id: insideFips }, { inside: true });
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
    // An area picked from the results zooms to that area (the effect below), not the county.
    const pending = latest.current.inside?.focus;
    const toArea = !!pending && pending !== zoomedArea.current && tractFeatures.current.has(pending.geoid);
    const b = shapesRef.current?.bounds.get(insideFips);
    if (b && !toArea) {
      const inset = latest.current.bottomInset;
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 30, left: 30, right: 30, bottom: inset + 30 }, duration: 600 });
    }
    return () => {
      for (const id of ["tract-selected", "tract-hover", "tract-line", "tract-fill"]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource("counties")) map.setFeatureState({ source: "counties", id: insideFips }, { inside: false });
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
    map.setPaintProperty(
      "tract-fill",
      "fill-color",
      insidePalette === "score" ? AREA_SCORE_FILL : insidePalette === "measure" ? AREA_FILL : "rgba(0,0,0,0)",
    );
    // A measure is a light wash, so streets and names read through it (owner, 2026-11-10).
    map.setPaintProperty("tract-fill", "fill-opacity", insidePalette === "measure" ? MEASURE_OPACITY : 0.8);
    // Unshaded, the lines are the areas: drawn in ink, since there's no fill to cut through.
    const plain = insidePalette === "none";
    map.setPaintProperty("tract-line", "line-color", plain ? (dark ? "#e5e5e5" : "#262626") : dark ? "#0a0a0a" : "#ffffff");
    map.setPaintProperty("tract-line", "line-width", plain ? 1 : 0.6);
    map.setPaintProperty("tract-line", "line-opacity", plain ? 0.55 : 0.8);
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

  const frameLookup = (map: MapLibreMap, bounds: PlaceShapes["bounds"]) => {
    if (!bounds) return;
    const [w, s, e, n] = bounds;
    const height = map.getContainer().clientHeight;
    const inset = Math.min(latest.current.bottomInset, height * 0.6);
    const pad = Math.max(16, Math.min(60, (height - inset) / 6));
    map.fitBounds([[w, s], [e, n]], { padding: { top: pad, left: pad, right: pad, bottom: inset + pad }, maxZoom: 13, duration: 600 });
  };

  // A looked-up place: its areas and its outline, framed once per place.
  const lookupKey = lookup?.key ?? null;
  const lookupShapes = lookup?.shapes ?? null;
  const lookupCounties = lookup?.counties ?? null;
  const framedLookup = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !lookupKey || !lookupShapes || !lookupCounties) return;
    const layers = map.getStyle().layers;
    const lastShape = layers.findLastIndex((l) => l.type !== "symbol");
    const firstLabel = layers.slice(lastShape + 1).find((l) => l.type === "symbol")?.id;
    const ink = dark ? "#fff" : "#111";
    const paper = dark ? "#0a0a0a" : "#ffffff";
    for (const fips of lookupCounties) map.setFeatureState({ source: "counties", id: fips }, { lookup: true });
    map.addSource("lookup-areas", { type: "geojson", data: lookupShapes.areas, promoteId: "GEOID" });
    map.addSource("lookup-outline", { type: "geojson", data: lookupShapes.outline });
    map.addLayer({ id: "lookup-fill", type: "fill", source: "lookup-areas",
      paint: { "fill-color": LOOKUP_FILL, "fill-opacity": 0.75 } }, firstLabel);
    map.addLayer({ id: "lookup-line", type: "line", source: "lookup-areas",
      paint: { "line-color": paper, "line-width": 0.6, "line-opacity": 0.8 } }, firstLabel);
    // The place's own edge, over everything: a light casing keeps it readable on any fill.
    map.addLayer({ id: "lookup-outline-casing", type: "line", source: "lookup-outline",
      layout: { "line-join": "round" }, paint: { "line-color": paper, "line-width": 5, "line-opacity": 0.7 } });
    map.addLayer({ id: "lookup-outline", type: "line", source: "lookup-outline",
      layout: { "line-join": "round" }, paint: { "line-color": ink, "line-width": 2.5 } });
    // An area under the pointer — on the map (`over`) or in the list (`hover`).
    map.addLayer({ id: "lookup-hover", type: "line", source: "lookup-areas",
      layout: { "line-join": "round" },
      paint: { "line-color": ink,
        "line-width": ["case",
          ["any", ["boolean", ["feature-state", "hover"], false], ["boolean", ["feature-state", "over"], false]], 3.5, 0] } });
    if (framedLookup.current !== lookupKey) {
      framedLookup.current = lookupKey;
      frameLookup(map, lookupShapes.bounds);
    }
    return () => {
      for (const id of ["lookup-hover", "lookup-outline", "lookup-outline-casing", "lookup-line", "lookup-fill"]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of ["lookup-areas", "lookup-outline"]) if (map.getSource(id)) map.removeSource(id);
      if (map.getSource("counties")) {
        for (const fips of lookupCounties) map.setFeatureState({ source: "counties", id: fips }, { lookup: false });
      }
    };
  }, [ready, lookupKey, lookupShapes, lookupCounties, dark]);
  // No place: the next lookup of the same one frames it again.
  useEffect(() => {
    if (!lookupKey) framedLookup.current = null;
  }, [lookupKey]);

  // Its areas show while its list does; with one of them open, only the outline stays.
  const lookupShowAreas = lookup?.showAreas ?? false;
  const lookupAreasShown = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getLayer("lookup-fill")) return;
    for (const id of LOOKUP_AREA_LAYERS) map.setLayoutProperty(id, "visibility", lookupShowAreas ? "visible" : "none");
    // Back from one of its areas to its list: show the whole place again.
    if (lookupShowAreas && !lookupAreasShown.current) frameLookup(map, lookupShapes?.bounds ?? null);
    lookupAreasShown.current = lookupShowAreas;
  }, [ready, lookupShowAreas, lookupKey, lookupShapes, lookupCounties, dark]);

  const lookupValues = lookup?.values ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !lookupValues || !map.getSource("lookup-areas")) return;
    for (const [geoid, v] of lookupValues) map.setFeatureState({ source: "lookup-areas", id: geoid }, { v });
  }, [ready, lookupValues, lookupKey, lookupShapes, lookupCounties, dark]);

  const lookupHighlight = lookup?.highlight;
  const prevLookupHighlight = useRef<string[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getSource("lookup-areas")) return;
    for (const id of prevLookupHighlight.current) map.setFeatureState({ source: "lookup-areas", id }, { hover: false });
    prevLookupHighlight.current = lookupHighlight ?? [];
    for (const id of prevLookupHighlight.current) map.setFeatureState({ source: "lookup-areas", id }, { hover: true });
  }, [ready, lookupHighlight, lookupKey, lookupShapes, lookupCounties, dark]);

  // The open result's area: a pin, and the map moves there (keeping a regional view).
  const pinLat = pin?.lat ?? null;
  const pinLon = pin?.lon ?? null;
  const pinFly = pin?.fly ?? 0;
  const flown = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const data = {
      type: "FeatureCollection" as const,
      features: pinLat === null || pinLon === null ? [] : [
        { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [pinLon, pinLat] } },
      ],
    };
    const src = map.getSource("result-pin") as GeoJSONSource | undefined;
    if (src) src.setData(data);
    else {
      map.addSource("result-pin", { type: "geojson", data });
      map.addLayer({ id: "result-pin", type: "circle", source: "result-pin",
        paint: { "circle-radius": 7, "circle-color": "#111", "circle-stroke-width": 3, "circle-stroke-color": "#fff" } });
    }
    if (pinLat !== null && pinLon !== null && pinFly !== flown.current) {
      flown.current = pinFly;
      const inset = Math.min(latest.current.bottomInset, map.getContainer().clientHeight * 0.6);
      map.easeTo({ center: [pinLon, pinLat], zoom: Math.max(map.getZoom(), 8), padding: { top: 0, left: 0, right: 0, bottom: inset }, duration: 600 });
    }
  }, [ready, pinLat, pinLon, pinFly, dark]);

  // Your top areas by zoom: count bubbles (HTML, so they need no map fonts — the
  // offline basemap has none) for states and counties, and dots for the areas.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const dots = {
      type: "FeatureCollection" as const,
      features: (marks?.areas ?? []).map((a) => ({
        type: "Feature" as const,
        properties: { geoid: a.geoid, score: a.score, label: a.label },
        geometry: { type: "Point" as const, coordinates: [a.lon, a.lat] },
      })),
    };
    const src = map.getSource("result-areas") as GeoJSONSource | undefined;
    if (src) src.setData(dots);
    else {
      map.addSource("result-areas", { type: "geojson", data: dots });
      map.addLayer(
        {
          id: "result-areas",
          type: "circle",
          source: "result-areas",
          minzoom: AREAS_FROM,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], AREAS_FROM, 5, 12, 9],
            "circle-color": ["interpolate", ["linear"], ["get", "score"], ...SCORE_STOPS] as unknown as ExpressionSpecification,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": dark ? "#111" : "#fff",
          },
        },
        map.getLayer("result-pin") ? "result-pin" : undefined,
      );
    }
    const made: { marker: Marker; kind: "state" | "county" }[] = [];
    for (const st of marks?.states ?? []) {
      const el = bubble(st.count, `${st.label}: ${st.count} of your top areas`, "state");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        map.fitBounds(st.bounds, { padding: 60, maxZoom: AREAS_FROM - 0.5, duration: 600 });
      });
      made.push({ marker: new Marker({ element: el }).setLngLat([st.lon, st.lat]), kind: "state" });
    }
    for (const c of marks?.counties ?? []) {
      const el = bubble(c.count, `${c.label}: ${c.count} of your top areas`, "county");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        latest.current.onSelect(c.key);
      });
      made.push({ marker: new Marker({ element: el }).setLngLat([c.lon, c.lat]), kind: "county" });
    }
    let shown: "state" | "county" | null | undefined;
    const update = () => {
      const z = map.getZoom();
      const level = z < COUNTIES_FROM ? "state" : z < AREAS_FROM ? "county" : null;
      if (level === shown) return;
      shown = level;
      for (const m of made) {
        if (m.kind === level) m.marker.addTo(map);
        else m.marker.remove();
      }
    };
    update();
    map.on("zoom", update);
    return () => {
      map.off("zoom", update);
      for (const m of made) m.marker.remove();
    };
  }, [ready, marks, dark]);

  // The sheet's height settles after load (and can change): keep the opening view above
  // it until the map is moved by hand or something is selected.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !home.current || camera.current || selectedFips || inside) return;
    map.fitBounds(CONTIGUOUS_US, { padding: homePadding(map.getContainer()), duration: 0 });
    // homePadding reads the latest inset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, bottomInset]);

  // A pick from the area list or the results zooms to it — once its county's shapes are in.
  useEffect(() => {
    const map = mapRef.current;
    const g = insideFocus && tractFeatures.current.get(insideFocus.geoid);
    if (!ready || !map || !g || zoomedArea.current === insideFocus) return;
    zoomedArea.current = insideFocus;
    const [x0, y0, x1, y1] = bboxOf(g);
    const inset = Math.min(latest.current.bottomInset, map.getContainer().clientHeight * 0.6);
    map.fitBounds([[x0, y0], [x1, y1]], { padding: { top: 60, left: 60, right: 60, bottom: inset + 60 }, maxZoom: 13, duration: 600 });
  }, [ready, insideFocus, insideFips, insideShapes]);

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

  // A place looked up by name: the map shows all of it (a city, a ZIP code), above the sheet.
  const fitted = useRef<typeof fit>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !fit || fitted.current === fit) return;
    fitted.current = fit;
    const [w, s, e, n] = fit.bounds;
    const height = map.getContainer().clientHeight;
    const inset = Math.min(latest.current.bottomInset, height * 0.6);
    const pad = Math.max(16, Math.min(60, (height - inset) / 6));
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: { top: pad, left: pad, right: pad, bottom: inset + pad }, maxZoom: 12, duration: 600 },
    );
  }, [ready, fit]);

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
      {ready && inside ? inside.legend && inside.palette !== "none" && <AreaLegend {...inside.legend} palette={inside.palette} /> : ready && lookup?.showAreas && lookup.legend ? <AreaLegend {...lookup.legend} palette="score" /> : ready && relative.size > 0 && <Legend count={relative.size} byBestArea={byBestArea} />}
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
        style={{
          background: `linear-gradient(to right, ${stops.filter((_, i) => i % 2 === 1).join(", ")})`,
          opacity: palette === "measure" ? MEASURE_OPACITY + 0.25 : undefined,
        }}
      />
      <div className="mt-0.5 flex justify-between text-neutral-500">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function Legend({ count, byBestArea }: { count: number; byBestArea: boolean }) {
  return (
    <div className="pointer-events-none absolute right-2 bottom-[calc(var(--map-inset)+2rem)] w-48 rounded-md bg-white/90 px-2.5 py-2 text-caption text-neutral-700 shadow-sm dark:bg-neutral-900/90 dark:text-neutral-300">
      <p className="font-medium">{byBestArea ? `${count} counties, by their best area` : `Top ${count} results`}</p>
      <div
        className="mt-1 h-2 rounded-sm"
        style={{ background: `linear-gradient(to right, ${SCORE_STOPS.filter((_, i) => i % 2 === 1).join(", ")})` }}
      />
      <div className="mt-0.5 flex justify-between text-neutral-500">
        <span>{byBestArea ? "weaker match" : "weakest of these"}</span>
        <span>{byBestArea ? "stronger" : "best"}</span>
      </div>
    </div>
  );
}
