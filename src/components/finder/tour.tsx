"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The first-run tour (plan §9 Phase 9): a welcome card, then a few steps that each
 * spotlight a real control (`data-tour="…"`) with a short card. Passive — Next moves
 * on; nothing has to be done. Escape skips, ← and → step. On phones the card docks to
 * the top or bottom edge, whichever doesn't cover the spotlight.
 */

export interface TourStep {
  /** The `data-tour` value of the control to spotlight; none = a centered card. */
  target?: string;
  title: string;
  body: ReactNode;
  /** Skipped when its control isn't on screen (results in another view, say). */
  optional?: boolean;
  /** Run when the step opens: raise the phone sheet, open the panel… */
  prepare?: () => void;
}

/** Shown once per device; bump to show it again after a big redesign. */
const SEEN_KEY = "lodestar.tour";
const VERSION = "1";

export function tourSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === VERSION;
  } catch {
    return true; // Storage blocked: don't show it on every visit.
  }
}

export function markTourSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, VERSION);
  } catch {
    // Nothing to do.
  }
}

const PAD = 6;
const GAP = 12;
const MARGIN = 16;

type Rect = { top: number; left: number; width: number; height: number };

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (!!a && !!b && Math.abs(a.top - b.top) < 1 && Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1);

function findTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 });
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const step = steps[index];
  const last = index === steps.length - 1;

  const go = (to: number) => {
    if (to < 0) return;
    if (to >= steps.length) return onClose();
    setDir(to > index ? 1 : -1);
    setRect(null);
    setIndex(to);
  };

  // Each step: prepare the page, then follow its control (it can move: the sheet
  // animates, the panel opens). An optional step whose control never shows is skipped.
  useEffect(() => {
    step.prepare?.();
    if (!step.target) return;
    const started = performance.now();
    let scrolled = false;
    let frame = 0;
    const tick = () => {
      const el = findTarget(step.target!);
      if (el) {
        if (!scrolled) {
          el.scrollIntoView({ block: "nearest" });
          scrolled = true;
        }
        const r = el.getBoundingClientRect();
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        setRect((prev) => (sameRect(prev, next) ? prev : next));
      } else if (step.optional && performance.now() - started > 900) {
        setRect(null);
        setIndex((i) => Math.min(steps.length - 1, Math.max(0, i + dir)));
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Re-run per step only; `dir` is read when skipping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // The card's size, to place it beside the spotlight.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      setCardSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    primary.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Where the card goes: beside the spotlight on wide screens, docked on phones.
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const phone = vw < 768;
  let cardStyle: CSSProperties;
  if (!rect || !step.target) {
    cardStyle = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  } else if (phone) {
    const lowHalf = rect.top + rect.height / 2 > vh / 2;
    cardStyle = lowHalf ? { left: MARGIN, right: MARGIN, top: MARGIN } : { left: MARGIN, right: MARGIN, bottom: MARGIN };
  } else {
    const below = rect.top + rect.height + PAD + GAP;
    const above = rect.top - PAD - GAP - cardSize.h;
    const top = below + cardSize.h <= vh - MARGIN ? below : above >= MARGIN ? above : Math.max(MARGIN, vh - MARGIN - cardSize.h);
    const left = Math.min(Math.max(MARGIN, rect.left), vw - MARGIN - cardSize.w);
    cardStyle = { top, left };
  }

  const progress = steps.length - 1; // the welcome card isn't counted
  return createPortal(
    <div className="fixed inset-0 z-[1000]" aria-hidden={false}>
      {rect && step.target ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + 2 * PAD,
            height: rect.height + 2 * PAD,
            // A white ring round the control, and everything else dimmed. No transition:
            // the spotlight must show even where animations don't run.
            boxShadow: "0 0 0 2px #fff, 0 0 0 9999px rgba(0,0,0,.55)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/55" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-white p-4 text-neutral-900 shadow-2xl max-md:w-auto dark:bg-neutral-900 dark:text-neutral-100"
        style={cardStyle}
      >
        {index > 0 && (
          <p className="text-caption font-medium text-neutral-500 dark:text-neutral-400">
            {index} of {progress}
          </p>
        )}
        <h2 id={titleId} className={index === 0 ? "text-heading font-semibold" : "text-title font-semibold"}>
          {step.title}
        </h2>
        <div className="mt-1.5 text-label text-neutral-700 dark:text-neutral-300">{step.body}</div>
        <div className="mt-4 flex items-center gap-2">
          {index === 0 ? (
            <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-label font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
              Skip
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="rounded-full px-2 py-2 text-label text-neutral-600 hover:underline dark:text-neutral-400">
                Skip tour
              </button>
              <button
                type="button"
                onClick={() => go(index - 1)}
                className="ml-auto rounded-full border border-neutral-300 px-3.5 py-2 text-label font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Back
              </button>
            </>
          )}
          <button
            ref={primary}
            type="button"
            onClick={() => go(index + 1)}
            className={`${index === 0 ? "ml-auto" : ""} rounded-full bg-neutral-900 px-4 py-2 text-label font-semibold text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300`}
          >
            {index === 0 ? "Show me around" : last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
