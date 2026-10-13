"""
SOURCE: Zillow Home Value Index by county — today's typical home value.

WHAT THIS PRODUCES
    fips, zhvi_county, zillow_month

    `join.add_derived_columns` turns it into `home_value_today` (and
    `home_value_today_source`): Zillow's county value where there is one; else the
    county's Census median scaled by its state's typical Zillow / Census ratio; else
    the Census median as is.

WHY (plan §9 Phase 10 follow-up, 2026-10-13)
    The Taxes estimate charged property tax on the county's 2019–2023 Census median.
    Areas were already at today's prices (Census × the ZIP's Zillow ratio), counties
    weren't: Washtenaw read $353,000 against $417,000 today, and nationally the gap
    runs from a few percent to over 50% — so it reordered counties, not only shifted
    them. ZHVI is Zillow's typical value (the middle third of homes), all homes
    (single-family and condo), smoothed and seasonally adjusted.

SOURCE
    https://files.zillowstatic.com/research/public_csvs/zhvi/
        County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
    The same family of file as the ZIP data the area pipeline reads (etl/tracts/market.py).

RUN STANDALONE
    python -m etl.sources.zillow_county
"""

from __future__ import annotations

import io

import numpy as np
import pandas as pd

from ..util import describe_frame, get_logger, http_get, write_interim

log = get_logger("source.zillow_county")

URL = ("https://files.zillowstatic.com/research/public_csvs/zhvi/"
       "County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv")


def parse(table: pd.DataFrame) -> pd.DataFrame:
    """Zillow's wide county file -> fips, zhvi_county (latest month), zillow_month."""
    months = [c for c in table.columns if c[:2] in ("19", "20") and len(c) == 10]
    if not months or not {"StateCodeFIPS", "MunicipalCodeFIPS"} <= set(table.columns):
        raise ValueError("Zillow county file: layout changed (no month or FIPS columns)")
    latest = months[-1]
    fips = (table["StateCodeFIPS"].astype(str).str.zfill(2)
            + table["MunicipalCodeFIPS"].astype(str).str.zfill(3))
    out = pd.DataFrame({"fips": fips, "zhvi_county": pd.to_numeric(table[latest], errors="coerce"),
                        "zillow_month": latest[:7]})
    return out.dropna(subset=["zhvi_county"]).drop_duplicates("fips").reset_index(drop=True)


def today_values(df: pd.DataFrame) -> pd.DataFrame:
    """`home_value_today` and its source on the county table (needs median_home_value; the
    Zillow columns may be absent). Zillow's county value; else the Census median times the
    state's median Zillow / Census ratio; else the Census median."""
    df = df.copy()
    census = pd.to_numeric(df["median_home_value"], errors="coerce")
    zillow = pd.to_numeric(df["zhvi_county"], errors="coerce") if "zhvi_county" in df.columns else census * np.nan
    ratio = (zillow / census).where((zillow > 0) & (census > 0))
    state_ratio = ratio.groupby(df["state"]).transform("median")
    national = float(np.nanmedian(ratio)) if ratio.notna().any() else 1.0
    df["home_value_today"] = zillow.where(zillow > 0, census * state_ratio.fillna(national))
    df["home_value_today_source"] = np.where(
        zillow > 0, "zillow", np.where(census.notna() & state_ratio.notna(), "census_state_ratio",
                                       np.where(census.notna(), "census_national_ratio", None)))
    log.info("home_value_today: %d from Zillow, %d from the Census scaled (national Zillow/Census %.2f)",
             int((zillow > 0).sum()), int((~(zillow > 0) & census.notna()).sum()), national)
    return df


def fetch() -> pd.DataFrame:
    body = http_get(URL, cache_hint="zillow_zhvi_county")
    out = parse(pd.read_csv(io.StringIO(body), low_memory=False))
    log.info("Zillow county ZHVI: %d counties, latest %s", len(out), out["zillow_month"].iloc[0])
    return out


def main() -> None:
    df = fetch()
    write_interim(df, "zillow_county")
    print(describe_frame(df, "zillow_county"))


if __name__ == "__main__":
    main()
