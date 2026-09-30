"""
SOURCE: FEMA National Risk Index, census tract table — natural hazards by tract.

WHAT THIS PRODUCES
    geoid, hazard_risk, hazard_hurricane, hazard_wildfire, hazard_inland_flood,
    hazard_coastal_flood, hazard_earthquake, hazard_tornado

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

import io
import sys
import zipfile

import pandas as pd

from .. import config
from ..sources.nri import HAZARDS, _is_zip
from ..util import get_logger, http_get

log = get_logger("tracts.nri")


def fetch(county_fips: str) -> pd.DataFrame:
    body = http_get(config.NRI_TRACTS_URL, binary=True, cache_hint="nri_tracts",
                    user_agent=config.BROWSER_USER_AGENT, check=_is_zip)
    assert isinstance(body, bytes)
    cols = ["TRACTFIPS", "STCOFIPS", "ALR_NPCTL"] + [
        f"{p}_{s}" for p in HAZARDS.values() if p for s in ("ALR_NPCTL", "RISKR")
    ]
    parts = []
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        name = next(n for n in z.namelist() if n.lower() == "nri_table_censustracts.csv")
        for chunk in pd.read_csv(z.open(name), usecols=cols, dtype={"TRACTFIPS": str, "STCOFIPS": str},
                                 chunksize=200_000, low_memory=False):
            parts.append(chunk[chunk["STCOFIPS"].str.zfill(5) == county_fips])
    table = pd.concat(parts, ignore_index=True)

    out = pd.DataFrame({"geoid": table["TRACTFIPS"].str.zfill(11)})
    for col, prefix in HAZARDS.items():
        pct = pd.to_numeric(table[f"{prefix}_ALR_NPCTL" if prefix else "ALR_NPCTL"], errors="coerce")
        if prefix:
            na = table[f"{prefix}_RISKR"].astype(str).str.strip().eq("Not Applicable")
            pct = pct.where(~(pct.isna() & na), 0.0)
        out[col] = pct.clip(0, 100)
    log.info("NRI tracts: %d rows for %s", len(out), county_fips)
    return out


if __name__ == "__main__":
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    df = fetch(fips)
    print(df.describe().T.round(1).to_string())
