"""
SOURCE: housing market by ZIP — Zillow and Redfin (plan §9 Phase 8; not MLS).

WHAT THIS PRODUCES (one row per tract, for the tract's ZIP from names.py)
    geoid,
    zhvi, zhvi_yoy            Zillow Home Value Index (typical home value) and its
                              change over 12 months, %
    zori, zori_yoy            Zillow Observed Rent Index (typical asking rent)
    zillow_month              the month those are for
    sale_price                Redfin median sale price, all residential
    days_on_market            Redfin median days on market
    sale_to_list              Redfin average sale-to-list ratio, %
    homes_sold                Redfin homes sold in the period
    redfin_period             the 90-day period's end date

    These are ZIP-level: every tract in a ZIP shows its ZIP's market. They're
    fresher than Census figures (which lag 2–5 years), which is their point.

SOURCES (free; credit both in the app)
    Zillow Research: https://www.zillow.com/research/data/  (monthly, by ZIP)
    Redfin Data Center: zip_code_market_tracker.tsv000.gz (~1.5 GB). Streamed
      to data/raw/ once; the latest "All Residential" period per ZIP is cached
      in data/interim/redfin_zip_latest.csv.

RUN STANDALONE
    python -m etl.tracts.market 48453
"""

from __future__ import annotations

import functools
import io
import sys

import numpy as np
import pandas as pd
import requests

from .. import config
from ..util import get_logger, http_get

log = get_logger("tracts.market")

ZHVI_URL = "https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
ZORI_URL = "https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv"
REDFIN_URL = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz"
REDFIN_RAW = config.RAW_DIR / "redfin_zip_code_market_tracker.tsv000.gz"
REDFIN_CACHE = config.INTERIM_DIR / "redfin_zip_latest.csv"


@functools.lru_cache(maxsize=4)
def _zillow(url: str, hint: str, name: str) -> pd.DataFrame:
    """zip, {name}, {name}_yoy, zillow_month — latest month and change over 12 months."""
    text = http_get(url, cache_hint=hint, user_agent=config.BROWSER_USER_AGENT)
    assert isinstance(text, str)
    df = pd.read_csv(io.StringIO(text), dtype={"RegionName": str})
    months = sorted(c for c in df.columns if c[:2] in ("19", "20") and c[4] == "-")
    latest = next(m for m in reversed(months) if df[m].notna().mean() > 0.5)
    prior = months[months.index(latest) - 12]
    return pd.DataFrame({
        "zip": df["RegionName"].str.zfill(5),
        name: df[latest],
        f"{name}_yoy": 100 * (df[latest] / df[prior] - 1),
        "zillow_month": latest[:7],
    })


def _download_redfin() -> None:
    if REDFIN_RAW.exists():
        return
    log.info("downloading Redfin ZIP tracker (~1.5 GB, once)…")
    tmp = REDFIN_RAW.with_suffix(".part")
    with requests.get(REDFIN_URL, stream=True, timeout=config.HTTP_TIMEOUT,
                      headers={"User-Agent": config.HTTP_USER_AGENT}) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=8 << 20):
                f.write(chunk)
    tmp.rename(REDFIN_RAW)


@functools.lru_cache(maxsize=1)
def redfin_latest() -> pd.DataFrame:
    """zip, sale_price, days_on_market, sale_to_list, homes_sold, redfin_period (latest per ZIP)."""
    if REDFIN_CACHE.exists():
        return pd.read_csv(REDFIN_CACHE, dtype={"zip": str})
    _download_redfin()
    cols = ["PERIOD_END", "REGION", "PROPERTY_TYPE", "MEDIAN_SALE_PRICE", "MEDIAN_DOM", "AVG_SALE_TO_LIST",
            "HOMES_SOLD"]
    best: pd.DataFrame | None = None
    for chunk in pd.read_csv(REDFIN_RAW, sep="\t", compression="gzip", usecols=cols, chunksize=500_000,
                             dtype={"REGION": str, "PROPERTY_TYPE": str, "PERIOD_END": str}):
        c = chunk[chunk["PROPERTY_TYPE"] == "All Residential"]
        c = c.sort_values("PERIOD_END").drop_duplicates("REGION", keep="last")
        best = c if best is None else pd.concat([best, c]).sort_values("PERIOD_END").drop_duplicates("REGION", keep="last")
    assert best is not None
    out = pd.DataFrame({
        "zip": best["REGION"].str.extract(r"(\d{5})")[0],
        "sale_price": pd.to_numeric(best["MEDIAN_SALE_PRICE"], errors="coerce"),
        "days_on_market": pd.to_numeric(best["MEDIAN_DOM"], errors="coerce"),
        "sale_to_list": 100 * pd.to_numeric(best["AVG_SALE_TO_LIST"], errors="coerce"),
        "homes_sold": pd.to_numeric(best["HOMES_SOLD"], errors="coerce"),
        "redfin_period": best["PERIOD_END"],
    }).dropna(subset=["zip"])
    out.to_csv(REDFIN_CACHE, index=False)
    log.info("Redfin: latest period for %d ZIPs (cached); newest %s", len(out), out["redfin_period"].max())
    return out


def fetch(names: pd.DataFrame) -> pd.DataFrame:
    """`names` needs geoid and zip (from names.py)."""
    z = _zillow(ZHVI_URL, "zillow_zhvi_zip", "zhvi")
    r = _zillow(ZORI_URL, "zillow_zori_zip", "zori").drop(columns=["zillow_month"])
    out = names[["geoid", "zip"]].merge(z, on="zip", how="left").merge(r, on="zip", how="left")
    out = out.merge(redfin_latest(), on="zip", how="left")
    log.info("market: %d tracts; Zillow value for %d, rent for %d, Redfin for %d", len(out),
             out["zhvi"].notna().sum(), out["zori"].notna().sum(), out["sale_price"].notna().sum())
    return out.drop(columns=["zip"])


if __name__ == "__main__":
    import pandas as _pd
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    names = _pd.read_csv(config.TRACT_OUT_DIR / f"{fips}.csv", dtype={"geoid": str, "zip": str})[["geoid", "zip"]]
    df = fetch(names)
    print(df.describe().T.round(1).to_string())
