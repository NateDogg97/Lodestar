import { DEFAULT_PREFERENCES, readSavedPreferences, type Preferences } from "./preferences";
import { decodeSearch, encodeSearch, type SharedSearch } from "./search-url";

/**
 * Recent and saved searches (decided 2026-09-30), kept in localStorage — on
 * this device only, like the last search. Each is stored as the same query
 * string a shared link uses (never with a county), so it's compact and goes
 * through the same validation when opened.
 *
 * - Recent: recorded when the Filters modal closes and before a search is
 *   replaced (a shared link, or opening another search). Newest first, no
 *   repeats, at most RECENT_MAX.
 * - Saved: named by the person, kept until deleted.
 */
export interface StoredSearch {
  id: string;
  query: string;
  /** Saved searches only. */
  name?: string;
  /** ISO time it was recorded or saved. */
  at: string;
}

const RECENT_KEY = "nhf.searches.recent.v1";
const SAVED_KEY = "nhf.searches.saved.v1";
export const RECENT_MAX = 8;
const SAVED_MAX = 50;

function read(key: string): StoredSearch[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (s): s is StoredSearch =>
        typeof s?.id === "string" && typeof s?.query === "string" && typeof s?.at === "string",
    );
  } catch {
    return [];
  }
}

function write(key: string, list: StoredSearch[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // storage blocked or full: the list just isn't remembered
  }
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** A stored search's filters, or null if it no longer decodes. */
export function storedPrefs(s: StoredSearch): Preferences | null {
  return decodeSearch(new URLSearchParams(s.query))?.prefs ?? null;
}

export const searchKey = (prefs: Preferences) => encodeSearch(prefs);

export const loadRecent = () => read(RECENT_KEY);
export const loadSaved = () => read(SAVED_KEY);

/** Record a search as the most recent (moving it up if it's already listed). */
export function addRecent(prefs: Preferences): void {
  const query = searchKey(prefs);
  const rest = loadRecent().filter((s) => s.query !== query);
  write(RECENT_KEY, [{ id: newId(), query, at: new Date().toISOString() }, ...rest].slice(0, RECENT_MAX));
}

export function saveSearch(name: string, prefs: Preferences): StoredSearch {
  const entry: StoredSearch = { id: newId(), query: searchKey(prefs), name: name.trim().slice(0, 60), at: new Date().toISOString() };
  write(SAVED_KEY, [entry, ...loadSaved()].slice(0, SAVED_MAX));
  return entry;
}

export function deleteSaved(id: string): void {
  write(SAVED_KEY, loadSaved().filter((s) => s.id !== id));
}

/**
 * The search to open with: a link's search wins over the last one saved on
 * this device (plan Phase 7b). When a link replaces a different search, that
 * search goes into Recent first so it isn't lost.
 */
export function initialSearch(): SharedSearch {
  const saved = readSavedPreferences();
  const shared = decodeSearch(new URLSearchParams(window.location.search));
  if (!shared) return { prefs: saved ?? DEFAULT_PREFERENCES, place: null };
  if (saved && searchKey(saved) !== searchKey(shared.prefs)) addRecent(saved);
  return shared;
}

