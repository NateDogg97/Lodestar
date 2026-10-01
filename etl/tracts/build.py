"""
Build the tract table for one or more counties (plan §9 Phase 8a).

    python -m etl.tracts.build --county 48453           # Travis County, TX
    python -m etl.tracts.build --pilot                  # config.TRACT_PILOT_COUNTIES

Per county, writes to data/out/tracts/:
    {fips}.csv         one row per tract: every column from acs, geo and nri,
                       plus density_per_sq_mi
    {fips}.topo.json   simplified tract shapes for the app (layer `tracts`)
    {fips}_schools.csv the county's scored schools (see schools.py)

Checks that every source covers the same tracts; a tract missing from a
source is logged, never silently dropped.
"""

from __future__ import annotations

import argparse

import pandas as pd

from .. import config
from ..util import get_logger
from . import acs, crime, geo, market, names, nri, schools, walkability

log = get_logger("tracts.build")

MIN_HOMES_SOLD = 10  # Redfin sale price from fewer sales in the period is low confidence


def build_county(fips: str) -> pd.DataFrame:
    name = config.TRACT_PILOT_COUNTIES.get(fips, fips)
    log.info("— %s (%s) —", name, fips)
    shapes = geo.shapes(fips)
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
    parts["crime"] = crime.fetch(fips, parts["names"])
    parts["market"] = market.fetch(parts["names"])
    base = set(parts["geo"]["geoid"])
    for src, df in parts.items():
        got = set(df["geoid"])
        if got != base:
            log.warning("%s: %d tracts not in the shapes, %d shapes without a row",
                        src, len(got - base), len(base - got))

    df = parts["geo"]
    for src in ("names", "acs", "nri", "schools", "walkability", "crime", "market"):
        df = df.merge(parts[src], on="geoid", how="left")
    # One list of low-confidence values per tract, for the caution icon.
    lowc = df["low_confidence"].fillna("")
    crime_flag = df["crime_low_confidence"].fillna(True).astype(bool)
    # A median sale price from a handful of sales is noise.
    thin = df["homes_sold"].fillna(0) < MIN_HOMES_SOLD
    df["low_confidence"] = [";".join(x for x in (a, "crime" if c else "", "sale_price" if t else "") if x)
                            for a, c, t in zip(lowc, crime_flag, thin)]
    df = df.drop(columns=["crime_low_confidence"])
    df["density_per_sq_mi"] = df["population"] / df["land_sq_mi"].where(df["land_sq_mi"] > 0)
    df.insert(1, "county_fips", fips)

    config.TRACT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(config.TRACT_OUT_DIR / f"{fips}.csv", index=False)
    school_table.to_csv(config.TRACT_OUT_DIR / f"{fips}_schools.csv", index=False)
    topo = geo.topojson(shapes)
    (config.TRACT_OUT_DIR / f"{fips}.topo.json").write_text(topo)
    log.info("wrote %s.csv (%d tracts x %d cols) and %s.topo.json (%.0f KB)",
             fips, len(df), len(df.columns), fips, len(topo) / 1024)
    return df


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--county", action="append", default=[], help="5-digit county FIPS (repeatable)")
    ap.add_argument("--pilot", action="store_true", help="build the Phase 8a pilot counties")
    args = ap.parse_args()
    counties = list(config.TRACT_PILOT_COUNTIES) if args.pilot else args.county
    if not counties:
        ap.error("give --county FIPS or --pilot")
    for fips in counties:
        build_county(fips.zfill(5))


if __name__ == "__main__":
    main()
