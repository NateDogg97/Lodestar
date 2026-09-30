"use client";

import { SerwistProvider, useSerwist } from "@serwist/next/react";
import { useEffect, useState, type ReactNode } from "react";

export function PwaProvider({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/sw.js"
      disable={process.env.NODE_ENV === "development"}
      reloadOnOnline
    >
      {children}
      <UpdatePrompt />
    </SerwistProvider>
  );
}

/** How often returning to the app may trigger an update check. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * "New version available" (plan Phase 7b). The worker skips waiting and
 * claims open pages, so after a deploy (or the monthly law-data refresh) a
 * new worker takes over while this page still runs the old code: offer a
 * reload. An installed app can stay open for days without navigating, which
 * is when browsers normally look for updates, so also check when the app
 * comes back to the foreground, at most hourly.
 */
function UpdatePrompt() {
  const { serwist } = useSerwist();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!serwist) return;
    const onControlling = (e: { isUpdate?: boolean }) => {
      if (e.isUpdate) setReady(true);
    };
    let lastCheck = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck < CHECK_EVERY_MS) return;
      lastCheck = Date.now();
      serwist.update().catch(() => {
        // offline or the check failed: try again next time
      });
    };
    serwist.addEventListener("controlling", onControlling);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      serwist.removeEventListener("controlling", onControlling);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [serwist]);

  if (!ready) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-40 flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-neutral-900 py-1.5 pr-1.5 pl-4 text-label text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
        <span>A new version of Lodestar is ready.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-emerald-600 px-3 py-1 font-semibold text-white hover:bg-emerald-700"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => setReady(false)}
          aria-label="Dismiss"
          className="grid h-7 w-7 place-items-center rounded-full opacity-70 hover:opacity-100"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
