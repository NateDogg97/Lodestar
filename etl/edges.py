"""
Distances to things with an edge, not a center (plan §9 Phase 10 follow-up, 2026-10-13).

    dist_metro_mi, nearest_metro   to the EDGE of the nearest 500k+ metro's built-up area:
                                   its largest 2020 Census urban area. 0 inside it.
    dist_great_lake_mi             to the nearest Great Lake shore (0 on the water).
    nearest_town, dist_town_mi     the nearest town or city center of 15,000+ people
                                   (GeoNames' point), shown on the area page beside the
                                   metro's downtown.

WHY
    "Distance to a 500k+ metro" was to the metro's population-weighted center: Washtenaw,
    MI, which borders Wayne County, read 31.7 mi from "Detroit" — the label promised
    distance to the metro. A metro is the place you can reach, so its edge is the honest
    measure: 0 when you're in it. The coast excludes the Great Lakes by definition (ocean,
    bays, tidal water); Michigan, Ohio and Wisconsin's shores get their own measure.
    Downtowns are the metro's major cities only, so Ypsilanti measured to downtown Ann
    Arbor; the town center gives its own, without changing what "downtown" ranks on.

SOURCES
    Census 2020 urban areas, cartographic boundary 1:500k (cb_2020_us_ua20_500k.zip).
    Natural Earth 1:10m lakes (ne_10m_lakes.zip): Superior, Michigan, Huron, Erie, Ontario.
    GeoNames cities15000 (the file the downtown search already uses).

Distances are great-circle miles from each point to the nearest point of the shape,
found in a locally scaled plane (longitude × cos latitude) — within about 1% at these
ranges.
"""

from __future__ import annotations

import functools
import io
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from . import config
from .util import get_logger, haversine_miles, http_get

log = get_logger("edges")

URBAN_AREAS_URL = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_ua20_500k.zip"
LAKES_URL = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes.zip"
GREAT_LAKES = {"Lake Superior", "Lake Michigan", "Lake Huron", "Lake Erie", "Lake Ontario"}
# GeoNames' cities15000 floor. 20,000 left out Ypsilanti, MI (GeoNames: ~19,400).
TOWN_MIN_POPULATION = 15_000


def _shapefile(url: str, hint: str) -> tuple[pd.DataFrame, list]:
    """(attributes, shapely geometries) of a zipped shapefile, in WGS84 degrees."""
    import pyogrio
    import shapely

    body = http_get(url, binary=True, cache_hint=hint)
    assert isinstance(body, bytes)
    with tempfile.TemporaryDirectory() as tmp:
        zipfile.ZipFile(io.BytesIO(body)).extractall(tmp)
        shp = next(Path(tmp).glob("*.shp"))
        meta, _, geoms, fields = pyogrio.raw.read(shp)
        attrs = pd.DataFrame({name: values for name, values in zip(meta["fields"], fields)})
    return attrs, list(shapely.from_wkb(geoms))


@functools.lru_cache(maxsize=1)
def metro_edges() -> pd.DataFrame:
    """cbsa, cbsa_name, geometry: each 500k+ metro's largest 2020 urban area (by land area)
    among those whose representative point lies in one of the metro's counties."""
    import shapely

    from .sources.bea import load_cbsa_crosswalk

    attrs, geoms = _shapefile(URBAN_AREAS_URL, "cb_2020_us_ua20_500k")
    ua = attrs.assign(geometry=geoms, aland=pd.to_numeric(attrs["ALAND20"], errors="coerce"))
    counties = _county_shapes()
    pts = np.array([g.representative_point() for g in ua["geometry"]], dtype=object)
    hit = counties["tree"].query(pts, predicate="within")
    ua["fips"] = None
    ua.loc[hit[0], "fips"] = counties["fips"][hit[1]]
    xw = load_cbsa_crosswalk()[["fips", "cbsa", "cbsa_name", "metro_type"]]
    big = big_metro_cbsas(xw)
    ua = ua.merge(xw[xw["cbsa"].isin(big)], on="fips", how="inner")
    edges = ua.sort_values("aland", ascending=False).drop_duplicates("cbsa")
    log.info("metro edges: %d of %d 500k+ metros have an urban area", len(edges), len(big))
    return edges[["cbsa", "cbsa_name", "NAME20", "geometry"]].reset_index(drop=True)


def _county_population() -> pd.DataFrame:
    """fips, population: the ACS interim file in a full build, else the published table."""
    import json

    from .util import read_interim

    try:
        return read_interim("acs")[["fips", "population"]]
    except FileNotFoundError:
        p = json.loads(config.PUBLISH_PATH.read_text(encoding="utf-8"))
        return pd.DataFrame(p["rows"], columns=p["columns"])[["fips", "population"]]


def big_metro_cbsas(xw: pd.DataFrame) -> set[str]:
    """Metropolitan CBSAs with METRO_MIN_POPULATION+ people (the same rule as distances.big_metros)."""
    m = xw[xw["metro_type"].str.contains("Metropolitan", case=False, na=False)].merge(_county_population(), on="fips")
    pop = m.groupby("cbsa")["population"].sum()
    return set(pop[pop >= config.METRO_MIN_POPULATION].index)


@functools.lru_cache(maxsize=1)
def _county_shapes() -> dict:
    """County polygons (Census cartographic boundaries, the map's source) in an STRtree."""
    import shapely

    attrs, geoms = _shapefile(config.BOUNDARY_URL, "cb_county_boundaries")
    return {"fips": attrs["GEOID"].to_numpy(), "tree": shapely.STRtree(geoms)}


@functools.lru_cache(maxsize=1)
def great_lakes():
    import shapely

    attrs, geoms = _shapefile(LAKES_URL, "ne_10m_lakes")
    keep = [g for name, g in zip(attrs["name"], geoms) if name in GREAT_LAKES]
    if len(keep) < 5:
        raise ValueError(f"Natural Earth lakes: found {len(keep)} of the 5 Great Lakes")
    return shapely.union_all(keep)


@functools.lru_cache(maxsize=1)
def towns() -> pd.DataFrame:
    """name, state, lat, lon of US places with 15,000+ people (GeoNames)."""
    from .tracts.geo import STATE_ABBR  # noqa: F401  (same GeoNames file as the downtown search)

    gz = http_get(config.GEONAMES_CITIES_URL, binary=True, cache_hint="geonames_cities15000")
    assert isinstance(gz, bytes)
    cols = ["id", "name", "ascii", "alt", "lat", "lon", "fclass", "fcode", "country", "cc2", "admin1",
            "admin2", "admin3", "admin4", "population", "elevation", "dem", "tz", "modified"]
    gn = pd.read_csv(zipfile.ZipFile(io.BytesIO(gz)).open("cities15000.txt"), sep="\t", header=None,
                     names=cols, dtype=str, quoting=3)
    # Populated places, not sections of one (PPLX: "University of Texas") or destroyed ones.
    gn = gn[(gn["country"] == "US") & gn["fcode"].isin(["PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC"])]
    gn = gn.assign(population=pd.to_numeric(gn["population"], errors="coerce"),
                   lat=pd.to_numeric(gn["lat"]), lon=pd.to_numeric(gn["lon"]))
    gn = gn[gn["population"] >= TOWN_MIN_POPULATION]
    return gn.rename(columns={"admin1": "state"})[["name", "state", "lat", "lon", "population"]].reset_index(drop=True)


def distance_to(lat: np.ndarray, lon: np.ndarray, geoms: list) -> tuple[np.ndarray, np.ndarray]:
    """(miles, index of the nearest geometry) from each point to the nearest of `geoms`
    (0 inside one). Nearest found in a plane scaled by cos(latitude) around each point.

    The tree's own nearest is in raw degrees, where a degree of longitude counts as much as
    one of latitude: at 45°N a shape 1.2° east (59 mi) loses to one 1.0° north (69 mi). So
    it only bounds the search: scaling shrinks distances by at most cos(lat), so any shape
    nearer in miles is within d0 / cos(lat) degrees of the point, where d0 is the raw-degree
    distance to the tree's pick. Those few candidates are compared in the scaled plane."""
    import shapely
    from shapely.ops import nearest_points

    tree = shapely.STRtree(geoms)
    pts = shapely.points(lon, lat)
    first = tree.nearest(pts)
    d0 = shapely.distance(pts, np.asarray(geoms, dtype=object)[first])
    # Scaled copies, per shape and 0.1° latitude band: points cluster, so most are reused.
    scaled_cache: dict[tuple[int, int], object] = {}

    def scaled(gi: int, band: int, c: float):
        key = (gi, band)
        if key not in scaled_cache:
            scaled_cache[key] = shapely.transform(geoms[gi], lambda xy: np.column_stack([xy[:, 0] * c, xy[:, 1]]))
        return scaled_cache[key]

    out = np.empty(len(lat))
    idx = first.copy()
    for k, p in enumerate(pts):
        if d0[k] == 0.0:  # inside (or on the edge of) the tree's pick
            out[k] = 0.0
            continue
        band = int(round(lat[k] * 10))
        c = float(np.cos(np.radians(band / 10)))
        here = shapely.Point(lon[k] * c, lat[k])
        best, best_d, best_q = int(first[k]), np.inf, None
        for gi in tree.query(p, predicate="dwithin", distance=d0[k] / c * 1.0001):
            g = scaled(int(gi), band, c)
            dd = here.distance(g)
            if dd < best_d:
                best, best_d = int(gi), dd
                best_q = nearest_points(here, g)[1] if dd > 0 else None
        idx[k] = best
        out[k] = 0.0 if best_q is None else float(haversine_miles(lat[k], lon[k], best_q.y, best_q.x / c))
    return out, idx


def fetch() -> pd.DataFrame:
    """County columns (etl.patch / a full build): from population centers — the popcenter
    interim file in a full build, else the published table's."""
    import json

    # `distances.origins` quietly falls back to internal points without the popcenter file,
    # so it's used only when that file is there.
    if (config.INTERIM_DIR / "popcenter.csv").exists():
        from .sources.distances import origins

        pts = origins()
    else:
        p = json.loads(config.PUBLISH_PATH.read_text(encoding="utf-8"))
        t = pd.DataFrame(p["rows"], columns=p["columns"])
        pts = pd.DataFrame({"fips": t["fips"], "lat": t["pop_lat"].fillna(t["lat"]), "lon": t["pop_lon"].fillna(t["lon"])})
    cols = edge_columns(pts["lat"].to_numpy(float), pts["lon"].to_numpy(float))
    return pd.concat([pts[["fips"]].reset_index(drop=True), cols], axis=1)


def edge_columns(lat: np.ndarray, lon: np.ndarray, with_towns: bool = False) -> pd.DataFrame:
    """The module's columns for points (population centers), in input order."""
    edges = metro_edges()
    d_metro, i_metro = distance_to(lat, lon, list(edges["geometry"]))
    lakes = great_lakes()
    d_lake, _ = distance_to(lat, lon, list(getattr(lakes, "geoms", [lakes])))
    out = pd.DataFrame({
        "dist_metro_mi": d_metro.round(1),
        "nearest_metro": edges["cbsa_name"].to_numpy()[i_metro],
        "dist_great_lake_mi": d_lake.round(1),
    })
    if with_towns:
        t = towns()
        d = haversine_miles(lat[:, None], lon[:, None], t["lat"].to_numpy()[None, :], t["lon"].to_numpy()[None, :])
        k = d.argmin(axis=1)
        out["nearest_town"] = t["name"].to_numpy()[k]
        out["dist_town_mi"] = d[np.arange(len(lat)), k].round(1)
    return out
