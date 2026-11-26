# Lodestar — Working Plan

> **Open work only.** This file says what to build next and in what order. How the project
> works and the rules earlier phases settled are in `AGENTS.md`. The full record of finished
> phases (designs, measurements, reasoning) is in `docs/plan-archive.md`, which is read-only;
> code comments citing "plan §N" or "§9 Phase N" point there. Dated decisions go in
> `docs/plan-changelog.md`, newest first.
>
> When the code and this file disagree, the code is right: fix this file. When a phase is
> done, cut it to one row in *Built so far*, move its lasting rules to `AGENTS.md`, and log
> it in the changelog.
>
> Last updated: 2026-11-25

---

## 1. What this is

A map-based tool for choosing where to live in the US. The person sets priorities and
must-haves, and gets ranked neighborhoods (census tracts) and counties, a map, and a page for
each place explaining its score. It's live at www.lodestarmap.com and works offline as a PWA.

It started as a personal-use MVP with no accounts and no monetization. **Whether to monetize
(ads or affiliate links) is an open owner decision** (Phase 15). Until it's made, the
no-monetization line stands.

---

## 2. Built so far

| Phase | What it delivered | Done |
|---|---|---|
| 1–2 | ETL joins ~10 federal sources on county FIPS; pure-TS scoring engine (percentiles, directions, weights, must-haves, decomposition) | 2026-09-22 |
| 3–4 | Ranked list; MapLibre choropleth; phone bottom-sheet layout | 2026-09-26 |
| 5–6 | Full county metric set (FEMA, BLS, distances, laws as filters); place pages; climate tab with compare and Köppen types | 2026-09-27 |
| 7 | UI reorganisation (filters modal, settings, type scale); URL state, saved and recent searches; update prompt; live at lodestarmap.com | 2026-09-30 |
| 8, 8f | Census tracts nationwide on R2 with monthly refresh; areas as the results; map by zoom; area pages | 2026-10-04 |
| Audits | Results audit, then full audit (`npm run audit:results`); filters cut down; "Who lives here" and racial diversity | 2026-10-04 |
| 9 | First-run tour | 2026-10-04 |
| 10 | Results that don't mislead: local cost of living, Taxes in $/yr, household budget, Watch out, shrinkage, taxes by area | 2026-10-13 |
| 11 (Tier 1) | Pollution: PM2.5 (anchored bands plus monitor doubt), smoke days, older housing; radon shown only | 2026-10-13 |
| Tuning | Washtenaw source check: today's home value, new-buyer tax rate, FEMA rating words, borderline Köppen, metro edges, Great Lakes | 2026-10-13 |
| 12 | Find a place by name (counties, cities, neighborhoods, ZIPs) with its outline on the map | 2026-11-10 |
| 13 (steps 1–5) | Hosting moved from Vercel to a Cloudflare Worker | 2026-11-13 |
| 14a, 14c | Crime out of ranking and filters; climate on area pages | 2026-11-13 |

Details of each are in `docs/plan-archive.md` §9 under the same phase number.

---

## 3. Build order: open work

Work top to bottom unless the owner reorders. Each item is its own pull request.

### Phase 13 — finish the hosting move

- [ ] **Step 6 (the week of watching ended 2026-11-20).** Remove the Vercel project,
      `vercel.json` and `.vercelignore`, and the "Vercel is the rollback" lines in `AGENTS.md`.
      Optionally replace the `www.lodestarmap.com/*` route with a Worker Custom Domain. The
      owner has two Cloudflare accounts: confirm which one before touching the dashboard.

### Phase 14 — owner's queue after the Cloudflare move (decided 2026-11-13)

Each item is built by a subagent, reviewed in the main session, and checked by hand by the
owner before merging. "Backend" means a Worker script on `/api/*`. The app keeps working
offline, and a backend feature may be off or limited offline and says so.

- [ ] **14b. Rural cost of living.** Derive a state non-metro RPP (the state's figure minus
      its metros, expenditure-weighted) for the ~62% of counties whose parent is the state's
      blended value, and label it in `rpp_geo_level`. Where it can't be derived, keep the
      state value and show a "state estimate" note in results and on the county page.
      *Check first:* Phase 10a (`etl/rpp_local.py`) already localises rents against that
      parent, and non-metro counties now average 89.1 vs BEA's national non-metro 88.7. Measure
      what 14b changes before building it, and tell the owner if it's small.
- [ ] **14d. Climate like a place I know.** Pick a county, and score others by how close their
      monthly high, low and precipitation curves are (`climate.json` already has every
      county's 12 months).
- [ ] **14e. Distance from a place you pick** ("near my parents"). Straight-line miles need
      no new data (county and area centres). For drive time, build on the free county-to-county
      table first (Zenodo record 13906981, CC-BY-4.0, OSRM car profile, October 2024, all 3,144
      counties; not yet downloaded or checked; needs a credit line), as a precomputed file on
      R2 with the anchor snapped to its county. Then test TravelTime's free key as an upgrade
      for exact addresses: it caps at 4 hours, its licence says "research, development and
      evaluation", and its caching terms are unconfirmed. Google, Mapbox, HERE and the rest
      allow a handful of lookups or forbid storing results.
- [ ] **14f. Crime: pool three years; murder and robbery apart.**
      - Pool counts and person-years over the years an agency reported
        (`etl/tracts/crime.py`), so a town of 5,000 stops swinging by half year to year
        (Michigan agencies of 2,500–5,000 people move a median 47% between years). This
        touches the partial-year, exposure and low-confidence rules and the state programs,
        and needs three years of every state's files. Do it with
        `python -m etl.tracts.sentinels --crime`, then a full refresh.
      - Split murder and robbery from assault and rape using the incident files' offence
        codes (Chelsea, MI would read "no murders or robberies in 3 years").
      - Count `(state, crime_agency)` across a state's county files, so the ~140 areas of a
        city across a county line show its rate as the city's, not their own (Kansas City,
        Oklahoma City, Dallas, Houston, Austin, Atlanta). This needs an upload.
      - `areas.json` still carries crime columns nothing reads: drop them.
- [ ] **14g. Daily check and "this number looks wrong".** A report button on county and area
      pages stores the report (D1 behind the Worker; Turnstile against bots). A daily
      scheduled Claude Code cloud routine on Opus checks the app (pages and data answer, R2
      data is fresh, refresh workflows passed) and reads new reports. When something's wrong it
      starts agents (Opus or Sonnet) that investigate and open a fix PR. At most one normal and
      one emergency PR a day, never auto-merged. The owner gets an email per PR through
      Cloudflare email sending.

Candidates the owner hasn't decided on (Cloudflare features to learn on): Web Analytics (now
15a), a preview link per pull request, logs and tracing on the `/api` Worker, short share links
(KV, now in 15d), plain-English search (Workers AI; deferred in §4), and filter-use counts
(Analytics Engine).

### Phase 15 — Reach and revenue (proposed 2026-11-25; owner decision pending)

**Why.** Ads and affiliate links pay per visit, and the site gets almost no search traffic.
The whole app is one client-rendered page (`src/app/page.tsx` → `<CountyFinder />`), so a
search engine can index roughly one URL. People search "cost of living in Washtenaw County",
"is Chelsea MI a good place to live", "best counties in Ohio for families". The app already
holds better data for those questions than most sites that rank for them, but none of it is
indexable. So the order is: measure, check that monetization is allowed, make the data
indexable, give people reasons to come back and share, and only then add ads.

15a and 15b are small and need almost no app change. The owner may pull them ahead of Phase 14.

- [ ] **15a. Measure.** Turn on Cloudflare Web Analytics (cookieless: one script tag, or
      automatic on a proxied zone). Record a baseline of visits per week before anything else
      in this phase changes it. Check it doesn't break the service worker or offline use.
- [ ] **15b. Licence check for commercial use.** For every source the app shows, record
      whether it may be used on a site with ads or affiliate links, and what credit it needs,
      in a table here and on the Data sources page. Known flags:
      - Zillow Research (ZHVI, ZORI, 2017 neighbourhoods): check the ToS before any
        monetization (the plan has said so since day one).
      - Redfin Data Center: attribution terms.
      - SEDA (Stanford): its terms of use.
      - WashU ACAG PM2.5 V6.GL.03 is CC BY 4.0. The biomass product V5.NA.05.02 states no
        licence, and the drafted request to its authors calls Lodestar "free, non-commercial":
        rewrite that draft if it's ever sent.
      - OpenFreeMap tiles and OpenStreetMap attribution.
      - Zenodo drive-time table (14e): CC-BY, needs a credit line.
      - OSF radon model: CC0. Federal sources (Census, BEA, BLS, FEMA, NOAA, EPA, NCES, FBI):
        public domain, but confirm none forbids commercial reuse.
      - The laws sources (`LAWS.md`): Tax Foundation, NCSL, KFF, Giffords, EIA.
      A source that forbids it is replaced or dropped before any ad goes live.
- [ ] **15c. Indexable place pages.** One static page per county (`/county/{st}/{slug}`) and
      per state (`/state/{st}`), generated at build time from `counties.json`,
      `climate.json` and `laws.json` with `generateStaticParams` (read the static-export guide
      in `node_modules/next/dist/docs/` first). Each page shows real content from data already
      shipped: cost of living, home value and rent against the typical US county, climate
      chart and key figures, hazards, pollution, laws and taxes, "Who lives here", the
      county's best-scoring areas on the default search, and a button that opens the map tool
      on that county (`place=`). Add per-page `<title>` and description, a generated share
      image, `sitemap.xml`, `robots.txt` and canonical URLs. Write sentences comparing each
      county's numbers ("rent 22% below Ohio's median"), not filler: template pages with thin
      text get treated as spam. Sizes: about 3,200 pages × (HTML + RSC payload) is well under
      the Workers static-assets limit of 20,000 files. Area pages (84k) would not fit as
      static files, so they'd need a Worker rendering from R2 later, if county pages prove
      out. Pages are not precached by the service worker.
- [ ] **15d. Reasons to come back and share.**
      - The `localStorage` shortlist (open since Phase 7), with a side-by-side compare of 2–4
        places. Compare is "Saved comparisons" in §4 deferred, so the owner must un-defer it.
      - Short share links (KV behind the Worker): "my top 5" as a short URL.
      - 14d and 14e above are the most shareable features in the queue.
      - Plain-English search ("warm, good schools, under $400k, near an ocean" → filter
        state) is deferred in §4. It's the strongest hook for press and social, so the owner
        should decide whether to un-defer it.
- [ ] **15e. Monetization (only after 15a–15c, and only on the owner's decision).**
      - **Placement:** ads go on the static county and state pages only. Never over the map,
        in the results list, or on area or place pages in the tool.
      - **Affiliate and lead links** likely pay more than display ads for this audience:
        moving quotes, mortgage rates, home insurance, apartment search. Real-estate agent
        referral fees are regulated (RESPA), so don't take them without advice.
      - **Display ads:** AdSense takes any site. Premium networks need tens of thousands of
        monthly visits: decide on 15a's numbers.
      - **Before the first ad:** a privacy policy page; a consent banner for EU and UK
        visitors and opt-outs for US state privacy laws (any ad network that sets cookies
        needs them); ad scripts allowed in `public/_headers`; ads never precached, and the
        app still works offline without them. Update §1 and record the decision in the
        changelog.

### Loose ends from finished phases

Smaller open items. Pick them up when convenient, or when a queue item touches the same code.

**Checks by hand**
- [ ] A real-phone pass: overall layout and light mode (Phase 7), the first-run tour
      (Phase 9), and the Find-a-place button and list (Phase 12).
- [ ] A keyboard-only walkthrough and a screen-reader pass. Service-worker offline behaviour
      on a real phone.

**Product**
- [ ] A looked-up place isn't in the URL: a shared link carries the search and an open county
      or area, not "Austin's areas". Needs a place key in `search-url.ts` (Phase 12).
- [ ] Default search clustering: three of the four default priorities are county-wide, so
      the first screen can be eleven areas of one county in a row. Options: default to the
      Counties view when county-wide weight is at least half the total, or cap areas per county
      in the top N with "+6 more in this county". Owner's call.
- [ ] Score colours as text: the yellow-green stops (scores 70–85) are ~1.6:1 contrast on
      white, below WCAG AA. Darken the mid stops for text only, or draw the number on a tinted
      pill. Owner's call (the owner chose the ramp).
- [ ] Low-confidence values show only as a flag, never as a range.
- [ ] Tied school ranks inside a county read "1st of 4" for four schools without AP.
- [ ] Maybe: quick-start chips on the tour's welcome card ("What matters most?"); a tiny US
      map on each climate-type card; active-filter chips above the results (skipped
      2026-09-28).
- [ ] "$400k budget, schools" surfaces a mobile-home park (Near East Rochester, NY) now
      that crime isn't weighed: a budget-scoring weakness to look at.

**Data**
- [ ] **Pollution 11g, Tier 2:** air toxics (EPA AirToxScreen), transport noise (BTS),
      drinking water (UCMR 5 PFAS, SDWIS violations, service-area boundaries). Ozone (EPA
      FAQSD tract surface) and NO2 (SatNO2, licence unchecked) only if they pass the
      acceptance gate. Rules, risks and the gate are in the archive's Phase 11. Size: Tier 2
      county columns won't fit under counties.json's 2 MB, so detail goes in the per-county
      files.
- [ ] **Pollution 11h, Tier 3:** a "Sites near here" list (TRI, Superfund, RMP, brownfields)
      on area pages, as distance and count, never "exposure". Light pollution only if asked.
- [ ] Mirror the pollution inputs to the private bucket, so CI stops re-downloading ~3–4 GB a
      month. Settle the cadence (annual inputs vs monthly runs).
- [ ] Owner: send the ACAG note about the biomass-burning PM2.5 product, or keep smoke as
      NOAA HMS days (as built). See 15b about its "non-commercial" wording.
- [ ] Crime gaps: NY State Police (most of rural NY), PA regional departments, and SD/WY
      tribal departments aren't matched to areas.
- [ ] High schools: fall back to CRDC 2021–22 for districts missing from 2023–24 (Hobbs and
      Roswell NM, Selma AL). Add high-school test scores and graduation rates if ED Data
      Express publishes school-level files after 2020–21. Check SEDA's latest school year.
- [ ] 8d extras, as wanted: CDC PLACES health, OSM amenities (parks, groceries),
      neighbourhood names beyond Zillow's cities.
- [ ] Taxes, later: the new-buyer ratio by PUMA for areas (now the county's); MI and FL
      statutory millage; share of owned homes under the budget (ACS B25075) instead of fit to
      the typical home; local income taxes; filing-status-aware sales tax.
- [ ] Minor: a non-housing `real_income` variant; whether tract-level RPP needs re-weighting;
      Connecticut's county-level school score (null; areas are fine).

---

## 4. Explicitly deferred

Don't build these unless the owner moves them into the build order.

- A nationwide tract map (all areas' shapes at once). Areas show as dots by zoom, and shapes
  load per county.
- User accounts and auth.
- Natural-language search (name lookup is built, Phase 12). Candidate for 15d.
- Saved comparisons (candidate for 15d).
- **Month-by-month climate envelope:** an acceptable range per month, where a county passes
  if its curve fits inside. Monthly data is already in the browser, but it needs a
  chart-based control.
- **Place profile content:** images, things to do, what a place is known for, good and bad.
  Key it by place id, not FIPS, so it follows areas. Its source is undecided (§5). A
  possible AI summary should summarise fetched, sourced facts, not free-write.
- AI-generated place descriptions.
- Commute isochrones.
- Real estate listings data.
- Mobile native apps.
- Wildlife and landscape data (GBIF is raw observations; turning it into something readable
  is real work).
- An optional full-basemap download (`.pmtiles`) for complete offline use.
- Street or parcel-level data (commercial vendors, and the wrong job for this app).

---

## 5. Open questions (owner decisions)

- [ ] **Monetize at all?** (Phase 15.) If yes: ads, affiliate links, or both, and which pages.
- [ ] **The coast.** Keep "ocean, bays and tidal rivers" as built (recommended), or rebuild
      `dist_coast_mi` from a coastline with estuaries clipped (half a day plus a full
      rebuild).
- [ ] **Default search clustering** and **score colours as text** (under Loose ends).
- [ ] **Place profile source:** a static dataset, a live fetch on select (online only), or
      both. Decide before building the deferred place profile.
- [ ] **14b's scope** after measuring what it adds on top of Phase 10a.

---

## 6. Tuning track (ongoing)

The hard part of this product is making "matches" feel true rather than arbitrary. Budget
time here, not on infrastructure. Run real searches, note where a ranking feels wrong, and
write down *why* before changing anything. Log each finding below with the date, the search
and what changed. Past entries (Jackson Hole and "good schools + low taxes", 2026-10-12;
Washtenaw checked against outside sources, 2026-10-13) are in the archive's §12.

*No open entries.*
