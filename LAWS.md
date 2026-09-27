# Laws, Taxes & Policy — Data Model and Maintenance Plan

> **This is a working document.** It reflects current thinking, not settled fact. Update it as
> decisions change. If this file and the code disagree, the code is right and this file is stale —
> fix the file.
>
> Last updated: 2026-09-27
> Companion to: `Working Master Plan.md` (project context), `etl/README.md` (the county pipeline)
>
> **Files:** the table is `etl/data/law_definitions.csv` + `etl/data/law_values.csv`
> (committed). The code is in `etl/laws/`: `refresh.py` (re-fetches every source and rewrites
> the values), `sources/` (one parser per publisher), `verify_laws.py` (the checks),
> `publish.py` (writes `public/data/laws.json` for the app), and offline tests.
> `.github/workflows/laws-refresh.yml` runs the refresh monthly.
>
> **Decided 2026-09-27: no human reviews the values.** Every value is parsed by code from a
> cited source, re-checked monthly, and shown with its source and dates. Accuracy is the
> source's claim, clearly attributed; our job is to cite it faithfully, keep it current, and
> leave a cell blank rather than guess. §8 is the rule set that makes that safe.

---

## 1. What this section is

A per-state and per-county layer of legal, tax, and policy facts, sitting alongside the
statistical metrics already in the county dataset.

It is **not** just more columns. It behaves differently from every other source in the
pipeline in three ways, and the whole design follows from those:

| | Statistical metrics (ACS, BEA, SEDA, NOAA) | This section |
|---|---|---|
| **Source** | One authoritative publisher per metric | Fifty-one legislatures, no common API |
| **Update** | Annual, scheduled, machine-fetchable | Continuous, unscheduled, mostly manual |
| **Wrongness** | A stale number is slightly off | A stale law can be a bad life decision |

That last row is the reason this document exists. A median home value from 2023 is a
*slightly imprecise* input to a ranking. An abortion access status from 2023 could be
**actively false today**, and someone could move because of it.

So the design goal is not "be the authority." The goal is:

> **Cite a reputable source for every fact, re-check it against that source every month,
> show the source and both dates next to the value, make staleness visible, and leave a
> cell blank rather than present a guess or a disputed value as settled.**

---

## 2. Two kinds of entry, and only one is a filter

Not everything here belongs in the scoring engine. Each law carries a `usage`:

- **`filter`** — participates in scoring and filtering
- **`info`** — appears in the county detail panel under "Before you move," never in ranking
- **`both`** — does both

The distinction matters because the scoring engine wants things that *discriminate between
places you'd consider*. Vehicle inspection requirements are worth knowing and worthless for
ranking — giving them a slider next to abortion access implies they are comparable concerns.

Default new entries to `info`. Promote to `filter` only when you'd actually move a slider
for it.

---

## 3. Value types and the preference control

The app gives every filter a **lower / average / higher** preference. That resolves the
direction question for numbers and for ordered categories, and it correctly handles the case
where a user *wants* a higher cost of housing because they're looking at nicer areas.

But it does not cover unordered categories, so the schema declares four value types:

| `value_type` | Example | Preference control |
|---|---|---|
| `numeric` | income tax top rate | lower / average / higher |
| `ordinal` | homeschool regulation: low → moderate → high | lower / average / higher, using the declared order |
| `boolean` | permitless carry | require true / require false / don't care |
| `nominal` | marijuana: recreational \| medical \| cbd_only \| illegal | **multi-select of acceptable values** |

**Every `ordinal` law must declare `ordinal_low_to_high`.** That column is what lets the
preference control map onto it. The verifier blocks an ordinal without one, because otherwise
"higher" is undefined and the scoring engine would silently pick alphabetical order.

**Nominal laws cannot use the slider.** Marijuana status has no natural low-to-high — is
`medical` higher or lower than `illegal`? The UI control is a set of checkboxes: "acceptable
to me are [recreational, medical]." Trying to force these onto a slider produces a ranking
that looks meaningful and isn't.

---

## 4. Schema

Two files, deliberately normalized. Definitions change rarely; values change monthly.

### `law_definitions.csv` — one row per law

| Column | Purpose |
|---|---|
| `law_key` | Stable snake_case identifier. Never rename — it's the join key. |
| `display_name` | UI label |
| `category` | tax / property / personal / family / work / housing / vehicle / utility |
| `usage` | filter / info / both (§2) |
| `value_type` | numeric / ordinal / boolean / nominal (§3) |
| `unit` | percent, dollars, cents per kWh… |
| `allowed_values` | Pipe-separated. The verifier rejects anything outside this set. |
| `ordinal_low_to_high` | Required for ordinals. Defines what the slider means. |
| `jurisdiction_level` | state / county / state_with_county_override (§7) |
| `verify_tier` | A / B / C (§5) |
| `primary_source_name` | Who publishes the authoritative version |
| `primary_source_url` | Where to start research |
| `refresh_cadence` | monthly / quarterly / session / annual / computed |
| **`rubric`** | **How to decide the value.** See below. |
| `notes` | Caveats |

**The `rubric` column is the most important one in this file.** For anything categorical,
it is the written-down definition of what each category means. Without it, "moderate
homeschool regulation" means whatever the researcher thought that day, and the value drifts
every time a different person (or a different model) touches it.

A good rubric is mechanically applicable:

> `low` = notification only or nothing. `moderate` = notification plus testing OR portfolio
> review. `high` = notification, testing AND curriculum approval or teacher qualification.

A bad rubric is `"how strict the state is"`.

### `law_values.csv` — one row per (law, jurisdiction)

| Column | Purpose |
|---|---|
| `law_key` | FK to definitions |
| `jurisdiction_level` | state / county |
| `jurisdiction_code` | Two-letter postal code, or 5-char county FIPS **as a string** |
| `value` | The value, from `allowed_values` |
| `value_numeric` | Parsed number for numeric types (required when `value_type=numeric`) |
| **`status`** | `in_effect` / `enjoined` / `scheduled` / `unknown` / `computed` |
| `effective_date` | When it takes/took effect — often *not* the passage date |
| **`as_of`** | When the value was last checked against its source (the refresh date). Drives every staleness check. |
| **`source_name`** | Who says so ("Tax Foundation", "NCSL", "KFF", …). Shown in the app. |
| **`source_url`** | The page a person opens to check it. Shown in the app as a link. |
| **`source_date`** | The source's own "as of" / "updated" date. Shown in the app. |
| `data_url` | The file actually parsed (a spreadsheet, CSV or API call), when it isn't the page |
| **`source_quote`** | The source row or sentence the value came from |
| `source_hash` | Normalized content hash of the page (optional, for pages checked by quote) |
| `confidence` | high (government data, or two sources agree) / medium (one reputable source) / unverified (blank) |
| `reviewed_by` | `etl.laws.refresh (automated)` for every value the refresh wrote |
| `notes` | Thresholds, exceptions, court history, and why a cell is blank |

Long format rather than wide, for three reasons: per-fact `as_of` and provenance instead of
one date for the whole sheet; adding a law is rows, not a schema migration; and county
overrides slot in without a parallel table.

### How a value gets into the table

Only one way: `etl/laws/refresh.py` fetches the source, a parser in `etl/laws/sources/`
reads the value out of the source's own table, spreadsheet, CSV or API response, and the
refresh writes it with the source's name, URL, date and the row it came from. Nobody types
values in, and no value comes from a model's memory.

(History: the table started as a 462-row skeleton with every value empty, then was filled
from aggregators by a research pass on 2026-09-26/27. On 2026-09-27 every one of those values
was replaced by the refresh, which re-read each from a source it can re-check monthly — and
found several of them out of date; see §5b.)

---

## 5. Verification tiers

Every law is tiered by **how its value can be confirmed**. Since 2026-09-27 every tier that
has values is refreshed by code; the tier now says what kind of source it is.

### Tier A — government data, fetched or computed

| Law | How |
|---|---|
| `property_tax_effective_rate` | **Computed per county by the county ETL** from Census ACS 5-year: aggregate real estate taxes paid (B25090) ÷ aggregate home value (B25082), owner-occupied. Lives in `counties.json`, not in the law table. *Not* the median ratio first planned — the median-taxes variable B25103 is top-coded at "$10,000+". State totals match Tax Foundation's Table 33 within 0.1 point (r = 0.999). |
| `electricity_price_cents_kwh` | EIA Open Data API v2, residential retail price, latest complete year. `EIA_API_KEY` optional (public `DEMO_KEY` otherwise). |

### Tier B — a published table from a reputable source, parsed

Most laws. A publisher maintains a 51-row table (spreadsheet, CSV or HTML); the parser reads
it. **B1** = a periodic edition (Tax Foundation's annual tables, NCSL's dated brief); the
edition check flags an out-of-date year. **B2** = a living page (KFF's tracker, NCSL's
cannabis report). Where a second independent source can be fetched, the two must agree (§5a).

### Tier C — requires judgment

No page states the value, because the value is a categorization we invented (homeschool
regulation, retirement income treatment). **Not filled**: there is no machine-readable
source to re-check against, and values are never entered by hand. They stay blank until one
exists.

---

## 5a. Source registry

As of 2026-09-27. Every value is refreshed monthly by `etl/laws/refresh.py`.

| Law | Source (parsed) | Cross-check | Source date | Filled |
|---|---|---|---|---|
| `income_tax_top_rate`, `income_tax_structure` | [Tax Foundation 2026 rates table](https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/) (as of Feb 11) and [Facts & Figures Table 11](https://taxfoundation.org/data/all/state/2026-state-tax-data/) (as of Apr 28) — the later table wins per state | the two editions; differences noted | 2026-04-28 | 51/51 |
| `sales_tax_combined` | [Tax Foundation midyear sales tax table](https://taxfoundation.org/data/all/state/2026-sales-tax-rates-midyear/) (.xlsx) | — | 2026-07-01 | 51/51 |
| `grocery_tax_exempt` | [Tax Foundation Facts & Figures Table 31](https://taxfoundation.org/data/all/state/2026-state-tax-data/) (Bloomberg Tax; state statutes) | — | 2026-01-01 | 51/51 |
| `electricity_price_cents_kwh` | [EIA API](https://www.eia.gov/opendata/browser/electricity/retail-sales) | — | 2025 (annual) | 51/51 |
| `minimum_wage` | [NCSL State Minimum Wages](https://www.ncsl.org/labor-and-employment/state-minimum-wages) | Wikipedia state table (pinned revision) | 2026-07-01 | 50/51 |
| `marijuana_status` | [NCSL State Medical Cannabis Laws](https://www.ncsl.org/health/state-medical-cannabis-laws) | Wikipedia legality table (pinned revision) | 2026-09-02 | 49/51 |
| `abortion_access` | [KFF Abortion in the U.S. Dashboard](https://www.kff.org/womens-health-policy/abortion-in-the-u-s-dashboard/), "Status of Abortion Bans" (dataset behind the map) | — (KFF's analysis includes court decisions) | 2026-08-10 | 51/51 |
| `permitless_carry` | [Giffords Law Center](https://giffords.org/lawcenter/gun-laws/policy-areas/guns-in-public/concealed-carry/) list of states not requiring a permit | Wikipedia "Constitutional carry" (pinned revision) — **must agree** | 2025-09-22 | 51/51 |
| `property_tax_effective_rate` | Census ACS 5-year (county ETL) | Tax Foundation Table 33 (state totals) | 2019–2023 | all but 8 counties |
| `retirement_income_taxed`, `homeschool_regulation` | — Tier C, no machine-readable source | — | — | 0/51 |

**Cross-check rule.** Both sources agree → `confidence=high`. The second source doesn't cover
the state or its entry is unclear → the primary alone, `medium`. They disagree → **blank**,
with both figures in `notes`; the app shows "Not shown" and the reason.

**Sources ruled out** because a monthly script can't fetch them: US DOL minimum wage pages and
USCCA (HTTP 403 to any script), EPI. Ruled out for quality: DISA (a drug-testing company),
TaxJar's grocery page (prose, and aggregators contradicted each other), KFF's State Health
Facts gestational-limit table (dated 2026-01-06; the dashboard is current).

---

## 5b. What the first research pass revealed

Doing the work changed the design in five ways. Recorded because each was a wrong assumption,
not a detail.

**1. `minimum_wage` was misclassified Tier A.** DOL publishes an HTML page, not an API.
Reclassified B1.

**2. Tier B needed splitting into B1 and B2.** The first fill produced 204 warnings demanding
`source_quote` on Tax Foundation rate tables — the wrong check entirely. An annual table is
*supposed* to change wholesale each edition, so a verbatim quote signals nothing. What
actually goes wrong is a newer edition existing while you cite the old one.

- **B1** = periodic publication → verify by edition year (check 7)
- **B2** = living statute page → verify by quote drift (check 6)

**3. Check 7 (edition staleness) exists because of that.** It reads the year out of
`source_url` and flags when it trails the current year. Next January,
`state-income-tax-rates-2026` auto-flags. Better maintenance signal than anything in the
original design.

**4. `grocery_tax_exempt` could not be a boolean.** Roughly 7 of 51 states tax groceries at a
*reduced* rate — neither exempt nor taxed. Changed to ordinal `exempt|reduced|taxed`. A
two-value schema would have forced every reduced-rate state into a wrong bucket.

**5. The `abortion_access` rubric overreached.** It originally defined `protected` as
"affirmative statutory or constitutional protection," which no aggregator publishes. Rewritten
to grade gestational *access*, which sources do publish reliably. A rubric that cannot be
applied from available evidence is not a rubric.

### What the 2026-09-27 verification pass found

Re-reading every value from a source that can be re-checked, and checking each disagreement
against the state's own announcement:

- **Four income tax rates were out of date** in the aggregator-filled table — all 2026
  changes, all confirmed: **SC** 6% → 5.21% (H.4216, signed 2026-03-30, per SC DOR),
  **ME** 7.15% → 9.15% (LD 2212 surcharge), **UT** 4.5% → 4.45% (SB 60), **WV** 4.82% → 4.58%
  (SB 392). Using the later-dated Tax Foundation table is what caught SC.
- **Washington is "capital gains income only."** Facts & Figures shows WA with 7%/9% rates and
  says so only in footnote (k); the parser reads footnotes, so WA is 0 on wages.
- **NCSL listed Rhode Island's minimum wage at $15.00**; the state raised it to $16.00 on
  2026-01-01 (RI Department of Labor & Training). This is why minimum wage now needs a second
  source. RI is blank until the sources agree.
- **NCSL's "future increases" column mixes in past steps and stray old rates** (Michigan, DC);
  the parser keeps only dated future increases and applies one on its date (Florida's $15 on
  2026-09-30) with a note.
- **KFF's map alt text lagged its data by five months** (Wyoming's 2026-04-24 court ruling);
  the parser reads the dataset and its source line, never the alt text.
- **The property tax rubric would have been wrong** for high-tax counties (median top-coding);
  switched to aggregates.
- **The abortion rubric's "before viability" edge** put 24-week states in `limited`; KFF groups
  them as "at or near viability", so they're `protected`, and the rubric now says so.
- **Grocery taxes are state-level.** IL, NC and VA exempt groceries from the state tax but
  allow a local one; the rubric now says local grocery taxes are not counted.
- **The verifier's online check used a bot user agent** that Tax Foundation and KFF answer
  with 403 — it would have reported every working source as a dead link.

### Known gaps, carried deliberately

- **Blank because sources disagree:** `minimum_wage` RI; `marijuana_status` IA (NCSL:
  CBD-only; Wikipedia: medical) and ID (NCSL: illegal; Wikipedia: CBD oil allowed).
- **Single-source values** (`confidence=medium`): sales tax, groceries, abortion, DC's minimum
  wage, two marijuana entries. Reputable and cited, not independently confirmed.
- **Giffords' page was last modified 2025-09-22.** Permitless carry changes rarely and
  Wikipedia (revised 2026-07) agrees on every state, but a new law may reach Wikipedia first.
- **State-level only.** County overrides (§7) are not built: local sales tax rates, NY/OR/CA
  regional minimum wages (the state floor is shown, regional rates are in notes), local
  cannabis opt-outs.
- **Tier C laws are empty**, and will stay so without a machine-readable source.

---

## 6. The refresh and the verification harness

```bash
python -m etl.laws.refresh                  # re-fetch every source, rewrite values, verify, publish
python -m etl.laws.refresh --dry-run        # fetch and report only
python -m etl.laws.refresh --only minimum_wage
python -m etl.laws.verify_laws              # offline checks
python -m etl.laws.verify_laws --online     # also: every cited page and data file still loads
python -m etl.laws.test_sources             # parser + merge tests (offline, synthetic pages)
python -m etl.laws.test_verify              # verifier tests + checks on the real table
python -m etl.laws.publish                  # rewrite public/data/laws.json only
```

**The refresh** runs each source's fetcher. A fetcher parses the source and validates it
before anything is written: all 51 jurisdictions present, values inside `allowed_values`,
numbers in a plausible range, category splits that make sense. Any failure raises, and **that
law's rows are left exactly as they were** — their `as_of` stops advancing, so they age
visibly (§10). The run prints a change report (only real changes; "5.00" vs "5" is not one),
then runs the verifier; if the verifier finds a blocking problem nothing is published.

**The verifier** has seven checks:

| # | Check | Catches |
|---|---|---|
| 1 | **Schema** | Values outside `allowed_values`, undeclared law keys, numeric laws missing `value_numeric`, ordinals with no declared order |
| 2 | **Coverage** | Missing jurisdictions; partially filled laws (the blanks' notes say why) |
| 3 | **Staleness** | `as_of` past the cadence threshold (warn) or past the 730-day hard expiry (block). Also a `scheduled` change whose date has arrived. |
| 4 | **Provenance** | A value without `source_name`, `source_url` or `source_date` (block), or without a quote (warn) |
| 5 | **Link rot** (online) | The cited page or the parsed data file no longer loads |
| 6 | **Quote drift** (online) | For values *not* written by the refresh: the stored quote no longer appears on the page. Refreshed values skip it — they are re-derived from the source every month, which is stronger. |
| 7 | **Edition** | A B1 source URL citing an older year than the current one; a source whose own date is over two years old |

---

## 7. County overrides

Several laws are state-level with local variation. Hardcoding them as state facts produces
confidently wrong answers.

| Law | Local variation |
|---|---|
| Sales tax | Local add-ons vary within a state |
| Marijuana | State-legal with widespread municipal opt-outs — a legal state can have counties with no dispensaries |
| Alcohol | Dry counties still exist, notably in Texas |
| Minimum wage | Cities and counties set higher local minimums |
| Short-term rentals, ADUs, zoning | Almost entirely city-level — probably out of scope at county granularity |

**Resolution order:** county row if present → state row → null. Record which applied in a
`law_geo_level` field on the resolved output, exactly as `rpp_geo_level` works in the BEA
module, and for the same reason: "why does this county say that?" must be answerable without
re-deriving anything.

---

## 8. The automation line

Revised 2026-09-27: values are written by code with no human review, so the line is drawn in
code, not in a review step.

A value may be written **only** when:
- it was parsed from a source the refresh fetched in that run — never typed in, never from a
  model's memory or a web-search summary;
- it carries the source's name, URL, own date and the row it came from;
- the source passed its validation (full coverage, allowed values, plausible numbers);
- where a second source is wired up, **both agree** — otherwise the cell is blank and the note
  says why.

Never:
- Hand-edit `law_values.csv`. A wrong parse is fixed in the parser, and the next refresh
  rewrites the table.
- Fill a blank "because we know the answer." If the state's own site says Rhode Island's wage
  is $16, the fix is a source that the refresh can read and that says so, not an edit.
- Loosen a parser's validation or a verifier check to get a run through. Each exists because
  its failure produces plausible-looking wrong data.

A model or a person may still **investigate** — search the web, read a state site, compare
figures, as was done on 2026-09-27 — and change code as a result: add a source, a
cross-check, a rubric clarification.

---

## 9. Pitfalls

Each of these has bitten someone maintaining a table like this.

1. **Link rot.** The single most common failure. Check 5 exists for this.

2. **Effective date ≠ passage date ≠ signing date.** A law passed in March may take effect
   the following January. Store `effective_date` and use `status=scheduled` for future
   changes — then the harness promotes them when the date arrives instead of you discovering
   it a year late.

3. **Enjoined laws.** On the books, blocked by a court. Common in exactly the contested areas
   people filter on. A table that says "banned" for a law under injunction is wrong in the
   direction that matters. `status=enjoined` plus the case name in notes.

4. **Categorical drift.** "Moderate" means whatever the last researcher thought. The `rubric`
   column plus recording the specific requirements in `notes` makes the call auditable.

5. **Advocacy sources.** Gun law grades, landlord-friendliness rankings, and homeschool
   categorizations mostly come from organizations with a position. Using their grade imports
   their framing. **Prefer objective binaries you can cite to a statute** — "permitless carry:
   yes/no" over "gun law grade: B−". Where you must use an advocacy source, name it in
   `primary_source_name` so it's visible.

6. **Partial applicability.** "No income tax" is not the same as "no tax on income" —
   Washington has no wage income tax but does tax capital gains. Structure and rate are
   separate columns for this reason.

7. **Ballot measures.** Take effect on odd schedules, sometimes immediately on certification.

8. **The confidence trap.** A value displayed with no date and no confidence indicator reads
   as settled fact. See §10.

9. **Thresholds hidden in a category.** "Retirement income: partial" could mean exempt below
   $30k or exempt for military only. Put the threshold in `notes` or the category is a lie of
   omission.

10. **FIPS as integer.** Same bug as the main pipeline. County codes are strings.

---

## 10. UI requirements

Built 2026-09-27 as the **Laws & taxes** section of the selected-county card
(`src/components/finder/laws-section.tsx`, data from `public/data/laws.json`,
`src/lib/laws/`):

- **Every value shows its source (a link), the source's own date, and when it was last
  checked** — "Source: Tax Foundation, as of Apr 28, 2026 · checked Sep 27, 2026".
- **A value past its cadence threshold is muted and badged** "Not re-checked since …".
  Past the hard expiry it is not published at all.
- `enjoined` / `scheduled` statuses and low confidence are badged.
- **A deliberately blank value is shown as "Not shown", with the reason** (e.g. the two
  sources' figures) — never silently omitted.
- "Details" opens the notes (thresholds, court history, cross-check) and the source row
  quoted.
- The county's property tax rate is shown with its Census source and method.
- **A standing disclaimer** closes the section: compiled automatically from the linked
  sources, re-checked about monthly, verify anything you'd act on.

**Laws as filters** (2026-09-27), in the Filters panel's **Laws & taxes** tab:

| Law | Where | Control |
|---|---|---|
| `income_tax_top_rate`, `sales_tax_combined` | Laws & taxes → Taxes | Weighted slider, Lower/Average/Higher, limits |
| `electricity_price_cents_kwh` | Place → Cost of living, after utilities | Weighted slider |
| `property_tax_effective_rate` | Place → Housing (county-level) | Weighted slider |
| `marijuana_status`, `abortion_access` | Laws & taxes → Policies | Checkboxes of acceptable values (all = no filter) |
| `permitless_carry` | Laws & taxes → Policies | Any / Permitless only / Permit required only |
| `income_tax_structure`, `grocery_tax_exempt`, `minimum_wage` | County card only | Info |

Each county takes its state's value (`applyStateLaws`, `src/lib/laws`), so all counties in a
state tie on a law; percentiles are over counties, so a state with many counties (Texas, 254)
moves the percentile scale more than one with few. Policies are never weighted: a county
whose state isn't allowed is ruled out, and a blank value counts as unknown. Every law control
shows its source and dates.

---

## 11. Maintenance rhythm

| When | What |
|---|---|
| **Monthly, automated** | `.github/workflows/laws-refresh.yml` on the 1st: offline tests, refresh every source, verify, commit the new values and `laws.json`, check every link. A failed source or a dead link fails the job, so GitHub emails the repo owner; the failed law keeps its old values, visibly aging. |
| When the job fails | Fix the parser (a publisher changed its layout) or replace the source. Never patch the data. |
| **January and July** | Glance at the change reports: new editions (Tax Foundation's January tables, NCSL's July brief) should appear as changes. If a law never changes for a year, check its source is still maintained (check 7 warns after two years). |
| Anytime | Add a second source for a single-source law, or a source for a Tier C law. |

---

## 12. Current status

**Done (2026-09-27)**
- 9 laws filled from sources that code can re-check: 456 state values and 3 deliberate
  blanks, plus property tax for every county. 47 marijuana, 50 minimum wage and 51 permitless
  carry values are confirmed by a second source.
- `refresh.py` + 6 source parsers, `publish.py`, `verify_laws.py` (7 checks), 72 parser/merge
  tests and 33 verifier tests, all offline.
- Monthly GitHub Actions workflow (runs once the repo is on GitHub).
- The app's Laws & taxes section with sources and dates, and law filters (§10).

**Not done**
- Second sources for sales tax, groceries and abortion.
- County overrides (§7).
- Tier C laws — waiting for a machine-readable source.

Do not add new laws faster than they can be sourced this way. A narrow table of cited,
re-checked facts beats a wide one of guesses.

---

## 13. The backlog

Considered, not in the first twelve. Add when the core set is complete and maintained.

**Money:** homeowners insurance premium and availability (arguably the most consequential
number on this whole list — carriers have withdrawn from parts of FL, LA and CA, and in some
markets the constraint is availability, not price), estate/inheritance tax, vehicle ad valorem
tax, gas tax, capital gains treatment, transfer taxes.

**Work:** non-compete enforceability, **remote-work tax treatment** (NY, DE and NE apply a
"convenience of the employer" rule that taxes nonresident remote employees of in-state
employers — a four-figure annual surprise almost nobody checks before moving), occupational
licensing burden, state paid family leave.

**Housing:** rent control permitted, statutory eviction timeline, solar rights and net
metering, ADU legality, water rights and rainwater collection, building code strictness.

**Family:** childcare cost, compulsory school age, school choice/ESA programs, vaccine
exemption rules.

**Personal:** gambling and sports betting, fireworks, cottage food law scope, raw milk,
recording consent (one- vs two-party), stand your ground, LGBTQ+ nondiscrimination
protections, medical aid in dying, death penalty.

**Infrastructure:** broadband availability (FCC National Broadband Map — a hard requirement
for remote work, and "rural county, great schools, cheap land, no fiber" is a combination the
app will otherwise recommend happily), distance to hospital, water availability restrictions
(Arizona requires proof of a 100-year assured water supply for new subdivisions in its managed
areas, and development has been blocked on exactly that).

---

## 14. For another agent picking this up

Read `Working Master Plan.md`, then this file, then `law_definitions.csv` — the rubrics there
are the specification for what each value means — then `etl/laws/refresh.py`.

**Rules that matter:**

- **Values come only from `refresh.py` parsing a cited source** (§8). Never edit
  `law_values.csv` by hand; fix the parser.
- Adding a law: a row in `law_definitions.csv` (with a mechanically-applicable `rubric`), a
  parser in `etl/laws/sources/` that validates coverage and values, an entry in
  `refresh.FETCHERS` / `PRODUCES`, and offline tests with a synthetic page in the source's layout.
- Prefer a source a script can fetch. A source that blocks scripts can't be re-checked, so it
  can't be used.
- `law_key` is a stable identifier. Renaming one breaks the join and any saved user filter.
- Ordinals must declare `ordinal_low_to_high`, or the preference control has no meaning.
- FIPS codes are strings.
- If you loosen a check in `verify_laws.py` or a parser's validation to make something pass,
  you have almost certainly made the wrong change.
