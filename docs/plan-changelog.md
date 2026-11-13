# Lodestar plan changelog

Dated decisions and progress for `Working Master Plan.md`, newest first. Add an entry here
when a decision changes or a step lands; the plan itself holds the current state.

- 2026-11-13 — **Phase 14 decisions** (owner): offline still works, with backend features off
  or limited there; drive time from a routing service behind the Worker if a free tier
  covers it, else county-to-county; the daily agents are a Claude Code cloud routine on
  Opus, one normal and one emergency pull request a day, never auto-merged, email through
  Cloudflare.
- 2026-11-13 — **Owner's decisions after the Cloudflare move** (§9 Phase 14). **The "no
  backend" rule is revoked** (§2): server-side features are allowed, as a Worker script on
  `/api/*` beside the static export, with D1, KV, Workers AI and the rest open to use.
  Scoring stays in the browser as built. Queued, in the order of Phase 14: no ranking or
  shading of areas on one city-wide crime rate; a derived non-metro cost of living for
  rural counties, with a "state estimate" note where it can't be derived; distance from a
  place you pick (straight-line miles and drive time); the climate comparison on area
  pages, from county climate; three-year pooled crime with murder and robbery apart; and a
  daily check of the app plus "this number looks wrong" reports that starts AI agents to
  investigate and open a pull request, with an email to the owner for each one.
  "Climate like a place I know" leaves §10 for Phase 14.
- 2026-11-13 — **The changelog moved here** from the top of `Working Master Plan.md`
  (about 275 of its 3,200 lines, read at the start of every session). The plan keeps its
  `Last updated` date and a pointer; new entries go at the top of this file.
- 2026-11-13 — **Cut over to the Cloudflare Worker** (§9 Phase 13 step 5): production is the
  Worker, deployed by `.github/workflows/deploy.yml` on every push to main. The Vercel
  project stays for a week as the rollback.
- 2026-11-12 — **Hosting moves from Vercel to a Cloudflare Worker** (§9 Phase 13; owner's
  call). DNS and the R2 data bucket are already on Cloudflare, the app has no server-side
  features, and this leaves one vendor. The app becomes a Next.js static export
  (`output: "export"` → `out/`) served by Workers Static Assets (`wrangler.jsonc`, no Worker
  script). OpenNext was considered and rejected: nothing runs on a server, so an assets-only
  Worker has fewer moving parts. Response headers move from `next.config.ts` to
  `public/_headers`; `NEXT_PUBLIC_DATA_URL` moves from a Vercel env var to the committed
  `.env.production`. The R2 bucket and both monthly workflows are unchanged. Cutover is
  staged for zero downtime and instant rollback. **Cut over 2026-11-13**: production is the
  Worker; the Vercel project stays for a week as the rollback (Phase 13 step 6).
- 2026-11-11 — **Schools by district; no crime rate from a county-wide sheriff** (owner agreed
  to both after the accuracy check in §11). **Schools:** an area's schools are only those
  standing inside its district boundary (elementary or unified for grades 3–8, secondary or
  unified for high schools; `etl/tracts/schools.py`, `area_schools`). `nearby_school_pctl`
  — the key is kept for saved searches and links, the label is now "Schools" — is the
  district's percentile among US districts; in a district with 20+ scored schools
  (`BIG_DISTRICT_SCHOOLS`: Chicago, Clark County) or one SEDA has no score for, the nearest
  schools inside it, placed on the same scale. `school_basis` says which. `nearby_hs_pctl`
  is the district's own high schools. Applied to the published files locally with
  `python -m etl.tracts.backfill --schools` (no SEDA needed): 99.9% of areas keep a school
  score, 98.0% a high-school score; in the biggest districts the areas' median matches the
  district's (New York 48 vs 49, Los Angeles 9 vs 8, Chicago 15 vs 16). The real
  `schools.build` gave the same answer on six counties. **Crime:** an area flagged
  `crime_wide` (its only figure is a county agency's rate over farmland and suburbs) has no
  rate in the app: average on crime, unknown for a must-have, not shaded, and the area page
  says whose number it was. A rate resting on fewer than 20 crimes shows the count beside
  it. **Not uploaded yet:** the R2 keys in `etl/.env` were refused (`SignatureDoesNotMatch`: the
  secret didn't belong to the access key ID; rolled and fixed the same day, in `etl/.env`
  and the repo secrets), so production still serves the old school columns until
  `python -m etl.tracts.upload` is run or the monthly refresh.
- 2026-11-10 — **Inside a county, shading is opt-in** (§9 Phase 8; owner: "by default we
  shouldn't have any color sorting on the map when a user just looks in a county", and the
  colors were "a bit too solid"). With no by-area filter, a county's areas used to be shaded
  and sorted by Census home value, always. Now the map shows the areas' lines only, and
  **Sort and shade by** (above the list) picks a measure — any of the 21 `colorable` ones:
  home value, property tax rate, density, schools, crime… — which orders towns and their
  areas by it (High → low / Low → high), shows its value in each row and on the map's hover
  label, and washes the map with it at 45% opacity (was 80%), so streets and names read
  through. "Nothing" is the default; the choice is remembered on the device
  (`nhf.areaShade`). The control is a button that opens a panel of the measures as chips
  by topic (Homes and cost, Schools, People, Getting around, Safety and hazards, Air and
  environment), not a native list (owner; `shade-picker.tsx`). Ranked areas (a by-area filter is set) are unchanged.
- 2026-11-10 — **Find a place by name** (§9 Phase 12; owner: "look up a city, neighborhood,
  county, or zip code and see the results"). A **Find a place** button in the header (or `/`)
  searches counties, cities, neighborhoods and ZIP codes; picking one shows it scored on the
  current search. No new data and no backend: counties from `counties.json`, the rest read
  off the area labels already in `areas.json` (`src/lib/tracts/places.ts`). Also: a fresh
  clone's dev server now reads area data from the public data host (`.env.development`,
  committed) instead of 404ing on `/data/tracts/*`.
- 2026-11-03 — **Data checks at session start** (owner: "tell me if it's time to check for
  new data sets" and about better sources). `etl/data_checks.json` lists every source a
  person refreshes or re-checks, with a cadence and the last check; a Claude Code SessionStart
  hook (`scripts/data-checks.mjs --hook`) reports what's due, and a source review recurs every
  90 days. Open from the first list: `ACS_YEAR` is still 2023 (2019–2023) and the code only
  walks backwards from it, so a newer 5-year release is never picked up by itself.
- 2026-11-03 — **Monthly area refresh failed: Redfin and FDLE refuse us** (owner). Every
  county failed (3,077 on Redfin, Florida's 67 on FDLE) and the quality gate then crashed
  reading a report with no counts. Redfin retired `redfin_market_tracker/` (AccessDenied for
  every file; the live figures had already stopped at May 2026) for its Data Center files,
  listed in `redfin_data_center/index.json`: `tracts/market.py` now reads
  `housing_market/monthly/all_zips.csv` (same four measures, rolling 3 months, all homes —
  no property type). **Newest period only** (owner: no stale data): a ZIP without sales in it
  has no figures, where the old code kept each ZIP's last row, some years old. If Redfin
  can't be downloaded or read, the run builds without those columns (empty, never a stale
  copy) and the gate summary says so. FDLE's page refuses scripts (403 from GitHub and a
  laptop): a copy downloaded by hand is a manual input (`inputs.MANUAL`,
  `fdle_fibrs_offense_detail.xlsx`), used when the live page refuses
  (`tracts/crime_states.py`). The gate fails cleanly when no county built.
- 2026-10-13 — **PR #1 from a fork (zamays): Phases 10d–10g, 11 and the §12 audit fixes.**
  Decisions in those sections credited to "zamays" were made by the PR's author; the owner
  has reviewed and confirmed them.
  Review fixes on merge: the area page's Taxes always uses the rate Taxes ranks on (loads
  the national file for an open area page); budget notes compare the estimate that's scored;
  switching buy ↔ rent moves the budget's priority; rank caches keyed by column, so a budget
  keystroke re-ranks only Taxes; 7+ digit bracket amounts no longer rounded. Nearest metro and
  Great Lake are now chosen in miles, not raw degrees (`etl/edges.py`: 231 lower-48 counties
  get a nearer metro, median 10 mi; Alaska's is Seattle, not Honolulu), and a city with too
  few rated areas centers its tax rate on the whole county, not the state (`shrink_log_medians`
  `parent`). Both need the ETL rerun to reach the data. Checked, no change: the 2019–2023
  5-year PUMS codes every year's records to 2020 PUMAs (API `PUMA` is "2020 definitions";
  Michigan: all 68 codes valid in all five years, no PUMA's share shifts >10% between
  2019–21 and 2022–23), so `newbuyer.py`'s join on the 2020 crosswalk is sound.
- 2026-10-13 — **Pollution survives a source outage** (owner). The inputs aren't mirrored, so a
  source being down failed the monthly area refresh and held back every other source. Now each
  run publishes its result tables to R2 (`tracts/pollution/*.csv`, merged with the live ones);
  a source that fails, or whose known areas fall below 95% of the live table's, keeps the live
  tables and the run goes on (`etl/pollution/carry.py`). `tracts/pollution.json` dates each
  source; the area page's Pollution section says when it was updated, and in amber when a
  source was unavailable at the last refresh or is over 62 days old. Only the first run, with
  nothing live yet, still fails. County pages show no date: counties.json is rebuilt by hand.
- 2026-10-13 — **Taxes by area** (§9 Phase 10, "10g"; zamays: "several areas have different
  effective tax burdens within the same county"). Each area has its own property tax rate
  (tract ACS); with areas as the results, Taxes uses it and is scored per area. Area pages
  get a Taxes section; the county page says its rate is an average.
- 2026-10-13 — **Phase 11 Tier 1 built (11a–11f)** (§9): PM2.5 (with the monitor-disagreement
  caution), wildfire smoke days, older housing (lead paint) as anchored area priorities;
  radon shown and cautioned, never ranked; Pollution sections on area and county pages; the
  monthly refresh computes pollution with a coverage gate. Inputs not yet mirrored.
- 2026-10-13 — **Phase 11 planned: pollution, and it is NEXT** (§9; zamays). Eleven rules against averaging and
  nearby-pollution bias, an acceptance gate per pollutant, the health risk and the risk to
  this plan of each type, and a tiered build order. Tier 1: PM2.5, wildfire smoke, older-housing
  lead paint, radon (info only). Nothing built.
- 2026-10-04 — **Fewer filters; who lives here.** Filters drop the cost-of-living
  parts, electricity, the income ratios and commute (data kept for the pages);
  Cost of living, Housing and Taxes are one section. Race and Hispanic origin, a
  diversity index and the Gini index are shown on area and county pages (§9 "Filters
  tightened").
- 2026-10-04 — **Full audit** (scoring and results first; see §9 "Full audit"). Crime
  rates are now yearly rates with an exposure floor (a 4-month Phoenix read as a third
  of its real rate; 168 of the 200 "safest" areas were partial-year or tiny-agency
  artifacts); percentiles are over residential areas; top-coded and mobile-home values
  take Zillow's ZIP value; capped incomes are "$250,000+", not "low confidence"; the
  results audit grew to 83 searches with independent checks that fail the test.
- 2026-10-02 — **Area data refreshes itself.** A monthly GitHub Action
  (`tracts-refresh.yml`) rebuilds every county's areas from fresh sources on a clean
  runner, runs a quality gate, and syncs changed files to R2. The hand-downloaded SEDA
  files moved out of git into a private R2 bucket (`etl/inputs.py`); crime picks the
  newest FBI year by itself. The national run is this workflow with `states: all`.
- 2026-10-01 — **8c Texas rehearsal done.** The tract ETL builds a whole state in one run
  (`build --state TX`): 254 counties, 6,884 tracts, ~5 min, 0 failures, with a per-county
  coverage report. Crime moved from the rate-limited CDE API to the FBI's **bulk NIBRS file
  per state and year** (no key, no quota; counts match the API). Fixes found on the way:
  multi-downtown metros (Fort Worth, Midland), a 15-mile school radius, K-12 campuses.
  Published Texas is 9.7 MB.
- 2026-09-30 — **Phase 8 refined (owner answers):** crime from the FBI Crime Data Explorer by
  police jurisdiction; schools ranked both nationally and within the county; housing market
  from Redfin/Zillow (MLS isn't usable by a public app); low confidence as a caution icon
  with details on hover; 8b displays data only, filters inside the county wait for 8e.
- 2026-09-30 — **Phase 8 planned: inside the county.** After shipping the county MVP, the
  next goal is areas within a county (census tracts): open a county, "Explore inside", and
  rank its tracts on home values, housing style, walkability, schools (by district),
  distances, hazards and families. Per-county files loaded on demand; pilot on Travis
  County first. Tracts moved out of §10 (deferred).
- 2026-09-30 — **MVP feature-complete.** "New version available" notice, README rewritten
  for Lodestar, domain lodestarmap.com. Left before launch: GitHub remote, hosting that
  redeploys on push, `EIA_API_KEY` secret, DNS, and a real-phone pass.
- 2026-09-30 — **Shareable searches.** The URL now carries the whole search and the open
  county (readable params: `?v=1&w=…&lim=…&cat=…&place=…`, `search-url.ts`), kept live in
  the address bar; **Share** (Filters → Saved, beside "Save this search"; 2026-10-04,
  replaced the header's Copy link) sends it by email or text, copies it, or opens the
  device's share sheet. A link wins
  over the saved search, and the search it replaces goes to Recent. Filters has a **Saved**
  button (beside the Priorities / Must-haves tabs): name and save the current search, reopen saved or recent ones (up to 8,
  recorded when Filters closes), all in localStorage (`searches-store.ts`).
- 2026-09-30 — **Light is the default theme** (no saved choice = light; "System" follows
  the OS only once picked). Settings ends with "© <current year> Planet X Devs".
- 2026-09-30 — **Branding: the app is now "Lodestar".** Brand kit in `brand/` (mark,
  lockups, icons, share image; README in `brand/nextjs/`). Header shows the mark + wordmark
  (Source Serif 4 Semibold); favicon, `icon.svg`, apple icon, PWA icons and the Open Graph
  image come from the kit; theme color is now neutral-950 `#0a0a0a` (was slate-900). The
  kit's `icon.svg` had lost its style block, so `src/app/icon.svg` is a corrected copy.
  Domain: **www.lodestarmap.com** (canonical; the apex redirects; `metadataBase` in `layout.tsx`).
- 2026-09-30 — **Climate type filter → plain-language climate cards.** 85% of counties sit in
  three Köppen types, so the 21 jargon checkboxes became 9 families (Humid South, Four
  seasons, Northern cold, Dry & sunny, Desert, West Coast, Mountain West, Tropical,
  Highlands & Alaska), each with an icon, a one-line description, example places and a
  county count; tap to rule one out. Still stored as Köppen codes, so saved searches work.
  Definitions in `src/lib/scoring/climate-families.ts`. Place view and filter rows speak in
  families too. Also: a cost-of-living "i" in the place view, and the Material gear icon.
- 2026-09-28 — **Phase 7a: settings, theme, quieter UI.** Active-filter chips skipped for
  now (user call). Settings screen (gear) with a System/Light/Dark switch, the unknown and
  Alaska/Hawaii toggles, and About the data; the "⋯" menus and the header's source line are
  gone. Dark basemap relabelled for contrast. Laws tab: Sources list + per-value "i".
- 2026-09-28 — **Phase 7a steps 1–2 done:** type/spacing tokens, `Modal` and `InfoTip`, and
  the Filters modal (Priorities / Must-haves, Off–5 importance) replacing the Filters panel.
- 2026-09-28 — **Phase 7a: UI reorganization planned** — filters move to a large modal split
  into Priorities and Must-haves, Off–5 importance buttons, a Settings screen with About the
  data, a type/spacing pass with "i" popovers. New features paused until it's done.
- 2026-09-27 — **Phase 5 complete; Phase 7 (polish) entered.** FEMA National Risk Index
  (loss-rate percentiles, not the size-driven risk score), BLS 2025 unemployment (API key),
  and distances to a major airport, the coast (incl. tidal water) and a 500k+ metro.
- 2026-09-27 — **Phase 6 complete.** Place view (Overview / Climate / Laws & taxes), monthly
  climate charts with a compare county, and a Köppen climate type label and filter. The
  month-by-month envelope and "climate like a place I know" moved to §10 (deferred).
- 2026-09-27 — **Phase 6 planned: place view + climate.** Selecting a county replaces the
  results list with a Google Maps–style place view (header, Overview / Climate / Laws &
  taxes tabs, "← All results", Back gesture); the detail view moves here from Phase 7.
  Climate tab: monthly chart incl. rainy/snowy day counts, compare with a county you pick.
- 2026-09-27 — **Law filters.** Filters panel split into Place and Laws & taxes tabs; taxes
  are sliders, policies are pass/fail "acceptable values" filters. See Phase 5.
- 2026-09-27 — **Phase 5 started: state laws, sourced and re-checked automatically.** No
  person reviews law values, so every value is parsed by code from a cited source
  (`etl/laws/refresh.py`), re-checked monthly by a GitHub Actions workflow, and shown in the
  county card with its source, the source's date, and the check date. Where a second source
  exists they must agree, or the cell is blank with the reason. The first pass found 4 stale
  income tax rates and an NCSL error (RI minimum wage). **Property tax** is now a county
  metric (ACS aggregates; matches Tax Foundation within 0.1 pt). Details in `LAWS.md`.
- 2026-09-27 — A deploy that adds a metric no longer breaks the first visit: the old
  service worker serves the old data file once, and a missing metric column now reads as
  unknown instead of an error.
- 2026-09-27 — **State laws have their own design doc, `LAWS.md`.** 12 laws with rubrics,
  verify tiers and sources; a long-format table in `etl/data/law_*.csv` (393/512 values
  filled from aggregators, none yet from primary sources); `etl/laws-v2/verify_laws.py`
  checks it. Answers the §11 "which state law attributes" question.
- 2026-09-26 — **Phase 4 complete; phone layout confirmed on a real phone.** Recorded the plan for a
  selected-result **detail view** (Phase 7, maybe post-MVP) and a later **place profile**
  (images, things to do, laws, good and bad). Profile content is deferred (§10) and must be
  keyed by place, not county, so neighborhoods can slot in later.
- 2026-09-26 — **Phone layout redesigned, Google Maps–style**: the map fills the screen,
  results are a bottom sheet dragged between 25 / 50 / 80 / 100%, and filters open from a
  "Filters" tab in a top bar. The side-panel layout on a phone felt wrong. **Picking a county
  in the list now always zooms to it** (previously only if it was off-screen). **The search
  is saved in `localStorage`** between sessions, pulled forward from Phase 7 as a stopgap for
  testing. Offline fallback checked in a real offline browser. It works.
- 2026-09-26 — **Alaska and Hawaii are now in-app toggles, both off by default.** Alaska is
  back in the dataset (3,144 counties). When a state is off it is cut from the data *before*
  percentiles are computed (`subsetDataset`), so it affects no one's score, median, rank or
  count. Replaces the 2026-09-22 build-time exclusion of Alaska.
- 2026-09-26 — **Phase 4 map built** and checked in the browser. Boundary step in the ETL
  (validated to cover exactly the data's counties). **The map fills only the top 50 results,
  colored red → green relative to each other** (§6 item 6, changed). Filters and Results are
  independently collapsible left panels; "Maximize map" hides both. OpenFreeMap basemap,
  county-lines-only fallback offline.
- 2026-09-26 — **Phase 3 complete.** Tuning moved to an ongoing track (§12) rather than a
  phase gate. Phase 4 prepped: 2024 Census boundaries match all 3,114 counties exactly;
  simplified TopoJSON ≈ 620 KB / 190 KB gzipped, so one boundary file is enough. Three
  decisions listed under Phase 4 before building.
- 2026-09-26 — **Third direction: "Average is better"** (§6 item 2). Scores closeness to the
  typical (median) county: `100 − 2·|percentile − 50|`. For "average rain, not a little or a
  lot", or "some snow". Three-way Lower / Average / Higher toggle on every metric.
- 2026-09-26 — **Climate is now measured where people live**: the station search starts from
  each county's 2020 Census population center (Gazetteer internal point as fallback, CT only).
  San Diego 84 → 19 days over 90°F; SF's nearest station 28.8 → 0.9 mi; Nye NV gained snow
  data, so every county now has every climate column. Median county moved < 1 day.
- 2026-09-26 — Six climate columns added (full coverage except Nye NV snow days). **Phase 3
  list view built** and checked in the browser: weight sliders, direction toggles, min/max
  limits, unknown toggle, top-50 list with reasons and an expandable breakdown. Found that
  big western counties get climate from their geographic middle, not where people live —
  fix proposed below.
- 2026-09-22 — **Climate preference model decided** (§6 *Climate preferences*): describe
  the year by its two ends — hottest-month high and coldest-month low — plus counts of
  uncomfortable days. No single year-round band, no annual averages. Built with existing
  direction flags and filters; no new scoring mode. Month-by-month envelope deferred to Phase 6.
- 2026-09-22 — **Phase 2 complete.** Scoring engine in `src/lib/scoring/` (pure TS, 36 Vitest
  tests incl. real-data sanity checks). ETL now publishes a compact columnar file: 704 KB,
  240 KB gzipped, precached by Serwist. Percentiles are national; any metric's direction can
  be flipped; missing data is unknown, never imputed.
- 2026-09-22 — Decisions after review: **Climate tab is now Phase 6; Polish moves to last
  (Phase 7).** **Alaska is out of scope** and dropped from the dataset (3,114 counties). Missing
  data is shown, not hidden — "unknown" counties render grey with a show/hide toggle (§6).
  Snowfall is a low-priority metric; an imperfect snow column is acceptable. NOAA station
  selection is now per variable, with a wider fallback search, before any second source.
- 2026-09-22 — Pre-Phase-2 review of the published dataset. Offline suite 71/71, lint and
  typecheck clean. Found three ETL data-quality issues (snow nulls, Livingston Parish climate
  gap, new AK census areas missing schools) and measured the payload fix: a row-array JSON
  at 3 decimals is ~785 KB raw / ~260 KB gzipped, well under Serwist's 2 MB cap. Added as
  Phase 2 prerequisites.
- 2026-09-20 — Initial plan.
- 2026-09-20 — Store cost of living as its three RPP components rather than one blended index
  (see "Making cost of living work below metro level"). Expanded the Phase 1 column set to
  include income, rent, and climate. Added the geography roadmap. Decided to keep small
  counties in the dataset and filter at runtime instead.
- 2026-09-20 — Corrections after review: `real_home_value` was dimensionally wrong (housing
  price over housing price index), replaced with `price_to_rent` and `real_income`. RPP has
  **four** components, not three — utilities split out in BEA's Dec 2021 methodology revision.
  Confirmed BEA does not publish county-level RPPs, so the CBSA crosswalk stays.
- 2026-09-20 — **Phase 1 complete.** `python -m etl.build` exits 0 with 0 FAIL / 0 WARN;
  3,144 counties × 33 columns published to `public/data/counties.json`. Live-run findings:
  SEDA 6.0 is long on subgroup (filter `subgroup=all`, `gap=0`; using `cs_mn_avg_eb`);
  NOAA inventory moved to a fixed-width file; CoCoRaHS (`US1`) rain gauges had to be excluded
  from the station search or metros lost their climate; SF's Gazetteer internal point is in
  the Pacific. Connecticut school gap confirmed. Published JSON is 2.7 MB — over Serwist's
  2 MB precache cap; decide in Phase 2/6.
- 2026-09-20 — First live run. BEA publishes no per-state non-metro RPP (API and bulk both
  checked), so rule 2 is now "statewide" and `rpp_geo_level` is `metro` | `state`. Recorded
  as a known gap. BEA line-code mapping verified: 1 All items, 2 Goods, 3 Rents, 4 Utilities,
  5 Other services.
- 2026-09-20 — ETL audit before first live run. Connecticut's 2022 switch to planning
  regions means SEDA (legacy county FIPS) will leave all of CT null for school
  achievement — recorded as a known gap below and in `etl/README.md`. Spot-check county
  changed from `09001` to `09190`. Validator now FAILs on a zero-join optional source and
  on an implausible RPP assignment mix.
