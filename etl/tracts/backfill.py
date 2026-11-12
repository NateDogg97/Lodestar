"""
Backfill the results-audit columns into already-published area files, without a full
rebuild (2026-10-04). A full rebuild (`python -m etl.tracts.build`) produces the same
thing; this patches public/data/tracts/{fips}.json in place:

- group_quarters_share (+ _moe): % of people in barracks, dorms, prisons, nursing homes
- mobile_home_share (+ _moe): % of owner-occupied homes that are mobile homes
- low_confidence gains "mobile_homes" where most owned homes are mobile homes, and the
  ACS margin flags for the two shares
- zero violent AND zero property crime becomes no data (and loses its "crime" flag)
- crime rates become yearly rates (full audit, 2026-10-04): a partial year's counts are
  annualized, and an agency with too little to rate (crime.rate_note: few months, too few
  person-years, implausibly little for its size) loses its rate and gains `crime_note`.
- who lives here (2026-10-04, etl/demographics.py): shares by race and Hispanic origin,
  the diversity index and the Gini index (flagged like a median). `--demographics` does
  only this (one Census call per state).
- a household income at the Census cap ($250,001) is top-coded, not low confidence
  (full audit, 2026-10-04; config.ACS_TOPCODE gained the cap).
  `--offline` does only these last two, with no network.
- pollution (Phase 11, 2026-10-13): `--pollution` adds the columns of the national tables
  `etl.pollution.pm25`, `.smoke` and `.radon` wrote to data/interim/, and the older-housing
  shares from the tract ACS (one Census call per state). PM2.5 gains the "pm25" flag where
  most residents live near a monitor reading well above it (etl/pollution/doubt.py), and
  the older-housing share its ACS margin flag.
- property tax by area (2026-10-13): `--taxes` adds `property_tax_rate` (taxes paid ÷ home
  values, owner-occupied) and its margin from the tract ACS, flagged like a median.

- schools inside the district (2026-11-11): `--schools` re-picks each area's schools by
  district boundary and re-derives its school score (schools.area_schools), from the
  published files and the Census district boundaries alone — no SEDA or CRDC files.

One Census API call per state (all tracts at once), then `python -m etl.tracts.national`
to rebuild areas.json, then `python -m etl.tracts.upload`.

    python -m etl.tracts.backfill            # every published county
    python -m etl.tracts.backfill --state TX # one state
    python -m etl.tracts.backfill --offline  # only the crime and top-code rules (no network)
    python -m etl.tracts.backfill --demographics  # only who lives here
    python -m etl.tracts.backfill --pollution     # only pollution (after the national runs)
    python -m etl.tracts.backfill --taxes         # only the property tax rate by area
    python -m etl.tracts.backfill --schools       # only the schools, by district boundary
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict

from ..util import get_logger
from . import acs
from .build import MOBILE_HOME_SHARE
from .crime import rate_note
from .publish import PUBLISH_DIR

log = get_logger("tracts.backfill")

NEW = ["group_quarters_share", "group_quarters_share_moe", "mobile_home_share", "mobile_home_share_moe"]
SHARES = ("group_quarters_share", "mobile_home_share")


def _num(v: object, digits: int) -> float | int | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    x = round(float(v), digits)
    return int(x) if digits == 0 else x


def patch_county(payload: dict, by_geoid: dict[str, dict]) -> dict[str, int]:
    """Add the new columns and flags to one county payload, in place. Returns counts."""
    cols: list[str] = payload["columns"]
    for c in NEW:
        if c not in cols:
            cols.append(c)
            for r in payload["rows"]:
                r.append(None)
    at = {c: cols.index(c) for c in cols}
    counts = {"mobile": 0, "gq": 0, "crime_zero": 0}
    for r in payload["rows"]:
        src = by_geoid.get(r[at["geoid"]])
        flags = [f for f in (r[at["low_confidence"]] or "").split(";") if f]
        if src:
            for c in NEW:
                r[at[c]] = _num(src.get(c), 0 if c.endswith("_moe") else 1)
            # The ACS margin flags for the two new shares, as a rebuild would add them.
            for c in SHARES:
                if c in src["flags"] and c not in flags:
                    flags.append(c)
        share = r[at["mobile_home_share"]]
        if share is not None and share >= MOBILE_HOME_SHARE and r[at["median_home_value"]] is not None:
            if "mobile_homes" not in flags:
                flags.append("mobile_homes")
            counts["mobile"] += 1
        gq = r[at["group_quarters_share"]]
        if gq is not None and gq >= 50:
            counts["gq"] += 1
        if "violent_rate" in at and r[at["violent_rate"]] == 0 and r[at["property_rate"]] == 0:
            r[at["violent_rate"]] = r[at["property_rate"]] = None
            flags = [f for f in flags if f != "crime"]
            counts["crime_zero"] += 1
        r[at["low_confidence"]] = ";".join(flags)
    return counts


def patch_crime(payload: dict) -> dict[str, int]:
    """Yearly crime rates (crime.py's rule) in one published county, in place.

    The published rate was count × 100k / population for however many months the agency
    reported: × 12 / months makes it a yearly rate. Then `rate_note` decides whether the
    agency can have a rate at all. The `crime_note` column marks a file already done, so
    running twice never annualizes twice.
    """
    cols: list[str] = payload["columns"]
    counts = {"annualized": 0, "unrated": 0}
    if "violent_rate" not in cols or "crime_note" in cols:
        return counts
    cols.append("crime_note")
    for r in payload["rows"]:
        r.append(None)
    at = {c: cols.index(c) for c in cols}
    for r in payload["rows"]:
        v, p, months, pop = r[at["violent_rate"]], r[at["property_rate"]], r[at["crime_months"]], r[at["crime_population"]]
        if v is None or not months:
            continue
        scale = 12 / months
        v, p = v * scale, (p * scale if p is not None else None)
        note = rate_note(pop, months, r[at["crime_year"]], v, p)
        if note:
            r[at["violent_rate"]] = r[at["property_rate"]] = None
            r[at["crime_note"]] = note
            r[at["low_confidence"]] = ";".join(f for f in (r[at["low_confidence"]] or "").split(";") if f and f != "crime")
            counts["unrated"] += 1
        elif months < 12:
            r[at["violent_rate"]], r[at["property_rate"]] = int(round(v)), None if p is None else int(round(p))
            counts["annualized"] += 1
    return counts


def patch_crime_scope(payload: dict) -> dict[str, int]:
    """`crime_shared` and the "crime_wide" caution (crime.shared_rates), in place. Re-run
    safe: both are recomputed from the published rates every time."""
    import pandas as pd

    from .crime import shared_rates

    cols: list[str] = payload["columns"]
    if "crime_agency" not in cols or "violent_rate" not in cols:
        return {"wide": 0}
    if "crime_shared" not in cols:
        cols.append("crime_shared")
        for r in payload["rows"]:
            r.append(None)
    at = {c: cols.index(c) for c in cols}
    rows = payload["rows"]
    col = lambda c: pd.Series([r[at[c]] for r in rows], dtype="object")  # noqa: E731
    num = lambda c: pd.to_numeric(col(c), errors="coerce")  # noqa: E731
    shared, wide = shared_rates(col("crime_agency"), num("density_per_sq_mi"), num("population"),
                                num("violent_rate").notna())
    for k, r in enumerate(rows):
        r[at["crime_shared"]] = None if pd.isna(shared[k]) else int(shared[k])
        flags = [f for f in (r[at["low_confidence"]] or "").split(";") if f and f != "crime_wide"]
        if wide[k]:
            flags.append("crime_wide")
        r[at["low_confidence"]] = ";".join(flags)
    return {"wide": int(wide.sum())}


def published_district_curve(payloads: list[dict]) -> "np.ndarray":
    """Every published district's score, sorted: what a big district's nearest schools are
    placed among (a rebuild uses SEDA's full list; a district no area's people live in is
    the only difference)."""
    import numpy as np

    scores: dict[str, float] = {}
    for p in payloads:
        cols = p["columns"]
        if "district_id" not in cols or "district_score" not in cols:
            continue
        i, j = cols.index("district_id"), cols.index("district_score")
        for r in p["rows"]:
            if r[i] is not None and r[j] is not None:
                scores[r[i]] = r[j]
    return np.sort(np.array(list(scores.values()), dtype=float))


SCHOOL_COLUMNS = ["nearby_schools", "nearby_school_pctl", "school_basis", "nearby_high_schools", "nearby_hs_pctl"]


def patch_schools(payloads: dict[str, dict], curve: "np.ndarray") -> dict[str, int]:
    """One state's published counties, in place: each area's schools are those standing
    inside its district boundary (etl/tracts/schools.py, IN THE DISTRICT). The state's
    scored schools are the union of its counties' school tables."""
    import numpy as np
    import pandas as pd

    from . import geo, schools

    state = next(iter(payloads))[:2]
    by_key: dict[str, dict] = {}
    for fips, p in payloads.items():
        sc = p["schools"]["columns"]
        for r in p["schools"]["rows"]:
            row = dict(zip(sc, r))
            if row.get("in_county") is not False:  # listed by its own county: rank and all
                by_key[row["school_id"]] = {**row, "home": fips}
    sch = pd.DataFrame(list(by_key.values())).rename(columns={"school_id": "key"})
    counts = {"areas": 0, "schools_changed": 0, "moved10": 0, "by_nearby": 0, "lost": 0, "hs_lost": 0}
    if sch.empty:
        return counts
    la, lo = sch["lat"].to_numpy(float), sch["lon"].to_numpy(float)
    sch["boundary"] = [schools._boundary(h) for h in geo.locate(la, lo, schools._district_polygons(state))]
    sch["hs_boundary"] = [schools._boundary(h) for h in geo.locate(la, lo, schools._district_polygons(state, "SCSD"))]
    for fips, p in payloads.items():
        cols: list[str] = p["columns"]
        for c in SCHOOL_COLUMNS:
            if c not in cols:
                cols.append(c)
                for r in p["rows"]:
                    r.append(None)
        at = {c: cols.index(c) for c in cols}
        rows = p["rows"]
        lat = np.array([r[at["pop_lat"]] for r in rows], dtype=float)
        lon = np.array([r[at["pop_lon"]] for r in rows], dtype=float)
        where = pd.DataFrame({
            "pop_lat": lat, "pop_lon": lon,
            "boundary": [schools._boundary(h) for h in geo.locate(lat, lon, schools._district_polygons(state))],
            "hs_boundary": [schools._boundary(h) for h in geo.locate(lat, lon, schools._district_polygons(state, "SCSD"))],
            "district_pctl": pd.to_numeric(pd.Series([r[at["district_pctl"]] for r in rows], dtype="object"), errors="coerce"),
        })
        new = schools.area_schools(where, sch, curve)
        used: set[str] = set()
        for k, r in enumerate(rows):
            n = new.iloc[k]
            residential = (r[at["population"]] or 0) > 50
            before, before_hs = r[at["nearby_school_pctl"]], r[at["nearby_hs_pctl"]]
            after = _num(n["nearby_school_pctl"], 1)
            after_hs = _num(n["nearby_hs_pctl"], 1)
            if residential:
                counts["areas"] += 1
                counts["schools_changed"] += (r[at["nearby_schools"]] or "") != n["nearby_schools"]
                counts["moved10"] += before is not None and after is not None and abs(after - before) >= 10
                counts["by_nearby"] += n["school_basis"] == "nearby"
                counts["lost"] += before is not None and after is None
                counts["hs_lost"] += before_hs is not None and after_hs is None
            r[at["nearby_schools"]] = n["nearby_schools"] or None
            r[at["nearby_school_pctl"]] = after
            r[at["school_basis"]] = n["school_basis"] if isinstance(n["school_basis"], str) else None
            r[at["nearby_high_schools"]] = n["nearby_high_schools"] or None
            r[at["nearby_hs_pctl"]] = after_hs
            used.update(i for c in ("nearby_schools", "nearby_high_schools") for i in n[c].split(";") if i)
        # The county's own schools, plus the ones its areas list from the next county.
        sc = p["schools"]["columns"]
        out_rows = []
        for key, row in by_key.items():
            if row["home"] == fips:
                out_rows.append([row.get(c) for c in sc])
            elif key in used:
                away = {**row, "in_county": False, "county_rank": None, "county_count": None}
                out_rows.append([away.get(c) for c in sc])
        p["schools"]["rows"] = out_rows
    return counts


def patch_hazards(payload: dict, table: "pd.DataFrame") -> dict[str, int]:
    """FEMA's rating words and the display-only hazards (etl/tracts/nri.py) for one published
    county, in place; the ranked loss-rate percentiles are left as they are."""
    import pandas as pd

    cols: list[str] = payload["columns"]
    by_geoid = table.set_index("geoid")
    new = [c for c in table.columns if c != "geoid" and (c.endswith("_rating") or c not in cols)]
    for c in new:
        if c not in cols:
            cols.append(c)
            for r in payload["rows"]:
                r.append(None)
    at = {c: cols.index(c) for c in cols}
    done = 0
    for r in payload["rows"]:
        g = r[at["geoid"]]
        if g not in by_geoid.index:
            continue
        row = by_geoid.loc[g]
        for c in new:
            v = row[c]
            r[at[c]] = None if pd.isna(v) else (v if isinstance(v, str) else round(float(v)))
        done += 1
    return {"hazards": done}


EDGE_COLUMNS = ["dist_metro_mi", "nearest_metro", "dist_great_lake_mi", "nearest_town", "dist_town_mi"]


def patch_edges(payload: dict) -> dict[str, int]:
    """Edge distances (etl/edges.py) from each area's population center, in place."""
    import numpy as np

    from ..edges import edge_columns

    cols: list[str] = payload["columns"]
    for c in EDGE_COLUMNS:
        if c not in cols:
            cols.append(c)
            for r in payload["rows"]:
                r.append(None)
    at = {c: cols.index(c) for c in cols}
    rows = [r for r in payload["rows"] if r[at["pop_lat"]] is not None and r[at["pop_lon"]] is not None]
    if not rows:
        return {"edges": 0}
    lat = np.array([float(r[at["pop_lat"]]) for r in rows])
    lon = np.array([float(r[at["pop_lon"]]) for r in rows])
    edge = edge_columns(lat, lon, with_towns=True)
    for k, r in enumerate(rows):
        for c in EDGE_COLUMNS:
            v = edge[c].iloc[k]
            r[at[c]] = v if isinstance(v, str) else float(v)
    return {"edges": len(rows)}


DEMOGRAPHICS_DIGITS = {"gini_index": 3}


def patch_demographics(payload: dict, by_geoid: dict[str, dict]) -> dict[str, int]:
    """Add the demographics columns (etl/demographics.py) to one county payload, in place,
    with the Gini index's low-confidence flag. Idempotent: values are replaced."""
    from ..demographics import COLUMNS

    cols: list[str] = payload["columns"]
    for c in COLUMNS:
        if c not in cols:
            cols.append(c)
            for r in payload["rows"]:
                r.append(None)
    at = {c: cols.index(c) for c in cols}
    counts = {"demographics": 0}
    for r in payload["rows"]:
        src = by_geoid.get(r[at["geoid"]])
        if not src:
            continue
        for c in COLUMNS:
            r[at[c]] = _num(src.get(c), DEMOGRAPHICS_DIGITS.get(c, 1))
        flags = [f for f in (r[at["low_confidence"]] or "").split(";") if f and f != "gini_index"]
        if "gini_index" in src["flags"] and r[at["gini_index"]] is not None:
            flags.append("gini_index")
        r[at["low_confidence"]] = ";".join(flags)
        counts["demographics"] += 1
    return counts


def patch_topcodes(payload: dict) -> dict[str, int]:
    """Top-coded Census medians (config.ACS_TOPCODE) noted in `topcoded`, never flagged low
    confidence for the margin the Census can't compute there. Idempotent."""
    from .. import config

    cols: list[str] = payload["columns"]
    counts = {"topcoded": 0}
    if "topcoded" not in cols or "low_confidence" not in cols:
        return counts
    at = {c: cols.index(c) for c in cols}
    for r in payload["rows"]:
        for col, cap in config.ACS_TOPCODE.items():
            if col not in at or r[at[col]] is None or r[at[col]] < cap:
                continue
            topped = [t for t in (r[at["topcoded"]] or "").split(";") if t]
            flags = [f for f in (r[at["low_confidence"]] or "").split(";") if f]
            if col in topped and col not in flags:
                continue
            if col not in topped:
                topped.append(col)
            r[at["topcoded"]] = ";".join(topped)
            r[at["low_confidence"]] = ";".join(f for f in flags if f != col)
            counts["topcoded"] += 1
    return counts


# Pollution columns in the area files: name -> decimals (etl/pollution/*, Phase 11).
POLLUTION = {
    "pm25": 1, "pm25_max": 1, "pm25_above": 0, "pm25_doubt": 0,
    "pm25_monitor_site": None, "pm25_monitor_name": None, "pm25_monitor_km": 0, "pm25_monitor": 1,
    "smoke_days": 0, "smoke_days_thick": 1,
    "pre1960_share": 0, "pre1960_share_moe": 0, "pre1980_share": 0, "pre1980_share_moe": 0,
    "radon_above4": 0, "radon_above2": 0, "radon_ci": 0,
}
POLLUTION_FLAGS = ("pm25", "pre1960_share")
# The quality gate for --pollution (11f): share of residential areas (51+ people) with a
# value, below which a source is broken, not sparse — the run fails before any upload.
# Radon is judged on the lower 48 only (the model has no Alaska or Hawaii); nationally it
# covers 94.5% (dense, basement-poor ZIPs are left out by the model), the others 100%.
POLLUTION_FLOORS = {"pm25": 99.0, "smoke_days_thick": 99.0, "pre1960_share": 95.0, "radon_above4": 85.0}
NOT_LOWER_48 = ("02", "15")


def pollution_gate(counts: dict[str, int]) -> list[str]:
    """The measures whose coverage fell below their floor, as messages (empty: pass)."""
    out = []
    for c, floor in POLLUTION_FLOORS.items():
        den = counts.get("residential_l48" if c == "radon_above4" else "residential", 0)
        if not den:
            continue
        share = 100 * counts.get(f"known_{c}", 0) / den
        if share < floor:
            out.append(f"{c}: {share:.1f}% of residential areas have a value (floor {floor:g}%)")
    return out


def pollution_table() -> "pd.DataFrame":
    """The national per-tract pollution tables, joined (each must have been run for `all`)."""
    import pandas as pd

    from .. import config

    out = None
    for name in ("pm25", "smoke", "radon"):
        path = config.INTERIM_DIR / f"{name}_tracts.csv"
        t = pd.read_csv(path, dtype={"tract": str, "pm25_monitor_site": str})
        out = t if out is None else out.merge(t, on="tract", how="outer")
    assert out is not None
    return out.rename(columns={"tract": "geoid"})


def patch_pollution(payload: dict, by_geoid: dict[str, dict]) -> dict[str, int]:
    """Pollution columns and their flags for one county payload, in place (idempotent)."""
    from ..pollution.doubt import DOUBTED_SHARE

    cols: list[str] = payload["columns"]
    for c in POLLUTION:
        if c not in cols:
            cols.append(c)
            for r in payload["rows"]:
                r.append(None)
    at = {c: cols.index(c) for c in cols}
    counts = {"pollution": 0, "doubted": 0, "residential": 0, "residential_l48": 0,
              **{f"known_{c}": 0 for c in POLLUTION_FLOORS}}
    for r in payload["rows"]:
        src = by_geoid.get(r[at["geoid"]])
        flags = [f for f in (r[at["low_confidence"]] or "").split(";") if f and f not in POLLUTION_FLAGS]
        if src:
            for c, digits in POLLUTION.items():
                v = src.get(c)
                if digits is None:
                    r[at[c]] = None if v is None or (isinstance(v, float) and math.isnan(v)) else str(v)
                else:
                    r[at[c]] = _num(v, digits)
            if r[at["pm25"]] is not None and (src.get("pm25_doubt") or 0) >= DOUBTED_SHARE:
                flags.append("pm25")
                counts["doubted"] += 1
            if "pre1960_share" in src.get("flags", set()) and r[at["pre1960_share"]] is not None:
                flags.append("pre1960_share")
            counts["pollution"] += 1
        r[at["low_confidence"]] = ";".join(flags)
        if "population" in at and (r[at["population"]] or 0) >= 51:
            l48 = str(r[at["geoid"]])[:2] not in NOT_LOWER_48
            counts["residential"] += 1
            counts["residential_l48"] += l48
            for c in POLLUTION_FLOORS:
                if r[at[c]] is not None:
                    counts[f"known_{c}"] += 1 if c != "radon_above4" else l48
    return counts


TAX_COLUMNS = ("property_tax_rate", "property_tax_rate_moe")


def patch_taxes(payload: dict, by_geoid: dict[str, dict]) -> dict[str, int]:
    """The area's property tax rate, its margin and flag, in place (idempotent)."""
    cols: list[str] = payload["columns"]
    for c in TAX_COLUMNS:
        if c not in cols:
            cols.append(c)
            for r in payload["rows"]:
                r.append(None)
    at = {c: cols.index(c) for c in cols}
    counts = {"taxes": 0, "taxes_flagged": 0}
    for r in payload["rows"]:
        src = by_geoid.get(r[at["geoid"]])
        if not src:
            continue
        for c in TAX_COLUMNS:
            r[at[c]] = _num(src.get(c), 2)
        flags = [f for f in (r[at["low_confidence"]] or "").split(";") if f and f != "property_tax_rate"]
        if "property_tax_rate" in src["flags"] and r[at["property_tax_rate"]] is not None:
            flags.append("property_tax_rate")
            counts["taxes_flagged"] += 1
        r[at["low_confidence"]] = ";".join(flags)
        counts["taxes"] += r[at["property_tax_rate"]] is not None
    return counts


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state", help="two-digit state FIPS, comma-separated (default: all published)")
    ap.add_argument("--offline", action="store_true", help="only the crime and top-code rules (no Census calls)")
    ap.add_argument("--demographics", action="store_true", help="only who lives here (one Census call per state)")
    ap.add_argument("--nri", action="store_true", help="only FEMA's ratings and the display-only hazards (NRI tract table)")
    ap.add_argument("--edges", action="store_true", help="only the metro-edge, Great Lake and town-center distances")
    ap.add_argument("--pollution", action="store_true", help="only pollution (national interim tables + ACS older housing)")
    ap.add_argument("--taxes", action="store_true", help="only the property tax rate by area (one Census call per state)")
    ap.add_argument("--schools", action="store_true", help="only the schools: inside each area's district boundary")
    args = ap.parse_args()
    wanted = set(args.state.split(",")) if args.state else None
    files = sorted(PUBLISH_DIR.glob("[0-9][0-9][0-9][0-9][0-9].json"))
    by_state: dict[str, list] = defaultdict(list)
    for f in files:
        if wanted is None or f.stem[:2] in wanted:
            by_state[f.stem[:2]].append(f)
    total = defaultdict(int)
    if args.schools:
        # The curve is national, whatever states are patched.
        curve = published_district_curve([json.loads(f.read_text()) for f in files])
        for state, paths in sorted(by_state.items()):
            payloads = {path.stem: json.loads(path.read_text()) for path in paths}
            for k, v in patch_schools(payloads, curve).items():
                total[k] += v
            for path in paths:
                path.write_text(json.dumps(payloads[path.stem], separators=(",", ":"), allow_nan=False))
            log.info("state %s: %d counties", state, len(paths))
        log.info("done: %d areas; %d list different schools; %d scores moved 10+ points; %d ranked by their "
                 "nearest schools in a big district; %d lost their school score, %d their high-school score "
                 "(no scored school in the district)", total["areas"], total["schools_changed"], total["moved10"],
                 total["by_nearby"], total["lost"], total["hs_lost"])
        return
    if args.edges:
        for state, paths in sorted(by_state.items()):
            for path in paths:
                payload = json.loads(path.read_text())
                total["edges"] += patch_edges(payload)["edges"]
                path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
            log.info("state %s: %d counties", state, len(paths))
        log.info("done: %d areas with edge distances", total["edges"])
        return
    if args.taxes:
        for state, paths in sorted(by_state.items()):
            parsed = acs.parse(acs._state_raw(state))
            by_geoid = {
                g: {**{c: v for c, v in zip(TAX_COLUMNS, vals)}, "flags": set((lc or "").split(";"))}
                for g, lc, *vals in zip(parsed["geoid"], parsed["low_confidence"], *(parsed[c] for c in TAX_COLUMNS))
            }
            for path in paths:
                payload = json.loads(path.read_text())
                for k, v in patch_taxes(payload, by_geoid).items():
                    total[k] += v
                path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
            log.info("state %s: %d counties", state, len(paths))
        log.info("done: %d areas with a property tax rate, %d of them low confidence", total["taxes"], total["taxes_flagged"])
        return
    if args.pollution:
        table = pollution_table()
        for state, paths in sorted(by_state.items()):
            parsed = acs.parse(acs._state_raw(state))
            lead = parsed.set_index("geoid")[["pre1960_share", "pre1960_share_moe", "pre1980_share",
                                              "pre1980_share_moe", "low_confidence"]]
            t = table[table["geoid"].str[:2] == state].set_index("geoid")
            by_geoid: dict[str, dict] = {}
            for g in set(t.index) | set(lead.index):
                row = t.loc[g].to_dict() if g in t.index else {}
                if g in lead.index:
                    lr = lead.loc[g]
                    row.update({c: lr[c] for c in lead.columns if c != "low_confidence"},
                               flags=set((lr["low_confidence"] or "").split(";")))
                by_geoid[g] = row
            for path in paths:
                payload = json.loads(path.read_text())
                for k, v in patch_pollution(payload, by_geoid).items():
                    total[k] += v
                path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
            log.info("state %s: %d counties", state, len(paths))
        log.info("done: %d areas with pollution, %d with PM2.5 doubted", total["pollution"], total["doubted"])
        failed = pollution_gate(total)
        for msg in failed:
            log.error("pollution gate: %s", msg)
        if failed:
            raise SystemExit(1)
        return
    if args.nri:
        from . import nri

        for state, paths in sorted(by_state.items()):
            for path in paths:
                payload = json.loads(path.read_text())
                total["hazards"] += patch_hazards(payload, nri.fetch(path.stem))["hazards"]
                path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
            log.info("state %s: %d counties", state, len(paths))
        log.info("done: %d areas with FEMA's ratings and the display-only hazards", total["hazards"])
        return
    if args.demographics:
        from ..demographics import COLUMNS

        for state, paths in sorted(by_state.items()):
            parsed = acs.parse(acs._state_raw(state))
            by_geoid = {
                g: {**{c: v for c, v in zip(COLUMNS, vals)}, "flags": set((lc or "").split(";"))}
                for g, lc, *vals in zip(parsed["geoid"], parsed["low_confidence"], *(parsed[c] for c in COLUMNS))
            }
            for path in paths:
                payload = json.loads(path.read_text())
                total["demographics"] += patch_demographics(payload, by_geoid)["demographics"]
                path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
            log.info("state %s: %d counties", state, len(paths))
        log.info("done: %d areas with demographics", total["demographics"])
        return
    if args.offline:
        for state, paths in sorted(by_state.items()):
            for path in paths:
                payload = json.loads(path.read_text())
                counts = {**patch_crime(payload), **patch_topcodes(payload), **patch_crime_scope(payload)}
                if any(counts.values()):
                    path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
                for k, v in counts.items():
                    total[k] += v
        log.info("done: %d areas' rates annualized, %d left without a rate (crime_note), %d top-codes noted, "
                 "%d on a county agency's rate spread over rural and suburban areas (crime_wide)",
                 total["annualized"], total["unrated"], total["topcoded"], total["wide"])
        return
    for state, paths in sorted(by_state.items()):
        parsed = acs.parse(acs._state_raw(state))
        by_geoid = {
            g: {**{c: v for c, v in zip(NEW, vals)}, "flags": set((lc or "").split(";"))}
            for g, lc, *vals in zip(parsed["geoid"], parsed["low_confidence"], *(parsed[c] for c in NEW))
        }
        for path in paths:
            payload = json.loads(path.read_text())
            for k, v in {**patch_county(payload, by_geoid), **patch_crime(payload), **patch_topcodes(payload),
                         **patch_crime_scope(payload)}.items():
                total[k] += v
            path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
        log.info("state %s: %d counties patched", state, len(paths))
    log.info("done: %d areas mostly mobile homes, %d mostly group quarters, %d zero-crime cleared",
             total["mobile"], total["gq"], total["crime_zero"])


if __name__ == "__main__":
    main()
