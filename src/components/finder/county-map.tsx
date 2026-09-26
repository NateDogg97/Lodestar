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
import { useEffect, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

import type { CountyDataset, CountyScore } from "@/lib/scoring";

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

async function pickStyle(dark: boolean): Promise<{ style: string | StyleSpecification; online: boolean }> {
  const url = dark ? BASEMAP_STYLES.dark : BASEMAP_STYLES.light;
  if (typeof navigator !== "undefined" && !navigator.onLine) return { style: fallbackStyle(dark), online: false };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(BASEMAP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(String(res.status));
    return { style: (await res.json()) as StyleSpecification, online: true };
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
  onSelect: (fips: string | null) => void;
}

export default function CountyMap({ data, scoresByFips, rankByFips, relative, selectedFips, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const shapesRef = useRef<Shapes | null>(null);
  const [ready, setReady] = useState(false);
  const [basemapOnline, setBasemapOnline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Latest props for map event handlers, which are registered once.
  const latest = useRef({ data, scoresByFips, rankByFips, onSelect });
  useEffect(() => {
    latest.current = { data, scoresByFips, rankByFips, onSelect };
  });

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    Promise.all([pickStyle(dark), loadShapes()]).then(
      ([{ style, online }, shapes]) => {
        if (cancelled || !container.current) return;
        setBasemapOnline(online);
        shapesRef.current = shapes;
        map = new MapLibreMap({
          container: container.current,
          style,
          bounds: CONTIGUOUS_US,
          fitBoundsOptions: { padding: 20 },
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
        mapRef.current = map;

        map.on("load", () => {
          const m = map!;
          // Draw counties under the basemap's labels so city names stay readable.
          const firstLabel = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
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
        map.on("mousemove", "county-fill", (e) => {
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
          const fips = e.features?.[0]?.properties?.GEOID as string | undefined;
          // Only counties in scope can be selected; a turned-off state has no score.
          if (fips && latest.current.scoresByFips.has(fips)) latest.current.onSelect(fips);
        });
      },
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    );

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

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

  // Highlight the selected county and bring it into view.
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (prevSelected.current) map.setFeatureState({ source: "counties", id: prevSelected.current }, { selected: false });
    prevSelected.current = selectedFips;
    if (!selectedFips) return;
    map.setFeatureState({ source: "counties", id: selectedFips }, { selected: true });
    const b = shapesRef.current?.bounds.get(selectedFips);
    if (!b) return;
    const view = map.getBounds();
    const inView = view.contains([b[0], b[1]]) && view.contains([b[2], b[3]]);
    if (!inView) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 8, duration: 600 });
  }, [ready, selectedFips]);

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
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" aria-label="Map of counties colored by score" role="region" />
      {!ready && !error && (
        <p className="absolute inset-0 grid place-items-center text-sm text-neutral-500">Loading map…</p>
      )}
      {error && (
        <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-rose-700 dark:text-rose-400">
          {error}
        </p>
      )}
      {ready && relative.size > 0 && <Legend count={relative.size} />}
      {basemapOnline === false && (
        <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/85 px-2 py-1 text-[11px] text-neutral-700 dark:bg-neutral-900/85 dark:text-neutral-300">
          Offline — showing county lines only
        </p>
      )}
    </div>
  );
}

function Legend({ count }: { count: number }) {
  return (
    <div className="pointer-events-none absolute right-2 bottom-8 w-48 rounded-md bg-white/90 px-2.5 py-2 text-[11px] text-neutral-700 shadow-sm dark:bg-neutral-900/90 dark:text-neutral-300">
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
