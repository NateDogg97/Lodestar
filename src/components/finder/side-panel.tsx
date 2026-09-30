"use client";

import type { ReactNode } from "react";

interface Props {
  id: string;
  title: string;
  /** Short extra text on the collapsed rail, e.g. a count. */
  badge?: string;
  open: boolean;
  onToggle: () => void;
  /** Width when open, as a Tailwind class for md+ screens. */
  widthClass: string;
  children: ReactNode;
}

/**
 * The desktop results panel; collapses to a thin labelled rail to give the
 * map the whole width. Phones use the results BottomSheet instead.
 */
export function SidePanel({ id, title, badge, open, onToggle, widthClass, children }: Props) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        aria-controls={id}
        title={`Show ${title.toLowerCase()}`}
        className="flex w-10 shrink-0 flex-col items-center gap-3 border-r border-neutral-200 bg-white py-3 text-xs font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        <span aria-hidden className="text-base leading-none">›</span>
        <span className="[writing-mode:vertical-rl]">
          {title}
          {badge && <span className="ml-1 text-neutral-400">{badge}</span>}
        </span>
      </button>
    );
  }

  return (
    <section
      id={id}
      aria-label={title}
      className={`absolute inset-y-0 left-0 z-20 flex w-full flex-col border-r border-neutral-200 bg-white md:static md:z-auto md:shrink-0 ${widthClass} dark:border-neutral-800 dark:bg-neutral-950`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        <div className="flex items-baseline gap-1.5">
          <h2 className="text-title font-semibold">{title}</h2>
          {badge && <span className="text-label text-neutral-500">{badge}</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded
            aria-controls={id}
            title={`Hide ${title.toLowerCase()}`}
            className="rounded px-1.5 text-base leading-none text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span aria-hidden>‹</span>
            <span className="sr-only">Hide {title}</span>
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
