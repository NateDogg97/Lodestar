"use client";

import { useId, type ReactNode } from "react";

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
}

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Everything that isn't the search itself (plan §9 Phase 7a): appearance,
 * which counties the results include, and where the data comes from.
 */
export function SettingsModal({ open, onClose, prefs, onChange, unknownCount, laws }: Props) {
  const theme = useThemePref();
  const themeLabel = useId();

  return (
    <Modal open={open} onClose={onClose} title="Settings" size="medium">
      <div className="space-y-section px-gutter py-5 md:px-6">
        <Section title="Appearance">
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
        </Section>

        <Section title="Results">
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
        </Section>

        <Section title="About the data">
          <p className="text-label text-neutral-600 dark:text-neutral-400">
            Every county is compared with every other on percentiles, so a score says where a county
            stands nationally, not how good it is in absolute terms. Your search is saved on this device only.
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
        </Section>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-title font-semibold">{title}</h3>
      {children}
    </section>
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
