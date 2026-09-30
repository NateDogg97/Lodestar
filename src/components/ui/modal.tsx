"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Beside the title, e.g. a live count. */
  headerExtra?: ReactNode;
  /** Pinned under the scrolling body, e.g. Reset / Show N. */
  footer?: ReactNode;
  /** large: the Filters workspace; medium: a narrower sheet sized to its content. */
  size?: "large" | "medium";
  children: ReactNode;
}

const SIZES = {
  large: "md:h-[min(85dvh,52rem)] md:w-[min(92vw,60rem)]",
  // fit, not auto: a modal <dialog> is fixed with inset 0, so an auto height
  // stretches to the viewport (the UA default is fit-content for that reason).
  medium: "md:h-fit md:max-h-[min(85dvh,52rem)] md:w-[min(92vw,36rem)]",
};

/**
 * A large dialog: centered over a dimmed page on desktop, full-screen on
 * phones. Built on the native <dialog> with showModal(), which traps focus
 * (the rest of the page goes inert), closes on Escape, and returns focus to
 * the opener. Also closes on a click on the backdrop and locks page scroll.
 * Children render only while open.
 */
export function Modal({ open, onClose, title, headerExtra, footer, size = "large", children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Close on a backdrop click only when the press also started there, so a
  // drag that begins inside (e.g. selecting text) and ends outside doesn't.
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Escape: let the parent own the open state.
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === ref.current) onClose();
        downOnBackdrop.current = false;
      }}
      className={`m-0 h-dvh max-h-none w-screen max-w-none bg-white p-0 text-neutral-900 backdrop:bg-black/50 open:flex open:flex-col md:m-auto md:rounded-2xl md:shadow-2xl dark:bg-neutral-950 dark:text-neutral-100 ${SIZES[size]}`}
    >
      {open && (
        <>
          <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-gutter pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 md:px-6 md:py-4 dark:border-neutral-800">
            <h2 id={titleId} className="text-heading font-semibold">
              {title}
            </h2>
            <div className="min-w-0 flex-1">{headerExtra}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
              </svg>
            </button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{children}</div>
          {footer && (
            <footer className="flex shrink-0 items-center gap-3 border-t border-neutral-200 px-gutter pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:py-4 dark:border-neutral-800">
              {footer}
            </footer>
          )}
        </>
      )}
    </dialog>
  );
}
