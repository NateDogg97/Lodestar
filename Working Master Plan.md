# Relocation Finder — MVP Plan

> **This is a working document.** It reflects current thinking, not settled fact. Update it as
> decisions change, assumptions break, or data sources turn out to be different than expected.
> If something here conflicts with what you actually built, the code is right and this file is
> stale — fix the file.
>
> Last updated: 2026-09-26
>
> **Changelog**
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

**Deferred:** the "area specificity" filter (state → county → city → neighborhood). Each level is
a separate join key, boundary file, and data-availability problem.

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


### Phase 5 — Full metric set
- [ ] Expand ETL: FEMA NRI, BLS unemployment, precomputed distances
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
- [ ] Each new metric = one column + one slider

### Phase 6 — Place view and climate

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
- [ ] Overview tab: reasons + per-filter pass/fail/unknown + weighted breakdown
- [ ] Climate tab: monthly chart, key numbers, source; compare-with overlay
- [ ] Köppen climate type (computed from monthly normals) as a label and filter
- [x] ~~Add `days_above_90f` / `days_below_32f`~~ Moved to Phase 3 (§6 *Climate preferences*)
- [ ] **Month-by-month climate envelope** — an acceptable range per month; a county passes if
      its monthly curve fits inside. Ships monthly normals to the browser as a separate,
      lazily loaded file (the tab needs it anyway).
- [ ] **"Climate like a place I know"** — pick a county; score others by similarity of their
      monthly high/low/precipitation curves
- [ ] Köppen climate type as a label and categorical filter

### Phase 7 — Polish *(always last)*
- [ ] **"New version available" prompt.** After a deploy, the first visit shows the previously
      cached version while the new service worker installs in the background; the update
      appears on the next load. Standard PWA behaviour, but confusing — show a small
      "Update available — reload" notice when a new worker is waiting.
- [x] ~~Selected-result detail view~~ Moved to Phase 6 as the **place view** (2026-09-27) —
      the climate section needs it.
- [ ] URL-encoded filter state. *(The search is already saved in `localStorage` since
      2026-09-26. The URL adds shareable links and should win over the saved search when both
      are present.)*
- [x] PWA shell + service worker
- [ ] `localStorage` shortlist

> **Sequencing note:** the strict ordering above matters for Phases 1–4, where each phase depends
> on the last. The Climate tab does not — its data lands in the Phase 1 pull, so it can slot in
> any time after Phase 3. **Polish stays last** (decided 2026-09-22): new features and data go
> in before finishing touches.

---

## 10. Explicitly deferred

Not in MVP. Do not build these until the above ships.

- Census tracts / neighborhoods / any sub-county geography (but the RPP decomposition above keeps
  the door open)
- The state→neighborhood specificity filter
- User accounts and auth
- Natural language search
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