"""
SOURCE: EPA National Walkability Index — how walkable each tract is.

WHAT THIS PRODUCES
    geoid, walkability      1–20 (EPA's scale). EPA's bands: 1–5.75 least
                            walkable, 5.76–10.5 below average, 10.51–15.25
                            above average, 15.26–20 most walkable.

    The index combines intersection density (walkable street grids), distance
    to the nearest transit stop, and the mix of jobs and homes nearby (EPA Smart
    Location Database, 2021). It ranks every block group nationally.

GEOGRAPHY: 2010 BLOCK GROUPS -> 2020 TRACTS
    EPA published the index on 2019 block groups, which use 2010 geography
    (its GEOID20 field equals GEOID10). Many tracts were split or redrawn for
    2020, so:
      1. block groups -> 2010 tracts, weighted by population (TotPop)
      2. 2010 tracts -> 2020 tracts by shared land area, from the Census
         Bureau's tract relationship file (tab20_tract20_tract10_natl.txt).
    Step 1 runs once nationally and is cached in data/interim/ (the source is
    a 425 MB geodatabase, read with pyogrio without geometry).

RUN STANDALONE
    python -m etl.tracts.walkability 48453
"""

from __future__ import annotations

import io
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from .. import config
from ..util import get_logger, http_get

log = get_logger("tracts.walkability")

WALKABILITY_URL = "https://edg.epa.gov/EPADataCommons/public/OA/WalkabilityIndex.zip"
RELATIONSHIP_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_natl.txt"
CACHE = config.INTERIM_DIR / "walkability_tract10.csv"


def tract10_walkability() -> pd.DataFrame:
    """geoid10, walkability: population-weighted mean over each 2010 tract's block groups."""
    if CACHE.exists():
        return pd.read_csv(CACHE, dtype={"geoid10": str})
    import pyogrio.raw as raw

    body = http_get(WALKABILITY_URL, binary=True, cache_hint="epa_walkability")
    assert isinstance(body, bytes)
    zf = zipfile.ZipFile(io.BytesIO(body))
    with tempfile.TemporaryDirectory() as tmp:
        zf.extractall(tmp, members=[n for n in zf.namelist() if n.startswith("Natl_WI.gdb")])
        _, _, _, (geoid, pop, walk) = raw.read(Path(tmp) / "Natl_WI.gdb", layer="NationalWalkabilityIndex",
                                               read_geometry=False, columns=["GEOID10", "TotPop", "NatWalkInd"])
    bg = pd.DataFrame({"geoid10": pd.Series(geoid).astype(str).str.zfill(12).str[:11],
                       "pop": pd.to_numeric(pop), "walk": pd.to_numeric(walk)}).dropna(subset=["walk"])
    # Population weights; a tract whose block groups are all unpopulated takes a plain mean.
    bg["w"] = bg["pop"].clip(lower=0)
    g = bg.groupby("geoid10")
    out = pd.DataFrame({
        "wsum": g.apply(lambda x: (x["walk"] * x["w"]).sum(), include_groups=False),
        "w": g["w"].sum(), "mean": g["walk"].mean(),
    })
    out["walkability"] = np.where(out["w"] > 0, out["wsum"] / out["w"].where(out["w"] > 0), out["mean"])
    out = out.reset_index()[["geoid10", "walkability"]]
    out.to_csv(CACHE, index=False)
    log.info("walkability: %d block groups -> %d 2010 tracts (cached)", len(bg), len(out))
    return out


def fetch(county_fips: str) -> pd.DataFrame:
    body = http_get(RELATIONSHIP_URL, binary=True, cache_hint="tab20_tract20_tract10_natl")
    assert isinstance(body, bytes)
    rel = pd.read_csv(io.BytesIO(body), sep="|", dtype=str, encoding="utf-8-sig",
                      usecols=["GEOID_TRACT_20", "GEOID_TRACT_10", "AREALAND_PART"])
    rel = rel[rel["GEOID_TRACT_20"].str[:5] == county_fips]
    rel["land"] = pd.to_numeric(rel["AREALAND_PART"], errors="coerce").fillna(0)
    rel = rel.merge(tract10_walkability(), left_on="GEOID_TRACT_10", right_on="geoid10", how="left")
    rel = rel.dropna(subset=["walkability"])
    # Land-area weights; a water-only overlap (land 0) counts only if nothing else does.
    rel["w"] = rel["land"].where(rel.groupby("GEOID_TRACT_20")["land"].transform("sum") > 0, 1.0)
    g = rel.assign(wv=rel["walkability"] * rel["w"]).groupby("GEOID_TRACT_20")
    out = (g["wv"].sum() / g["w"].sum()).rename("walkability").reset_index().rename(columns={"GEOID_TRACT_20": "geoid"})
    log.info("walkability %s: %d tracts", county_fips, len(out))
    return out


if __name__ == "__main__":
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    print(fetch(fips)["walkability"].describe().round(2).to_string())
