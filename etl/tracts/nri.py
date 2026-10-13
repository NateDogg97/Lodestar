"""
SOURCE: FEMA National Risk Index, census tract table — natural hazards by tract.

WHAT THIS PRODUCES
    geoid, hazard_risk, hazard_hurricane, hazard_wildfire, hazard_inland_flood,
    hazard_coastal_flood, hazard_earthquake, hazard_tornado, the display-only hazards and
    FEMA's rating words (etl/sources/nri.py `hazard_columns`)

    The same measures as the county data (etl/sources/nri.py): FEMA's NATIONAL
    percentile of each hazard's expected annual loss RATE, 0–100, among all US
    tracts. "Not Applicable" (the hazard can't happen there) is 0; any other
    blank stays unknown.

SOURCE
    OpenFEMA NRI v1.20, national tract table (~635 MB zip; FEMA publishes no
    per-state tract files — checked 2026-09-30). Downloaded once into
    data/raw/, then read in chunks, keeping only the county's rows and the
    columns used here.

RUN STANDALONE
    python -m etl.tracts.nri 48453
"""

from __future__ import annotations

import functools
import io
import sys
import zipfile

import pandas as pd

from .. import config
from ..sources.nri import ALL_HAZARDS, _is_zip, hazard_columns
from ..util import get_logger, http_get

log = get_logger("tracts.nri")


CACHE = config.INTERIM_DIR / "nri_tracts.csv"


@functools.lru_cache(maxsize=1)
def _national() -> pd.DataFrame:
    """The columns used here, for every US tract: read from the 635 MB zip once,
    then from data/interim/nri_tracts.csv."""
    cols = ["TRACTFIPS", "STCOFIPS", "ALR_NPCTL", "RISK_RATNG"] + [
        f"{p}_{s}" for p in ALL_HAZARDS.values() if p for s in ("ALR_NPCTL", "RISKR")
    ]
    if CACHE.exists():
        cached = pd.read_csv(CACHE, dtype={"TRACTFIPS": str, "STCOFIPS": str}, low_memory=False)
        if set(cols) <= set(cached.columns):  # an older cache without the ratings: re-read the zip
            return cached
    body = http_get(config.NRI_TRACTS_URL, binary=True, cache_hint="nri_tracts",
                    user_agent=config.BROWSER_USER_AGENT, check=_is_zip)
    assert isinstance(body, bytes)
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        name = next(n for n in z.namelist() if n.lower() == "nri_table_censustracts.csv")
        table = pd.read_csv(z.open(name), usecols=cols, dtype={"TRACTFIPS": str, "STCOFIPS": str}, low_memory=False)
    table["TRACTFIPS"] = table["TRACTFIPS"].str.zfill(11)
    table["STCOFIPS"] = table["STCOFIPS"].str.zfill(5)
    table.to_csv(CACHE, index=False)
    return table


def fetch(county_fips: str) -> pd.DataFrame:
    nat = _national()
    if county_fips.startswith("09"):  # Connecticut: NRI is on 2020 counties (geo.current_geoids)
        from .geo import current_geoids

        nat = nat[nat["STCOFIPS"].str[:2] == "09"].assign(TRACTFIPS=lambda d: current_geoids(d["TRACTFIPS"]))
        nat = nat.assign(STCOFIPS=nat["TRACTFIPS"].str[:5])
    table = nat[nat["STCOFIPS"] == county_fips].reset_index(drop=True)

    # The same columns as the county table (etl/sources/nri.py): loss-rate percentiles, the
    # display-only hazards, and FEMA's rating words.
    out = pd.DataFrame({"geoid": table["TRACTFIPS"].str.zfill(11)}).join(hazard_columns(table))
    log.info("NRI tracts: %d rows for %s", len(out), county_fips)
    return out


if __name__ == "__main__":
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    df = fetch(fips)
    print(df.describe().T.round(1).to_string())
