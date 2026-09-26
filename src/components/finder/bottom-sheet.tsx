"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Heights the sheet settles at, as a fraction of the area it sits in. */
export const SHEET_SNAPS = [0.25, 0.5, 0.8, 1] as const;

interface Props {
  id: string;
  label: string;
  /** Index into SHEET_SNAPS. */
  snap: number;
  onSnap: (index: number) => void;
  /** Height of the area the sheet sits in, in px (for dragging). */
  areaHeight: number;
  /** Title row; the whole row is a drag handle, but its buttons still work. */
  header: ReactNode;
  /** Bumped to scroll the body back to the top (e.g. to show a new selection). */
  scrollTopKey?: number;
  children: ReactNode;
}

const DRAG_THRESHOLD_PX = 6;
/** A flick faster than this (px/ms) moves one snap in its direction. */
const FLICK_SPEED = 0.5;

/**
 * The phone results panel (plan §9 Phase 4, mobile layout): a sheet over the
 * bottom of the map, dragged by its header between fixed heights — like
 * Google Maps. Only the header drags; the body scrolls normally.
 */
export function BottomSheet({ id, label, snap, onSnap, areaHeight, header, scrollTopKey, children }: Props) {
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startH: number; lastY: number; lastT: number; speed: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollTopKey) body.current?.scrollTo({ top: 0 });
  }, [scrollTopKey]);

  const minH = SHEET_SNAPS[0] * areaHeight;

  const settle = (height: number, speed: number) => {
    const heights = SHEET_SNAPS.map((f) => f * areaHeight);
    let nearest = 0;
    heights.forEach((h, i) => {
      if (Math.abs(h - height) < Math.abs(heights[nearest] - height)) nearest = i;
    });
    // A quick flick goes to the next snap that way, even if a short one.
    if (speed > FLICK_SPEED) nearest = Math.max(nearest, heights.findIndex((h) => h > height + 1));
    if (speed < -FLICK_SPEED) nearest = Math.min(nearest, heights.findLastIndex((h) => h < height - 1));
    onSnap(Math.max(0, nearest));
  };

  const step = (by: number) => onSnap(Math.min(SHEET_SNAPS.length - 1, Math.max(0, snap + by)));

  return (
    <section
      id={id}
      aria-label={label}
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-neutral-200 bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.12)] dark:border-neutral-800 dark:bg-neutral-950 ${
        dragHeight === null ? "transition-[height] duration-200 ease-out" : ""
      }`}
      style={{ height: dragHeight ?? `${SHEET_SNAPS[snap] * 100}%` }}
    >
      <div
        className="shrink-0 cursor-grab touch-none select-none border-b border-neutral-200 active:cursor-grabbing dark:border-neutral-800"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // A drag isn't always followed by a click; never let the flag outlive it.
          suppressClick.current = false;
          const startH = e.currentTarget.parentElement!.getBoundingClientRect().height;
          drag.current = { startY: e.clientY, startH, lastY: e.clientY, lastT: e.timeStamp, speed: 0, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dy = e.clientY - d.startY;
          if (!d.moved) {
            if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
            // Capture only once it's really a drag, so taps still reach buttons.
            d.moved = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Pointer already gone; the drag still works without capture.
            }
          }
          const dt = e.timeStamp - d.lastT;
          if (dt > 0) d.speed = (d.lastY - e.clientY) / dt; // positive = upward
          d.lastY = e.clientY;
          d.lastT = e.timeStamp;
          setDragHeight(Math.min(areaHeight, Math.max(minH, d.startH - dy)));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d?.moved) return;
          suppressClick.current = true;
          setDragHeight(null);
          settle(Math.min(areaHeight, Math.max(minH, d.startH - (e.clientY - d.startY))), d.speed);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragHeight(null);
        }}
        onClickCapture={(e) => {
          // The click that ends a drag shouldn't also press a button.
          if (suppressClick.current) {
            suppressClick.current = false;
            e.stopPropagation();
          }
        }}
      >
        <button
          type="button"
          aria-controls={id}
          aria-label={`Resize ${label.toLowerCase()} (${Math.round(SHEET_SNAPS[snap] * 100)}% of screen)`}
          title="Drag, tap, or use the arrow keys to resize"
          onClick={() => onSnap(snap === SHEET_SNAPS.length - 1 ? 0 : snap + 1)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            step(e.key === "ArrowUp" ? 1 : -1);
          }}
          className="flex w-full justify-center pt-2 pb-1"
        >
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        </button>
        {header}
      </div>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </section>
  );
}
