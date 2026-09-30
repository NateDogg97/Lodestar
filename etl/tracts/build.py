"""
Build the tract table for one or more counties (plan §9 Phase 8a).

    python -m etl.tracts.build --county 48453           # Travis County, TX
    python -m etl.tracts.build --pilot                  # config.TRACT_PILOT_COUNTIES

Per county, writes to data/out/tracts/:
    {fips}.csv         one row per tract: every column from acs, geo and nri,
                       plus density_per_sq_mi
    {fips}.topo.json   simplified tract shapes for the app (layer `tracts`)

Checks that every source covers the same tracts; a tract missing from a
source is logged, never silently dropped.
"""

from __future__ import annotations

import argparse

import pandas as pd

from .. import config
from ..util import get_logger
from . import acs, geo, nri

log = get_logger("tracts.build")


def build_county(fips: str) -> pd.DataFrame:
    name = config.TRACT_PILOT_COUNTIES.get(fips, fips)
    log.info("— %s (%s) —", name, fips)
    shapes = geo.shapes(fips)
    parts = {
        "geo": geo.table(fips, shapes),
        "acs": acs.fetch(fips),
        "nri": nri.fetch(fips),
    }
    base = set(parts["geo"]["geoid"])
    for src, df in parts.items():
        got = set(df["geoid"])
        if got != base:
            log.warning("%s: %d tracts not in the shapes, %d shapes without a row",
                        src, len(got - base), len(base - got))

    df = parts["geo"]
    for src in ("acs", "nri"):
        df = df.merge(parts[src], on="geoid", how="left")
    df["density_per_sq_mi"] = df["population"] / df["land_sq_mi"].where(df["land_sq_mi"] > 0)
    df.insert(1, "county_fips", fips)

    config.TRACT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(config.TRACT_OUT_DIR / f"{fips}.csv", index=False)
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
