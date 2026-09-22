# Relocation Finder — MVP Plan

> **This is a working document.** It reflects current thinking, not settled fact. Update it as
> decisions change, assumptions break, or data sources turn out to be different than expected.
> If something here conflicts with what you actually built, the code is right and this file is
> stale — fix the file.
>
> Last updated: 2026-09-22
>
> **Changelog**
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

**Scope: the lower 48, Hawaii, and DC. Alaska is excluded** (decided 2026-09-22 — not a place
we're considering). It is dropped at the county spine in the ETL, so it is absent from every
metric, the map, and the rankings. 3,114 counties.

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
shortcut.

**"Distance to X" is not a runtime query.** Precompute in the ETL as ordinary columns:
`dist_to_large_airport_mi`, `dist_to_coast_mi`, `dist_to_metro_500k_mi`. Haversine against a point
file, or PostGIS. They then behave like any other metric.

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
2. **Each metric carries a direction flag** — higher-is-better or lower-is-better. Invert the
   percentile for the latter.
3. **User input is two things:**
   - Hard filters: min/max cutoffs, boolean requirements
   - Weights: 0–5 slider per metric
4. **Score** = `Σ(weight × percentile) / Σ(weight)`
5. **Hard filters eliminate a county entirely**, rather than penalizing its score.
6. **Color ramp on score** — `d3-scale-chromatic` → `interpolateRdYlGn`. Green = strong match,
   red = weak.
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

---

## 7. Where AI belongs (neither is required for v1)

**Natural language → filter state.** *"Somewhere warm with good schools, houses under $400k, within
two hours of an ocean"* → a JSON object matching the filter schema. One structured-output call,
roughly $0.001 each. Best post-MVP feature; ~50 lines of code.

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
run log and known gaps (CT schools, rural RPP resolution, SF climate provenance). The
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

### Phase 2 — Scoring engine ⬅️ **NEXT**
- [ ] Decide how the app loads `public/data/counties.json` (2.7 MB; over Serwist's 2 MB
      precache cap — raise the cap, or emit a columnar/rounded JSON from the ETL).
      *Measured 2026-09-22:* rounding floats to 3 dp and emitting `{columns, rows}` arrays
      instead of one object per county gives ~785 KB raw / ~260 KB gzipped. Rounding alone
      only reaches 2.4 MB — the repeated keys are the bulk.
- [ ] **ETL fixes found in the 2026-09-22 review** — do before scoring, since they change
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
- [ ] Pure TypeScript module, no UI
- [ ] Percentile normalization with direction flags
- [ ] Weighted scoring function
- [ ] Hard filter application
- [ ] Score decomposition (top 3 / bottom 3 contributors)
- [ ] Unit tests asserting sane rankings against known places

### Phase 3 — Ranked list view
- [ ] Table of top 50 counties with score breakdown
- [ ] Weight sliders + hard filter inputs
- [ ] *(This is already a useful product. May turn out to be more useful than the map.)*

### Phase 4 — Map
- [ ] Download + simplify Census county boundaries with `mapshaper`
- [ ] MapLibre setup with free basemap
- [ ] Choropleth colored by score
- [ ] Click → side panel with score breakdown

### Phase 5 — Full metric set
- [ ] Expand ETL: FEMA NRI, BLS unemployment, precomputed distances, state law CSV
- [ ] Each new metric = one column + one slider

### Phase 6 — Climate tab
- [ ] Per-location panel with monthly temperature band chart (data already in the Phase 1 pull)
- [ ] Precipitation and snowfall by month
- [ ] Add `days_above_90f` / `days_below_32f`

### Phase 7 — Polish *(always last)*
- [ ] URL-encoded filter state
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
- AI-generated place descriptions
- Commute isochrones
- Saved comparisons
- Real estate listings data
- Mobile native apps
- **Wildlife and landscape data.** The free source is GBIF (Global Biodiversity Information
  Facility), an open API of species occurrence records. It's real data, but it's raw observation
  records rather than "here's what lives here" — turning it into something a person wants to read
  is meaningful work. Landscape imagery is a separate problem again. Park both.
- **Street / parcel-level data.** Requires a commercial vendor and is arguably the wrong job for
  this app anyway. See the geography roadmap.

---

## 11. Open questions

- [ ] Which 6–8 state law attributes actually matter? (Needs a decision before Phase 5.)
- [ ] Do we need a second boundary LOD for zoomed-out views, or is one simplified file enough?
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
- [ ] Is a non-housing `real_income` variant worth computing alongside the standard one?
- [ ] **Connecticut school data.** Census switched CT to nine planning regions in 2022
      (`09110`–`09190`); SEDA still keys on the eight legacy counties (`09001`–`09015`).
      *Confirmed 2026-09-20: all nine CT rows null for `school_achievement`.* Fix options: a legacy-county → planning-region crosswalk with population-weighted
      averaging (an afternoon), or accept the gap and have the UI show CT schools as
      "unavailable" rather than scoring them. Decide before Phase 3 ships a ranked list.

**Resolved**
- ~~How to handle counties with missing data — exclude, impute, or gray out?~~ Grey out, with a
  show/hide toggle for unknown results; never impute. See §6 item 7. (2026-09-22)
- ~~Include Alaska?~~ No — out of scope, dropped at the spine. (2026-09-22)
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