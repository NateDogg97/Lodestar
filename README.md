# Lodestar

Find your direction before you find the house. Lodestar ranks every US county by what matters
to you (cost of living, schools, climate, natural hazards, distances, state laws and taxes)
and shows the best matches on a map.

**[lodestarmap.com](https://lodestarmap.com)** · a personal-use progressive web app: no
accounts, no backend. It installs to a phone or desktop home screen and works offline.

## What it does

- **Priorities** rank counties: pick how much each measure matters (Off–5) and whether lower,
  average or higher is better. Scores are national percentiles, weighted and averaged.
- **Must-haves** rule counties out: min/max limits, state policies, and climate types
  (plain-language climate cards over Köppen types).
- **Results** as a ranked list and a map of the top 50, colored relative to each other. Each
  county has an Overview (why it ranks there), a Climate tab (monthly charts, compare with
  another county) and Laws & taxes (every value sourced and dated).
- **Share and save:** the URL carries the whole search and the open county, so **Copy link**
  sends exactly what you see. Filters → **Saved** keeps named and recent searches on the
  device.
- Light and dark themes (light by default), Alaska and Hawaii as opt-in toggles, an
  "update available" notice after each deploy.

Decisions, build order and open questions live in
[`Working Master Plan.md`](Working%20Master%20Plan.md); state-law sourcing rules in
[`LAWS.md`](LAWS.md).

## How it's built

Everything is scored in the browser over two static files. There is no search backend.

- **App:** [Next.js 16](https://nextjs.org) (App Router), React 19, TypeScript, Tailwind CSS 4,
  [MapLibre](https://maplibre.org) with [OpenFreeMap](https://openfreemap.org) tiles,
  [Serwist](https://serwist.pages.dev) for the service worker.
- **Data:** a Python ETL (`etl/`, pandas) joins Census ACS, BEA price parities, Stanford SEDA,
  NOAA climate normals, the FEMA National Risk Index, BLS unemployment and distance data into
  `public/data/counties.json` and `counties.topo.json`. Settings → About the data lists every
  source and vintage.
- **State laws:** `python -m etl.laws.refresh` parses each value from its cited source into
  `public/data/laws.json`. A GitHub Actions workflow (`.github/workflows/laws-refresh.yml`)
  re-runs it on the 1st of each month and commits the result.

## Getting started

```bash
npm install
npm run dev        # Next dev server + service-worker watcher (the worker is off in dev)
npm run build      # production build, then public/sw.js
npm run start      # serve the production build (use this to test install, offline, updates)
npm run lint
npm run typecheck
npm test           # Vitest: scoring engine, search links, climate families, real-data checks
```

Rebuilding the data needs Python 3.12 or newer and the ETL's virtualenv. Full steps, including
the one manual download (SEDA school data), are in [`etl/README.md`](etl/README.md).

```bash
python -m venv etl/.venv && etl/.venv/bin/pip install -r etl/requirements.txt
etl/.venv/bin/python -m etl.build              # counties.json + counties.topo.json
etl/.venv/bin/python -m etl.laws.refresh       # laws table and laws.json
etl/.venv/bin/python -m etl.test_offline       # ETL tests
```

API keys (Census, BEA, BLS, EIA) are read from the environment; `etl/.env.example` lists them.

## Deploying

- Host on anything that serves a static Next.js build and **redeploys on every push to
  `main`**: the monthly laws refresh publishes new data by committing to the repo.
- Add `EIA_API_KEY` as a GitHub Actions secret (the refresh falls back to the EIA's shared
  demo key without it), plus the Census/BEA/BLS keys if the county ETL ever runs in CI.
- The site URL for share cards is `SITE_URL` in `src/app/layout.tsx`.

## App files worth knowing

| File | Purpose |
| --- | --- |
| `src/lib/scoring/` | The scoring engine: pure TypeScript, tested, no UI imports |
| `src/components/finder/` | The UI: filters modal, results, place view, map |
| `src/components/finder/search-url.ts` | The search ↔ URL format behind shared links |
| `src/app/manifest.ts`, `src/app/sw.ts` | Web app manifest and service worker source |
| `src/components/pwa-provider.tsx` | Registers the worker; shows "a new version is ready" |
| `src/app/{favicon.ico,icon.svg,apple-icon.png,opengraph-image.png}` | Icons and share image (Next.js file conventions) |
| `brand/` | Lodestar brand kit: mark, lockups, icons, colors (`brand/nextjs/README.md`) |

`public/sw.js` and `public/maplibre/` are generated and git-ignored.

© Planet X Devs
