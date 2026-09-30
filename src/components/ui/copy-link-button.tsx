"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "./icons";

type State = "idle" | "copied" | "failed";

/** Copies text with the Clipboard API, falling back to a hidden textarea (plain-http LAN testing). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(el);
    el.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    el.remove();
    return ok;
  }
}

/**
 * "Copy link": copies this search's URL (and the county being viewed) and
 * shows "Copied" for a moment. `compact` is icon-only, for the phone bar.
 */
export function CopyLinkButton({ getUrl, compact = false }: { getUrl: () => string; compact?: boolean }) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    const ok = await copyText(getUrl());
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };

  const label = state === "copied" ? "Copied" : state === "failed" ? "Couldn’t copy" : "Copy link";
  const tone =
    state === "copied"
      ? "border-emerald-600 text-emerald-700 dark:border-emerald-500 dark:text-emerald-400"
      : state === "failed"
        ? "border-rose-600 text-rose-700 dark:text-rose-400"
        : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900";

  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy a link to this search"
      aria-label={compact ? label : undefined}
      className={`flex shrink-0 items-center gap-1.5 rounded-full text-label font-medium transition-colors ${
        compact
          ? `h-9 w-9 justify-center ${state === "idle" ? "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100" : tone}`
          : `border px-3.5 py-1.5 ${tone}`
      }`}
    >
      <Icon name={state === "copied" ? "check" : "link"} className="h-5 w-5" />
      {!compact && <span>{label}</span>}
      {/* Announce the result; the visible label changes too. */}
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "Link copied" : state === "failed" ? "Couldn’t copy the link" : ""}
      </span>
    </button>
  );
}
