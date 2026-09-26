"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * The "⋯" button beside a panel title, opening a small dropdown of settings
 * (toggles). Closes on a click outside, on Escape (returning focus to the
 * button), or when focus leaves the dropdown.
 */
export function PanelMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        className={`grid h-6 w-6 place-items-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 ${
          open ? "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200" : ""
        }`}
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          id={id}
          role="group"
          aria-label={label}
          className="absolute top-full left-0 z-30 mt-1 w-60 rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A labelled checkbox row for use inside a PanelMenu. */
export function MenuToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-emerald-600"
      />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">{hint}</span>}
      </span>
    </label>
  );
}
