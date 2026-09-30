"""
SOURCES: tract shapes, tract population centers, and distances from them.

WHAT THIS PRODUCES
    shapes(county)   GeoJSON FeatureCollection of the county's tracts, property
                     GEOID, from the 2024 cartographic boundaries (clipped to
                     the shoreline, like the county map). Converted with
                     mapshaper, the same tool the county boundaries use.
    table(county)    geoid, land_sq_mi, pop_lat, pop_lon,
                     dist_airport_mi, nearest_airport,
                     dist_metro_mi, nearest_metro, dist_coast_mi

WHERE DISTANCES ARE MEASURED FROM
    Each tract's 2020 population center — where its people live — the same
    origin the county data uses. A tract with no population center falls back
    to its shape's internal point (ALAND weighting isn't available offline).

    Airports, coastline and the 500k+ metro centers are exactly the county
    pipeline's (etl/sources/distances.py), so a tract's distances and its
    county's agree in method. The metro center is the metro's population-
    weighted center, not downtown; "distance to downtown" is a Phase 8 TODO.

RUN STANDALONE
    python -m etl.tracts.geo 48453
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from .. import config
from ..sources.bea import load_cbsa_crosswalk
from ..sources.distances import big_metros, large_airports, load_coastline, nearest_distance, origins
from ..util import get_logger, http_get, nearest_points, read_interim

log = get_logger("tracts.geo")

SQ_M_PER_SQ_MI = 2_589_988.110336


def shapes(county_fips: str) -> dict:
    """The county's tracts as GeoJSON (unsimplified; the app gets a simplified copy)."""
    state = county_fips[:2]
    body = http_get(config.TRACT_BOUNDARY_URL.format(state=state), binary=True,
                    cache_hint=f"cb_2024_{state}_tract")
    assert isinstance(body, bytes)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"cb_2024_{state}_tract_500k.zip"
        src.write_bytes(body)
        out = Path(tmp) / "tracts.json"
        cmd = ["npx", "-y", f"mapshaper@{config.MAPSHAPER_VERSION}", str(src),
               "-filter", f"COUNTYFP === '{county_fips[2:]}'",
               "-filter-fields", "GEOID,ALAND",
               "-o", "format=geojson", str(out)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"mapshaper failed: {result.stderr[-1500:]}")
        return json.loads(out.read_text())


def topojson(geojson: dict, simplify: str = "20%") -> str:
    """A simplified TopoJSON of the tracts for the app (layer `tracts`, property GEOID)."""
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "tracts.json"
        src.write_text(json.dumps(geojson))
        out = Path(tmp) / "tracts.topo.json"
        cmd = ["npx", "-y", f"mapshaper@{config.MAPSHAPER_VERSION}", str(src), "name=tracts",
               "-simplify", simplify, "keep-shapes", "-filter-fields", "GEOID",
               "-o", "format=topojson", "quantization=1e5", str(out)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"mapshaper failed: {result.stderr[-1500:]}")
        return out.read_text()


def popcenters(county_fips: str) -> pd.DataFrame:
    """geoid, pop_lat, pop_lon for the county's tracts (2020 centers of population)."""
    state = county_fips[:2]
    # Bytes, decoded as UTF-8 with BOM: the generic text path guesses latin-1
    # and turns the byte-order mark into "ï»¿STATEFP" (as sources/popcenter.py notes).
    body = http_get(config.TRACT_POPCENTER_URL.format(state=state), binary=True,
                    cache_hint=f"cenpop2020_tract_{state}")
    assert isinstance(body, bytes)
    text = body.decode("utf-8-sig")
    df = pd.read_csv(io.StringIO(text), dtype=str)
    df = df[df["COUNTYFP"] == county_fips[2:]]
    return pd.DataFrame({
        "geoid": df["STATEFP"] + df["COUNTYFP"] + df["TRACTCE"],
        "pop_lat": pd.to_numeric(df["LATITUDE"]),
        "pop_lon": pd.to_numeric(df["LONGITUDE"]),
    }).reset_index(drop=True)


def _interior_point(geometry: dict) -> tuple[float, float]:
    """A rough fallback origin: the mean of the outer ring's vertices (lat, lon)."""
    ring = geometry["coordinates"][0] if geometry["type"] == "Polygon" else geometry["coordinates"][0][0]
    arr = np.asarray(ring, dtype=float)
    return float(arr[:, 1].mean()), float(arr[:, 0].mean())


def table(county_fips: str, geojson: dict) -> pd.DataFrame:
    feats = geojson["features"]
    df = pd.DataFrame({
        "geoid": [f["properties"]["GEOID"] for f in feats],
        "land_sq_mi": [float(f["properties"]["ALAND"]) / SQ_M_PER_SQ_MI for f in feats],
    })
    df = df.merge(popcenters(county_fips), on="geoid", how="left")
    missing = df["pop_lat"].isna()
    if missing.any():
        pts = [_interior_point(f["geometry"]) for f in feats]
        fallback = pd.DataFrame(pts, columns=["lat", "lon"], index=df.index)
        df.loc[missing, "pop_lat"] = fallback.loc[missing, "lat"]
        df.loc[missing, "pop_lon"] = fallback.loc[missing, "lon"]
        log.info("%d tracts have no 2020 population center; using a shape point", int(missing.sum()))

    lat, lon = df["pop_lat"].to_numpy(float), df["pop_lon"].to_numpy(float)
    airports = large_airports(http_get(config.OURAIRPORTS_URL, cache_hint="ourairports"))  # type: ignore[arg-type]
    idx, dist = nearest_points(lat, lon, airports["lat"].to_numpy(), airports["lon"].to_numpy())
    df["dist_airport_mi"] = dist[:, 0]
    df["nearest_airport"] = airports["code"].to_numpy()[idx[:, 0]]

    metros = big_metros(load_cbsa_crosswalk(), origins(), read_interim("acs"))
    idx, dist = nearest_points(lat, lon, metros["lat"].to_numpy(), metros["lon"].to_numpy())
    df["dist_metro_mi"] = dist[:, 0]
    df["nearest_metro"] = metros["cbsa_name"].to_numpy()[idx[:, 0]]

    clat, clon = load_coastline()
    df["dist_coast_mi"] = nearest_distance(lat, lon, clat, clon)
    return df


if __name__ == "__main__":
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    gj = shapes(fips)
    df = table(fips, gj)
    print(len(gj["features"]), "shapes")
    print(df.describe().T.round(2).to_string())
