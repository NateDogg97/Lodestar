"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

const MARGIN = 8;

/**
 * A small "i" button that opens a short explanation in a popover, so notes
 * (how it's scored, what FEMA measures, law caveats) stay out of the reading
 * path. Uses the native Popover API: it renders in the top layer (never
 * clipped by a scrolling panel) and closes on Escape or a tap outside. It
 * also closes on scroll or resize rather than drifting from its button.
 */
export function InfoTip({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const hide = () => el.hidePopover();
    // "toggle" fires after the popover is shown; keep it invisible until placed.
    const onBeforeToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "open") el.style.visibility = "hidden";
    };
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") {
        window.removeEventListener("scroll", hide, true);
        window.removeEventListener("resize", hide);
        return;
      }
      place(button.current!, el);
      el.style.visibility = "";
      window.addEventListener("scroll", hide, true);
      window.addEventListener("resize", hide);
    };
    el.addEventListener("beforetoggle", onBeforeToggle);
    el.addEventListener("toggle", onToggle);
    return () => {
      el.removeEventListener("beforetoggle", onBeforeToggle);
      el.removeEventListener("toggle", onToggle);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-label={icon ? label : `About ${label}`}
        title={icon ? label : `About ${label}`}
        className={`inline-grid h-5 w-5 shrink-0 place-items-center rounded-full align-middle hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:hover:bg-neutral-800 ${
          // A custom icon (the low-confidence caution) is amber; the "i" is grey.
          icon
            ? "text-amber-500 hover:text-amber-600 dark:text-amber-400"
            : "text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
        }`}
      >
        {icon ?? (
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 7.2v4" strokeLinecap="round" />
            <circle cx="8" cy="4.9" r="0.4" fill="currentColor" />
          </svg>
        )}
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        role="note"
        aria-label={label}
        // Popovers default to centered (inset: 0; margin: auto); place() sets top/left.
        className="fixed inset-auto m-0 w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-neutral-200 bg-white p-3 text-label font-normal text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
      >
        {children}
      </div>
    </>
  );
}

/** Below the button, flipped above when there's no room, kept inside the viewport. */
export function place(anchor: HTMLElement, el: HTMLElement) {
  const a = anchor.getBoundingClientRect();
  const { width, height } = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - width / 2), vw - width - MARGIN);
  const below = a.bottom + 4;
  const top = below + height > vh - MARGIN && a.top - 4 - height >= MARGIN ? a.top - 4 - height : below;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
