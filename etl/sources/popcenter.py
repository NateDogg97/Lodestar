"""
SOURCE: Census Bureau 2020 Centers of Population — where each county's people live.

WHAT THIS PRODUCES
    fips, pop_lat, pop_lon

    The population-weighted mean center of each county: the point where the
    county would balance if every resident weighed the same.

WHY THIS EXISTS
    The spine's lat/lon is the Gazetteer INTERNAL POINT — a point guaranteed
    to be inside the polygon, roughly its geographic middle. For locating a
    weather station that is fine in a compact eastern county and badly wrong
    in a large western one. Found 2026-09-26:
      - San Diego County's internal point is inland, so it read 84 days over
        90°F and 30 freezing nights — nothing like where 3 million people live.
      - Riverside County's is in the desert: 12 rainy days a year.
      - San Francisco's is in the Pacific (the county includes the Farallons).
    The population center answers the question the app is actually asking:
    what is the climate like where people in this county live? It is also
    the right origin for the Phase 5 distance columns (airport, coast).

    County level is a starting point, not the destination — the plan's
    geography roadmap goes to tracts, where the question mostly answers itself.

COVERAGE
    2020 file, so it predates Connecticut's 2022 switch to planning regions:
    it lists the 8 legacy CT counties (09001-09015), which do not match the
    spine's 9 regions (09110-09190). Those 9 fall back to the internal point
    in sources/noaa.py. Every other county in the spine matches.

RUN STANDALONE
    python -m etl.sources.popcenter
"""

from __future__ import annotations

import io

import pandas as pd

from .. import config
from ..util import add_fips_column, describe_frame, get_logger, http_get, read_interim, write_interim

log = get_logger("source.popcenter")


def parse(text: str) -> pd.DataFrame:
    """Parse the CenPop CSV into (fips, pop_lat, pop_lon)."""
    # The file starts with a UTF-8 byte-order mark; without stripping it the
    # first header reads "\\ufeffSTATEFP" and the FIPS lookup fails.
    df = pd.read_csv(io.StringIO(text.lstrip("﻿")), dtype=str)
    df.columns = [c.strip().upper() for c in df.columns]
    required = {"STATEFP", "COUNTYFP", "LATITUDE", "LONGITUDE"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Centers of population file is missing columns {missing}; "
                         f"got {list(df.columns)}. The format may have changed.")
    df = add_fips_column(df, state_col="STATEFP", county_col="COUNTYFP")
    out = pd.DataFrame({
        "fips": df["fips"],
        "pop_lat": pd.to_numeric(df["LATITUDE"], errors="coerce"),
        "pop_lon": pd.to_numeric(df["LONGITUDE"], errors="coerce"),
    }).dropna()
    if out.empty:
        raise ValueError("Centers of population file parsed to zero rows")
    return out.drop_duplicates(subset=["fips"]).reset_index(drop=True)


def fetch() -> pd.DataFrame:
    log.info("fetching 2020 county centers of population")
    # Fetched as bytes and decoded here: the generic text path guesses
    # latin-1 and turns the UTF-8 byte-order mark into "ï»¿", which then
    # sticks to the first column name.
    body = http_get(config.POPCENTER_URL, cache_hint="cenpop2020_county", binary=True)
    assert isinstance(body, bytes)
    out = parse(body.decode("utf-8-sig"))

    # Keep only counties on the spine, and say which spine counties are missing.
    spine = read_interim("spine")
    unmatched = sorted(set(spine["fips"]) - set(out["fips"]))
    out = out[out["fips"].isin(spine["fips"])].reset_index(drop=True)
    log.info("population centers: %d of %d spine counties matched", len(out), len(spine))
    if unmatched:
        log.info("no population center (internal point will be used): %s", unmatched)
    return out


def main() -> None:
    df = fetch()
    write_interim(df, "popcenter")
    print(describe_frame(df, "popcenter"))


if __name__ == "__main__":
    main()
