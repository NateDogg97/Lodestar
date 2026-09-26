"use client";

import { useEffect, useState } from "react";

import { parseCountyPayload, type CountyDataset } from "@/lib/scoring";

export const COUNTY_DATA_URL = "/data/counties.json";

export type CountyDataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: CountyDataset };

// One fetch per page load, shared by every caller. The file is static and
// precached by the service worker, so this also works offline.
let pending: Promise<CountyDataset> | null = null;

function loadCountyData(): Promise<CountyDataset> {
  pending ??= fetch(COUNTY_DATA_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Could not load county data (HTTP ${res.status})`);
      return res.json();
    })
    .then(parseCountyPayload)
    .catch((err: unknown) => {
      pending = null; // let a later mount retry
      throw err;
    });
  return pending;
}

export function useCountyData(): CountyDataState {
  const [state, setState] = useState<CountyDataState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadCountyData().then(
      (data) => !cancelled && setState({ status: "ready", data }),
      (err: unknown) =>
        !cancelled &&
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
