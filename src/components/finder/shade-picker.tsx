"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";

import { AREA_MEASURE, AREA_MEASURES, type AreaMeasure } from "@/lib/tracts";

import { Icon } from "@/components/ui/icons";

/**
 * "Sort and shade by" inside a county (owner, 2026-11-10): a button that opens a panel
 * of measures by topic, instead of one long native list. Picking one orders the areas
 * by it and shades the map with it; "Nothing" is the default. Uses the Popover API like
 * InfoTip and Share: top layer, closes on Escape or a tap outside.
 */

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Homes and cost", keys: ["median_home_value", "zhvi", "zhvi_yoy", "median_gross_rent", "property_tax_rate", "highrise_share"] },
  { title: "Schools", keys: ["nearby_school_pctl", "nearby_hs_pctl"] },
  { title: "People", keys: ["per_capita_income", "kids_share", "density_per_sq_mi"] },
  { title: "Getting around", keys: ["walkability", "dist_downtown_mi", "dist_airport_mi"] },
  // No crime (owner, 2026-11-13): sorting and shading rank areas on it (lib/tracts/crime.ts).
  { title: "Hazards", keys: ["hazard_risk"] },
  { title: "Air and environment", keys: ["pm25", "smoke_days_thick", "pre1960_share", "radon_above4"] },
];

/** Every measure that reads well as a map, by topic; one added later lands under "More". */
export const SHADE_GROUPS: { title: string; measures: AreaMeasure[] }[] = (() => {
  const colorable = AREA_MEASURES.filter((m) => m.colorable);
  const placed = new Set(GROUPS.flatMap((g) => g.keys));
  const groups = GROUPS.map((g) => ({
    title: g.title,
    measures: g.keys.map((k) => AREA_MEASURE.get(k)).filter((m): m is AreaMeasure => !!m?.colorable),
  }));
  const rest = colorable.filter((m) => !placed.has(m.key));
  if (rest.length) groups.push({ title: "More", measures: rest });
  return groups.filter((g) => g.measures.length > 0);
})();

/** Kept clear of the window's edges, px. */
const EDGE = 8;

const Chevron = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6l4 4 4-4" />
  </svg>
);

export function ShadePicker({ value, onChange }: { value: string | null; onChange: (key: string | null) => void }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const onBeforeToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "open") el.style.visibility = "hidden";
    };
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      // Under the button, lined up with its left edge — moved up (over it, if need be) and in
      // from the right so the whole panel is on screen: every choice visible without scrolling
      // wherever the window is tall enough.
      const a = button.current!.getBoundingClientRect();
      const { width, height } = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      el.style.left = `${Math.max(EDGE, Math.min(a.left, vw - width - EDGE))}px`;
      el.style.top = `${Math.max(EDGE, Math.min(a.bottom + 4, window.innerHeight - height - EDGE))}px`;
      el.style.visibility = "";
      // Start on the current choice, so arrow keys move from it.
      (el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el.querySelector<HTMLElement>("[role=menuitemradio]"))?.focus();
    };
    el.addEventListener("beforetoggle", onBeforeToggle);
    el.addEventListener("toggle", onToggle);
    return () => {
      el.removeEventListener("beforetoggle", onBeforeToggle);
      el.removeEventListener("toggle", onToggle);
    };
  }, []);

  const pick = (key: string | null) => {
    onChange(key);
    pop.current?.hidePopover();
    button.current?.focus();
  };
  // Arrow keys step through the choices (Tab works too).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitemradio]")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-label ${
      on
        ? "border-neutral-900 bg-neutral-900 font-semibold text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
        : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
    }`;

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-haspopup="menu"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-neutral-300 px-3 py-2 text-left hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-caption text-neutral-500 dark:text-neutral-400">Sort and shade by</span>
          <span className="block truncate text-label font-semibold">{value ? (AREA_MEASURE.get(value)?.label ?? value) : "Nothing"}</span>
        </span>
        <Chevron />
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        role="menu"
        aria-label="Sort and shade by"
        onKeyDown={onKeyDown}
        className="fixed inset-auto m-0 max-h-[calc(100dvh-1rem)] w-[min(42rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-4 text-neutral-800 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <p className="text-caption text-neutral-500 dark:text-neutral-400">
          Orders the areas by one measure and shades the map with it.
        </p>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={value === null}
          onClick={() => pick(null)}
          className={`mt-2.5 mb-1 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-label ${
            value === null
              ? "border-neutral-900 font-semibold dark:border-neutral-100"
              : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          }`}
        >
          <span className="min-w-0 flex-1">
            Nothing
            <span className="block text-caption font-normal text-neutral-500 dark:text-neutral-400">
              Areas by city or town, map unshaded
            </span>
          </span>
          {value === null && <Icon name="check" className="h-4 w-4 shrink-0" />}
        </button>
        {/* Topics in two columns where there's room, so every choice shows at once. */}
        <div className="gap-x-6 sm:columns-2">
        {SHADE_GROUPS.map((g) => (
          <div key={g.title} role="group" aria-label={g.title} className="break-inside-avoid pt-3">
            <h4 className="text-caption font-semibold text-neutral-500 dark:text-neutral-400">{g.title}</h4>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {g.measures.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === m.key}
                  title={m.note}
                  onClick={() => pick(m.key)}
                  className={chip(value === m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        </div>
      </div>
    </>
  );
}
