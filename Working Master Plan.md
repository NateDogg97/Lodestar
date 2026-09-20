# Relocation Finder — MVP Plan

> **This is a working document.** It reflects current thinking, not settled fact. Update it as
> decisions change, assumptions break, or data sources turn out to be different than expected.
> If something here conflicts with what you actually built, the code is right and this file is
> stale — fix the file.
>
> Last updated: 2026-09-20
>
> **Changelog**
> - 2026-09-20 — Initial plan.
> - 2026-09-20 — Store cost of living as its three RPP components rather than one blended index
>   (see "Making cost of living work below metro level"). Expanded the Phase 1 column set to
>   include income, rent, and climate. Added the geography roadmap. Decided to keep small
>   counties in the dataset and filter at runtime instead.
> - 2026-09-20 — Corrections after review: `real_home_value` was dimensionally wrong (housing
>   price over housing price index), replaced with `price_to_rent` and `real_income`. RPP has
>   **four** components, not three — utilities split out in BEA's Dec 2021 methodology revision.
>   Confirmed BEA does not publish county-level RPPs, so the CBSA crosswalk stays.

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
        └──▶ metrics.json         (3,144 rows × ~30 columns)
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
- Re-scoring on a slider drag is sub-millisecond (3,144 rows is nothing)

Payload math: 3,144 counties × 30 metrics × 4 bytes (Float32) ≈ 375 KB raw, much less gzipped.
The entire national dataset fits comfortably in the browser.

---

## 3. Geography key: county FIPS

**Decision: use county FIPS as the single join key for MVP.**

Rationale:
- Nearly every federal dataset publishes at county level → trivial joins
- 3,144 units is granular enough to be useful, small enough to ship whole
- Boundaries are stable and free from Census TIGER

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

**Checked 2026-09-20: BEA does not publish county-level RPPs.** Only state, metro area, and the
non-metro portion of each state. Latest release was 2026-02-19 (2024 data); next is 2026-12-10.
The crosswalk step below is required.

1. Look up each county's CBSA (metro area) via a Census crosswalk file
2. Assign that metro's RPP components to every county in it
3. For rural counties in no CBSA, fall back to the state's non-metro portion value

**For the tract path (Phase 5+):** county-level RPP estimates *are* produced internally as part of
BEA's methodology but aren't published pending reliability work. A Commerce Department working
paper ("Estimating county-level regional price parities from public data") constructs them from
public microdata, releveled so they aggregate exactly to BEA's metro and non-metro figures. That's
a published methodology we can borrow rather than invent.

---

## 5. Phase 1 CSV schema

One row per county, ~3,144 rows.

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

### Phase 1 — Prove the join ⬅️ **START HERE**
- [ ] Set up ETL project (Python, `pandas`, `geopandas`)
- [ ] Pull Census county list — FIPS, name, state, population — as the spine
- [ ] Pull ACS: median home value, median household income, median gross rent
- [ ] Pull SEDA county-level achievement
- [ ] Pull BEA RPP **components** (all / rents / utilities / goods / other services) + published
      expenditure weights + CBSA→county crosswalk
- [ ] Pull NOAA 1991–2020 monthly normals, spatial-join stations to county centroids
- [ ] Compute derived columns
- [ ] Write single CSV, one row per county
- [ ] Sanity-check against places we know (Travis TX, San Francisco CA, Cuyahoga OH)

**This phase proves the hardest part of the project.** Four agencies that describe geography four
different ways, reconciled onto one spine. If the join works, every future metric is just another
column.

Known rough edges to expect:
- Alaska uses boroughs and census areas, Louisiana uses parishes — both have FIPS, but check them
- Connecticut reorganized its county-equivalents recently; crosswalks may be stale
- Counties with no nearby NOAA station need a fallback (nearest station, or state average)
- Keep FIPS as a string everywhere or pandas will eat the leading zeros

### Phase 2 — Scoring engine
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

### Phase 6 — Polish
- [ ] URL-encoded filter state
- [x] PWA shell + service worker
- [ ] `localStorage` shortlist

### Phase 7 — Climate tab
- [ ] Per-location panel with monthly temperature band chart (data already in the Phase 1 pull)
- [ ] Precipitation and snowfall by month
- [ ] Add `days_above_90f` / `days_below_32f`

> **Sequencing note:** the strict ordering above matters for Phases 1–4, where each phase depends
> on the last. Phase 7 does not — the climate data lands in the Phase 1 pull, so the tab can slot
> in any time after Phase 3 if a second useful view is wanted before Polish.

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
- [ ] How to handle counties with missing data for a given metric — exclude, impute, or gray out?
- [ ] Do we need a second boundary LOD for zoomed-out views, or is one simplified file enough?
- [ ] At tract level, does the RPP recombination need re-weighting, or do BEA's national weights
      hold well enough?
- [ ] Which ACS vintage? 5-year estimates are almost certainly right — the 1-year release only
      covers areas above 65,000 population, which would drop roughly two-thirds of counties.
      Confirm the latest available 5-year release when hitting the API.
- [ ] Is a non-housing `real_income` variant worth computing alongside the standard one?

**Resolved**
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