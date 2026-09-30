"use client";

import { useSyncExternalStore } from "react";

/**
 * Light / dark theme with a manual override (plan §9 Phase 7a). The resolved
 * theme lives on <html data-theme="light|dark">, which Tailwind's `dark:`
 * variant reads (see globals.css). `THEME_SCRIPT` sets it before first paint;
 * this module keeps it in step with the setting and the OS afterwards.
 * With no saved choice the app is light (decided 2026-09-30); "System"
 * follows the OS only once picked in Settings.
 */
export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "nhf.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Runs inline in <head>, before the page paints. Keep in step with `apply`. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${KEY}");var d=p==="dark"||(p==="system"&&matchMedia("${DARK_QUERY}").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

// Used when storage is blocked: the choice lasts until reload.
let memoryPref: ThemePref | null = null;

function readPref(): ThemePref {
  if (memoryPref) return memoryPref;
  try {
    const p = window.localStorage.getItem(KEY);
    return p === "dark" || p === "system" ? p : "light";
  } catch {
    return "light";
  }
}

function resolve(pref: ThemePref): Theme {
  if (pref !== "system") return pref;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function apply() {
  const t = resolve(readPref());
  const root = document.documentElement;
  root.dataset.theme = t;
  root.style.colorScheme = t;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const onOsChange = () => {
  apply();
  notify();
};

let osQuery: MediaQueryList | null = null;

function subscribe(onChange: () => void) {
  osQuery ??= window.matchMedia(DARK_QUERY);
  if (listeners.size === 0) osQuery.addEventListener("change", onOsChange);
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) osQuery?.removeEventListener("change", onOsChange);
  };
}

export function setThemePref(pref: ThemePref) {
  try {
    window.localStorage.setItem(KEY, pref);
    memoryPref = null;
  } catch {
    memoryPref = pref;
  }
  apply();
  notify();
}

export const useThemePref = () => useSyncExternalStore(subscribe, readPref, () => "light" as ThemePref);

export const useTheme = () =>
  useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light") as Theme,
    () => "light" as Theme,
  );
