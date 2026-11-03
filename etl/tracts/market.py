"""
SOURCE: housing market by ZIP — Zillow and Redfin (plan §9 Phase 8; not MLS).

WHAT THIS PRODUCES (one row per tract, for the tract's ZIP from names.py)
    geoid,
    zhvi, zhvi_yoy            Zillow Home Value Index (typical home value) and its
                              change over 12 months, %
    zori, zori_yoy            Zillow Observed Rent Index (typical asking rent)
    zillow_month              the month those are for
    sale_price                Redfin median sale price
    days_on_market            Redfin median days on market
    sale_to_list              Redfin average sale-to-list ratio, %
    homes_sold                Redfin homes sold in the period
    redfin_period             the 3-month period's end date (the same for every ZIP)

    These are ZIP-level: every tract in a ZIP shows its ZIP's market. They're
    fresher than Census figures (which lag 2–5 years), which is their point.

SOURCES (free; credit both in the app)
    Zillow Research: https://www.zillow.com/research/data/  (monthly, by ZIP)
    Redfin Data Center: housing_market/monthly/all_zips.csv (~1.3 GB, rolling 3
      months, every month since 2012; the file names are in
      redfin_data_center/index.json). Streamed to data/raw/ once; the newest
      period is cached in data/interim/redfin_zips_newest.csv. Only that period:
      a ZIP without sales in it has no figures, not its last ones from years
      ago. Redfin retired the old redfin_market_tracker/ files (AccessDenied
      since 2026-11), which had a property type; this file is all homes.
      OPTIONAL: a run that can't download it builds without the Redfin columns
      (empty, never last month's copy) and the quality gate says so.

RUN STANDALONE
    python -m etl.tracts.market 48453
"""

from __future__ import annotations

import functools
import io
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from .. import config
from ..util import get_logger, http_get, redact_query

log = get_logger("tracts.market")

ZHVI_URL = "https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
ZORI_URL = "https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv"
REDFIN_URL = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_data_center/housing_market/monthly/all_zips.csv"
REDFIN_RAW = config.RAW_DIR / "redfin_all_zips.csv"
REDFIN_CACHE = config.INTERIM_DIR / "redfin_zips_newest.csv"


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
    log.info("downloading Redfin ZIP market data (~1.3 GB, once)…")
    tmp = REDFIN_RAW.with_suffix(".part")
    with requests.get(REDFIN_URL, stream=True, timeout=config.HTTP_TIMEOUT,
                      headers={"User-Agent": config.HTTP_USER_AGENT}) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=8 << 20):
                f.write(chunk)
    tmp.rename(REDFIN_RAW)


REDFIN_COLUMNS = ["zip", "sale_price", "days_on_market", "sale_to_list", "homes_sold", "redfin_period"]


@functools.lru_cache(maxsize=1)
def redfin_latest() -> pd.DataFrame:
    """zip, sale_price, days_on_market, sale_to_list, homes_sold, redfin_period (the newest period).
    Empty when Redfin can't be downloaded or read: asked once per run, not once per county."""
    if REDFIN_CACHE.exists():
        return pd.read_csv(REDFIN_CACHE, dtype={"zip": str})
    try:
        _download_redfin()
        return _redfin_newest(REDFIN_RAW)
    except (requests.RequestException, ValueError) as exc:  # refused, or a new format (missing columns)
        log.error("Redfin unavailable (%s): building without sale price, days on market, sale-to-list",
                  redact_query(str(exc)))
        return pd.DataFrame(columns=REDFIN_COLUMNS)


def _redfin_newest(path: Path) -> pd.DataFrame:
    cols = ["FREQUENCY", "PERIOD END", "REGION TYPE", "REGION NAME", "MEDIAN SALE PRICE NSA ($)",
            "MEDIAN DAYS ON MARKET (DAYS)", "AVERAGE SALE TO LIST RATIO (%)", "HOMES SOLD"]
    # Each chunk's newest rows; the newest of those is the file's (rows are in no set order).
    parts = []
    for chunk in pd.read_csv(path, usecols=cols, chunksize=500_000, dtype=str):
        c = chunk[(chunk["REGION TYPE"] == "Zip") & (chunk["FREQUENCY"] == "Rolling 3 Months")]
        parts.append(c[c["PERIOD END"] == c["PERIOD END"].max()])
    rows = pd.concat(parts)
    rows = rows[rows["PERIOD END"] == rows["PERIOD END"].max()]
    out = pd.DataFrame({
        "zip": rows["REGION NAME"].str.extract(r"^(\d{5})$")[0],
        "sale_price": pd.to_numeric(rows["MEDIAN SALE PRICE NSA ($)"], errors="coerce"),
        "days_on_market": pd.to_numeric(rows["MEDIAN DAYS ON MARKET (DAYS)"], errors="coerce"),
        "sale_to_list": pd.to_numeric(rows["AVERAGE SALE TO LIST RATIO (%)"], errors="coerce"),  # already a %
        "homes_sold": pd.to_numeric(rows["HOMES SOLD"], errors="coerce"),
        "redfin_period": rows["PERIOD END"],
    }).dropna(subset=["zip"]).drop_duplicates("zip")
    if out.empty:
        raise ValueError(f"Redfin: no rolling 3-month ZIP rows in {path.name}: has the file changed format?")
    out.to_csv(REDFIN_CACHE, index=False)
    log.info("Redfin: %d ZIPs for the period to %s, %d with a sale price (cached)", len(out),
             out["redfin_period"].iloc[0], out["sale_price"].notna().sum())
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
