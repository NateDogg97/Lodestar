/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, Serwist, StaleWhileRevalidate } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Phase 8 tract data: one county's files, cached when it's first explored
    // (not precached: the national set is ~85 MB). Served from cache offline,
    // refreshed in the background. Matches local /data/tracts/ and, later,
    // the R2 data host's /tracts/ paths.
    {
      matcher: ({ url }) => /\/(data\/)?tracts\/[^/]+\.json$/.test(url.pathname),
      handler: new StaleWhileRevalidate({
        cacheName: "tracts",
        plugins: [new ExpirationPlugin({ maxEntries: 120 })],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
