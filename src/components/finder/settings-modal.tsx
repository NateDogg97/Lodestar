"use client";

import { useId, useRef, useState } from "react";

import type { LawData } from "@/lib/laws";

import { Modal } from "@/components/ui/modal";
import { setThemePref, useThemePref, type ThemePref } from "@/components/ui/theme";

import { CountySourcesList, LawSourcesList } from "./data-sources";
import { OPTIONAL_STATES, type Preferences } from "./preferences";

interface Props {
  open: boolean;
  onClose: () => void;
  prefs: Preferences;
  onChange: (next: Preferences) => void;
  /** Counties kept as unknown under the current search. */
  unknownCount: number;
  laws: LawData | null;
  /** Replay the first-run tour (plan Phase 9). */
  onShowTour: () => void;
}

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

type Page = "appearance" | "results" | "data" | "help";

const PAGES: { id: Page; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "results", label: "Results" },
  { id: "data", label: "Data sources" },
  { id: "help", label: "Help" },
];

/**
 * Everything that isn't the search itself (plan §9 Phase 7a): appearance, which
 * counties the results include, where the data comes from, and help. Laid out like
 * Filters (owner, 2026-10-04): pages on the left (a row of chips on phones), the page
 * on the right.
 */
export function SettingsModal({ open, onClose, prefs, onChange, unknownCount, laws, onShowTour }: Props) {
  const theme = useThemePref();
  const themeLabel = useId();

  const [page, setPage] = useState<Page>("appearance");
  const pane = useRef<HTMLDivElement>(null);
  const go = (id: Page) => {
    setPage(id);
    pane.current?.scrollTo({ top: 0 });
  };
  const current = PAGES.find((p) => p.id === page)!;

  return (
    <Modal open={open} onClose={onClose} title="Settings" size="panel">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Settings pages"
          className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-neutral-200 px-gutter py-2 md:w-48 md:flex-col md:gap-0.5 md:overflow-y-auto md:border-r md:border-b-0 md:px-3 md:py-4 dark:border-neutral-800"
        >
          {PAGES.map((p) => {
            const on = p.id === page;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => go(p.id)}
                aria-current={on ? "true" : undefined}
                className={`flex shrink-0 items-center rounded-full px-3 py-1.5 text-label whitespace-nowrap md:rounded-lg md:py-2 ${
                  on
                    ? "bg-neutral-900 font-medium text-white md:bg-neutral-100 md:text-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 md:dark:bg-neutral-800 md:dark:text-neutral-100"
                    : "text-neutral-700 hover:bg-neutral-50 max-md:border max-md:border-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-900 max-md:dark:border-neutral-800"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </nav>

        <div ref={pane} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter py-5 md:px-6">
          <h3 className="mb-4 text-title font-semibold">{current.label}</h3>

          {page === "appearance" && (
            <>
              <p id={themeLabel} className="mb-2 text-label text-neutral-600 dark:text-neutral-400">
                Theme
              </p>
              <div role="radiogroup" aria-labelledby={themeLabel} className="grid grid-cols-3 rounded-full bg-neutral-100 p-1 dark:bg-neutral-900">
                {THEMES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={theme === t.value}
                    onClick={() => setThemePref(t.value)}
                    className={`rounded-full py-1.5 text-label font-medium ${
                      theme === t.value
                        ? "bg-white shadow-sm dark:bg-neutral-700"
                        : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {page === "results" && (
            <>
              <Toggle
                label="Show unknown counties"
                hint={`Counties with no data for one of your must-haves (${unknownCount.toLocaleString()} right now), kept and shown grey rather than guessed.`}
                checked={prefs.includeUnknown}
                onChange={(on) => onChange({ ...prefs, includeUnknown: on })}
              />
              {OPTIONAL_STATES.map(({ state, label }) => (
                <Toggle
                  key={state}
                  label={`Include ${label}`}
                  hint="When off, it’s left out entirely — it doesn’t affect anyone’s percentiles."
                  checked={prefs.includeStates[state]}
                  onChange={(on) => onChange({ ...prefs, includeStates: { ...prefs.includeStates, [state]: on } })}
                />
              ))}
            </>
          )}

          {page === "data" && (
            <>
              <p className="text-label text-neutral-600 dark:text-neutral-400">
                Every county is compared with every other on percentiles, so a score says where a county stands
                nationally, not how good it is in absolute terms. Your search is saved on this device only.
              </p>
              <h4 className="mt-4 text-caption font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                County data
              </h4>
              <CountySourcesList />
              {laws && (
                <>
                  <h4 className="mt-4 text-caption font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                    Laws &amp; taxes
                  </h4>
                  <LawSourcesList laws={laws} />
                </>
              )}
            </>
          )}

          {page === "help" && (
            <>
              <button
                type="button"
                onClick={onShowTour}
                className="rounded-full border border-neutral-300 px-4 py-2 text-label font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Show the tour again
              </button>
              <p className="mt-2 text-caption text-neutral-500 dark:text-neutral-400">A one-minute look at how Lodestar works.</p>

              <h4 className="mt-8 text-label font-semibold">Questions or found a bug?</h4>
              <p className="mt-1 text-label text-neutral-600 dark:text-neutral-400">
                Let me know at{" "}
                <a
                  href="mailto:nathaniel@planetxdevs.com?subject=Lodestar"
                  className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
                >
                  nathaniel@planetxdevs.com
                </a>
                .
              </p>
              <p className="mt-8 border-t border-neutral-200 pt-4 text-caption text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                © {new Date().getFullYear()}{" "}
                <a
                  href="https://www.planetxdevs.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 hover:decoration-current dark:decoration-neutral-600 dark:hover:text-neutral-200"
                >
                  Planet X Devs
                </a>
                . All rights reserved.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div>
        <label htmlFor={id} className="text-body">
          {label}
        </label>
        <p className="text-caption text-neutral-500 dark:text-neutral-400">{hint}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-emerald-600" : "bg-neutral-300 dark:bg-neutral-700"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`}
        />
      </button>
    </div>
  );
}
