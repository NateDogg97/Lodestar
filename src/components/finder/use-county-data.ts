"use client";

import { useEffect, useState } from "react";

import { parseLawPayload, type LawData } from "@/lib/laws";
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

// ---------------------------------------------------------------------------
// Laws and taxes (LAWS.md). Optional: if the file is missing or malformed the
// finder still works, and the county card simply has no laws section.

export const LAW_DATA_URL = "/data/laws.json";

let lawsPending: Promise<LawData> | null = null;

function loadLawData(): Promise<LawData> {
  lawsPending ??= fetch(LAW_DATA_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Could not load law data (HTTP ${res.status})`);
      return res.json();
    })
    .then(parseLawPayload)
    .catch((err: unknown) => {
      lawsPending = null;
      throw err;
    });
  return lawsPending;
}

export function useLawData(): LawData | null {
  const [data, setData] = useState<LawData | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadLawData().then(
      (d) => !cancelled && setData(d),
      (err: unknown) => console.warn("[laws]", err),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}
