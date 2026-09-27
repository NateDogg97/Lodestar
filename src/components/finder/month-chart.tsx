"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";

import { MONTHS, type MonthlySeries } from "@/lib/climate";

/**
 * One measure across the 12 months, for one or two counties (dataviz skill:
 * one measure per chart — never two y-scales — thin marks, hairline grid,
 * a per-month hover/focus readout). Colors come from the `.viz-root` tokens.
 */

export interface ChartSeries {
  name: string;
  /** A CSS color, e.g. "var(--viz-s1)". */
  color: string;
  /** Columns: the values. Range: the monthly highs. */
  values: MonthlySeries;
  /** Range only: the monthly lows. */
  low?: MonthlySeries;
}

interface Props {
  title: string;
  kind: "columns" | "range";
  series: ChartSeries[];
  format: (v: number) => string;
}

const W = 340;
const M = { top: 8, right: 6, bottom: 18, left: 34 };
const LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function niceStep(span: number, target = 3): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= target + 0.5) ?? 10 * mag;
}

function domain(kind: Props["kind"], series: ChartSeries[]): [number, number, number] {
  const all = series.flatMap((s) => [...s.values, ...(s.low ?? [])]).filter((v): v is number => v !== null);
  if (kind === "columns") {
    const hi = Math.max(0, ...all);
    const step = niceStep(hi || 1);
    return [0, Math.max(step, Math.ceil(hi / step) * step), step];
  }
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const step = niceStep(hi - lo || 10);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step, step];
}

/** Path through a series, broken where months are missing. */
function linePath(values: MonthlySeries, x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** Filled band between two series (months where both are known). */
function bandPath(hi: MonthlySeries, lo: MonthlySeries, x: (i: number) => number, y: (v: number) => number): string {
  const idx = hi.map((_, i) => i).filter((i) => hi[i] !== null && lo[i] !== null);
  if (idx.length < 2) return "";
  const top = idx.map((i) => `${x(i).toFixed(1)},${y(hi[i]!).toFixed(1)}`);
  const bottom = [...idx].reverse().map((i) => `${x(i).toFixed(1)},${y(lo[i]!).toFixed(1)}`);
  return `M${top.join("L")}L${bottom.join("L")}Z`;
}

/** A column with a 4px rounded top, square at the baseline. */
function columnPath(x: number, w: number, top: number, base: number): string {
  const r = Math.min(4, w / 2, base - top);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

export function MonthChart({ title, kind, series, format }: Props) {
  const H = kind === "range" ? 150 : 104;
  const [lo, hi, step] = domain(kind, series);
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const band = plotW / 12;
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + plotH * (1 - (v - lo) / (hi - lo || 1));
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(Number(t.toFixed(6)));

  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setActive(Math.min(11, Math.max(0, Math.floor((px - M.left) / band))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => (a === null ? 0 : (a + d + 12) % 12));
    }
    if (e.key === "Escape") setActive(null);
  };

  const n = series.length;
  const barW = Math.min(24, (band - 6 - 2 * (n - 1)) / n);
  const groupW = n * barW + 2 * (n - 1);

  return (
    <figure className="relative">
      <figcaption id={titleId} className="mb-1 text-xs font-medium text-neutral-700 dark:text-neutral-300">
        {title}
      </figcaption>
      <span id={`${titleId}-hint`} className="sr-only">
        Use the left and right arrow keys to read each month. The Table view lists every value.
      </span>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        role="img"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-hint`}
        tabIndex={0}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
        onKeyDown={onKey}
        onFocus={() => setActive((a) => a ?? 0)}
        onBlur={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={M.left - 5} y={y(t)} dy="0.32em" textAnchor="end" fontSize={9} fill="var(--viz-muted)" className="tabular-nums">
              {format(t)}
            </text>
          </g>
        ))}
        {LETTERS.map((l, i) => (
          <text key={i} x={x(i)} y={H - 5} textAnchor="middle" fontSize={9} fill="var(--viz-muted)">
            {l}
          </text>
        ))}

        {active !== null && (
          <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
        )}

        {kind === "range"
          ? series.map((s, k) => (
              <g key={s.name}>
                {k === 0 && s.low && (
                  <path d={bandPath(s.values, s.low, x, y)} fill={s.color} fillOpacity={0.12} />
                )}
                <path d={linePath(s.values, x, y)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {s.low && (
                  <path d={linePath(s.low, x, y)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                )}
                {active !== null &&
                  [s.values[active], s.low?.[active] ?? null].map(
                    (v, j) =>
                      v !== null && (
                        <circle key={j} cx={x(active)} cy={y(v)} r={4} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />
                      ),
                  )}
              </g>
            ))
          : series.map((s, k) =>
              s.values.map((v, i) => {
                if (v === null || v <= 0) return null;
                const bx = x(i) - groupW / 2 + k * (barW + 2);
                return (
                  <path
                    key={`${k}-${i}`}
                    d={columnPath(bx, barW, y(v), y(0))}
                    fill={s.color}
                    opacity={active === null || active === i ? 1 : 0.55}
                  />
                );
              }),
            )}
        <line x1={M.left} x2={W - M.right} y1={y(lo)} y2={y(lo)} stroke="var(--viz-axis)" strokeWidth={1} />
      </svg>

      {active !== null && (
        <div
          role="status"
          // Beside the crosshair, on the side with room, so it never covers the month it describes.
          className={`pointer-events-none absolute top-5 z-10 min-w-28 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs shadow-md dark:border-neutral-700 dark:bg-neutral-900 ${
            active < 6 ? "ml-2" : "-ml-2 -translate-x-full"
          }`}
          style={{ left: `${(x(active) / W) * 100}%` }}
        >
          <p className="mb-0.5 text-neutral-500">{MONTHS[active]}</p>
          {series.map((s) => {
            const v = s.values[active];
            const l = s.low?.[active] ?? null;
            const text =
              kind === "range"
                ? v === null || l === null
                  ? "No data"
                  : `${format(v)} / ${format(l)}`
                : v === null
                  ? "No data"
                  : format(v);
            return (
              <p key={s.name} className="flex items-center gap-1.5 whitespace-nowrap">
                <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                <span className="font-semibold tabular-nums">{text}</span>
                {n > 1 && <span className="text-neutral-500">{s.name}</span>}
              </p>
            );
          })}
          {kind === "range" && <p className="mt-0.5 text-[10px] text-neutral-500">average high / low</p>}
        </div>
      )}
    </figure>
  );
}
