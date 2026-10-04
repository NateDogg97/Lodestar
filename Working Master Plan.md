# Relocation Finder — MVP Plan

> **This is a working document.** It reflects current thinking, not settled fact. Update it as
> decisions change, assumptions break, or data sources turn out to be different than expected.
> If something here conflicts with what you actually built, the code is right and this file is
> stale — fix the file.
>
> Last updated: 2026-10-04
>
> **Changelog**
> - 2026-10-02 — **Area data refreshes itself.** A monthly GitHub Action
>   (`tracts-refresh.yml`) rebuilds every county's areas from fresh sources on a clean
>   runner, runs a quality gate, and syncs changed files to R2. The hand-downloaded SEDA
>   files moved out of git into a private R2 bucket (`etl/inputs.py`); crime picks the
>   newest FBI year by itself. The national run is this workflow with `states: all`.
> - 2026-10-01 — **8c Texas rehearsal done.** The tract ETL builds a whole state in one run
>   (`build --state TX`): 254 counties, 6,884 tracts, ~5 min, 0 failures, with a per-county
>   coverage report. Crime moved from the rate-limited CDE API to the FBI's **bulk NIBRS file
>   per state and year** (no key, no quota; counts match the API). Fixes found on the way:
>   multi-downtown metros (Fort Worth, Midland), a 15-mile school radius, K-12 campuses.
>   Published Texas is 9.7 MB.
> - 2026-09-30 — **Phase 8 refined (owner answers):** crime from the FBI Crime Data Explorer by
>   police jurisdiction; schools ranked both nationally and within the county; housing market
>   from Redfin/Zillow (MLS isn't usable by a public app); low confidence as a caution icon
>   with details on hover; 8b displays data only, filters inside the county wait for 8e.
> - 2026-09-30 — **Phase 8 planned: inside the county.** After shipping the county MVP, the
>   next goal is areas within a county (census tracts): open a county, "Explore inside", and
>   rank its tracts on home values, housing style, walkability, schools (by district),
>   distances, hazards and families. Per-county files loaded on demand; pilot on Travis
>   County first. Tracts moved out of §10 (deferred).
> - 2026-09-30 — **MVP feature-complete.** "New version available" notice, README rewritten
>   for Lodestar, domain lodestarmap.com. Left before launch: GitHub remote, hosting that
>   redeploys on push, `EIA_API_KEY` secret, DNS, and a real-phone pass.
> - 2026-09-30 — **Shareable searches.** The URL now carries the whole search and the open
>   county (readable params: `?v=1&w=…&lim=…&cat=…&place=…`, `search-url.ts`), kept live in
>   the address bar; **Copy link** in the header copies it and shows "Copied". A link wins
>   over the saved search, and the search it replaces goes to Recent. Filters has a **Saved**
>   button (beside the Priorities / Must-haves tabs): name and save the current search, reopen saved or recent ones (up to 8,
>   recorded when Filters closes), all in localStorage (`searches-store.ts`).
> - 2026-09-30 — **Light is the default theme** (no saved choice = light; "System" follows
>   the OS only once picked). Settings ends with "© <current year> Planet X Devs".
> - 2026-09-30 — **Branding: the app is now "Lodestar".** Brand kit in `brand/` (mark,
>   lockups, icons, share image; README in `brand/nextjs/`). Header shows the mark + wordmark
>   (Source Serif 4 Semibold); favicon, `icon.svg`, apple icon, PWA icons and the Open Graph
>   image come from the kit; theme color is now neutral-950 `#0a0a0a` (was slate-900). The
>   kit's `icon.svg` had lost its style block, so `src/app/icon.svg` is a corrected copy.
>   Domain: **www.lodestarmap.com** (canonical; the apex redirects; `metadataBase` in `layout.tsx`).
> - 2026-09-30 — **Climate type filter → plain-language climate cards.** 85% of counties sit in
>   three Köppen types, so the 21 jargon checkboxes became 9 families (Humid South, Four
>   seasons, Northern cold, Dry & sunny, Desert, West Coast, Mountain West, Tropical,
>   Highlands & Alaska), each with an icon, a one-line description, example places and a
>   county count; tap to rule one out. Still stored as Köppen codes, so saved searches work.
>   Definitions in `src/lib/scoring/climate-families.ts`. Place view and filter rows speak in
>   families too. Also: a cost-of-living "i" in the place view, and the Material gear icon.
> - 2026-09-28 — **Phase 7a: settings, theme, quieter UI.** Active-filter chips skipped for
>   now (user call). Settings screen (gear) with a System/Light/Dark switch, the unknown and
>   Alaska/Hawaii toggles, and About the data; the "⋯" menus and the header's source line are
>   gone. Dark basemap relabelled for contrast. Laws tab: Sources list + per-value "i".
> - 2026-09-28 — **Phase 7a steps 1–2 done:** type/spacing tokens, `Modal` and `InfoTip`, and
>   the Filters modal (Priorities / Must-haves, Off–5 importance) replacing the Filters panel.
> - 2026-09-28 — **Phase 7a: UI reorganization planned** — filters move to a large modal split
>   into Priorities and Must-haves, Off–5 importance buttons, a Settings screen with About the
>   data, a type/spacing pass with "i" popovers. New features paused until it's done.
> - 2026-09-27 — **Phase 5 complete; Phase 7 (polish) entered.** FEMA National Risk Index
>   (loss-rate percentiles, not the size-driven risk score), BLS 2025 unemployment (API key),
>   and distances to a major airport, the coast (incl. tidal water) and a 500k+ metro.
> - 2026-09-27 — **Phase 6 complete.** Place view (Overview / Climate / Laws & taxes), monthly
>   climate charts with a compare county, and a Köppen climate type label and filter. The
>   month-by-month envelope and "climate like a place I know" moved to §10 (deferred).
> - 2026-09-27 — **Phase 6 planned: place view + climate.** Selecting a county replaces the
>   results list with a Google Maps–style place view (header, Overview / Climate / Laws &
>   taxes tabs, "← All results", Back gesture); the detail view moves here from Phase 7.
>   Climate tab: monthly chart incl. rainy/snowy day counts, compare with a county you pick.
> - 2026-09-27 — **Law filters.** Filters panel split into Place and Laws & taxes tabs; taxes
>   are sliders, policies are pass/fail "acceptable values" filters. See Phase 5.
> - 2026-09-27 — **Phase 5 started: state laws, sourced and re-checked automatically.** No
>   person reviews law values, so every value is parsed by code from a cited source
>   (`etl/laws/refresh.py`), re-checked monthly by a GitHub Actions workflow, and shown in the
>   county card with its source, the source's date, and the check date. Where a second source
>   exists they must agree, or the cell is blank with the reason. The first pass found 4 stale
>   income tax rates and an NCSL error (RI minimum wage). **Property tax** is now a county
>   metric (ACS aggregates; matches Tax Foundation within 0.1 pt). Details in `LAWS.md`.
> - 2026-09-27 — A deploy that adds a metric no longer breaks the first visit: the old
>   service worker serves the old data file once, and a missing metric column now reads as
>   unknown instead of an error.
> - 2026-09-27 — **State laws have their own design doc, `LAWS.md`.** 12 laws with rubrics,
>   verify tiers and sources; a long-format table in `etl/data/law_*.csv` (393/512 values
>   filled from aggregators, none yet from primary sources); `etl/laws-v2/verify_laws.py`
>   checks it. Answers the §11 "which state law attributes" question.
> - 2026-09-26 — **Phase 4 complete; phone layout confirmed on a real phone.** Recorded the plan for a
>   selected-result **detail view** (Phase 7, maybe post-MVP) and a later **place profile**
>   (images, things to do, laws, good and bad). Profile content is deferred (§10) and must be
>   keyed by place, not county, so neighborhoods can slot in later.
> - 2026-09-26 — **Phone layout redesigned, Google Maps–style**: the map fills the screen,
>   results are a bottom sheet dragged between 25 / 50 / 80 / 100%, and filters open from a
>   "Filters" tab in a top bar. The side-panel layout on a phone felt wrong. **Picking a county
>   in the list now always zooms to it** (previously only if it was off-screen). **The search
>   is saved in `localStorage`** between sessions, pulled forward from Phase 7 as a stopgap for
>   testing. Offline fallback checked in a real offline browser. It works.
> - 2026-09-26 — **Alaska and Hawaii are now in-app toggles, both off by default.** Alaska is
>   back in the dataset (3,144 counties). When a state is off it is cut from the data *before*
>   percentiles are computed (`subsetDataset`), so it affects no one's score, median, rank or
>   count. Replaces the 2026-09-22 build-time exclusion of Alaska.
> - 2026-09-26 — **Phase 4 map built** and checked in the browser. Boundary step in the ETL
>   (validated to cover exactly the data's counties). **The map fills only the top 50 results,
>   colored red → green relative to each other** (§6 item 6, changed). Filters and Results are
>   independently collapsible left panels; "Maximize map" hides both. OpenFreeMap basemap,
>   county-lines-only fallback offline.
> - 2026-09-26 — **Phase 3 complete.** Tuning moved to an ongoing track (§12) rather than a
>   phase gate. Phase 4 prepped: 2024 Census boundaries match all 3,114 counties exactly;
>   simplified TopoJSON ≈ 620 KB / 190 KB gzipped, so one boundary file is enough. Three
>   decisions listed under Phase 4 before building.
> - 2026-09-26 — **Third direction: "Average is better"** (§6 item 2). Scores closeness to the
>   typical (median) county: `100 − 2·|percentile − 50|`. For "average rain, not a little or a
>   lot", or "some snow". Three-way Lower / Average / Higher toggle on every metric.
> - 2026-09-26 — **Climate is now measured where people live**: the station search starts from
>   each county's 2020 Census population center (Gazetteer internal point as fallback, CT only).
>   San Diego 84 → 19 days over 90°F; SF's nearest station 28.8 → 0.9 mi; Nye NV gained snow
>   data, so every county now has every climate column. Median county moved < 1 day.
> - 2026-09-26 — Six climate columns added (full coverage except Nye NV snow days). **Phase 3
>   list view built** and checked in the browser: weight sliders, direction toggles, min/max
>   limits, unknown toggle, top-50 list with reasons and an expandable breakdown. Found that
>   big western counties get climate from their geographic middle, not where people live —
>   fix proposed below.
> - 2026-09-22 — **Climate preference model decided** (§6 *Climate preferences*): describe
>   the year by its two ends — hottest-month high and coldest-month low — plus counts of
>   uncomfortable days. No single year-round band, no annual averages. Built with existing
>   direction flags and filters; no new scoring mode. Month-by-month envelope deferred to Phase 6.
> - 2026-09-22 — **Phase 2 complete.** Scoring engine in `src/lib/scoring/` (pure TS, 36 Vitest
>   tests incl. real-data sanity checks). ETL now publishes a compact columnar file: 704 KB,
>   240 KB gzipped, precached by Serwist. Percentiles are national; any metric's direction can
>   be flipped; missing data is unknown, never imputed.
> - 2026-09-22 — Decisions after review: **Climate tab is now Phase 6; Polish moves to last
>   (Phase 7).** **Alaska is out of scope** and dropped from the dataset (3,114 counties). Missing
>   data is shown, not hidden — "unknown" counties render grey with a show/hide toggle (§6).
>   Snowfall is a low-priority metric; an imperfect snow column is acceptable. NOAA station
>   selection is now per variable, with a wider fallback search, before any second source.
> - 2026-09-22 — Pre-Phase-2 review of the published dataset. Offline suite 71/71, lint and
>   typecheck clean. Found three ETL data-quality issues (snow nulls, Livingston Parish climate
>   gap, new AK census areas missing schools) and measured the payload fix: a row-array JSON
>   at 3 decimals is ~785 KB raw / ~260 KB gzipped, well under Serwist's 2 MB cap. Added as
>   Phase 2 prerequisites.
> - 2026-09-20 — Initial plan.
> - 2026-09-20 — Store cost of living as its three RPP components rather than one blended index
>   (see "Making cost of living work below metro level"). Expanded the Phase 1 column set to
>   include income, rent, and climate. Added the geography roadmap. Decided to keep small
>   counties in the dataset and filter at runtime instead.
> - 2026-09-20 — Corrections after review: `real_home_value` was dimensionally wrong (housing
>   price over housing price index), replaced with `price_to_rent` and `real_income`. RPP has
>   **four** components, not three — utilities split out in BEA's Dec 2021 methodology revision.
>   Confirmed BEA does not publish county-level RPPs, so the CBSA crosswalk stays.
> - 2026-09-20 — **Phase 1 complete.** `python -m etl.build` exits 0 with 0 FAIL / 0 WARN;
>   3,144 counties × 33 columns published to `public/data/counties.json`. Live-run findings:
>   SEDA 6.0 is long on subgroup (filter `subgroup=all`, `gap=0`; using `cs_mn_avg_eb`);
>   NOAA inventory moved to a fixed-width file; CoCoRaHS (`US1`) rain gauges had to be excluded
>   from the station search or metros lost their climate; SF's Gazetteer internal point is in
>   the Pacific. Connecticut school gap confirmed. Published JSON is 2.7 MB — over Serwist's
>   2 MB precache cap; decide in Phase 2/6.
> - 2026-09-20 — First live run. BEA publishes no per-state non-metro RPP (API and bulk both
>   checked), so rule 2 is now "statewide" and `rpp_geo_level` is `metro` | `state`. Recorded
>   as a known gap. BEA line-code mapping verified: 1 All items, 2 Goods, 3 Rents, 4 Utilities,
>   5 Other services.
> - 2026-09-20 — ETL audit before first live run. Connecticut's 2022 switch to planning
>   regions means SEDA (legacy county FIPS) will leave all of CT null for school
>   achievement — recorded as a known gap below and in `etl/README.md`. Spot-check county
>   changed from `09001` to `09190`. Validator now FAILs on a zero-join optional source and
>   on an implausible RPP assignment mix.

---

## 1. What this is

A map-based tool for finding places to live in the US. The user sets criteria (school quality,
cost of living, climate, distance to an airport, hazard risk, etc.), assigns weights to what
matters most, and gets back a ranked list plus a choropleth heat map where color indicates how
closely each area matches.

Target: personal-use MVP. No accounts, no monetization, no listings data.

---

## 2. Core architectural decision

**This is an ETL problem, not an API problem.**

Nearly all the underlying data updates annually. Hitting live APIs at query time would be slow,
rate-limited, and pointless. Instead:

1. An offline pipeline pulls ~10 federal datasets
2. Normalizes everything to one geographic key
3. Bakes out two static files
4. The browser downloads those once and does all filtering/scoring locally

```
Federal data sources
        │
        ▼
ETL pipeline (Python, run ~yearly)
   joins everything on county FIPS
        │
        ├──▶ counties.topo.json   (~800 KB, simplified boundaries)
        └──▶ metrics.json         (3,114 rows × ~30 columns)
                │
                ▼
        Browser (Next.js PWA)
        filters, scores, colors — all client-side
```

**Consequences of this design:**

- No search backend
- No database for v1
- No per-query API cost
- Works fully offline once cached
- Re-scoring on a slider drag is sub-millisecond (~3,100 rows is nothing)

Payload math: 3,144 counties × 30 metrics × 4 bytes (Float32) ≈ 375 KB raw, much less gzipped.
The entire national dataset fits comfortably in the browser.

---

## 3. Geography key: county FIPS

**Decision: use county FIPS as the single join key for MVP.**

Rationale:
- Nearly every federal dataset publishes at county level → trivial joins
- ~3,100 units is granular enough to be useful, small enough to ship whole
- Boundaries are stable and free from Census TIGER

**Scope: all 50 states and DC in the data (3,144 counties); Alaska and Hawaii are opt-in.**
Decided 2026-09-26, replacing the 2026-09-22 decision to drop Alaska in the ETL. The app has
"Include Alaska" / "Include Hawaii" toggles, **both off by default** (the owner isn't
considering either, but someone else might). Off means the state's counties are removed from
the dataset *before* percentiles are computed — they don't count toward any percentile,
"typical county" median, rank, or count, and aren't colored on the map. Default scope: the
lower 48 + DC, 3,109 counties.

**Known limitation:** school districts do not nest inside counties — they cross county lines
constantly. SEDA publishes county-level rollups, so this is handled for MVP, but we are
approximating. Revisit if district-level precision becomes important.

**Beyond counties: Phase 8** (planned 2026-09-30) — rank counties, then drill into one
county's census tracts. See §9 Phase 8.

### Geography roadmap

The long-term goal is neighborhood-level precision. Here is how far that can actually go:

| Level | Units in US | Rich data? | Status |
|---|---|---|---|
| County | 3,144 | Everything | **MVP** |
| Place (city/town) | ~29,500 | Everything | Easy add. Gap: no coverage of unincorporated areas. |
| ZCTA (ZIP approximation) | ~33,000 | Everything | Easy add, and people think in ZIPs |
| **Census tract** | ~85,000 | Everything | **This is "neighborhood."** ~1,200–8,000 people. The real target. |
| Block group | ~242,000 | Most things, noisy | ~600–3,000 people. ACS margins of error get ugly. |
| Census block | ~8,000,000 | Population and race only | Dead end — no income or housing data exists at this level |
| Street / parcel | ~150M | — | **Hard wall.** Requires commercial data (Regrid, ATTOM, CoreLogic). Four to five figures annually. |

**Tracts are the target.** In a dense city a tract is genuinely a neighborhood — five or six
blocks. In rural areas a tract can span an entire county, but that's fine, because there's no
neighborhood distinction to make there anyway.

**What changes at tract scale:** 85,000 rows is ~10 MB of metrics — too much to eagerly load, but
fine to fetch per-state or per-metro on demand. Boundaries are the harder problem: 85k polygons
won't ship as one TopoJSON file, so we move to vector tiles (generate `.pmtiles` with
`tippecanoe`, serve from R2). Contained work, maybe a weekend.

**Why street level is out of scope, and should stay out.** The app's job is narrowing 3,144
counties down to five neighborhoods. Once you're evaluating individual streets you've switched
tasks — that's when you open Zillow and book a flight. Building for street level means building a
worse version of a tool that already exists.

---

## 4. Data sources

| Metric area | Source | Cost | Granularity | Notes |
|---|---|---|---|---|
| School quality | SEDA (Stanford Education Data Archive) | Free CSV | District, county, metro, state | Standardized test achievement, grades 3–8. This is the "top districts" source. |
| Boundaries | Census TIGER / cartographic boundary files | Free | All levels | Simplify with `mapshaper` before shipping |
| Income, rent, home value, commute, education | Census ACS 5-year API | Free (key) | County, tract, place | The workhorse dataset |
| Cost of living | BEA Regional Price Parities | Free (key) | **State + metro only** | Map down to counties via CBSA crosswalk |
| Natural hazard risk | FEMA National Risk Index | Free CSV | County, tract | 18 hazards, single composite score. Underrated. |
| Unemployment / job growth | BLS LAUS | Free (key) | County | |
| Climate | NOAA NCEI Climate Normals | Free | Station | Interpolate to county centroid |
| Airports | OurAirports open data | Free CSV | Point | Filter to `large_airport` for "international" |
| Coastline | Natural Earth / NOAA shoreline | Free | Geometry | |
| Home prices | Zillow Research / Redfin Data Center | Free CSV | ZIP, county, metro | Check ToS before any monetization |
| State laws | Hand-built CSV | An afternoon | State | See below |

### Notes on specific sources

**GreatSchools is out.** The 1–10 ratings and assigned schools are *not* in the NearbySchools API —
that requires their enterprise Data Licensing product, which has no published pricing. The API tier
only exposes three coarse bands (below average / average / above average). Use SEDA instead:
academically rigorous, nationally comparable, free, and rankable however we want.

**State laws have no API and never will.** Pick 6–8 binary or categorical attributes that actually
matter, build a 50-row CSV by hand, commit it. This is the correct engineering answer, not a
shortcut. *Superseded 2026-09-27 by `LAWS.md`:* 12 laws, one row per (law, state) with
per-fact sources and review dates, and a verifier. Some are ranking filters, some are info only.

**"Distance to X" is not a runtime query.** Precompute in the ETL as ordinary columns:
`dist_to_large_airport_mi`, `dist_to_coast_mi`, `dist_to_metro_500k_mi`. Haversine against a point
file, or PostGIS. They then behave like any other metric. **Measure from `pop_lat`/`pop_lon`**
(the population center), not the geographic middle — same reason as climate (§9 Phase 3).

### Climate fallback sources

Researched 2026-09-22, when some counties came out with null climate columns. In order of
preference:

| Option | Covers | Snowfall? | Verdict |
|---|---|---|---|
| **More NOAA stations** — select per variable, widen the search for short counties | Same as now | Yes | **Done first.** Same source and method, so no consistency questions. |
| **PRISM 1991–2020 normals** (Oregon State) — gridded rasters, 800 m / 4 km | Lower 48; Hawaii in a separate normals set | **No** — temperature and precipitation only | Best upgrade *if* we ever need one. It's elevation-aware, which would also fix the "mountain county gets the valley station" caveat. Costs a raster dependency (`rasterio`) and a sampling step. Keep in reserve. |
| **Open-Meteo Historical API** (ERA5 reanalysis) — free, no key | Global | Yes | Poor fit for 30-year normals. The free tier is non-commercial and bills long ranges as multiple calls: 30 years at one point ≈ 780 calls, against 10,000 a day — about a dozen counties a day. It's modeled data, not stations. OK for filling a handful of gaps; not a national source. |

**Rule if a second source is ever used:** record it per county (e.g. `climate_source`) so the UI
can say where a number came from. Never silently blend sources in one column.

### Making cost of living work below metro level

BEA publishes RPP only at state and metro level, not by county. Naively that means every county in
the Austin metro gets an identical cost-of-living number — a real loss of precision, and a blocker
for the neighborhood-level goal.

**The fix: store the four RPP components separately instead of the blended index.**

BEA estimates RPPs for four subcategories: **goods, housing rents, utilities, and other
services.** Utilities used to be folded into Other Services; the December 2021 methodology
revision split them out and they are now published separately.

| Component | Varies within a metro? |
|---|---|
| Housing rents | Enormously. East Austin vs Westlake is a different planet. |
| Utilities | Somewhat, and independently of rent — this is why the split matters |
| Goods (groceries, gas, retail) | Barely. Milk costs the same across the metro. |
| Other services (haircuts, childcare, healthcare) | Somewhat, but modestly. |

> **Do not hardcode component weights in the ETL.** BEA constructs expenditure weights from PCE
> and ACS housing rents expenditures — they are derived, not a fixed national split. Read them
> from the source when pulling. Any weights quoted from memory are wrong.

Keeping utilities separate matters for this app specifically. Utilities vary in ways rent doesn't
predict: Hawaii's utilities RPP was 201.2 — more than double the national average — while
California topped housing rents at 160.2. A place can have cheap rent and brutal utility bills,
and with the components merged you'd never see it.

The metro-level number is genuinely accurate for goods and most services. The part that's wrong at
neighborhood scale is housing — and housing is exactly the thing we *can* get at neighborhood
scale from ACS.

So at any geography below metro level:
1. Keep the metro's goods, utilities, and other services components
2. **Replace** the housing rents component with actual ACS rent data for that tract
3. Recombine using BEA's published expenditure weights

This yields a cost-of-living index accurate to the neighborhood with no commercial data vendor.

**Do this in Phase 1 even though we won't use it for a while.** It costs nothing now (five columns
instead of one) and it's the difference between "we can add tracts later" and "we have to
re-architect to add tracts later."

### County-level RPP assignment

**Checked 2026-09-20: BEA does not publish county-level RPPs.** Latest release was 2026-02-19
(2024 data); next is 2026-12-10. The crosswalk step below is required.

**Also checked 2026-09-20, on the first live run: BEA does not publish a per-state non-metro
portion either** — not through the Regional API (GeoFips lists for SARPP and MARPP probed) and
not in the bulk downloads. The only portion row anywhere is a single *national* non-metro
figure. The interactive tables suggest otherwise; they are wrong for our purposes.

So the assignment is two rules, not three:

1. Look up each county's CBSA via the Census delineation file (OMB 23-01, same vintage BEA uses)
2. County in a **metropolitan** CBSA → that metro's RPP components (`rpp_geo_level = metro`, ~38%)
3. Otherwise → the **statewide** RPP components (`rpp_geo_level = state`, ~62%)

Micropolitan CBSAs fall through to the state rule; BEA's footnote confirms its non-metro
figures include them.

**Cost of this:** the statewide RPP is a blend that includes the state's metros, so rural
counties read somewhat high — worst in states dominated by an expensive metro. For relative
ranking it's lost resolution, not wrong ordering. Options if it matters later: derive a state
non-metro value as statewide-minus-metros using BEA's expenditure weights (constructed data,
must be labelled), or the county-level working-paper method in the note below.

**For the tract path (Phase 5+):** county-level RPP estimates *are* produced internally as part of
BEA's methodology but aren't published pending reliability work. A Commerce Department working
paper ("Estimating county-level regional price parities from public data") constructs them from
public microdata, releveled so they aggregate exactly to BEA's metro and non-metro figures. That's
a published methodology we can borrow rather than invent.

---

## 5. Phase 1 CSV schema

One row per county, 3,114 rows (Alaska excluded — see §3).

**Identity**
| Column | Source | Notes |
|---|---|---|
| `fips` | Census | 5-digit county code. The join key. Keep as a **string** — leading zeros matter (`06075`). |
| `county_name` | Census | |
| `state` | Census | Two-letter |
| `population` | ACS | Kept so small-county filtering is a runtime slider, not a rebuild |

**Housing & income** — ACS, one API call
| Column | Notes |
|---|---|
| `median_home_value` | Owner-occupied, dollars |
| `median_household_income` | Dollars |
| `median_gross_rent` | Monthly, dollars, includes utilities |

**Cost of living** — BEA, components not composite
| Column | Notes |
|---|---|
| `rpp_all` | Blended index, 100 = national average |
| `rpp_rents` | The component we'll override at tract level |
| `rpp_utilities` | Split out separately since BEA's Dec 2021 revision. Varies independently of rent. |
| `rpp_goods` | |
| `rpp_services` | "Other services" — no longer includes utilities |

**Schools** — SEDA
| Column | Notes |
|---|---|
| `school_achievement` | Grade levels above/below national average. `0.42` = four-tenths of a grade ahead. Typical range -2 to +2. |

**Climate** — NOAA 1991–2020 Normals
| Column | Notes |
|---|---|
| `summer_high_f` | |
| `winter_low_f` | |
| `spring_mean_f` | |
| `fall_mean_f` | |
| `annual_precip_in` | |
| `annual_snow_in` | |

**Derived** — computed, not downloaded
| Column | Formula | What it tells you |
|---|---|---|
| `home_value_to_income` | `median_home_value / median_household_income` | Affordability of buying |
| `rent_to_income` | `(median_gross_rent * 12) / median_household_income` | Affordability of renting |
| `price_to_rent` | `median_home_value / (median_gross_rent * 12)` | Valuation — is buying cheap or dear relative to renting here |
| `real_income` | `median_household_income / (rpp_all / 100)` | How far a salary actually goes. BEA's own documented use: $12,000 income at RPP 120 → $10,000 adjusted. |

> **Superseded:** an earlier draft had `real_home_value = median_home_value / (rpp_rents / 100)`.
> That divides a housing price by a housing price index, so the two largely cancel — what comes
> out is a price-to-rent signal, not affordability. `price_to_rent` computes that directly from
> actual rent data, and `real_income` does the price-level adjustment properly.

> **Caveat on `real_income`:** `rpp_all` includes rents, so filtering on both `real_income` and a
> housing metric double-counts housing somewhat. If that becomes a problem, compute a
> non-housing variant from goods + utilities + other services — arguably the better measure for
> "how far does a salary go" when housing is being scored separately.

### Why NOAA is in Phase 1

Every other source joins on a county FIPS code — a simple key match. NOAA is weather stations with
latitude and longitude, so it needs an actual **spatial join**: find stations inside or near each
county, average them, handle counties with no station. That's a different class of problem. If
it's going to break, better to find out in Phase 1 than Phase 5.

It also unlocks the climate tab early. The NOAA normals file is monthly, so once pulled we have 12
data points per metric per county — enough for a proper temperature band chart with no additional
API call. The four seasonal columns are just aggregations of data already sitting there.

Worth adding later: `days_above_90f` and `days_below_32f`. Those are the numbers that actually
tell you what a summer feels like.

---

## 6. Scoring model

This is the actual product. Everything else is plumbing.

1. **Normalize every metric to a percentile rank, 0–100.** Percentile, *not* min-max — min-max gets
   destroyed by outliers (one county with a $4M median home value flattens everything else).
2. **Each metric carries a direction** — higher is better, lower is better, or **average is
   better** (added 2026-09-26). Each turns the raw percentile `p` into 0–100 points:
   `p`, `100 − p`, or `100 − 2·|p − 50|`. "Average" means the **typical (median) county**, not
   the arithmetic mean — a few 200-inch mountain counties drag mean snowfall far above what's
   typical, and working in percentiles keeps all three directions on one scale. Symmetric: a
   bit more than typical costs the same as a bit less. Every metric has a default direction;
   the person can pick any of the three per search.
3. **User input is two things:**
   - Hard filters: min/max cutoffs, boolean requirements
   - Weights: 0–5 slider per metric
4. **Score** = `Σ(weight × percentile) / Σ(weight)`
5. **Hard filters eliminate a county entirely**, rather than penalizing its score.
6. **Color ramp on score** — `d3-scale-chromatic` → `interpolateRdYlGn`. Green = strong match,
   red = weak. **Changed 2026-09-26: the map fills only the top 50 results, and the ramp spans
   those 50 relative to each other** — the best of them is fully green, the weakest fully red
   (`topRelativeScores`). Coloring every county on an absolute scale buried the differences
   that matter at the top. Absolute scores still decide *which* counties are in the top 50 and
   are what the list shows; the list's bar colors use the same relative scale so a county is
   the same color in both places. Other counties are unfilled, with faint county lines and
   state outlines for orientation.
8. **Opt-in places are removed before scoring, not after.** Filtering Alaska/Hawaii out of the
   *results* would still let them shift everyone's percentiles (Hawaii's winters are the
   warmest in the country; including it moves every other county down the warm-winter scale).
   So the toggle subsets the dataset first (`subsetDataset`), then everything is computed on
   what's left. Tested both ways against the real data.
7. **Missing data is shown as unknown, never guessed** (decided 2026-09-22):
   - A county with no value for a metric used in a **hard filter** is neither passed nor
     eliminated — it is **unknown**. On the map it renders **grey**; in the list it is marked.
   - A **toggle** shows or hides unknown results. Default: shown, so gaps are visible.
   - For **weighted** metrics, a missing value drops out of that county's weighted average
     (its weight is excluded from both sums) and the county is flagged as partially scored.
     *Proposed default — confirm while building Phase 2.*
   - No imputation. A grey county is honest; an invented number is not.

### "Why is this place here?" — no AI needed

Score decomposition beats an LLM blurb. For any county, sort its metrics by
`weight × (percentile − 50)`, take the top 3 and bottom 3. That produces:

> "94th percentile for school achievement and 88th for cost of living, but 12th percentile for
> airport access."

Deterministic, accurate, and trustworthy in a way generated text isn't.

### Climate preferences

Decided 2026-09-22. Climate doesn't fit "higher is better" — people want "not too hot, not too
cold" — and it varies by season, so **no single temperature band can apply to the whole year**,
and an annual average is meaningless for this.

**The model: describe the year by its two ends, plus how long the extremes last.**

- Across almost all of the US, temperature follows one smooth annual wave. Its **peak** and
  **trough** pin down nearly the whole curve. A ceiling on the peak and a floor on the trough
  are two independent constraints — one per end of the year — and if both hold, every month
  between them fits. That handles seasonality without a year-round band.
- **Use the hottest and coldest month, not fixed seasons.** A June–August average dilutes the
  peak, and it's the wrong window where the hottest month isn't in summer (San Francisco's
  is September). Computed from the monthly normals we already hold.
- **Count uncomfortable days.** "Days above 90°F" sums over the whole year by itself — those
  days only happen in summer, freezing nights only in winter — and it captures *duration*,
  which averages miss: two places with the same July average can have 10 or 60 days over 90.
  Fewer is better for essentially everyone, so these fit the existing direction flags.

**New ETL columns** (all from NOAA 1991–2020 station files already cached — no new source):

| Column | NOAA variable | Use |
|---|---|---|
| `hottest_month_high_f` | max of 12 `MLY-TMAX-NORMAL` | Filter: summer ceiling |
| `coldest_month_low_f` | min of 12 `MLY-TMIN-NORMAL` | Filter: winter floor |
| `days_above_90f` | Σ `MLY-TMAX-AVGNDS-GRTH090` | Rank: fewer is better |
| `nights_below_32f` | Σ `MLY-TMIN-AVGNDS-LSTH032` | Rank: fewer is better |
| `rainy_days` | Σ `MLY-PRCP-AVGNDS-GE001HI` (≥ 0.01 in) | Rank: fewer is better |
| `snow_days` | Σ `MLY-SNOW-AVGNDS-GE010TI` (≥ 1.0 in) | Rank: fewer is better |

`summer_high_f` / `winter_low_f` (3-month averages) stay in the data for display, but the
hottest/coldest-month columns replace them in the metric list the user filters on.
*Verify each NOAA variable's coverage on the first run* — threshold day-counts may be
reported by fewer stations than plain temperature, the same trap snowfall fell into.

**Typical use:** filter on hottest-month high and coldest-month low to rule out the extremes,
then rank by day-counts to reward mild places. No new scoring mode is needed.

**Considered and not chosen** (for now):
- *Comfort band* (ideal range with a soft falloff) — only meaningful per season, and the
  two-end model covers the need with existing tools.
- *Distance-from-ideal percentile* — always crowns someone, even when nothing is close.
- *Month-by-month envelope* — an acceptable range for each month, and a county's monthly curve
  must fit inside all twelve. The fullest form of the idea; pairs with **"climate like a place
  I know"** (the envelope is a chosen county's curve ± a margin). Needs monthly data in the
  browser and a chart-based control, so it lands with the Phase 6 Climate tab.
- *Köppen climate type* — cheap categorical label; Phase 6.

**Known gap: humidity.** 95°F in Phoenix and 95°F in Houston produce identical numbers here.
Dew point normals exist in PRISM (lower 48 only; Hawaii would be unknown) — Phase 5 candidate,
moved earlier if muggy heat turns out to be a dealbreaker.

---

## 7. Where AI belongs (neither is required for v1)

**Natural language → filter state.** *"Somewhere warm with good schools, houses under $400k, within
two hours of an ocean"* → a JSON object matching the filter schema. One structured-output call,
roughly $0.001 each. Best post-MVP feature; ~50 lines of code.

**Place profile summary** *(post-MVP, noted 2026-09-26).* A short good-and-bad summary for
the selected place in the detail view (§10 *Place profile content*). It has the same
hallucination risk as below, so it should summarize sourced facts we fetched, not free-write.

**One-time batch place descriptions.** Two sentences of character per county, cached as static
JSON, never regenerated. ~$10 for the whole country. **Probably skip** — hallucination risk, and
score decomposition already answers the "why" question.

**Not needed:** AI in the request path, embeddings, vector DB, RAG. The data is numeric and
structured. Think SQL, not LLM.

---

## 8. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Known quantity |
| Map | **MapLibre GL JS** — not Mapbox | Mapbox's free tier is real (50k web map loads/mo) but has **no hard spending cap**. MapLibre is the open fork, same API, zero billing surface. |
| Basemap tiles | Protomaps (`.pmtiles` on Cloudflare R2), Carto, or MapTiler free tier | Free, self-contained |
| Polygon rendering | MapLibre GeoJSON source + `setData()` on filter change, debounced ~100ms | Fine at 3,144 features. Swap to `deck.gl` `GeoJsonLayer` with `updateTriggers` on `getFillColor` if it feels sluggish. |
| Color scale | `d3-scale-chromatic` | |
| Filter state | **URL query params** | Free shareable links, back/forward, and "saved searches" with no auth and no DB |
| Shortlist | `localStorage` | |
| Hosting | Cloudflare Pages or Vercel | Static files on a CDN |
| Database | **None for v1** | If needed later: Neon (100 CU-hours + 0.5 GB free, fails soft by suspending compute). Note Supabase's free tier pauses projects after a week of inactivity, taking Auth and PostgREST down with it. |
| ETL | **Python** (`pandas` + `geopandas`) | Cuts against the JS stack, but saves days on spatial joins, projections, and centroid math. Build-time only — never touches app runtime. |
| PWA | Service worker + Serwist precache + manifest | Data is static files, so full offline support is nearly free |

### Cost

| Item | Monthly |
|---|---|
| Hosting | $0 |
| MapLibre + Protomaps basemap | $0 |
| All data sources | $0 |
| Database | $0 (there isn't one) |
| Claude API for NL search (if added) | ~$1–5 |
| Domain | ~$1 amortized |

**No server space needs to be purchased.** The entire MVP is static files on a CDN.

---

## 9. Build order

Strictly sequential. The temptation is to start with the map because it's the fun part — resist it.
The map is meaningless until the scoring works.

### Phase 1 — Prove the join ✅ **DONE 2026-09-20**
- [x] Set up ETL project (Python, `pandas`; `geopandas` not needed — haversine on Gazetteer points)
- [x] Pull Census county list — FIPS, name, state, population — as the spine
- [x] Pull ACS: median home value, median household income, median gross rent
- [x] Pull SEDA county-level achievement
- [x] Pull BEA RPP **components** (all / rents / utilities / goods / other services) + CBSA→county
      crosswalk *(expenditure weights deferred — not needed until tract recombination)*
- [x] Pull NOAA 1991–2020 monthly normals, spatial-join stations to county centroids
- [x] Compute derived columns
- [x] Write single CSV, one row per county
- [x] Sanity-check against places we know (Travis TX, San Francisco CA, Cuyahoga OH)

**The join holds.** Every future metric is one more column. See `etl/README.md` for the
run log and known gaps (CT schools, rural RPP resolution; SF climate provenance since fixed). The
"7 counties with no station" gap was 5 Alaska areas (now excluded) plus Alpine CA and
Livingston LA, both fixed 2026-09-22.

**This phase proves the hardest part of the project.** Four agencies that describe geography four
different ways, reconciled onto one spine. If the join works, every future metric is just another
column.

Known rough edges to expect:
- ~~Alaska uses boroughs and census areas~~ (Alaska now excluded); Louisiana uses parishes — has FIPS, but check it
- Connecticut reorganized its county-equivalents recently; crosswalks may be stale
- Counties with no nearby NOAA station need a fallback (nearest station, or state average)
- Keep FIPS as a string everywhere or pandas will eat the leading zeros

### Phase 2 — Scoring engine ✅ **DONE 2026-09-22**
- [x] Decide how the app loads `public/data/counties.json`. **Decided:** the ETL publishes a
      compact columnar file — `{format: "counties-columnar-v1", columns, rows}`, floats rounded
      per column (`etl/build.py`, `to_app_payload`). 2.6 MB → **704 KB, 240 KB gzipped**, so
      Serwist precaches it and the app works offline. The browser fetches it once and parses
      it with `parseCountyPayload`, which transposes it into one typed array per metric.
      `etl/data/out/counties.json` stays the readable one-object-per-county version.
- [x] **ETL fixes found in the 2026-09-22 review** — do before scoring, since they change
      percentiles:
  - [x] **Snow was null for 214 counties that had temperature data**, including snowy ones
        (Rolette ND, Beltrami MN, Price WI). Cause: stations without temperature normals were
        discarded outright, so a nearby snow-reporting station never counted. **Fixed
        2026-09-22:** stations are picked per variable group (temperature / precipitation /
        snowfall), plus a K=40 fallback search. **Snow nulls 214 → 1** (Nye County NV, shown
        as unknown). Rain and snow totals moved for most counties, since they now come from
        the nearest stations that actually measure them. The median change is under half an
        inch; the big swings are mountain and rain-shadow counties (e.g. Jefferson WA 40 → 94 in).
  - [x] **Livingston Parish, LA (pop ~150k, next to Baton Rouge) had no climate data.**
        Its 10 nearest stations were all rain gauges. Same fix. **Every county now has
        temperature and precipitation** — including Alpine County CA, previously null.
  - [x] ~~Chugach and Copper River AK have no school data.~~ Moot: Alaska is excluded.
  - [x] ~~Fallback climate source for anything still null~~ Not needed: the NOAA-only fix
        left one snow null. Options kept on file in §4 *Climate fallback sources*.
- [x] Pure TypeScript module, no UI — `src/lib/scoring/` (`metrics`, `dataset`, `percentile`,
      `score`)
- [x] Percentile normalization with direction flags. Ties share an averaged percentile, which
      matters because every county in a metro shares one cost-of-living figure. Each metric
      has a default direction, and **any metric's direction can be flipped** per search
      (someone may want hot summers).
- [x] Weighted scoring function — weights clamped to 0–5; a missing weighted metric leaves
      both sums, and the county is flagged as partially scored (`missingMetrics`)
- [x] Hard filter application — inclusive min/max; a missing value makes the county
      `unknown`, not excluded (§6 item 7); `rankCounties(..., {includeUnknown})` is the toggle
- [x] Score decomposition (top 3 / bottom 3 contributors) — `explainScore`
- [x] Unit tests asserting sane rankings against known places — `npm test`. Real-data checks:
      the SF metro is the costliest, Howard County MD top for schools and Baltimore city near
      the bottom, the top 15 warmest winters are all FL/HI, Connecticut shows as unknown for
      schools. Full re-score takes well under a frame.

**Phase 2 decisions**
- **Percentiles are national**, computed once over all counties, not over the ones left after
  filtering. Tightening a filter never changes the score of a county still on screen.
- **Direction is per search, not fixed.** Defaults: cheaper, higher income, better schools,
  milder summers, warmer winters, less rain and snow are "better". Flip any of them.
- Data finding while testing: the **Miami metro is the second-costliest in BEA 2024**
  (114.2), ahead of Los Angeles (113.6). Surprising but correct.

### Phase 3 — Ranked list view ✅ **DONE 2026-09-26**
- [x] **First: climate columns** (§6 *Climate preferences*) — `hottest_month_high_f`,
      `coldest_month_low_f`, `days_above_90f`, `nights_below_32f`, `rainy_days`, `snow_days`.
      Each day-count gets its own station selection: rainy-day counts exist at fewer stations
      than rainfall totals (3,287 vs 3,777 in a 4,000-station sample). **Coverage: every
      county, except Nye County NV for snow days.** Existing columns unchanged. Spot checks:
      Phoenix 176 days over 90°F, Seattle 187 rainy days, San Francisco's hottest month is
      September. In the metric list the hottest/coldest-month columns replace the 3-month
      summer/winter averages (those stay in the data for display).
- [x] Table of top 50 counties with score breakdown — `src/components/finder/`. Each row shows
      up to 3 strengths / 3 weaknesses; clicking opens every weighted metric's value,
      percentile, weight and effect. "Show 50 more" pages through the rest.
- [x] Weight sliders + hard filter inputs — per metric: weight 0–5, "lower/higher is better"
      toggle, optional min/max limit (placeholders show the national range in the units you
      type). "Show unknown" toggle; match / unknown / ruled-out counts. Starts from modest
      defaults (cost 3, schools 3, days above 90°F 2, nights below freezing 2); "Clear all"
      empties them.
- [x] **Measure climate where people live.** Found 2026-09-26: a county's climate was taken
      at its Gazetteer *internal point* — its geographic middle — which for big western
      counties is the wrong place. **Fixed:** new source `etl/sources/popcenter.py` (Census 2020
      centers of population); the NOAA station search starts there, falling back to the
      internal point for the 9 CT planning regions the 2020 file predates. Recorded per county
      as `climate_point`. Results:

      | County | Days > 90°F | Freezing nights | Nearest station |
      |---|---|---|---|
      | San Diego CA | 84 → 19 | 30 → 0 | 7.7 → 1.7 mi |
      | Riverside CA | 189 → 121 | 9 → 13 | 11.5 → 5.8 mi |
      | San Francisco CA | 10 → 3 | 2 → 0 | 28.8 → 0.9 mi |
      | Pima AZ (Tucson) | 82 → 160 | | |
      | King WA (Seattle) | | 67 → 29 | |

      Median county moved < 1 day; 129 counties moved > 10 days, nearly all large western
      ones. Nye NV now has snowfall, so every county has every climate column. Median
      station distance 5.9 → 4.4 mi. County level stays a starting point — one point per
      county can't describe a county that spans coast and desert; tracts will.
- [x] **"Average is better" direction** (2026-09-26) — see §6 item 2. The panel shows the
      typical county's value when it's picked ("Aiming for the typical county: 105 days");
      the breakdown shows the raw percentile, e.g. "49th · aiming for 50th". Checked in the
      browser: rainy days at weight 5 → top matches have 103–108 rainy days.
- [x] ~~Tuning pass~~ → moved to the ongoing tuning track in §12. It never really "finishes",
      and the map will make wrong-feeling rankings easier to spot.
- *(This is already a useful product. May turn out to be more useful than the map.)*

### Phase 4 — Map ✅ **DONE 2026-09-26**

**Prep done 2026-09-26** (measured, nothing committed to the app yet):
- **Boundaries:** Census cartographic boundary files, 2024 vintage —
  `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_{500k,5m,20m}.zip`
  (11.6 MB / 3.0 MB / 0.9 MB). After dropping Alaska and territories, **GEOIDs match our 3,114
  counties exactly, both directions** — including Connecticut's planning regions, so no crosswalk.
- **Size after `mapshaper` simplification** (TopoJSON, quantization 1e5, GEOID only):

  | Source | Simplify | Size | Gzipped |
  |---|---|---|---|
  | 5m | none | 1.37 MB | 419 KB |
  | 5m | 10% | 620 KB | 189 KB |
  | 500k | 5% | 748 KB | 231 KB |
  | 500k | 2% | 621 KB | 188 KB |

  Under Serwist's 2 MB per-file cap, so the boundaries precache and the choropleth works
  offline. Pick between 5m@10% and 500k@2–5% by eye (coastlines, small eastern counties) —
  similar size. **One file is enough; no second LOD** (closes the §11 question).
- **Libraries (current versions):** `maplibre-gl` 6.11, `mapshaper` 0.7.68 (build-time only,
  run with `npx`), `pmtiles` 4.5 (only if self-hosting a basemap).
- **Basemap:** OpenFreeMap (`https://tiles.openfreemap.org/styles/positron`) is live — free,
  no account, no API key, no usage cap. Needs a connection; offline, the county polygons
  still draw without the background.

**Decisions (2026-09-26):**
1. **Basemap: online map when online, county lines when offline.** OpenFreeMap (positron in
   light mode, dark in dark mode) when reachable; if it isn't, the map draws on a plain
   background with county and state lines — still fully usable. *Future:* an **optional**
   full-basemap download for complete offline use (large, so opt-in) — see §10.
2. **Layout: the map gets most of the screen.** Filters and results are two **side panels on
   the left, each collapsible independently** — show both, focus on one, or collapse both.
   A **"maximize map"** control collapses both at once. Start here and tune the UI by use;
   it is expected to change.
3. **Boundary step lives in the Python pipeline** (`etl/sources/boundaries.py`, shelling out
   to `npx mapshaper`), so the ETL stays one command. The future full-map download is a
   separate problem.

**Boundary output:** one TopoJSON with two layers sharing arcs — `counties` (GEOID) and
`states` (dissolved from STATEFP, for state outlines). From the 500k file at 5%: 813 KB,
246 KB gzipped.

**Build steps:**
- [x] Boundary step in the ETL — `etl/sources/boundaries.py`: 2024 cartographic boundaries
      (500k), AK + territories dropped with the spine's own exclusion lists, simplified to 5%
      by `npx mapshaper@0.7.68`, one TopoJSON with `counties` (GEOID) and `states` layers.
      Published as `public/data/counties.topo.json` (813 KB) beside the data.
- [x] Validate: `validate._check_boundaries` FAILs if any data county lacks a shape or any
      shape lacks data; offline tests cover both directions. Current: exact match, 3,114.
- [x] MapLibre setup — `src/components/finder/county-map.tsx`, loaded with
      `next/dynamic({ ssr: false })`. OpenFreeMap positron / dark to match the system theme;
      plain background with county + state lines when the style can't be fetched (offline).
      **Gotcha:** MapLibre 6 loads its web worker from beside its own module, which the Next
      bundler moves — the map never finished loading. Fix: `scripts/copy-maplibre-worker.mjs`
      copies the worker (+ its shared chunk) into `public/maplibre/` on `predev`/`prebuild`,
      and the map calls `setWorkerUrl()`. Git-ignored and ESLint-ignored.
- [x] Choropleth — **top 50 only, relative colors** (see §6 item 6). A top-50 county with no
      score is grey. A legend explains "weakest of these → best".
- [x] Recolor via `setFeatureState` only; geometry is uploaded once.
- [x] Click a county on the map, or a row in the list → the **same selected county**: white
      outline on the map (it pans there if off-screen) and a detail card with rank and full
      breakdown at the top of the Results panel. Hover shows name, score and rank.
- [x] Layout — header bar, then **Filters** and **Results** panels on the left, each collapsing
      to a labelled rail independently; **Maximize map** collapses both and "Show panels"
      restores them. On phones one panel at a time covers the map.
- [x] **Settings menus** (2026-09-26): a "⋯" button beside each panel title opens a small
      dropdown of toggles, keeping the panels themselves for weights and results. Filters ⋯ →
      Include Alaska / Hawaii. Results ⋯ → Show unknown. Closes on outside click, Escape (focus
      returns to the button), or tabbing away. Future toggles go in these menus.
- [x] **Alaska / Hawaii toggles** in the Filters ⋯ menu ("Include in results"), off by default.
      Checked in the browser: 3,109 counties by default, 3,114 with Hawaii, 3,144 with both;
      with warm winters as the only weight, Florida leads with Hawaii off and Honolulu, Kauai,
      Kalawao and Maui move into the top 6 with it on.
- [x] **Offline fallback checked** in a real offline browser (2026-09-26): the app loads from
      the service worker and the map draws county + state lines on a plain background. An
      unknown path such as `/foo` shows the 404 page, not the offline page. That's fine.
- [x] **Phone layout, first version, tried on a real phone (2026-09-26): rejected.** Side panels
      and vertical rails don't suit a phone. Replaced by the layout below.
- [x] **Phone layout, second version** (below `md`, 768 px), modeled on Google Maps:
      - The map fills the screen behind everything.
      - **Results are a bottom sheet** (`bottom-sheet.tsx`) that snaps to **25 / 50 / 80 /
        100%** of the area below the top bar. Drag its header (a quick flick moves one snap),
        tap the handle to step up, or use the arrow keys. Only the header drags; the list
        scrolls normally. It opens at 50%.
      - **Filters are a tab in a top bar** ("Filters · 4 weighted · 1 limit"). They open as a
        full overlay with a Done button. The page header is hidden on phones to save a row.
      - Picking a county (map or list) sets the sheet to 50% and scrolls it to the county card.
      - The map knows the sheet's height (`bottomInset`): zooms keep the county above it, and
        the legend, offline note and attribution sit just above it.
      - The desktop layout (side panels, Maximize map) is unchanged.
- [x] **Second phone layout tried on an actual phone** (2026-09-26): works well.
- [x] **Picking a county in the list always zooms to it** (fit to its bounds, max zoom 8),
      even when it is already on screen and even if it is already selected. Clicking a county
      on the map selects it without moving the map.
- [x] **The search is saved between sessions** (`localStorage`, key `nhf.preferences.v1`):
      weights, directions, limits, Show unknown, Alaska/Hawaii. Loaded through
      `sanitizePreferences`, so an old or damaged save never breaks the app (unit-tested).
      Per device and per browser. This is a **testing stopgap pulled forward from Phase 7**. The
      shareable version is still the URL (Phase 7), and accounts / saved-search lists stay out
      of v1 (§10).

**Noticed while testing (for the tuning track):**
- At national zoom the top 50 are small, scattered counties — easy to miss. Options: zoom to
  the top 50's bounds on demand, or draw a marker at each one's population center.
- Hawaii sits outside the initial view.
- Selecting a county inserts its card above the list, which shifts the list down. → Planned
  fix: the selected-result detail view (Phase 7).
- Automated browser checks run in a hidden window, where MapLibre never renders (no animation
  frames). The map itself has to be checked by eye.


### Phase 5 — Full metric set ✅ **DONE 2026-09-27**
- [x] Expand ETL: FEMA NRI, BLS unemployment, precomputed distances — **built 2026-09-27**
  (`etl/sources/nri.py`, `bls.py`, `distances.py`; all 3,144 counties join; Kalawao HI has no
  BLS series). App: "Natural hazards (FEMA)" and "Location" groups in Place, unemployment in
  People & income, and always-on Location + Natural hazards sections in the place view's
  Overview. Built as planned, with two findings: Natural Earth's coastline follows tidal
  estuaries (Potomac to DC, Delaware to Philadelphia), kept and labeled "ocean, bays, tidal
  water"; it also runs up the freshwater St. Lawrence past Montreal, cut above Quebec City.
  Validation spot-checks well-known places (New Orleans hurricane > 90, Austin → AUS < 25 mi,
  Denver > 600 mi from the coast, Miami < 15, Chicago < 15 mi from its metro center).
  counties.json 1.27 MB (~400 KB gzipped). **Plan (2026-09-27):**
  - **FEMA National Risk Index v1.20 (Dec 2025)** — `etl/sources/nri.py`, county CSV from
    OpenFEMA (`fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_Counties.zip`;
    needs a browser User-Agent, 403 otherwise). All 3,144 counties join, CT regions included.
    **Use the expected annual loss *rate* percentiles (`*_ALR_NPCTL`), not the headline
    `RISK_SCORE`**: the risk score is total dollars at risk, so it tracks county size (LA 100,
    Austin 98); the loss rate is loss per dollar of buildings/people, which is what someone
    moving there faces (New Orleans 96, Austin 21). Columns: `hazard_risk` (composite) plus
    hurricane, wildfire, inland flooding, coastal flooding, earthquake, tornado. A hazard
    FEMA rates "Not Applicable" (no coast, no hurricanes) is 0; insufficient data stays
    unknown. New "Hazards" group in Place, lower is better.
  - **BLS LAUS unemployment rate** — `etl/sources/bls.py`, latest annual average (2025; BLS
    notes 2025 is an 11-month average — October wasn't collected in the shutdown) via the BLS
    API v2 with a free `BLS_API_KEY` (63 requests of 50 series; unregistered access allows only
    25 requests/day). BLS file downloads need a contact email in the User-Agent — declined;
    USDA's republished copy stops at 2023 — declined. "People & income" group.
  - **Distances** — `etl/sources/distances.py`, from each county's population center (internal
    point for CT's 9 regions), haversine miles:
    - nearest **large US airport with scheduled service** (OurAirports `airports.csv`,
      `type=large_airport`);
    - nearest **ocean coastline** (Natural Earth 1:10m coastline, converted with the pinned
      `npx mapshaper`; Great Lakes shores are not ocean coast);
    - nearest **metro area of 500k+ people** (OMB CBSA delineation already used for BEA +
      ACS populations; distance to the metro's population-weighted center).
    New "Location" group in Place, lower is better (flip for "remote").
  - Each: validation (join rate, plausible ranges, well-known-place spot checks), offline
    tests, metric entries, formatting, and the source listed in the app header.
- [x] **Property tax rate** (2026-09-27) — county metric from ACS aggregates (B25090 ÷ B25082),
      in the Housing group. Aggregates, not medians: the median-taxes variable is top-coded.
- [x] **State laws: sourced, refreshed, displayed** (2026-09-27, `LAWS.md`). 9 laws, 456
      values from Tax Foundation, NCSL, KFF, Giffords and EIA, cross-checked against Wikipedia
      where possible; `python -m etl.laws.refresh`; monthly `.github/workflows/laws-refresh.yml`
      (starts once the repo is pushed to GitHub); "Laws & taxes" in the county card with source,
      source date and check date on every value (LAWS.md §10).
- [x] **Laws as filters** (2026-09-27). The Filters panel has two tabs, **Place** and **Laws &
      taxes**. Income and sales tax are weighted sliders in Laws & taxes; electricity sits in
      Place → Cost of living after utilities; property tax stays in Housing. Marijuana and
      abortion access are "acceptable values" checkboxes, permitless carry is Any / Permitless /
      Permit required — policies are never weighted, only rule out. Income tax structure,
      grocery tax and minimum wage are info only (county card). Engine: state-level metrics
      (`scope: "state"`) and category filters, joined from laws.json per county (LAWS.md §10).
- [x] Each new metric = one column + one slider

### Phase 6 — Place view and climate ✅ **DONE 2026-09-27**

**Decided 2026-09-27 (planning session):**

*Place view* — modeled on Google Maps' place sheet. The Results panel (desktop) / bottom sheet
(phone) has two states, **list** and **place**:
- Selecting a county (list or map) replaces the list with the place view; the map still
  highlights and zooms. **"← All results"** returns to the list at the same scroll position.
  The browser/phone **Back** gesture does the same (a history entry, not full URL state).
  Clicking another county on the map while a place is open switches to it.
- No previous/next arrows.
- **Header** (always visible): name, state, rank "#1 of 3,109", score bar, a few quick-fact
  chips. On a phone the 25% sheet shows the header; dragging up shows the tabs.
- **Tabs, not collapsible sections**; always opens on **Overview**:
  - *Overview* — why it ranks here (strengths/weaknesses), then **how it does on your
    filters**: each weighted metric's value, percentile and effect; each limit and policy
    filter as pass / fail / unknown. Filter *controls* stay in the Filters panel.
  - *Climate* — see below.
  - *Laws & taxes* — the existing section.
  - Later: Photos, Things to do, … (the place profile, §10) as more tabs.

*Climate tab:*
- Monthly chart: low–high temperature range, precipitation amount, snowfall amount, and
  **rainy-day and snowy-day counts** per month — all in the first version.
- **Compare with a county you pick**: overlay a second county's curves (a "Compare with…"
  picker). No national-typical line.
- Key numbers: hottest month high, coldest month low, days > 90°F, nights < 32°F, rainy
  days, snowy days. Source line: NOAA 1991–2020 normals + distance to the nearest station;
  caution past ~25 mi.
- Hand-built SVG (no chart library); must fit a 360 px phone.

*Data:* the ETL publishes `public/data/climate.json` — all counties, 12 months × 8 measures
(tmax, tmin, precip, snow, days > 90, nights < 32, rainy days, snow days), 1 decimal. Measured
1.36 MB raw / 359 KB gzipped: under the 2 MB precache cap, so it works offline. Loaded on
first place view, not at startup. One file, not per state, because the envelope filter and
"climate like a place I know" need every county's curve.

**Build order:**
- [x] ETL: publish `climate.json` (+ validation, offline tests) — 2026-09-27. `etl/climate.py`;
      3,140 counties × 12 months × 8 measures, 1.36 MB / ~370 KB gzipped, precached (total
      precache now 5.9 MB). `validate` checks the monthly data reproduces the annual columns
      (it does, for every county).
- [x] Place view: list ↔ place states, header, tabs, "← All results" with scroll restore,
      Back gesture, phone sheet behavior — 2026-09-27 (`place-view.tsx`). The list stays
      mounted while a place is open, so its scroll position survives; each opening pushes one
      history entry, so Back / Escape return to the list. On phones the place identity is the
      sheet's drag header. Tabs so far: Overview (today's reasons + breakdown, reworked in the
      next step) and Laws & taxes; Climate joins with its step. Replaces the old county card.
- [x] Overview tab: reasons + per-filter pass/fail/unknown + weighted breakdown — 2026-09-27
      (`place-overview.tsx`): a status line (passes all / ruled out / unknown), "Why it ranks
      here", "Your filters" (✓/✕/? with your rule in words and the county's value, limits and
      policies alike), and "How it's scored" as rows with a 0–100 points bar, percentile,
      direction, weight and effect. Rows, not a table, so it fits a phone.
- [x] Climate tab: monthly chart, key numbers, source; compare-with overlay — 2026-09-27
      (`climate-tab.tsx`, `month-chart.tsx`, `src/lib/climate`). Seven one-measure charts on a
      shared month axis (no dual axes): temperature range, precipitation, rainy days, snowfall,
      snowy days, days > 90°F, nights < 32°F — a chart is dropped when both counties are zero
      all year ("None all year: …"). Eight key-number tiles (from the same months; tested to
      match the county columns). Hover/tap/arrow keys read a month; a Chart / Table switch gives
      the full table. "Compare with…" search picks a second county (orange vs blue, palette
      validated light and dark), remembered across places and sessions. Source line: NOAA
      normals + nearest-station distance, with a caution past 25 mi. climate.json is loaded on
      first use of the tab and now also carries station distances (1.40 MB).
- [x] Köppen climate type as a label and filter — 2026-09-27. The ETL computes it per county
      from the monthly normals with the Peel, Finlayson & McMahon (2007) rules (`etl/climate.py`
      `koppen()`; E checked before B so dry Arctic Alaska is tundra), publishes a `koppen`
      column, and FAILs on an unnamed type, a climate county without a type, or a wrong
      well-known place (Austin Cfa, Phoenix BWh, Seattle Csb, Minneapolis Dfa, Denver BSk).
      App: a county-level category filter "Climate type (Köppen)" in Place → Climate
      (checkboxes of the types that exist, with county counts), a header chip, and a line at
      the top of the Climate tab with a borderline-county caveat. Mix (50 states + DC): Cfa
      1,394 · Dfa 801 · Dfb 472 · BSk 209 · others < 70 each.
- [x] ~~Add `days_above_90f` / `days_below_32f`~~ Moved to Phase 3 (§6 *Climate preferences*)
- [x] ~~Month-by-month climate envelope~~ and ~~"Climate like a place I know"~~ — moved to §10
      *Explicitly deferred* on 2026-09-27 when Phase 6 closed; the Climate tab's compare overlay
      covers the everyday need.

### Phase 7 — Polish *(always last)* ✅ **MVP SHIPPED 2026-09-30** at www.lodestarmap.com (open: real-phone pass, shortlist)

**7a — UI reorganization (decided 2026-09-28; features paused until it's done).** The app feels
jumbled and cramped: filters, results and place details all squeeze into ~350 px panels, setting
up a search (occasional) competes with browsing (constant) for the same space, explanations sit
in the reading path at 11 px, and settings hide in two "⋯" menus. On phones, scrolling the
filter list moves any slider the finger lands on.

Decisions:
- **Filters leave the side panel for a large modal** — centered over a dimmed map on desktop,
  full-screen on phones — opened from a **Filters** button (with an active-count badge) in the
  top bar. Category rail on the left, cards on the right, a live "N counties match" count and
  **Show N** / Reset in the footer. Changes apply live.
- **Priorities vs Must-haves.** *Priorities* = what to rank by: per metric, importance and
  "lower / average / higher is better". *Must-haves* = what to rule out: min/max limits,
  policies, climate types. Active filters show as removable **chips** above the results.
- **Importance is six tap targets — Off 1 2 3 4 5 — not a slider.** Exact, and a scrolling
  finger can't change it (nothing drags).
- **Settings screen** (gear in the top bar): include Alaska / Hawaii, show unknown counties,
  default compare county, theme (system / light / dark), and **About the data** — every
  source with its date and method, plus the laws disclaimer. Replaces the "⋯" menus.
- **Breathing room.** One small type scale (12 caption / 14 secondary / 16 body / 18–20
  headings) instead of today's 10/11/12 px mix; more padding between sections; **"i" icons**
  that open a short popover for explanations (how it's scored, FEMA, NOAA, law notes) instead
  of paragraphs in the reading path. Place view key numbers as a stat grid. Results rows
  taller, two reason chips instead of four.
- **Layout.** Desktop: top bar (name · Filters · chips · gear), one wider (~440 px) results /
  place panel, map fills the rest. Phone: top bar (Filters · gear) and the existing bottom
  sheet.

Build order:
- [x] Foundations: type scale and spacing tokens; an `InfoTip` popover; a `Modal` (focus
      trap, Escape, scroll lock, full-screen on phones) — *done 2026-09-28.* Tokens are
      `text-caption/label/body/title/heading` and `gutter/stack/section` spacing in
      `globals.css`; `src/components/ui/` holds `Modal` (native `<dialog>` + `showModal()`)
      and `InfoTip` (native Popover API, top layer, closes on scroll).
- [x] Filters modal: Priorities / Must-haves, Off–5 importance, live count; remove the Filters
      side panel; Filters button + badge in the top bar (desktop and phone) — *done
      2026-09-28* (`filters-modal.tsx`). The rail switches sections (one at a time) rather
      than scroll-spying; "Better" appears only once a metric has importance; state-level
      source lines moved into "i" tips. The desktop header moved from `page.tsx` into the
      finder. Alaska / Hawaii sit in the Results "⋯" menu until the Settings step.
- [ ] ~~Active-filter chips above the results~~ — *skipped for now (2026-09-28, user call):*
      the Filters badge and the per-section counts in the modal cover it. Revisit if the
      search gets hard to read at a glance.
- [x] Settings screen + About the data + theme switch; remove the "⋯" menus — *done
      2026-09-28* (`settings-modal.tsx`, `data-sources.tsx`, `src/components/ui/theme.ts`).
      The theme is `<html data-theme>`, set before paint by an inline script and read by
      Tailwind's `dark:` variant; the choice is per device (localStorage). The map rebuilds on
      a theme switch and keeps its view. **Guiding rule (user, 2026-09-28): the ranked list,
      map and place view are the main UI; settings, explanations and sources stay one tap
      away, not in view.**
- [x] Place view and results list: spacing and type pass, stat grid, "i" icons — *done
      2026-09-28.* Place tabs split the panel width evenly; quick facts are a stat grid;
      explanations (scoring, location, FEMA, Köppen) moved into "i" tips; result rows show
      two reason chips. Laws tab: a **Sources** list, and each value's source, notes and quote
      in its "i" (LAWS.md §10 updated). Dark basemap: labels, roads, water and borders lifted
      for contrast (`DARK_OVERRIDES` in `county-map.tsx`); county fills now sit above roads
      and below labels.
- [x] Climate type as family cards (2026-09-30, see changelog). Possible follow-up: a tiny US
      map on each card with that family's counties shaded, if the cards still feel abstract.
- [x] Desktop layout: wider single panel, header cleanup — *done 2026-09-28:* 440 px results
      panel; header is name · Filters · gear. The "Maximize map" button is gone (the panel's
      own collapse does it).
- [ ] Phone pass and a light-mode check by eye — layouts checked in a 390 px frame and light
      mode on desktop 2026-09-28; the light map after a theme switch confirmed 2026-09-30.
      **Still wants a real-phone pass.**

**7b — paused features** (from the original list):
- [x] **"New version available" prompt.** — *done 2026-09-30* (`pwa-provider.tsx`): a notice
      with Reload when a new worker takes over (Serwist `controlling` + `isUpdate`), plus an
      update check when the app returns to the foreground, at most hourly. Tested across two
      production builds. After a deploy, the first visit shows the previously
      cached version while the new service worker installs in the background; the update
      appears on the next load. Standard PWA behaviour, but confusing — show a small
      "Update available — reload" notice when a new worker is waiting.
- [x] ~~Selected-result detail view~~ Moved to Phase 6 as the **place view** (2026-09-27) —
      the climate section needs it.
- [x] URL-encoded filter state — *done 2026-09-30.* Readable query params, live in the
      address bar (debounced `replaceState`), plus the open county (`place=`), which opens and
      zooms on arrival. Copy link button. The URL wins over the saved search; the replaced
      search is kept in Recent.
- [x] Saved and recent searches (2026-09-30) — a **Saved** button inside the Filters modal,
      beside the tabs (user call, after trying a header "Searches" button and a third tab). Stored as the same query strings.
- [x] PWA shell + service worker
- [ ] `localStorage` shortlist

> **Sequencing note:** the strict ordering above matters for Phases 1–4, where each phase depends
> on the last. The Climate tab does not — its data lands in the Phase 1 pull, so it can slot in
> any time after Phase 3. **Polish stays last** (decided 2026-09-22): new features and data go
> in before finishing touches.

### Phase 8 — Inside the county (census tracts) ⬅️ **NEXT** (planned 2026-09-30)

**Why.** Counties proved the idea, but a county is not where you live. Travis County, TX is
the owner's example: the east side is near the airport; the west side (Westlake, Lake Travis)
has much stronger schools and higher home values; central Travis is downtown Austin — high
incomes, high-rise condos, walkable city life; south Austin is suburban and family-oriented.
One county row averages all of that away.

**Decision: a drill-down, not a new map of the whole country.**
1. **Stage 1 (today):** rank counties. Filters that don't vary inside a county (state laws and
   taxes, climate, metro prices for goods and services) do their work here.
2. **Stage 2 (new):** open a county → **"Explore inside"** loads that county's **census
   tracts** (~1,200–8,000 people each; ~290 in Travis) and ranks *areas* with the same
   priorities. The map switches to tract shapes inside the county; the list shows areas; each
   area has a place view like a county's.

**Why tracts.** They are the smallest unit with the full ACS (income, home value, rent,
housing type, commute, households with children) and FEMA hazard data, and they're stable
(2020 vintage). In a city a tract is roughly a neighborhood; in the country it can be the
whole county, which is fine — there's nothing finer to distinguish there. (§3 has the full
geography table; block groups are too noisy, parcels need paid data.)

**Architecture: per-county files, loaded on demand.** The ETL writes one small file per
county: `public/data/tracts/{fips}.json` (metrics) + `{fips}.topo.json` (shapes). Travis is
~290 rows — tens of KB — so the browser scores it instantly with the existing engine. Only
the counties someone opens are fetched (and cached by the service worker for offline). This
replaces the earlier idea of national vector tiles (§3), which was for a nationwide tract
map this design doesn't need. **Measure total size in 8c** (~85k tracts across ~3,100
counties); if the repo or deploy gets heavy, move the files to object storage (R2).

**Scoring inside a county.** Percentiles against **all US tracts** (so "strong schools" means
strong nationally), using precomputed national breakpoints per metric (a small file of
quantiles) rather than loading 85k rows. The map colors areas **relative to each other within
the county**, like today's top-50 coloring. Filters that are constant within the county are
shown as "applies to the whole county" and don't affect area ranking.

#### What varies inside a county, and where it comes from

| What | Source (free) | Unit | Notes |
|---|---|---|---|
| Home value, rent, income, price/rent to income | Census ACS 5-year | Tract | B25077, B25064, B19013. Margins of error grow in small tracts: flag low-confidence values. |
| **Cost of living, housing part** | ACS tract rent + BEA metro components | Tract | The §4 recombination: keep metro goods/utilities/services, swap in tract rent. Already designed for this. |
| **Housing style / urban form** | ACS | Tract | Share of units in 20+ unit buildings (high-rise), single-family detached share, owner vs renter, median year built, population density. |
| **Walkability** | EPA National Walkability Index (2021) | Block group → tract | 2019 block groups: needs a crosswalk to 2020 tracts (Census relationship files), population-weighted. |
| **Family orientation** | ACS | Tract | Households with children under 18, median age. |
| Commute | ACS | Tract | Mean travel time to work, share working from home. |
| **Schools (primary)** | NCES school district boundaries + SEDA district scores | District → tract | Districts split counties — exactly the east/west Travis story (Austin, Eanes, Lake Travis, Manor, Del Valle, Pflugerville ISDs…). Boundaries are official and current. |
| Schools (detail) | NCES school locations + SEDA school-level scores | School | "Schools near this area" list with scores. **Not** attendance zones: the only national zone data (NCES SABS) stopped in 2015-16 and was experimental, so we never claim which school a street is zoned to. Check each SEDA file's latest school year. |
| | | | **Show both comparisons (owner, 2026-09-30):** where a school or district ranks **nationally** (percentile) *and* **within the county** (e.g. "Top 12% nationally · 3rd of 41 elementary schools in Travis County"). |
| **Housing market** | Redfin Data Center; Zillow Research | ZIP / neighborhood / city | Median sale price, days on market, inventory, sale-to-list (Redfin); home values and rents (Zillow ZHVI / ZORI). Free downloads, attribution required. ZIP → tract via ZCTA crosswalk. **Not MLS** (see below). |
| **Distances** (airport, metro center, coast) | Census 2020 **tract** population centers + existing distance code | Tract | Same method as counties, from where people in the tract live. Add "distance to downtown" (the metro's principal city). |
| Natural hazards | FEMA National Risk Index | Tract | NRI publishes tracts; same metrics as the county view. |
| Health (optional) | CDC PLACES | Tract | Later, if wanted. |
| Current home values (optional) | Zillow ZHVI | ZIP / neighborhood | Fresher than ACS (which lags 2–5 years). Free with attribution. ZIP → tract via ZCTA crosswalk. |
| Climate | NOAA (existing) | County | Stays county-level; differences within a county are small except in mountains. |
| **Crime** | FBI Crime Data Explorer (bulk NIBRS file per state and year) | Police agency → jurisdiction | Reported by **agency**, not by neighborhood: a city's police department covers the city; the sheriff covers unincorporated areas. So a tract gets its **jurisdiction's** rate (Austin PD vs Travis County Sheriff vs Pflugerville PD vs West Lake Hills PD). Coarser than tracts but still inside the county. Caveats: data lags 1–2 years; some agencies report partial years or not at all (→ low confidence); rates use the FBI's population served. No key needed: the bulk files replaced the API in 8c (the API's 1,000/hour quota and 503s made a national run take days). Map agencies (ORI) to Census places by name + state; skip campus and transit agencies. |

**Why not MLS (asked 2026-09-30).** MLS data isn't a public database: there are hundreds of
regional MLSs, each with its own rules, and access requires a licensed agent or broker to sign
a data license (IDX/VOW, usually through a vendor on the RESO Web API) that forbids
republishing the data outside approved uses. A free public app can't use it. Redfin and
Zillow publish free aggregates from the same market activity, which is what this app needs.

#### Low confidence (decided 2026-09-30)
A small **yellow caution icon** next to an area, in the list and its detail view. Hover (tap on
phones) shows **"Low confidence"** and lists each affected value and why, e.g. "Median home
value: Census margin of error ±38%", "Crime: agency reported 7 of 12 months". Same pattern as
the laws' confidence badges. Thresholds are set in 8a (a starting point: the Census Bureau
treats a coefficient of variation above ~30–40% as unreliable).

#### Naming and grouping areas (owner feedback 2026-09-30)
Compass regions ("North Austin", "West Austin") mislabel counties whose big city isn't in the
middle: Pflugerville, Lakeway and Lago Vista are their own places. **Areas are named and
grouped by real places**, which the data already carries per tract:
**County → city, town or community (Census place) → neighborhood (Zillow) → area (tract)**.
Travis County, for example, reads as Austin (203 areas, 115 in named neighborhoods),
Pflugerville, Steiner Ranch, Lakeway, Lago Vista, West Lake Hills, Bee Cave… plus
unincorporated areas. The place level doubles as the "middle level" for very large counties
(open question below). **To do:** name unincorporated areas outside any community by the
nearest place, e.g. "Unincorporated, near Manor · 78653" (42 of Travis's 290 areas).

#### Naming areas (tracts are only numbers)
Label each tract with names people know: its **city or town** (Census places), a
**neighborhood** name where one exists (Zillow's 2017 neighborhood boundaries, ~17,000
neighborhoods in ~650 cities, Creative Commons — verify the exact license; Who's On First as a
fallback), and its **ZIP**. For example "Westlake Hills · 78746", "Govalle, East Austin · 78702".

#### Build order (strict, like Phases 1–4)
- [x] **8a — Prove it on Travis County.** Tract ETL for one county, end to end: 2020 tract
      spine, ACS metrics, tract population centers and distances, NRI, district assignment +
      SEDA scores, walkability crosswalk, names. **Check against what the owner knows**:
      east vs west schools and home values, downtown incomes and high-rise share, south Austin
      households with children. If the data doesn't tell that story, stop and fix it before
      building UI. Add two contrasting counties (a rural one, and one big city, e.g. Cook, IL).
      **Progress 2026-09-30 (`etl/tracts/`, `python -m etl.tracts.build --pilot`):**
      - [x] Tract shapes (2024 cartographic, via mapshaper), 2020 tract population centers,
            distances (airport, 500k+ metro center, coast) from where people live.
      - [x] ACS tract metrics **with margins of error**: home value, household and
            per-person income, rent, high-rise and single-family share, owner share,
            households with kids, median age, bachelor's+, work from home, commute, year
            built, density. Low-confidence flags per value (CV > 40%, share MOE > 15 pts).
      - [x] FEMA NRI hazards by tract (national 635 MB table, read in chunks).
      - [x] All three pilots build: Travis 290 tracts, Cook 1,331, Zavala 4. Travis
            shapes 57 KB, Cook 228 KB (simplified TopoJSON).
      - [x] **Story check, Travis** (`python -m etl.tracts.report 48453`), population-
            weighted medians by region around City Hall: East is nearest the airport (7 mi
            vs 14 west) with the lowest home values ($318k vs $667k west); West has the
            highest household income ($146k) and bachelor's share (74%); Downtown has the
            highest home values ($751k), per-person income ($80k), high-rise share (60%) and
            density, the shortest commutes and the fewest kids (7%). **Matches the owner's
            description**, except "south = family-oriented": households with kids are 26%
            south vs 30–39% elsewhere. Compass regions are crude (78704 and Circle C are both
            "south"); revisit with neighborhood names.
      - Findings: household income understates downtown earnings (one-person households),
        so **per-person income** was added. The "metro center" distance is the metro's
        population center, 4.5 mi from downtown Austin: **a real downtown distance is
        needed** (principal-city center or a curated point). Low confidence is common at
        tract level (33% of Travis tracts have some flagged value; ~7% on a headline
        value), so the list's caution icon should probably consider headline values only
        (decide in 8b).
      - [x] **Schools** (`schools.py`): district from Census 2019 elementary/unified
            boundaries (what SEDA's geographic districts use) + SEDA 6.0 geodist scores,
            national percentile and rank in county; scored schools within 5 mi (NCES
            2023–24 locations + SEDA school scores, national percentile by level and rank in
            county). Travis: Eanes ISD 98th pctl (1 of 11), Lake Travis 96th, Manor 13th,
            Del Valle 11th. **One-district cities can't be split by district** (Chicago
            Public Schools: every Chicago tract 16th), so a `nearby_school_pctl` (mean of
            the nearby schools) was added: Chicago north 66 vs south 27; Travis west 92 vs
            east 28. **SEDA covers grades 3–8: high schools have no score** (say so in UI).
      - [x] **Downtown** (`geo.downtown`): each metro's densest job cluster (Census LODES
            2023 jobs within 1 mi), not a hand-picked point. Austin → Congress & 6th
            (131k jobs), Chicago → the Loop (687k), rural Zavala → downtown San Antonio
            (nearest 500k+ metro). `dist_downtown_mi` per tract.
      - [x] **Walkability** (`walkability.py`): EPA index (2010 block groups → 2010 tracts
            by population → 2020 tracts by land area, Census relationship file). Downtown
            Austin 16.2 ("most walkable"), east/west 8.3–8.4. Adds `pyogrio` (reads the
            geodatabase; bundles GDAL).
      - [x] **Names** (`names.py`): Zillow 2017 neighborhood (CC0 via EPA/data.gov), Census
            place, main ZIP → labels like "Zilker, Austin · 78704", "Unincorporated Travis
            County · 78738". Settled "south = family": 78704 has 15% households with kids,
            Circle C (78739) 54%. The compass regions had lumped them together.
      - [x] **Crime** (`crime.py`): FBI CDE 2025 (all Travis agencies reported 12 months),
            city PD inside its city, sheriff elsewhere. **Separates jurisdictions only**:
            all of Austin shows Austin PD's rate (422 violent /100k). Tiny towns with a
            mall distort rates (Sunset Valley, ~700 people: 33,113 property /100k), so
            agencies under 5,000 people are low confidence. Option for 8d: cities' own
            incident-level open data (Austin and Chicago publish it).
      - [x] **Market** (`market.py`): Zillow ZHVI/ZORI by ZIP (Aug 2026) + Redfin latest
            90-day period by ZIP (to May 2026; 1.5 GB tracker streamed once, cached).
            Zillow's typical value can differ a lot from Census (downtown Austin $548k vs
            $751k: condos, ZIP-level, newer): show both, labeled. Sale price from <10 sales
            is low confidence.
      - Pilot output: Travis 290 tracts × 78 columns; Cook 1,331; Zavala 4 (no market
        data, all low confidence — expected for a small rural county). Low confidence:
        101 of 290 Travis tracts have some flagged value.
      - **8a is done pending the owner's review of the report.** Next: 8b (show it).

- [ ] **Data hosting (decide before 8b ships; build 8b locally first).** Measured
      2026-09-30 on the pilots, projected to ~85,000 tracts: ~85 MB of per-county files
      (~25 MB compressed; Travis ≈ 67 KB), about 9,300 files. Raw inputs are several GB
      and stay on the ETL machine. **Proposal: Cloudflare R2** (object storage, S3-
      compatible, no download fees; free tier 10 GB stored and 10M reads/month) behind
      `data.lodestarmap.com`, files under a versioned prefix with a `manifest.json`, uploaded
      by an ETL publish step. The app reads a base URL (`NEXT_PUBLIC_DATA_URL`), which in
      local development points at `public/data/tracts/` (git-ignored). Keeps §2: static
      files, scoring in the browser, no database server. Alternatives considered: Vercel
      Blob (simplest, but download bandwidth is billed), Supabase/Postgres (a real database
      and API the app doesn't need), a separate GitHub data repo through a CDN (free but
      history grows with every refresh).
- [ ] **8b — Show it: drill-down UI on the pilot counties, display first.** "Explore inside"
      in the county view; tract map inside the county, area list, area place view ("applies
      to the whole county" facts, schools nearby with both rankings, distances, crime by
      jurisdiction, housing market, low-confidence icon). **No filters inside the county
      yet** (owner, 2026-09-30): get the data on screen, look at it, then decide.
      Try a few ways of handling very large counties here (see open questions). URLs:
      `place=` accepts an 11-digit tract ID.
      **Progress 2026-10-01 (local only; data hosting on R2 later, owner's call):**
      - [x] ETL publish step (`python -m etl.tracts.publish`) → `public/data/tracts/`
            (git-ignored): `{fips}.json` (columnar, schools inline), `{fips}.topo.json`,
            `index.json`. Never precached by the service worker (runtime-cached per county).
            Unincorporated areas are named after the nearest place ("Near Manor · 78653").
      - [x] App: `src/lib/tracts/` (parser, measures, formatting, tests);
            `use-tract-data.ts` (base URL `NEXT_PUBLIC_DATA_URL`, default `/data`).
      - [x] County view: **"Explore inside {county}"** button when the county has area data.
      - [x] Inside view: areas grouped by city / town / community, sorted by a chosen
            measure ("Color the map by"; default Census home value, which varies per area —
            Zillow is per ZIP), rows named by neighborhood or ZIP, **yellow caution icon**
            on headline low-confidence values (hover/tap lists them). Area detail: stats,
            schools (district national pctl + rank in county; nearby schools with both),
            homes and people, getting around, safety (by police jurisdiction), housing
            market (by ZIP), hazards; every flagged value marked.
      - [x] Map: area shapes over the county, viridis colors by position within the county,
            hover label, click to select, outline, zoom to county / area, legend.
      - [x] Share links: `place=` takes an 11-digit tract (opens the county, inside, with
            the area); Escape steps back area → areas → county → list.
      - [ ] **Map not yet seen rendering.** The automated browser runs in a hidden window
            (MapLibre pauses) and headless Chrome won't render the map; the panel, data,
            URL and console are verified. Owner to check by eye.
      - Dev aid: `window.__lodestarMap` in development builds only.
      - [x] **High schools (owner, 2026-10-01).** SEDA has no grades 9–12, and federal
            school-level state test and graduation files stop at 2020–21 in ED Data Express
            (its 2022–23 graduation file is state-level only), so high schools come from the
            **Civil Rights Data Collection 2023–24** (civilrightsdata.ed.gov, ~100 MB,
            fetched by the ETL): AP courses, AP participation, dual enrollment, IB,
            enrollment. Ranked by **college-prep access** = mean of national percentiles for
            AP participation and AP courses (participation alone put KIPP charters, which
            enroll ~everyone in AP, above LASA and Westlake). CRDC codes a school without AP
            as -9, not "No" (31% of 18,885 high schools). Travis top 5: Westlake, LASA,
            McNeil, Vandegrift, Lake Travis. Each area lists its 2 nearest high schools; new
            measure "Nearby high schools". Comparable nationally, but it measures access to
            college-prep courses, not test results — say so in the "i".
      - [x] **Nearby schools cross county lines** (found via Leander, whose high schools are
            in Williamson County): the nearest schools within 15 mi (5 mi missed rural schools; 8c); county ranks only among the
            county's own schools; others shown as "in Williamson County".
      - State test scores and graduation rates for high schools: revisit if ED Data Express
        publishes school-level files after 2020–21.
- [ ] **8c — All counties.** Run the tract ETL nationwide, measure file sizes, decide on
      hosting (repo vs R2). Precompute national tract percentile breakpoints.
      - [x] **Restructure for scale.** National and per-state sources load once per run
            (cached in memory and `data/interim/`); `build --state ST` builds every county,
            resumes (skips built ones unless `--force`), records failures instead of
            stopping, and writes `_coverage_{ST}.csv` (share of populated tracts with each
            measure) — the check that replaces eyeballing 3,000 counties.
      - [x] **Texas rehearsal** (2026-10-01): 254 counties, 6,884 tracts, ~5 min, 0 failures.
            Coverage of populated tracts: income, district, walkability, hazards, downtown,
            names 100%; elementary/middle schools 99.9%; high schools 99.8%; crime 99.6%;
            Zillow 98.8%; Census home value 95.1%; Redfin 91.6% (thin in rural counties);
            inside a named place 75.4%. ~39% of tracts carry at least one low-confidence
            flag (mostly small-sample ACS shares). Published size 9.7 MB for Texas → roughly
            100–150 MB nationally: R2, as proposed.
      - [x] **Fixes from the rehearsal.** Downtowns: a metro's major principal cities (≥30% of
            its largest city's population) each get a downtown (densest 1-mile job cluster
            within 5 mi of the city's GeoNames point); a tract measures to the nearest one
            (Fort Worth was measured to Dallas). Schools: 15-mile radius (rural coverage 94.7%
            → 99.9%). K-12 campuses: elementary and high-school entries get separate keys.
            CRDC schools answering `-9` to the AP question count as no AP.
      - [x] **Crime at scale: bulk files.** The CDE API (2–4 calls per agency, 1,000/hour,
            frequent 503s) would take days. CDE's "Crime Incident-Based Data by State" zip
            (`nibrs/incident/{year}/{ST}-{year}.zip` via its signed-URL endpoint) has every
            agency, its population, counties and reported months. Violent crime counts one per
            victim (robbery one per offense), property crime one per offense — matching the
            API on 64 Texas agencies (median ratio 1.00). Each state-year is reduced to one row
            per agency in `data/interim/crime/`. Texas: 2 downloads, 15 s. Agencies that report
            only the old summary format aren't in these files (their tracts: no rate, low
            confidence). 95% of Texas tracts have a full-year, ≥5k-population rate.
      - [ ] Small UI notes from the rehearsal: tied county ranks (Dawson County: four high
            schools without AP all "1st of 4"); 12 counties have one ACS/walkability tract not
            in the shapes (water tracts, harmless).
      - [x] **R2 hosting first** (owner, 2026-10-01): move the tract files to Cloudflare R2
            and ship to production with what's built (Texas + Cook County), then run the
            rest of the country.
            - [x] `python -m etl.tracts.upload` syncs `public/data/tracts/` to the bucket under
                  `tracts/` (changed files only, by MD5; `index.json` last); `--cors` lets the
                  app's origins read it. Credentials `R2_*` in `etl/.env`.
            - [x] Domain: **data.lodestarmap.com** as an R2 custom domain, which needs the
                  domain's DNS on Cloudflare (owner chose to move it from Namecheap,
                  2026-10-01; the registration stays at Namecheap). Namecheap's email
                  forwarding stops with the move: use Cloudflare Email Routing if it's needed.
            - [x] Vercel: `NEXT_PUBLIC_DATA_URL=https://data.lodestarmap.com` (inlined at build
                  time, so set it before the deploy), then push main.
            - [x] Uploaded Texas + Cook County (511 files, 9 MB), deployed 2026-10-02.
            - [x] Bucket CORS rule (GET/HEAD from www.lodestarmap.com, lodestarmap.com,
                  localhost:3000), set in the dashboard (the object token can't). Explore
                  inside works in production (checked on Tarrant County, 2026-10-02).
            - [x] Apex and www set to DNS only (Vercel's advice); `data` stays proxied (R2).
      - [ ] **Automatic refresh** (owner, 2026-10-02: solve data hosting and refreshing
            completely before the national run).
            - [x] Repo holds no tract data (`public/data/tracts/` was always ignored). The
                  20 MB SEDA county file left git; all manual downloads (SEDA county,
                  geodist, school) live in a **private** R2 bucket (`R2_INPUTS_BUCKET`;
                  the public one would expose them) — `python -m etl.inputs push|pull|status`.
                  Still in git, deliberately: `counties.json`, `counties.topo.json`,
                  `climate.json`, `laws.json` (~3.7 MB): they ship with the app and are
                  precached, and the laws workflow's commits are the audit trail of every
                  law value (LAWS.md §8). The SEDA file stays in old history (rewriting
                  it means a force push — not done).
            - [x] `.github/workflows/tracts-refresh.yml`: monthly (3rd, 06:23 UTC) and by
                  hand (`states`: `all`, or `RI` to test). Clean runner → manual inputs from
                  R2 → `build --state all` (makes the county tables it needs: spine,
                  popcenter, county ACS) → `tracts.check` quality gate → merge with the live
                  index → publish → upload changed files. A failed gate uploads nothing; a
                  failed county keeps its old files.
            - [x] Quality gate (`etl/tracts/check.py`): fails on more than 1% failed
                  counties (min 3) or a core measure under its national floor (income,
                  walkability, hazards, downtown 95%; districts, schools, high schools 90%;
                  home value 85%; crime 70%; names 99%); per-state lows are warnings.
            - [x] Crime year automatic: the newest year CDE has published per state
                  (`CRIME_YEAR` pins it). Other vintages (ACS year, CRDC, LODES, TIGER) stay
                  manual in `config.py` — a yearly look, since their variables can change.
            - [x] Clean-machine test (2026-10-02): a copy holding only what git has, Python
                  3.12 (CI's), no caches — Rhode Island built end to end in 5 min with 2.9 GB of
                  downloads. The gate **failed it** (crime 57%), which found a real gap:
            - [x] **Town police.** New England towns and NJ/PA/Midwest townships run police
                  departments but aren't Census places, so their tracts fell to a sheriff (RI
                  has none). A tract outside a policed place now matches its county
                  subdivision — only those that are governments (TIGER `FUNCSTAT` A; Texas's
                  CCDs are statistical and would hand unincorporated land to city police).
                  Names compare without "Township", "Borough"… RI crime 57% → 99.2%; Texas
                  unchanged (0 town matches, 99.6%).
            - [ ] Owner: create the private bucket, give the token access to both, add the
                  Actions secrets; `python -m etl.inputs push`; run the workflow with `RI`.
            - The laws workflow needs no change: laws live in git, not R2.
      - [ ] **State by state, not all at once** (owner, 2026-10-02): add states one at a
            time, fix what each one reveals, and run the rest together only once confident.
            The monthly schedule rebuilds exactly the live counties (`--state published`);
            a new state is built deliberately (locally, or the workflow with `states: CA`).
            - [x] **California** (2026-10-02): 58 counties, 9,109 tracts, 2 min, 0 failures.
                  Coverage: crime 100%, schools 99.9%, high schools 99.5%, home value 96.6%,
                  Redfin 98.7%, inside a place 93%. What it found:
                  - The 2024 NIBRS file isn't UTF-8 (cp1252): every county failed until the
                    reader fell back — one bad state file fails a whole state, and the gate
                    would have stopped it.
                  - Crime 82% at first: SFPD and the LA, Riverside and San Bernardino sheriffs
                    still report the summary format, absent from NIBRS files. Filled from the
                    FBI's yearly tables (CIUS Table 8 cities with population, Table 10
                    sheriffs without — a sheriff's population is the tracts it serves: LA
                    1.03M, Riverside 437k, San Bernardino 342k, matching their unincorporated
                    populations). Statewide tables match by name only, so only incorporated
                    cities (place `FUNCSTAT` A) and real towns use them (Riverside County's
                    El Cerrito CDP had matched the Bay Area city).
                  - Contract cities (Santa Clarita, Compton…) are sheriff-patrolled but
                    reported under their own name: the label is now the jurisdiction
                    ("Reported for Santa Clarita"), not "… Police".
                  - **Published 2026-10-02** (`upload --state CA`: only that state's files and
                    the index, merged into the live one — never overwriting what CI published).
                    313 counties live. Los Angeles is the largest file so far (2 MB).
                  - The county index is now network-first in the service worker: with
                    stale-while-revalidate a returning visitor saw a new state only on the
                    second visit.
            - [x] **New York** (2026-10-02, published): 62 counties, ~5,400 tracts, 2 min.
                  Coverage: schools and high schools 100%, crime 91.3%, home value 92.7%
                  (Bronx 64%, Manhattan 81%: few owner-occupied homes, so no ACS median),
                  low confidence 63% (small ACS samples in NYC). What it found:
                  - **Village vs town.** Stripping "Village"/"Town" to compare names let the
                    Village of Hempstead's police cover the Town of Hempstead (760k people,
                    county-policed), and made Mamaroneck Town and Village indistinguishable.
                    Names now keep their kind: a village's police match a village, a town's a
                    town; a suffix-less agency matches either (New England's "Bristol").
                  - **Same-named village and township** (Illinois, found by the reference
                    check on Cook): a suffix-less agency matched by town must not serve over
                    2× its own population (Village of Thornton, 2,400, vs Thornton Township).
                  - **County police.** Nassau/Suffolk are policed by county police
                    departments, not sheriffs; with several county agencies the one with a
                    population (then the busiest) wins. Label: "Nassau County (sheriff or
                    county police)" — the FBI's type doesn't say which.
                  - **Missing agencies.** Suffolk County PD, Westchester County PD and the
                    State Police (most of rural NY) aren't in either FBI source. A sheriff
                    standing in for them looked absurdly safe (Suffolk 4/100k), so: under
                    20/100k over 50k people is dropped (no number beats a wrong one); a county
                    agency under 50/100k is flagged. Suffolk's crime coverage is 13% — an
                    honest gap. Open: the State Police may be in another FBI table.
                  - The CDE site timed out once: retries, and offline the newest downloaded
                    year is used.
            - [x] **Reference counties** (`python -m etl.tracts.sentinels [--crime]`): after a
                  shared-code change, rebuild ten counties that each once went wrong
                  (Travis, Zavala, LA, SF, Riverside, Nassau, Westchester, Suffolk,
                  Bristol RI, Cook) and diff against the previous build — ~2 min, instead
                  of rebuilding every live state. The monthly CI run carries the change to
                  all live states. **Routine per state:** build that state → read its
                  coverage → fix what it reveals → `sentinels` if shared code changed →
                  `publish` + `upload --state ST` → add a reference county if it taught us
                  something.
            - [x] **Florida** (2026-10-02, published): 67 counties, 5,122 tracts, 2 min.
                  Everything ≥97.6% except crime, 83%. Florida's switch to FIBRS left many
                  agencies out of both FBI sources (the Broward, Volusia, Lake, Manatee
                  sheriffs; Orlando). Added `crime_states.py`: a state's own program fills
                  agencies the FBI lacks — Florida's FDLE offense workbook (link found on its
                  page; counts offenses not victims and includes fondling, so a little high).
                  But most of what FDLE adds is partial too (Deltona: 14 property crimes for
                  98,792 people), so a second floor: under 100 property crimes per 100k for
                  10k+ people is partial reporting, dropped (it also caught NY zero-reporters
                  and Long Beach, NY). And a dropped city's tracts now get no rate, not the
                  county's (Orlando isn't Orange County's to describe). Broward Sheriff
                  isn't on FIBRS at all: Broward 38%. These fill in as agencies report.
            - [x] **Pennsylvania** (2026-10-02, published): 67 counties, 3,445 tracts. Crime
                  66% → 98.3%: half its towns have no police and are patrolled by the
                  **State Police**, which PA's NIBRS file lists per county with the
                  population served — now a county-level agency like a sheriff ("State
                  Police in Adams County"). Also found: statewide yearly tables matched
                  same-named townships in other counties (Adams got Butler's and Berwick's
                  numbers) — outside New England a town now needs its full name there; a
                  county-level agency reporting with population 0 (Allegheny County Police:
                  parks, airport) means no county patrol, so leftover towns stay blank
                  rather than take it; a 5k+ town with zero property crime isn't reporting.
                  Open: regional departments ("Northern Regional") cover several townships
                  under a name that matches none — those tracts fall to the State Police.
            - [x] **Virginia** (2026-10-02, published): 133 counties and independent cities,
                  2,186 tracts. Crime 100%, schools 99.8%. Independent cities work as their
                  own counties (Richmond, Virginia Beach; Fairfax and Arlington by county
                  police). Labels: a full agency name ("Fairfax County Police Department")
                  now reads "Fairfax County Police". Small gap: a city or county that shares
                  a school system with a neighbor (Fairfax City, Emporia, James City County)
                  has a paper district with no test scores — nearby schools still show.
            - [x] **Washington** (2026-10-02, published): 39 counties, 1,772 tracts, 1 min.
                  Clean: crime 99.4%, schools 99.9%, home value 98.3%. No fixes needed.
            - [x] **Michigan** (2026-10-02, published): 83 counties, 2,971 tracts. Census has
                  no LODES jobs file for MI after 2021, so every county failed: the jobs
                  loader now takes the newest year published (downtowns barely move).
                  Detroit's schools were unscored: the 2019 boundary is the old Detroit City
                  SD, SEDA scores its 2016 successor (DPSCD) — `SUCCESSOR_DISTRICTS` maps old
                  IDs to new. Crime 97.8%, schools 99.9%, districts 90%.
            - [x] **Maryland** (2026-10-02, published): 24 counties, 1,464 tracts. Crime 97.9%
                  → ~100%, schools 100%. County police (Montgomery, Prince George's,
                  Baltimore County) come through by name. Carroll County's patrol is split
                  between the sheriff and the State Police, and the FBI gives nearly all the
                  population to one (State Police 122,587 at 19/100k; sheriff 2,793) — each
                  alone implausible. Several county-level agencies of different kinds in one
                  county are now combined: "Carroll County (sheriff and State Police)",
                  93/100k.
            - [x] **Colorado, Ohio, Missouri** (2026-10-02, published): clean — crime 97.2%,
                  96.8%, 99.3%; schools ≥99.6%. Ohio's township police handled by the town
                  rules; Missouri's St. Louis City as its own county.
            - [x] **Louisiana** (2026-10-02, published): 64 parishes, 1,379 tracts. New Orleans
                  PD is in neither FBI source for 2024 or 2025: the yearly tables now reach
                  one year further back (2023) for agencies silent since — shown with its year
                  and always flagged. (2023's tables are named without "CIUS_" and write
                  "ALABAMA - Metropolitan Counties": both handled.) Crime 98.2%.
            - [x] **New Mexico** (2026-10-02, published): 33 counties, 612 tracts. Doña Ana
                  (Las Cruces) had no crime: name matching dropped the "ñ" ("DOAANA" vs the
                  FBI's "DONA ANA") — accents are now folded. Crime 90.7%. Hobbs and Roswell
                  school districts didn't submit to CRDC 2023–24, so Lea/Chaves high schools
                  are thin (33–35%). Open: fall back to CRDC 2021–22 for districts missing
                  from 2023–24.
            - [x] **Georgia** (2026-10-02, published): 159 counties, 2,791 tracts. Consolidated
                  city-counties carry Census names like "Athens-Clarke County unified
                  government (balance)": labels showed them whole and crime couldn't match the
                  police. `names.clean_place` → "Athens-Clarke County" (also Augusta,
                  Louisville, Nashville, Indianapolis to come). Crime 91.1% (Savannah reported
                  146 property crimes for 242k people: dropped as partial).
            - [x] **Massachusetts, Oregon, Minnesota, Oklahoma, Mississippi, South Carolina**
                  (2026-10-02, published): clean. Crime 94.9%, 97.3%, 98.6%, 100%, 88.0%,
                  100%; schools ≥99%. Gaps are agencies not reporting, or reporting a
                  sliver (Worcester, MA: 17 property crimes for 212k people; Greenville, MS:
                  absent).
            - [x] **West Virginia** (2026-10-02, published): 55 counties. The State Police
                  report per county with population 0 and the sheriff gets the population
                  (Logan: 3 property crimes for 26,532 people) — the Carroll, MD split the
                  other way round. Reporting county-level agencies of different kinds now
                  count together over the population of those that have one. Crime 86% →
                  96.7%.
            - [x] **Queue done** (owner, 2026-10-02): Florida, Pennsylvania, Virginia,
                  Washington, Michigan, Maryland, Colorado, Ohio, Missouri, Louisiana, New
                  Mexico, Georgia, Massachusetts, Oregon, Minnesota, Oklahoma, Mississippi,
                  South Carolina, West Virginia. With Texas, California, New York and Cook
                  County: 23 states live. Next: decide on the remaining 28 (incl. DC).
            - [x] **The rest, one by one** (owner, 2026-10-02: order mine; the owner runs the
                  refresh workflow after): IL, NC, NJ, AZ, TN, IN, WI, KY, AL, AR, IA, KS, NE,
                  NV, UT, CT, RI, NH, VT, ME, DE, DC, ID, MT, ND, SD, WY, HI, AK.
                  - IL: clean (crime 97.4%). NC: Charlotte's police are the joint
                    "Charlotte-Mecklenburg" department — a "City-County" agency now answers to
                    the city's name and is the county's patrol (Mecklenburg 14% → 100%).
                  - NJ: the FBI names same-named townships with their county ("Washington
                    Township, Gloucester County") — that suffix is now dropped before matching
                    (crime 89.5% → 93.5%). Rural Salem/Sussex/Warren (State Police, one
                    statewide row with no counts) stay ~70%.
                  - AZ: clean (94.2%; Maricopa's sheriff doesn't report). TN: Nashville's
                    police are "Metropolitan Nashville Police Department" and its place
                    "Nashville-Davidson" — agency names lose "Metropolitan … Police
                    Department", and a place named "City-County" answers to the city
                    (Davidson 2% → 98%; TN 99.5%).
                  - IN: clean (88%; many sheriffs report a sliver — Bartholomew: 23 property
                    crimes for 32,820 — dropped). WI: clean (98.5%). KY: "Louisville Metro"
                    (suffix) and place "Louisville/Jefferson County" handled; a city agency
                    serving ≥75% of its county's people is the county's patrol where no
                    sheriff reports (Jefferson 12% → 100%; KY 94.8%).
                  - AL 98.7%, AR 99.6%, IA 95.8%, KS 98.5%: clean (Selma, AL high schools
                    missing from CRDC like Hobbs). NE: Sarpy County's sheriff (17 violent but
                    518 property per 100k) was dropped by the violent floor — low violent crime
                    alone can be real, so that floor now needs low property crime too (only
                    Sarpy and Orland Park, IL come back).
                  - NV: Las Vegas Metropolitan PD is the city's police and unincorporated
                    Clark County's (Paradise, Spring Valley…) — a "Metropolitan"/"Metro"
                    department is its county's patrol where no sheriff reports (Clark 55% →
                    100%).
                  - UT: clean (99.3%). CT: replaced its 8 counties with 9 planning regions in
                    2022 (09110–09190); tract shapes and ACS use them, but population centers,
                    NRI, walkability, ZIPs, LODES and the FBI are on 2020 codes, so every
                    region failed. Tract numbers are unique statewide and unchanged:
                    `geo.current_geoids` translates; crime matches CT's towns statewide (no
                    sheriffs since 2000). All 9 regions built, crime 93.5%.
                  - RI 99.6%, NH 100%: clean. VT: half its schools had no location — a school's
                    NCES id embeds its district's, and Vermont merged most districts in
                    2015–19, so SEDA's (older) ids weren't in the 2023–24 locations. Unmatched
                    schools now match by state + name when exactly one current school has it;
                    unscored 2019 districts by name too. VT schools 50% → 100%, districts 69% →
                    91%. Nationally it recovers 1,623 of 6,430 unmatched schools (mostly NYC,
                    whose citywide district id was split by borough; New Orleans charters).
                  - ME 99.2%, DE 100%: clean. DC: its police are listed with county "NOT
                    SPECIFIED" — DC (one county) takes its agencies regardless (crime 0 → 100%).
                    SEDA has no DC district score: districts 0%, nearby schools 100%.
                  - ID 99.3%, MT 98.7%, ND 100%: clean (rural high schools under 100 students
                    or >15 mi away thin MT/SD/WY high-school coverage to ~88–90%). SD 89% and
                    WY 89%: reservation counties are policed by tribal departments, which aren't
                    matched to areas. HI: one statewide school district SEDA doesn't score
                    (like DC). AK: no LODES after 2016 (now looks back 8 years; with none,
                    downtowns use city points); the State Troopers are one statewide agency —
                    each borough's leftover patrol, flagged as coarse (crime 60% → 100%).
            - [x] **First CI run (2026-10-02) failed, usefully.** FEMA answers GitHub's runners
                  with 403 (any user agent) for the NRI tract table, and the build then
                  crashed writing its report (no output folder on a fresh machine — fixed).
                  Fix: **mirrors** — `util.http_get` falls back to `mirror/{cache file}` in
                  the private bucket when a download fails; `python -m etl.inputs mirror`
                  pushes the copies listed in `inputs.MIRRORED` (now: the NRI tract table,
                  635 MB). Tested by simulating FEMA's 403. Re-push when FEMA publishes a new
                  NRI version. Other sources may refuse CI too: each run will say.
                  Second run passed (Texas + Cook rebuilt on GitHub and uploaded).
                  Rule: only rarely-changing sources may be mirrored; a monthly one (Zillow,
                  Redfin) that refuses CI needs another route, never a stale copy.
- [x] **Area list ↔ map** (owner, 2026-10-02): hovering a town in the area list outlines all
      its areas on the map; hovering one area outlines just it (keyboard focus too). A town
      with a single area has no dropdown — the row is the area (its value, caution icon), and
      a click opens it. Hover state is kept apart from the map's colors so hovering never
      recolors the map.
- [ ] **8d — Extras, as wanted.** CDC PLACES health, OSM amenities (parks, groceries),
      neighborhood names beyond Zillow's cities.
- [x] **8e — Filters and must-haves inside the county** (2026-10-03). Owner's choice: **one
      search, two levels** — the same Filters rank counties and the areas inside them.
      - County priorities that vary by area carry over with their importance and direction:
        home value, rent, household income, schools (→ nearby elementary & middle schools),
        hazards (all seven), airport distance (`CARRIED_OVER`, `src/lib/tracts/scoring.ts`).
        County-wide ones (climate, taxes, cost of living…) don't rank areas, and the "i" says
        so.
      - Area-only priorities in Filters → **Inside a county**: walkability, violent and
        property crime, high schools, distance to downtown, households with kids, people per
        sq mi, commute. Must-haves for the same, plus county limits in the same units (a
        maximum home value; not school grades vs percentiles). Saved, and in share links
        (`aw`, `adir`, `alim`).
      - Scoring: each measure's percentile among the county's areas, by direction, weighted
        like counties. Excluded areas are hidden ("N areas hidden by your must-haves");
        unknowns follow the county "include unknown" setting.
      - The "Color the map by" dropdown is gone: the map is colored by match on the
        red→green score scale ("Your match"), the list ranked by match (towns by their best
        area). With no priority that varies inside a county, areas show Census home value
        and a hint to add some. "Edit filters" opens the Filters modal.
      - Open: the area view could show why an area scores as it does (as counties do);
        repeated labels ("Wells Branch · 78728" ×4) when several tracts share a
        neighborhood and ZIP.

#### Open questions for Phase 8
- ~~Schools: national or within the county?~~ **Both** (owner, 2026-09-30).
- ~~How to show low confidence?~~ **Caution icon + hover details** (owner, 2026-09-30).
- Tract percentiles for the other metrics: national (proposed), or within the metro? Try
  both on Travis in 8a.
- Filters inside the county: **deferred to 8e** (owner, 2026-09-30), after seeing the data.
- Do very large counties need a middle level (city/town) between county and tract, e.g. Los
  Angeles County with 2,500 tracts? **Test a few solutions in 8b** (owner, 2026-09-30).
- ~~Crime: how well do FBI agencies map onto places?~~ Well: agency names match Census place
  names; unincorporated tracts take the sheriff. In Texas 99.6% of populated tracts get a
  rate; an agency that didn't report a full year is flagged low confidence (8c).

### Phase 8f — Areas as the results (planned 2026-10-03, owner decisions)

With area data for every county, the unit a person is really choosing is an **area** (a
neighborhood near a specific school), not a county average. Decided with the owner:

- **One level per filter, automatic** — the most precise level that exists:
  - County/state only: climate, taxes, laws and policies, cost of living, electricity,
    unemployment. They gate counties and give every area in the county the same share of
    its score.
  - Area: home value, rent, income, **schools**, hazards, distances (airport, coast, metro),
    plus the area-only ones (crime, walkability, downtown, high schools, families,
    density, commute). The "Inside a county" section merges back into the topic sections;
    each card is tagged "county-wide" or "by area".
  - **Schools stay percentiles of specific schools** (owner): a county's average grade level
    hides good and bad schools alike, so school priorities and limits apply to an area's
    nearest schools, never the county average.
- **An area's match** = one weighted average over all priorities: county measures at the
  county's national percentile, area measures at the area's **national** percentile (no
  longer within-county). Needs every area's scoring columns in the browser: measured
  2026-10-03 at 84,119 areas × ~18 columns = 3.4 MB gzipped, loaded only when a search
  has an area-level filter.
- **Results are capped by areas, not counties:** the top N areas nationally — 100 by default, with
  "show more" to 250 and 500 (owner, 2026-10-03).
  Counties are the ones holding at least one of them — however many that is.
- **County ranking: by their best area** (owner: "that's the whole purpose of this app"),
  each showing "5 of your top 100 areas". Open: a "most options" sort (count of top-N areas,
  then best) as the alternative.
- **Default view:** Areas whenever any area-level filter is set; Counties otherwise.
- **Map by zoom — the results grow as you zoom out** (owner): states with a count of
  matching areas when zoomed far out; counties with their count in between; the areas
  themselves when zoomed in (only top-N areas; geometry loaded per county as needed).
- **Inside a county: only its areas in your top results** (top 100/250/500, whichever is
  chosen) — one if one is, fifteen if fifteen are; the rest stay off the map. "Reveal full
  county" lists and draws every area (failing ones grey); "Hide weaker results" goes back
  (owner, 2026-10-04; replaced "best 5, Show 5 more").
- Mockup first (owner, 2026-10-03): area page, county page and results list reorganized
  around "Your search" — https://claude.ai/artifact/BM9S29sxGTLmV87V2Lj72X (private).
- **Results list holds the summaries** (owner, 2026-10-03, after the mockup): each result
  row has a summary toggle — the name opens the area (or county), the chevron toggles a
  short "your search" summary; the #1 result is open by default with a "#1 best match"
  flag; one summary open at a time. Counties expand to their best areas. The area page's
  back link returns straight to Results (its county is a separate link), so there's no
  area → county → results back-tracking. Owner approved: verdicts in words + a smaller
  number; county pages lead with their best areas.
- **Result summaries compare; the area page explains** (owner, 2026-10-03, mockup round 3).
  The area page keeps its full "Your search" detail; a result's summary in the list is
  different: a **fingerprint** (owner's favorite: one bar per priority, no words; collapsed
  rows show it as tiny columns, one per priority, most important first), a **trade-off
  sentence** built from at most the **3 priorities that moved the score most**, the rest
  one tap away; opening a summary outlines the area on the map ("Open <area> →" stays).
  **Score colors:** deep red at 1, yellow around 75, deep green at the top. **Gold** (top 1%)
  only on bars (fingerprints, breakdowns) and badges — the map and score numbers top out
  at deep green (owner, 2026-10-04). **Badges:** "best of your results" (green: Most walkable,
  Best schools, Cheapest homes… — the single best returned area on a priority, at most two
  per area) and **"Top 1% … in the US"** (gold star) for a national top-1% priority.
- Next, separately: **data overload** — reorganize county and area pages (nothing removed),
  so what matters for *this* search comes first and the rest is a tap away.

**Built (2026-10-03):**

- [x] `etl/tracts/national.py` → `tracts/areas.json` (column-major, 3.7 MB brotli from R2);
  the refresh workflow merges it after publishing (`--merge-live`).
- [x] National scoring (`src/lib/tracts/national.ts`, tested): `scoreNational`, top N,
  counties by best area, `explainArea`, trade-off sentence, badges. County stand-ins for
  area measures (home value, rent, income, school grade level, hazards, distances) move to
  the area level when a saved search or link is read (`MOVED_TO_AREAS`; a grade-level limit
  has no area equivalent and is dropped).
- [x] Results list: Areas/Counties toggle, Top 100/250/500, summaries (fingerprint,
  trade-off, top 3 bars, must-haves, badges), #1 open; opening a summary moves the map to
  it (the #1 open on load only drops a pin, so the national view stays).
- [x] Filters: area measures in their topic sections (new **Safety** section), tagged
  "By area" / "County-wide"; the "Inside a county" section is gone. "Show N areas" when
  results are areas.
- [x] Inside a county: its areas in your top results, "Reveal full county" / "Hide weaker
  results", fingerprints; the county page says "See all N areas in your top 100". Opening an
  area from the results zooms to the area, not the county (2026-10-04). The area
  page's breakdown uses national percentiles ("lower than 97% of US areas"); "← Results"
  plus a county link.
- [x] Inside a county, the map draws only the areas listed,
  colored by rank among them (best deep green); the rest stay blank, and the county's own
  fill is hidden underneath (it had shown through as one color — fixed 2026-10-04).
- [x] Area page header: its overall rank in your top results ("#1 of your top 100"),
  colored like the map's ranks; the low-confidence warning sits beside the name.
- [x] County page in area mode leads with its best 3 areas. Its title matches an area's
  (owner, 2026-10-04): "← Results", name, state · population, and its rank on the right
  ("#1 of 24 counties", colored like the map). The Overview tab dropped "Why it ranks
  here", "Your filters" and "Passes all N filters" (a note stays when ruled out or
  unknown); "How it's scored" is drawn like an area's breakdown.
- [x] Map by zoom: state count bubbles (< z5), county count bubbles (z5–7.5), area dots
  colored by score (≥ z7.5; tap opens the area). Bubbles are HTML markers because the
  offline basemap has no fonts. Dots sit at each area's population center rather than its
  shape (shapes load per county, as before, once you open one).
- [x] Many areas share a label (a ZIP covers several tracts: 43,951 labels for 84,119
  areas), so lists name them by direction from the group's middle — "Grand Forks · 58201 ·
  west" (`distinctNames`).
- [x] **States filter** (owner, 2026-10-04): Must-haves → States, a grid of state toggles
  with All / None — rule some out, or None and pick a few. A must-have like the policies
  (`state` category from counties.json; `cat=state:TX.NC` in links): ruled-out states are
  gated, percentiles stay national. Alaska and Hawaii still turn on in Settings. Known edge:
  a state list saved while Alaska/Hawaii were off doesn't include them, so turning them on
  later keeps them ruled out until "All" is pressed.
- [ ] Data overload: one-line sections with verdict words and a smaller number on county
  and area pages.

### Phase 9 — First-run tutorial (added 2026-10-01)

The app has a lot in it (priorities, must-haves, climate cards, saved searches, the map,
Explore inside). A first-time visitor should learn the main loop in under a minute.

- [ ] A short guided tour the **first time** someone opens the app: set what matters → read
      the ranked list → open a county on the map → Explore inside. A few steps, each pointing
      at the real control; **Skip** on every step.
- [ ] Shown once: remember "seen" in localStorage (a per-device convenience). A link that
      opens a shared search still shows it to a first-time visitor, after the search loads.
- [ ] Re-open it from Settings ("Show the tour again").
- [ ] Works on phone widths and with the keyboard (Escape skips).

---

## 10. Explicitly deferred

Not in MVP. Do not build these until the above ships.

- ~~Census tracts / neighborhoods / any sub-county geography~~ — **now Phase 8** (2026-09-30).
- A nationwide tract map (all 85k tracts at once). Phase 8 drills into one county at a time.
- User accounts and auth
- Natural language search
- **Month-by-month climate envelope** (from Phase 6) — an acceptable range per month; a county
  passes if its monthly curve fits inside. The monthly data is already in the browser
  (`climate.json`); needs a chart-based control.
- **"Climate like a place I know"** (from Phase 6) — pick a county; score others by the
  similarity of their monthly high/low/precipitation curves. Pairs with the envelope (a chosen
  county's curve ± a margin).
- **Place profile content** (requested 2026-09-26) for the selected-result detail view:
  images, points of interest and attractions, what the place is known for, rules and laws
  to know, and anything else worth knowing, good and bad. Notes for when it's built:
  - **Key everything by a place id, not a county FIPS.** The geography roadmap moves to
    tracts (neighborhoods), school districts and towns, and the profile has to follow the
    selected area. County-level facts stay useful as the outer layer. Neighborhood,
    district and part-of-town detail goes on top of them.
  - **Source is undecided:** a static dataset we build (works offline, fits §2) or a live
    fetch when a place is selected (online only, needs a proxy or keyless APIs, rate
    limits). Probably both: static basics, live extras. See §11.
  - **The shell can come first:** empty sections (image carousel, Things to do, Laws to
    know, Known for) that each fill from a fetch and show a plain "not available offline" /
    "nothing yet" state.
  - A possible **AI summary** of the place, good and bad (see §7).
- AI-generated place descriptions
- Commute isochrones
- Saved comparisons
- Real estate listings data
- Mobile native apps
- **Wildlife and landscape data.** The free source is GBIF (Global Biodiversity Information
  Facility), an open API of species occurrence records. It's real data, but it's raw observation
  records rather than "here's what lives here" — turning it into something a person wants to read
  is meaningful work. Landscape imagery is a separate problem again. Park both.
- **Optional full-basemap download for offline use** (decided 2026-09-26). Online, the map uses
  OpenFreeMap; offline, it falls back to county lines only. A later version could let the
  person download a US basemap (`.pmtiles`) on request for full offline use — opt-in because
  it is large. Separate from the ETL boundary step.
- **Street / parcel-level data.** Requires a commercial vendor and is arguably the wrong job for
  this app anyway. See the geography roadmap.

---

## 11. Open questions

- [x] ~~Which 6–8 state law attributes actually matter?~~ Answered by `LAWS.md` (2026-09-27):
      12 laws, each marked filter / info / both.
- [ ] At tract level, does the RPP recombination need re-weighting, or do BEA's national weights
      hold well enough?
- [ ] **Rural cost of living.** ~62% of counties carry their state's blended RPP because BEA
      publishes no state non-metro portion. Is that acceptable for ranking, or is it worth
      deriving a state non-metro value (statewide minus its metros, expenditure-weighted)? If
      derived, it must be labelled as such in `rpp_geo_level`. Decide before Phase 3's list
      view is trusted for rural counties.
- [ ] Which ACS vintage? 5-year estimates are almost certainly right — the 1-year release only
      covers areas above 65,000 population, which would drop roughly two-thirds of counties.
      Confirm the latest available 5-year release when hitting the API.
- [ ] **Place profile source** (post-MVP): a static dataset, a live fetch on select, or both?
      Live fetches break "fully static, works offline" (§2), so they'd be an online-only
      layer. Decide before building the §10 place profile.
- [ ] Is a non-housing `real_income` variant worth computing alongside the standard one?
- [ ] **Connecticut school data.** Census switched CT to nine planning regions in 2022
      (`09110`–`09190`); SEDA still keys on the eight legacy counties (`09001`–`09015`).
      *Confirmed 2026-09-20: all nine CT rows null for `school_achievement`.* Fix options: a legacy-county → planning-region crosswalk with population-weighted
      averaging (an afternoon), or accept the gap and have the UI show CT schools as
      "unavailable" rather than scoring them. Decide before Phase 3 ships a ranked list.
      *2026-09-22:* the unknown-data handling from Phase 2 already does the second option by
      default — CT is scored on its other metrics, flagged as partial, and shows as unknown
      under a schools filter. The crosswalk is now optional polish.

**Resolved**
- ~~Second boundary LOD for zoomed-out views?~~ No — one simplified file is ~620 KB /
  190 KB gzipped. See Phase 4 prep. (2026-09-26)
- ~~"Ideal value" scoring for climate?~~ Not as a year-round band. Hottest-month ceiling +
  coldest-month floor + uncomfortable-day counts, on existing filters and direction flags.
  See §6 *Climate preferences*. (2026-09-22)
- ~~How to handle counties with missing data — exclude, impute, or gray out?~~ Grey out, with a
  show/hide toggle for unknown results; never impute. See §6 item 7. (2026-09-22)
- ~~Include Alaska?~~ Superseded 2026-09-26: kept in the data; Alaska and Hawaii are both
  in-app toggles, off by default. (Originally dropped at the spine, 2026-09-22.)
- ~~Exclude counties under 10,000 population?~~ No. Keep them, store `population`, filter at
  runtime with a slider.
- ~~Which climate normals?~~ Four seasonal temperature aggregates plus annual precipitation and
  snowfall, from the monthly 1991–2020 normals. Monthly data retained for the climate tab.
- ~~Does SEDA's lag matter?~~ Acceptable. Releases trail by several years, but district quality is
  sticky and we only need relative ranking. Note it in the UI eventually.
- ~~Does BEA publish county-level RPPs?~~ No, checked 2026-09-20. State, metro, and non-metro
  portion of state only. The CBSA crosswalk is required.

---

## 12. The real risk

The technical build is maybe three or four weekends. The hard part is **tuning what "matches"
means** — getting the weighting model to produce a heat map that feels true rather than arbitrary.

Budget most of the iteration time there, not on infrastructure.

### Tuning track (ongoing, from Phase 3 on)

Not a phase — a habit. Run real searches, note where a ranking feels wrong, and write down
*why* before changing anything. Log findings here with the date, the search, and what changed.

- *(no entries yet)*