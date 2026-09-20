# New Home Finder — agent guide

A personal-use PWA for finding US counties to move to: the user sets criteria and
weights, gets a ranked list and a choropleth map. No accounts, no backend, no DB.

## Read the master plan first

**`Working Master Plan.md` is the source of truth for what to build and in what order.**
Before implementing anything, read it — in particular:

- §2 *Core architectural decision* — this is an ETL problem; the browser does all scoring
  client-side over two static files. Do not add a search backend or per-query APIs.
- §5 *Phase 1 CSV schema* — the exact columns the ETL must produce; keep `fips` a string.
- §6 *Scoring model* — percentile normalization, direction flags, weighted score, hard
  filters, score decomposition. This is the product; everything else is plumbing.
- §8 *Stack* — MapLibre (not Mapbox), URL params for filter state, Python for ETL only.
- §9 *Build order* — **strictly sequential**. Work the earliest phase with unchecked
  items. Do not start the map before the scoring engine works.
- §10 *Explicitly deferred* — do not build these, even if asked in passing; point back
  to the plan instead.

The plan is a working document. When you finish a step, tick its checkbox. When the code
diverges from the plan, the code is right — update the plan (and its `Last updated` date)
rather than leaving it stale. Record new decisions or open questions there, not in chat.

## Project layout

- `src/app/` — Next.js App Router. `manifest.ts`, `sw.ts`, `~offline/` are the PWA pieces.
- `src/components/pwa-provider.tsx` — registers the service worker on the client.
- `serwist.config.mjs` — builds `public/sw.js` after `next build` (generated, git-ignored).
- ETL pipeline (Python, `pandas` + `geopandas`) lives outside the app runtime — see plan §2/§8.

## Commands

```bash
npm run dev        # next dev + service-worker watcher (SW disabled in dev)
npm run build      # next build && serwist build
npm run start      # serve production build; use this to test install/offline
npm run lint
npm run typecheck
```

Run `lint`, `typecheck`, and `build` before considering a change done.

## Conventions

- TypeScript, App Router, Tailwind 4. Server Components by default; `"use client"` only
  where needed.
- Scoring logic is a pure TS module with unit tests — no UI imports (plan §9, Phase 2).
- Keep the app fully static; anything that needs a server is out of scope for v1.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
