# Full audit of Lodestar — prompt for an AI agent

*Written 2026-10-04 for a fresh session (intended: Claude Fable 5.1). Read this whole file,
then `AGENTS.md`, then `Working Master Plan.md` (§2, §6, §9 Phase 8f and the "Results audit"
section, §10) before touching anything.*

---

## Your job

You are auditing **Lodestar** (www.lodestarmap.com), a personal-use PWA that helps someone
decide where in the US to move. They set priorities (weighted 1–5) and must-haves (hard
limits, states, policies, climate), and get the best **areas** (census tracts) nationwide,
ranked, with a map, a results list, and a page per area and per county.

The owner's standard, in their words: *"The most important thing about this app is that it
actually works and the data is accurate and the results are genuinely helpful, not
misleading."*

Audit everything built so far, fix what's wrong, and improve what's weak — in this order:

1. **Scoring and results: correct, accurate, genuinely useful, never misleading.** This is
   the product. Spend most of your effort here.
2. **UI and ease of use:** can a first-time visitor understand what they're seeing and act on
   it, on a phone and on a desktop?
3. **Everything else:** code health, performance, offline/PWA, accessibility, data pipeline
   robustness.

You have a long budget. Be thorough and skeptical: assume there are bugs nobody has found yet,
and go find them with evidence, not opinions. Fix them, verify the fix, and record what you did.

---

## What already exists (don't redo it — build on it, and check it)

**Architecture.** Next.js 16 (App Router, prerendered static pages on Vercel — no server logic; read
`node_modules/next/dist/docs/` before writing Next code — it differs from your training data),
React 19, TypeScript, Tailwind 4, MapLibre, Serwist PWA, Vitest. No backend: the browser scores
everything over static files. A Python/pandas ETL (`etl/`) builds the data.

**Data.**
- Counties: `public/data/counties.json` (3,144 counties; built by `python -m etl.build`).
- State laws/taxes: `public/data/laws.json` (built only by `python -m etl.laws.refresh`, which
  parses cited sources — read `LAWS.md` §8 first; never hand-edit values).
- Areas: 84,119 census tracts. Per-county files `{fips}.json` and `areas.json` (all areas'
  scoring columns, column-major), hosted on Cloudflare R2 at data.lodestarmap.com, rebuilt
  monthly by `.github/workflows/tracts-refresh.yml`. Local copies in `public/data/tracts/`
  (git-ignored). Upload with `python -m etl.tracts.upload`.

**Scoring (read plan §6 and the code — `src/lib/scoring/score.ts`, `percentile.ts`,
`src/lib/tracts/national.ts`, `scoring.ts`, `verdicts.ts`):**
- Every measure has one level: **county-wide** (climate, taxes, laws, cost of living,
  electricity, unemployment) or **by area** (home value, rent, income, nearest schools, crime,
  walkability, distances, hazards, density, commute, families…). Old county stand-ins migrate to
  the area level (`MOVED_TO_AREAS`).
- Each value becomes a **national percentile**, then **points** (0–100, higher is better) by
  direction: higher / lower / middle ("typical is best", `100 − 2·|p − 50|`).
- An area's **match score** = weighted average of points over all priorities; county-wide
  priorities use the county's points.
- **Results** = top 100 (or 250/500) areas nationwide; counties rank by their best area.

**Decisions from the first results audit (2026-10-04) — keep these unless you find they're
wrong, and say so if you change one:**
- A weighted priority with **no value counts as average (50 points)** at full weight — never
  dropped (dropping it let areas known on one good measure outrank complete ones).
- **Ties:** points count a tie as a win (`percentileBounds`: the best possible value scores 100
  however many places share it). Rarity claims — gold bars, "Top 1% in the US" badges — use
  `beats`, the share strictly worse (ties count against).
- **Not results:** areas with ≤ 50 residents, or ≥ 50% in group quarters (bases, dorms,
  prisons) — `notResidential`.
- **Unknown for a must-have** ranks after every verified match (areas and counties).
- **Zero violent AND zero property crime** = no data (an agency that didn't report).
- **Mobile homes:** ≥ 50% of owned homes → a caution on the home value, no "Cheapest homes"
  badge; the value still ranks (it's real). The owner may want this revisited.
- **Home value and rent are scored "at today's prices":** the Census tract value × its ZIP's
  Zillow/Census ratio (county, then national fallback) — `etl/tracts/national.py today_prices`.
- **Schools** are percentiles of the specific nearest schools, never county averages.
- Must-haves only, no priorities: matches listed by population, labelled as not a ranking.

**A results audit harness exists:** `npm run audit:results` runs 16 realistic searches
(`scripts/audit/results.audit.ts`) through the app's own scoring code over the real data and
writes `scripts/audit/report.md` (git-ignored): each search's top areas/counties with the values
and points behind them, plus automatic checks (missing data, low confidence, tiny areas,
concentration, must-have leaks, ties). Read the report first; then extend the harness.

---

## Priority 1 — scoring and results

Your goal is to be able to say, with evidence: *for the searches real people would run, the
results are right, the numbers shown are true, and nothing on screen misleads.*

**1. Verify the math and the pipeline end to end.**
- Re-derive points and scores by hand for a handful of areas and counties (from the raw values
  in `public/data/`) and compare with what the app shows. Check every direction (higher, lower,
  middle), ties, missing values, county-wide + area mixes, weights, must-have gates, unknowns.
- Check the percentile population is right: national, not filtered; are `notResidential` areas
  distorting it? Should they be excluded from the distribution too?
- Check units and formatting everywhere a number is shown (dollars, %, per 100k, miles, °F,
  "pctl", top-codes like "$2M+").
- Check `today_prices` against real-world knowledge for well-known places, and its fallbacks.
- Check the "typical US area" medians (`US_TYPICAL` in `src/lib/tracts/verdicts.ts`) against
  the data; they were computed once.

**2. Grow the audit into the test it should be.** Extend `scripts/audit/results.audit.ts`
with many more searches — at least 40 — that mirror real intents: young families on a budget,
retirees, remote workers, outdoors people, city lovers, people leaving high-cost metros,
single-priority searches for every measure (each direction), must-have-only searches,
state-restricted searches, policy filters (each law/policy), climate-type filters, extreme
weights, conflicting priorities (cheap AND top schools AND walkable). For each, write down what
a knowledgeable human would expect and check the results against it. Add checks that fail
loudly: e.g. a top result whose shown value contradicts its points, a policy filter passing a
state whose sources say otherwise, a "Top 1%" claim that isn't, a score from mostly missing
data, an area that isn't residential.

**3. Hunt for misleading results specifically.** Places that technically score well but no
reasonable person would want or recognize: data artifacts, small-sample Census values (look at
`low_confidence` and margins of error), crime rates from agencies that don't cover the area,
school matches across district lines, hazard or distance values that look implausible,
duplicate or confusing area names, counties dominated by one feature. For each pattern, decide:
fix the data, change the rule, add a caution, or document why it's right.

**4. Check the explanations.** Every result explains itself (trade-off sentence, bars, "why it
ranks here", badges, verdict lines like "More crime than a typical US area", gold bars). Each
claim must be true for that area. Write tests for the wording functions
(`tradeOff`, `verdicts.ts`, `standing` in `area-detail.tsx`) across edge cases.

**5. Data quality at the source.** Run the ETL tests (`etl/.venv/bin/python -m
etl.test_offline`, and for laws `-m etl.laws.test_sources`, `-m etl.laws.test_verify`). Look
for sources that are stale, mis-joined (FIPS with lost leading zeros, renamed counties —
Connecticut planning regions, Alaska), or silently partial. Check coverage per state.

## Priority 2 — UI and user-friendliness

Use the app like a first-time visitor, on desktop and at phone width (390 px), light and dark.

- **First visit:** does the tour (`src/components/finder/tour.tsx`) make sense, place its cards
  well on every step, and leave the user ready to search? Is the default search sensible?
- **Filters:** is it clear what "priorities" vs "must-haves", "by area" vs "county-wide",
  importance and "better: lower/average/higher" mean? Can someone build the search in their
  head without help?
- **Results:** list, summaries, fingerprints, badges, Areas/Counties toggle, Top 100/250/500,
  the map (zoom-dependent state/county bubbles and area dots), tooltips, "Reveal full county".
- **Area and county pages:** the section style (takeaway + visuals + "Show details"), numbers,
  sources, cautions. Is anything confusing, redundant, or missing that a mover would want?
- **Accessibility:** keyboard paths, focus, screen-reader labels, contrast (WCAG AA), touch
  targets, reduced motion.
- **Performance and offline:** load time of `areas.json` (~3.7 MB compressed), scoring speed on
  a slow phone, the service worker and offline behaviour (`npm run build && npm run start`).

Prefer small, clearly better changes over redesigns. For anything that changes how the app
looks or behaves in a big way, write it up as a proposal (with a mockup if it helps) instead of
shipping it — the owner decides design direction.

---

## Rules of this repo (read `AGENTS.md`; these matter most)

- Follow `Working Master Plan.md`. Record decisions, findings and open questions **there**, tick
  what you finish, update its "Last updated" date. When the code and the plan disagree, the code
  is right — fix the plan.
- Don't build anything in plan §10 *Explicitly deferred*. No backend, no accounts.
- Never hand-edit generated data (`public/data/*`, `etl/data/law_*.csv`). Change the ETL and
  rebuild.
- Never print or commit secrets (`etl/.env`: Census, EIA, R2 keys). Don't commit `.claude/`.
- Before calling anything done: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`;
  for ETL changes `etl/.venv/bin/python -m etl.test_offline`; re-run `npm run audit:results` and
  read the report.
- Type sizes are tokens (`text-caption` / `label` / `body` / `title` / `heading`), never
  `text-[11px]`. Dark mode is `<html data-theme>` via `dark:`.
- Commit in small, focused commits with clear messages; push to `main` (the owner deploys from
  it). If you rebuild area data, upload it with `python -m etl.tracts.upload` and check the live
  file (`https://data.lodestarmap.com/tracts/areas.json`).

**Practical notes from earlier sessions:**
- Dev server: `npm run dev` (port 3000). It may need starting.
- In an automated browser tab that's hidden, MapLibre doesn't render or animate and CSS
  transitions freeze. Verify map behaviour from the map object (`window.__lodestarMap` in
  development: camera, sources, feature state) or ask the owner to look. For phone widths, an
  iframe of the app at 390 px inside the page works when the window can't be resized.
- The owner's browser shares localStorage with yours on localhost: clear or restore what you
  change (e.g. `lodestar.tour`, `lodestar.area-sections`).

---

## What to deliver

1. **Fixes**, committed and pushed, each verified (tests or the audit report showing the
   before and after).
2. **An expanded audit harness** (40+ searches, stronger automatic checks) that a future session
   can re-run to catch regressions.
3. **Tests** for every bug you fix and every rule you rely on.
4. **A written audit report**, added to the plan (a new dated section), covering:
   - what you checked and how
   - what you found, ranked by how misleading or broken it was
   - what you fixed
   - what's still open, with your recommendation and anything the owner must decide
5. **A short summary for the owner**, in plain language. Lead with whether they can trust the
   results now and why, then the biggest changes, then the decisions waiting on them.

Don't stop at the first round of fixes: after fixing, re-run everything, look again at the
results with fresh eyes, and keep going until another pass turns up nothing that matters.
