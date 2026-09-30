import { useId } from "react";

/**
 * The Lodestar mark (brand/lodestar-mark-*.svg): a compass ring with an
 * emerald north point. Ink follows the theme's foreground (#171717 /
 * #ededed); the north point is emerald-600 in light and emerald-400 in dark,
 * as in the brand kit.
 */
export function LodestarMark({ className = "h-7 w-7" }: { className?: string }) {
  // The hub is a hole cut by a mask; its id must be unique on the page.
  const mask = useId();
  return (
    <svg aria-hidden viewBox="0 0 64 64" className={className}>
      <defs>
        <mask id={mask}>
          <rect width="64" height="64" fill="#fff" />
          <circle cx="32" cy="32" r="3" fill="#000" />
        </mask>
      </defs>
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--foreground)" strokeWidth="5" />
      <g mask={`url(#${mask})`}>
        <path d="M32 10l6.5 22h-13z" className="fill-emerald-600 dark:fill-emerald-400" />
        <path d="M32 54l-6.5-22h13z" fill="var(--foreground)" />
        <path d="M14 32l18-5v10zM50 32l-18 5V27z" fill="var(--foreground)" />
      </g>
    </svg>
  );
}

/** Mark + "Lodestar" in Source Serif 4 Semibold, tracked -0.025em (brand kit README). */
export function LodestarLogo({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LodestarMark className={size === "sm" ? "h-6 w-6" : "h-7 w-7"} />
      <span
        className={`font-brand font-semibold tracking-[-0.025em] ${size === "sm" ? "text-title" : "text-heading"}`}
      >
        Lodestar
      </span>
    </span>
  );
}
