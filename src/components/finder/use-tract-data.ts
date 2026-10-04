"use client";

import { useEffect, useState } from "react";
import type { Topology } from "topojson-specification";

import {
  nationalAreasUrl,
  parseCountyAreas,
  parseNationalAreas,
  type NationalAreas,
  parseTractIndex,
  tractDataUrl,
  tractIndexUrl,
  tractShapesUrl,
  type CountyAreas,
  type TractIndex,
} from "@/lib/tracts";

/**
 * Areas inside a county (plan §9 Phase 8b). The index says which counties have
 * area data; a county's data and shapes are fetched when it's explored, once
 * per page load (the service worker also caches them for offline use).
 */

let indexPending: Promise<TractIndex> | null = null;

function loadIndex(): Promise<TractIndex> {
  indexPending ??= fetch(tractIndexUrl())
    .then((res) => (res.ok ? res.json() : { format: "tracts-v1", counties: {} }))
    .then(parseTractIndex)
    .catch(() => ({ counties: {} })); // no area data anywhere: nothing to explore
  return indexPending;
}

/** Which counties can be explored inside (empty until the index loads). */
export function useTractIndex(): TractIndex["counties"] {
  const [counties, setCounties] = useState<TractIndex["counties"]>({});
  useEffect(() => {
    let cancelled = false;
    loadIndex().then((i) => !cancelled && setCounties(i.counties));
    return () => {
      cancelled = true;
    };
  }, []);
  return counties;
}

export interface LoadedCounty {
  areas: CountyAreas;
  shapes: Topology;
}

const countyPending = new Map<string, Promise<LoadedCounty>>();

function loadCounty(fips: string): Promise<LoadedCounty> {
  let p = countyPending.get(fips);
  if (!p) {
    const get = (url: string) =>
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`Could not load area data for ${fips} (HTTP ${res.status})`);
        return res.json();
      });
    p = Promise.all([get(tractDataUrl(fips)), get(tractShapesUrl(fips))])
      .then(([data, shapes]) => ({ areas: parseCountyAreas(data), shapes: shapes as Topology }))
      .catch((err: unknown) => {
        countyPending.delete(fips); // let a later attempt retry
        throw err;
      });
    countyPending.set(fips, p);
  }
  return p;
}

export type CountyAreasState =
  | { status: "idle" }
  | { status: "loading"; fips: string }
  | { status: "error"; fips: string; message: string }
  | { status: "ready"; fips: string; data: LoadedCounty };

export function useCountyAreas(fips: string | null): CountyAreasState {
  const [state, setState] = useState<CountyAreasState>({ status: "idle" });
  useEffect(() => {
    if (!fips) return;
    let cancelled = false;
    // Loading state is set from the promise's callbacks only (no sync setState in the effect).
    Promise.resolve().then(() => !cancelled && setState({ status: "loading", fips }));
    loadCounty(fips).then(
      (data) => !cancelled && setState({ status: "ready", fips, data }),
      (err: unknown) =>
        !cancelled && setState({ status: "error", fips, message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [fips]);
  return fips ? state : { status: "idle" };
}

let nationalPending: Promise<NationalAreas> | null = null;

export type NationalAreasState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: NationalAreas };

/**
 * Every US area's scoring columns (Phase 8f), fetched once — and only when a search
 * has an area-level filter (`enabled`). ~3.4 MB compressed; the service worker keeps it.
 */
export function useNationalAreas(enabled: boolean): NationalAreasState {
  const [state, setState] = useState<NationalAreasState>({ status: "idle" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.resolve().then(() => !cancelled && setState((s) => (s.status === "ready" ? s : { status: "loading" })));
    nationalPending ??= fetch(nationalAreasUrl())
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load area rankings (HTTP ${res.status})`);
        return res.json();
      })
      .then(parseNationalAreas)
      .catch((err: unknown) => {
        nationalPending = null; // a later search retries
        throw err;
      });
    nationalPending.then(
      (data) => !cancelled && setState({ status: "ready", data }),
      (err: unknown) => !cancelled && setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? state : { status: "idle" };
}
