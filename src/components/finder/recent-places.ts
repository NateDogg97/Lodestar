import type { Place, PlaceKind } from "@/lib/tracts";

/**
 * Places recently looked up in "Find a place" (plan §9 Phase 12), kept in
 * localStorage — on this device only, like recent searches. Stored by the place's
 * index key with what its row shows, so the list can be drawn before the areas
 * file (cities, neighborhoods, ZIP codes) has loaded. Newest first, no repeats.
 */
export interface RecentPlace {
  key: string;
  kind: PlaceKind;
  name: string;
  where: string;
  near: boolean;
}

const KEY = "nhf.places.recent.v1";
export const RECENT_PLACES_MAX = 8;
const KINDS: PlaceKind[] = ["county", "city", "neighborhood", "zip"];

export function loadRecentPlaces(): RecentPlace[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (p): p is RecentPlace =>
          typeof p?.key === "string" && typeof p?.name === "string" && typeof p?.where === "string" && KINDS.includes(p?.kind),
      )
      .map((p) => ({ key: p.key, kind: p.kind, name: p.name, where: p.where, near: p.near === true }))
      .slice(0, RECENT_PLACES_MAX);
  } catch {
    return [];
  }
}

function write(list: RecentPlace[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage blocked or full: the list just isn't remembered
  }
}

/** Put a picked place first; returns the new list. */
export function addRecentPlace(p: Place): RecentPlace[] {
  const entry: RecentPlace = { key: p.key, kind: p.kind, name: p.name, where: p.where, near: p.near };
  const list = [entry, ...loadRecentPlaces().filter((r) => r.key !== p.key)].slice(0, RECENT_PLACES_MAX);
  write(list);
  return list;
}

export function clearRecentPlaces() {
  write([]);
}
