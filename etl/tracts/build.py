"""
Build tract tables (plan §9 Phase 8).

    python -m etl.tracts.build --county 48453           # one county
    python -m etl.tracts.build --pilot                  # config.TRACT_PILOT_COUNTIES
    python -m etl.tracts.build --state TX               # every county in a state
    python -m etl.tracts.build --state TX --no-crime    # skip crime
    python -m etl.tracts.build --state TX --force       # rebuild counties already built
    python -m etl.tracts.build --state TX,OK            # several states
    python -m etl.tracts.build --state published        # exactly what the app has now (monthly CI)

Per county, writes to data/out/tracts/:
    {fips}.csv         one row per tract: every column from the sources, plus
                       density_per_sq_mi
    {fips}.topo.json   simplified tract shapes for the app (layer `tracts`)
    {fips}_schools.csv the county's scored schools, and nearby ones (schools.py)

At scale (8c): national and per-state source files are loaded once per run
(the source modules cache them), so a state's counties build back to back.
A state run skips counties already built (resume), records a county that
fails instead of stopping, and writes _coverage_{ST}.csv: per county, how
many tracts have each measure — the check that replaces eyeballing 3,000
counties. Crime comes from the FBI's bulk file per state and year (two
downloads per state, then cached), not a rate-limited API.
"""

from __future__ import annotations

import argparse
import time
import traceback

import numpy as np
import pandas as pd

from .. import config
from ..util import get_logger, read_interim
from . import acs, crime, geo, market, names, nri, schools, walkability

log = get_logger("tracts.build")

MIN_HOMES_SOLD = 10  # Redfin sale price from fewer sales in the period is low confidence

# Coverage report: share of a county's populated tracts with each measure.
COVERAGE = {
    "home_value": "median_home_value",
    "income": "per_capita_income",
    "zillow": "zhvi",
    "district": "district_pctl",
    "schools": "nearby_school_pctl",
    "high_schools": "nearby_hs_pctl",
    "walkability": "walkability",
    "hazards": "hazard_risk",
    "downtown": "dist_downtown_mi",
    "crime": "violent_rate",
    "redfin": "sale_price",
}


def _county_names() -> dict[str, str]:
    spine = read_interim("spine")
    return {f: f"{n}, {st}" for f, n, st in zip(spine["fips"], spine["county_name"], spine["state"])}


# Owned homes that are mobile homes, at or above which the home value gets a caution.
MOBILE_HOME_SHARE = 50.0


def mobile_homes(df: pd.DataFrame) -> pd.Series:
    """True where most owned homes are mobile homes and there is a home value to caution."""
    if "mobile_home_share" not in df:
        return pd.Series(False, index=df.index)
    return (df["mobile_home_share"] >= MOBILE_HOME_SHARE) & df["median_home_value"].notna()


def build_county(fips: str, with_crime: bool = True) -> pd.DataFrame:
    name = config.TRACT_PILOT_COUNTIES.get(fips) or _county_names().get(fips, fips)
    log.info("— %s (%s) —", name, fips)
    shapes = geo.shapes(fips)
    if not shapes["features"]:
        raise ValueError(f"no tract shapes for {fips}")
    geo_table = geo.table(fips, shapes)
    school_tracts, school_table = schools.build(fips, geo_table)
    parts = {
        "geo": geo_table,
        "acs": acs.fetch(fips),
        "nri": nri.fetch(fips),
        "schools": school_tracts,
        "walkability": walkability.fetch(fips),
        "names": names.fetch(fips, geo_table, name),
    }
    if with_crime:
        parts["crime"] = crime.fetch(fips, parts["names"], geo_table, parts["acs"][["geoid", "population"]])
    parts["market"] = market.fetch(parts["names"])
    base = set(parts["geo"]["geoid"])
    for src, df in parts.items():
        got = set(df["geoid"])
        if got != base:
            log.warning("%s: %d tracts not in the shapes, %d shapes without a row",
                        src, len(got - base), len(base - got))

    df = parts["geo"]
    for src in ("names", "acs", "nri", "schools", "walkability", "crime", "market"):
        if src in parts:
            df = df.merge(parts[src], on="geoid", how="left")
    df["density_per_sq_mi"] = df["population"] / df["land_sq_mi"].where(df["land_sq_mi"] > 0)
    df.insert(1, "county_fips", fips)

    # One list of low-confidence values per tract, for the caution icon. Without
    # crime data (--no-crime), crime isn't flagged — it's simply not there yet.
    lowc = df["low_confidence"].fillna("")
    if with_crime:
        crime_flag = df["crime_low_confidence"].fillna(True).astype(bool)
        df = df.drop(columns=["crime_low_confidence"])
    else:
        crime_flag = pd.Series(False, index=df.index)
    # Zero violent and zero property crime is an agency that reported nothing, not a
    # perfect record (results audit, 2026-10-04): no data, and nothing to flag.
    if with_crime and {"violent_rate", "property_rate"} <= set(df.columns):
        none = (df["violent_rate"] == 0) & (df["property_rate"] == 0)
        df.loc[none, ["violent_rate", "property_rate"]] = np.nan
        crime_flag = crime_flag & ~none
    # A median sale price from a handful of sales is noise.
    thin = df["homes_sold"].fillna(0) < MIN_HOMES_SOLD
    # Mostly mobile homes: the home value is real but isn't a house price.
    mobile = mobile_homes(df)
    df["low_confidence"] = [
        ";".join(x for x in (a, "crime" if c else "", "sale_price" if t else "", "mobile_homes" if m else "") if x)
        for a, c, t, m in zip(lowc, crime_flag, thin, mobile)
    ]

    config.TRACT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(config.TRACT_OUT_DIR / f"{fips}.csv", index=False)
    school_table.to_csv(config.TRACT_OUT_DIR / f"{fips}_schools.csv", index=False)
    topo = geo.topojson(shapes)
    (config.TRACT_OUT_DIR / f"{fips}.topo.json").write_text(topo)
    log.info("wrote %s.csv (%d tracts x %d cols) and %s.topo.json (%.0f KB)",
             fips, len(df), len(df.columns), fips, len(topo) / 1024)
    return df


def coverage(fips: str, df: pd.DataFrame, seconds: float) -> dict:
    populated = df[df["population"].fillna(0) > 0]
    n = max(len(populated), 1)
    row = {"fips": fips, "tracts": len(df), "populated": len(populated), "seconds": round(seconds, 1)}
    for name, col in COVERAGE.items():
        row[name] = round(100 * populated[col].notna().sum() / n) if col in populated else None
    row["in_place"] = round(100 * (populated["neighborhood"].notna() | populated["place"].notna()).sum() / n)
    row["named"] = round(100 * populated["label"].notna().sum() / n)
    row["low_conf"] = round(100 * (populated["low_confidence"].fillna("") != "").sum() / n)
    return row


# Tables from the county pipeline the tract build reads: the county list (spine),
# population centers and county ACS (to size metros, geo.py). Made here when
# missing, so a fresh machine (CI) needs no county run first.
PREREQS = [("spine", "etl.sources.spine"), ("popcenter", "etl.sources.popcenter"), ("acs", "etl.sources.acs")]


def ensure_prereqs() -> None:
    from ..build import run_source

    for name, module in PREREQS:
        if not (config.INTERIM_DIR / f"{name}.csv").exists() and not run_source(name, module):
            raise SystemExit(f"could not build data/interim/{name}.csv")


def plan(arg: str) -> dict[str, list[str] | None]:
    """State -> the counties to build (None: all of them).

    "all" is every state; "published" is exactly the counties in the app's
    index.json (public/data/tracts/, which CI first copies from the live site):
    the monthly refresh rebuilds what's live and nothing more — new states are
    added deliberately, one at a time (owner, 2026-10-02).
    """
    spine = read_interim("spine")
    if arg.lower() == "all":
        return {st: None for st in sorted(spine["state"].unique())}
    if arg.lower() == "published":
        import json

        from .publish import PUBLISH_DIR

        index = PUBLISH_DIR / "index.json"
        if not index.exists():
            raise SystemExit(f"--state published: no {index}")
        live = set(json.loads(index.read_text())["counties"])
        by_state = spine[spine["fips"].isin(live)].groupby("state")["fips"].apply(sorted)
        return {st: list(f) for st, f in by_state.items()}
    return {st.strip().upper(): None for st in arg.split(",") if st.strip()}


def build_state(st: str, with_crime: bool, force: bool, only: list[str] | None = None) -> None:
    spine = read_interim("spine")
    counties = only or sorted(spine.loc[spine["state"] == st.upper(), "fips"])
    log.info("%s: %d counties%s", st.upper(), len(counties), "" if with_crime else " (no crime)")
    rows, failed = [], []
    started = time.time()
    for i, fips in enumerate(counties, 1):
        out = config.TRACT_OUT_DIR / f"{fips}.csv"
        t0 = time.time()
        try:
            if out.exists() and not force:
                df = pd.read_csv(out, dtype={"geoid": str})
            else:
                df = build_county(fips, with_crime=with_crime)
            rows.append(coverage(fips, df, time.time() - t0))
        except Exception as exc:  # noqa: BLE001 — record and keep going; the report lists it
            log.error("%s failed: %s", fips, exc)
            failed.append({"fips": fips, "error": f"{type(exc).__name__}: {exc}",
                           "trace": traceback.format_exc(limit=3)})
        if i % 25 == 0:
            log.info("%s: %d/%d counties in %.0f min", st.upper(), i, len(counties), (time.time() - started) / 60)

    report = pd.DataFrame(rows)
    if failed:
        report = pd.concat([report, pd.DataFrame(failed)], ignore_index=True)
    path = config.TRACT_OUT_DIR / f"_coverage_{st.upper()}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)  # a fresh machine whose first county failed
    report.to_csv(path, index=False)
    log.info("%s done in %.0f min: %d built, %d failed -> %s", st.upper(), (time.time() - started) / 60,
             len(rows), len(failed), path.name)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--county", action="append", default=[], help="5-digit county FIPS (repeatable)")
    ap.add_argument("--pilot", action="store_true", help="build the Phase 8a pilot counties")
    ap.add_argument("--state", help="two-letter state(s), comma-separated; 'published' (the counties live in the app); or 'all'")
    ap.add_argument("--no-crime", action="store_true", help="skip FBI crime data")
    ap.add_argument("--force", action="store_true", help="with --state: rebuild counties already built")
    args = ap.parse_args()
    ensure_prereqs()
    if args.state:
        todo = plan(args.state)
        started = time.time()
        for st, only in todo.items():
            build_state(st, with_crime=not args.no_crime, force=args.force, only=only)
        if len(todo) > 1:
            log.info("%d states in %.0f min", len(todo), (time.time() - started) / 60)
        return
    counties = list(config.TRACT_PILOT_COUNTIES) if args.pilot else args.county
    if not counties:
        ap.error("give --county FIPS, --pilot or --state ST")
    for fips in counties:
        build_county(fips.zfill(5), with_crime=not args.no_crime)


if __name__ == "__main__":
    main()
