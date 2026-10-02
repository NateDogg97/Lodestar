"""
SOURCE: names for tracts — tracts are only numbers (plan §9 Phase 8).

WHAT THIS PRODUCES
    geoid, neighborhood, place, near_place, zip, label

    neighborhood  the Zillow neighborhood containing the tract's population
                  center, where one exists (mostly inside cities)
    place         the city, town or CDP (Census "place") containing it; empty
                  in unincorporated areas
    near_place    for those, the nearest place (owner, 2026-09-30): an area
                  outside any community reads "Near Manor · 78653"
    zip           the ZIP code (ZCTA) sharing the most land with the tract
    label         what the app shows, e.g. "Barton Hills, Austin · 78704",
                  "Pflugerville · 78660", "Near Manor · 78653"

SOURCES
    Zillow neighborhood boundaries (2017; ~17,000 neighborhoods in ~650 cities),
      republished by EPA on data.gov with a CC0 license; credit Zillow anyway.
      A geodatabase, read with pyogrio (geometry as WKB -> shapely).
    Census TIGER 2024 places, one zip per state.
    Census 2020 ZCTA-to-tract relationship file (land area of each overlap).

RUN STANDALONE
    python -m etl.tracts.names 48453
"""

from __future__ import annotations

import functools
import io
import re
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from .. import config
from ..util import get_logger, http_get
from . import geo

log = get_logger("tracts.names")

ZILLOW_URL = "https://edg.epa.gov/data/PUBLIC/OEI/ZILLOW_NEIGHBORHOODS/Zillow_Neighborhoods.zip"
PLACE_URL = "https://www2.census.gov/geo/tiger/TIGER2024/PLACE/tl_2024_{state}_place.zip"
ZCTA_REL_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt"

_zillow_cache: list | None = None


def clean_place(name: str | None) -> str | None:
    """Consolidated city-counties' Census names, made readable (8c, Georgia):
    "Athens-Clarke County unified government (balance)" -> "Athens-Clarke County",
    "Nashville-Davidson metropolitan government (balance)" -> "Nashville-Davidson",
    "Indianapolis city (balance)" -> "Indianapolis"."""
    if not isinstance(name, str):
        return name
    if "(balance)" not in name and "government" not in name:
        return name
    n = re.sub(r"\s*\(balance\)$", "", name)
    n = re.sub(r"\s+(unified|consolidated|metropolitan|metro)\s+government$", "", n)
    return re.sub(r"\s+(city|town|village)$", "", n)


def zillow_neighborhoods() -> list:
    """[(props {Name, City, State}, shapely geometry)] for every Zillow neighborhood."""
    global _zillow_cache
    if _zillow_cache is not None:
        return _zillow_cache
    import pyogrio.raw as raw
    from shapely import from_wkb

    body = http_get(ZILLOW_URL, binary=True, cache_hint="zillow_neighborhoods")
    assert isinstance(body, bytes)
    zf = zipfile.ZipFile(io.BytesIO(body))
    with tempfile.TemporaryDirectory() as tmp:
        zf.extractall(tmp, members=[n for n in zf.namelist() if n.startswith("ZillowNeighborhoods.gdb")])
        meta, _, wkb, fields = raw.read(Path(tmp) / "ZillowNeighborhoods.gdb", layer="ZillowNeighborhoods_GeoDD",
                                        columns=["State", "City", "Name"], read_geometry=True)
    cols = dict(zip(meta["fields"], fields))
    geoms = from_wkb(wkb)
    _zillow_cache = [({"Name": n, "City": c, "State": s}, g)
                     for n, c, s, g in zip(cols["Name"], cols["City"], cols["State"], geoms) if g is not None]
    return _zillow_cache


@functools.lru_cache(maxsize=1)
def _zcta_relationship() -> pd.DataFrame:
    body = http_get(ZCTA_REL_URL, binary=True, cache_hint="tab20_zcta520_tract20_natl")
    assert isinstance(body, bytes)
    return pd.read_csv(io.BytesIO(body), sep="|", dtype=str, encoding="utf-8-sig",
                       usecols=["GEOID_ZCTA5_20", "GEOID_TRACT_20", "AREALAND_PART"])


def _zips(county_fips: str) -> pd.Series:
    rel = _zcta_relationship()
    rel = rel[(rel["GEOID_TRACT_20"].str[:5] == county_fips) & rel["GEOID_ZCTA5_20"].notna()].copy()
    rel["land"] = pd.to_numeric(rel["AREALAND_PART"], errors="coerce").fillna(0)
    best = rel.sort_values("land", ascending=False).drop_duplicates("GEOID_TRACT_20")
    return best.set_index("GEOID_TRACT_20")["GEOID_ZCTA5_20"]


def fetch(county_fips: str, tracts: pd.DataFrame, county_name: str) -> pd.DataFrame:
    """`tracts` needs geoid, pop_lat, pop_lon."""
    lat, lon = tracts["pop_lat"].to_numpy(float), tracts["pop_lon"].to_numpy(float)

    # Only neighborhoods near the county: a bounding-box prefilter keeps this fast.
    pad = 0.05
    box = (lon.min() - pad, lat.min() - pad, lon.max() + pad, lat.max() + pad)
    hoods = [(p, g) for p, g in zillow_neighborhoods()
             if g.bounds[0] <= box[2] and g.bounds[2] >= box[0] and g.bounds[1] <= box[3] and g.bounds[3] >= box[1]]
    hood = geo.locate(lat, lon, hoods)

    places = geo.load_polygons(PLACE_URL.format(state=county_fips[:2]), f"tl_2024_{county_fips[:2]}_place",
                               ["NAME"])
    place = geo.locate(lat, lon, places)

    out = pd.DataFrame({
        "geoid": tracts["geoid"],
        "neighborhood": [h["Name"] if h else None for h in hood],
        "place": [clean_place(p["NAME"]) if p else None for p in place],
    })
    out["zip"] = out["geoid"].map(_zips(county_fips))

    # Outside any place: name the nearest one (distance to its outline, in
    # degrees — fine for "nearest" at county scale).
    from shapely import points as _points

    near = []
    for i, p in enumerate(place):
        if p is not None or not places:
            near.append(None)
            continue
        pt = _points(lon[i], lat[i])
        near.append(clean_place(min(places, key=lambda pg: pg[1].distance(pt))[0]["NAME"]))
    out["near_place"] = near

    def label(r) -> str:
        # Missing values arrive as NaN, which is truthy: test with notna.
        if pd.notna(r["place"]):
            where = r["place"]
        elif pd.notna(r["near_place"]):
            where = f"Near {r['near_place']}"
        else:
            where = f"Unincorporated {county_name.split(',')[0]}"
        name = f"{r['neighborhood']}, {where}" if pd.notna(r["neighborhood"]) else where
        return f"{name} · {r['zip']}" if pd.notna(r["zip"]) else name

    out["label"] = out.apply(label, axis=1)
    log.info("names %s: %d with a neighborhood, %d in a city/town, %d with a ZIP (of %d)", county_fips,
             out["neighborhood"].notna().sum(), out["place"].notna().sum(), out["zip"].notna().sum(), len(out))
    return out


if __name__ == "__main__":
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    t = geo.table(fips, geo.shapes(fips))
    n = fetch(fips, t, config.TRACT_PILOT_COUNTIES.get(fips, fips))
    print(n.sample(15, random_state=1)[["geoid", "label"]].to_string(index=False))
