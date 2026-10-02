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
    weighted center, not downtown, so there's also:
                     dist_downtown_mi, nearest_downtown, downtown_metro — to the
                     nearest downtown of the metro's major cities (Dallas or
                     Fort Worth), found from where jobs are (see downtowns()).

RUN STANDALONE
    python -m etl.tracts.geo 48453
"""

from __future__ import annotations

import functools
import io
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from .. import config
from ..sources.bea import load_cbsa_crosswalk
from ..sources.distances import big_metros, large_airports, load_coastline, nearest_distance, origins
from ..util import get_logger, haversine_miles, http_get, nearest_points, read_interim

log = get_logger("tracts.geo")

SQ_M_PER_SQ_MI = 2_589_988.110336


@functools.lru_cache(maxsize=4)
def _state_tracts(state: str) -> tuple[dict, ...]:
    """Every tract feature in a state (GEOID, ALAND), converted once per state."""
    body = http_get(config.TRACT_BOUNDARY_URL.format(state=state), binary=True,
                    cache_hint=f"cb_2024_{state}_tract")
    assert isinstance(body, bytes)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"cb_2024_{state}_tract_500k.zip"
        src.write_bytes(body)
        out = Path(tmp) / "tracts.json"
        cmd = ["npx", "-y", f"mapshaper@{config.MAPSHAPER_VERSION}", str(src),
               "-filter-fields", "GEOID,ALAND", "-o", "format=geojson", str(out)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"mapshaper failed: {result.stderr[-1500:]}")
        return tuple(json.loads(out.read_text())["features"])


def shapes(county_fips: str) -> dict:
    """The county's tracts as GeoJSON (unsimplified; the app gets a simplified copy)."""
    feats = [f for f in _state_tracts(county_fips[:2]) if f["properties"]["GEOID"].startswith(county_fips)]
    return {"type": "FeatureCollection", "features": feats}


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


@functools.lru_cache(maxsize=4)
@functools.lru_cache(maxsize=4)
def _current_by_tract_code(state: str) -> dict[str, str]:
    return {f["properties"]["GEOID"][5:]: f["properties"]["GEOID"] for f in _state_tracts(state)}


def current_geoids(geoids: pd.Series) -> pd.Series:
    """2020-coded tract GEOIDs -> today's. Connecticut replaced its 8 counties with 9
    planning regions in 2022 (09001… -> 09110…): tracts kept their numbers, unique
    statewide, so the number finds the new GEOID. Sources still on 2020 codes (population
    centers, NRI, walkability, ZIPs, LODES) go through this; other states pass unchanged."""
    g = geoids.astype(str)
    ct = g.str[:2] == "09"
    if not ct.any():
        return g
    lookup = _current_by_tract_code("09")
    return g.where(~ct, g[ct].str[5:].map(lookup).fillna(g[ct]))


def _state_popcenters(state: str) -> pd.DataFrame:
    # Bytes, decoded as UTF-8 with BOM: the generic text path guesses latin-1
    # and turns the byte-order mark into "ï»¿STATEFP" (as sources/popcenter.py notes).
    body = http_get(config.TRACT_POPCENTER_URL.format(state=state), binary=True,
                    cache_hint=f"cenpop2020_tract_{state}")
    assert isinstance(body, bytes)
    df = pd.read_csv(io.StringIO(body.decode("utf-8-sig")), dtype=str)
    return pd.DataFrame({
        "geoid": current_geoids(df["STATEFP"] + df["COUNTYFP"] + df["TRACTCE"]),
        "pop_lat": pd.to_numeric(df["LATITUDE"]),
        "pop_lon": pd.to_numeric(df["LONGITUDE"]),
    })


def popcenters(county_fips: str) -> pd.DataFrame:
    """geoid, pop_lat, pop_lon for the county's tracts (2020 centers of population)."""
    pc = _state_popcenters(county_fips[:2])
    return pc[pc["geoid"].str.startswith(county_fips)].reset_index(drop=True)


@functools.lru_cache(maxsize=1)
def _airports() -> pd.DataFrame:
    return large_airports(http_get(config.OURAIRPORTS_URL, cache_hint="ourairports"))  # type: ignore[arg-type]


@functools.lru_cache(maxsize=1)
def _metros() -> pd.DataFrame:
    return big_metros(load_cbsa_crosswalk(), origins(), read_interim("acs"))


@functools.lru_cache(maxsize=1)
def _coastline() -> tuple[np.ndarray, np.ndarray]:
    return load_coastline()


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
    airports = _airports()
    idx, dist = nearest_points(lat, lon, airports["lat"].to_numpy(), airports["lon"].to_numpy())
    df["dist_airport_mi"] = dist[:, 0]
    df["nearest_airport"] = airports["code"].to_numpy()[idx[:, 0]]

    metros = _metros()
    idx, dist = nearest_points(lat, lon, metros["lat"].to_numpy(), metros["lon"].to_numpy())
    df["dist_metro_mi"] = dist[:, 0]
    df["nearest_metro"] = metros["cbsa_name"].to_numpy()[idx[:, 0]]

    clat, clon = _coastline()
    df["dist_coast_mi"] = nearest_distance(lat, lon, clat, clon)

    dts = downtowns(county_fips)
    dist = np.column_stack([haversine_miles(lat, lon, d["lat"], d["lon"]) for d in dts])
    nearest = dist.argmin(axis=1)
    df["dist_downtown_mi"] = dist[np.arange(len(df)), nearest]
    df["nearest_downtown"] = [dts[k]["city"] for k in nearest]
    df["downtown_metro"] = dts[0]["metro"]
    log.info("downtowns for %s: %s", county_fips,
             "; ".join(f"{d['city']} ({d['lat']:.3f}, {d['lon']:.3f})" for d in dts))
    return df


# ---------------------------------------------------------------------------
# Point-in-polygon: which district / neighborhood / jurisdiction a tract is in
# ---------------------------------------------------------------------------


def load_polygons(url: str, cache_hint: str, fields: list[str], where: str | None = None,
                  user_agent: str | None = None) -> list[tuple[dict, object]]:
    """Cached per (url, fields, where): a statewide file is converted once per run."""
    return list(_load_polygons(url, cache_hint, tuple(fields), where, user_agent))


@functools.lru_cache(maxsize=16)
def _load_polygons(url: str, cache_hint: str, fields: tuple[str, ...], where: str | None,
                   user_agent: str | None) -> tuple[tuple[dict, object], ...]:
    """A zipped shapefile -> [(properties, shapely geometry)], via mapshaper GeoJSON.

    `where` is a mapshaper -filter expression to keep only nearby features
    (e.g. one county), which keeps statewide files fast.
    """
    from shapely.geometry import shape

    body = http_get(url, binary=True, cache_hint=cache_hint, user_agent=user_agent)
    assert isinstance(body, bytes)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "src.zip"
        src.write_bytes(body)
        out = Path(tmp) / "out.json"
        cmd = ["npx", "-y", f"mapshaper@{config.MAPSHAPER_VERSION}", str(src)]
        if where:
            cmd += ["-filter", where]
        cmd += ["-filter-fields", ",".join(fields), "-proj", "wgs84", "-o", "format=geojson", str(out)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"mapshaper failed on {url}: {result.stderr[-1500:]}")
        gj = json.loads(out.read_text())
    return tuple((f["properties"], shape(f["geometry"])) for f in gj["features"] if f.get("geometry"))


def locate(lat: np.ndarray, lon: np.ndarray, polygons: list[tuple[dict, object]]) -> list[dict | None]:
    """For each point, the properties of the polygon containing it (first match), or None."""
    from shapely import STRtree, points

    if not polygons:
        return [None] * len(lat)
    geoms = [g for _, g in polygons]
    tree = STRtree(geoms)
    pts = points(lon, lat)
    hits = tree.query(pts, predicate="within")  # [point index, polygon index]
    out: list[dict | None] = [None] * len(lat)
    for pi, gi in zip(hits[0], hits[1]):
        if out[pi] is None:
            out[pi] = polygons[gi][0]
    return out


# ---------------------------------------------------------------------------
# Downtown: the metro's densest cluster of jobs
# ---------------------------------------------------------------------------

STATE_ABBR = {
    "01": "al", "02": "ak", "04": "az", "05": "ar", "06": "ca", "08": "co", "09": "ct", "10": "de",
    "11": "dc", "12": "fl", "13": "ga", "15": "hi", "16": "id", "17": "il", "18": "in", "19": "ia",
    "20": "ks", "21": "ky", "22": "la", "23": "me", "24": "md", "25": "ma", "26": "mi", "27": "mn",
    "28": "ms", "29": "mo", "30": "mt", "31": "ne", "32": "nv", "33": "nh", "34": "nj", "35": "nm",
    "36": "ny", "37": "nc", "38": "nd", "39": "oh", "40": "ok", "41": "or", "42": "pa", "44": "ri",
    "45": "sc", "46": "sd", "47": "tn", "48": "tx", "49": "ut", "50": "vt", "51": "va", "53": "wa",
    "54": "wv", "55": "wi", "56": "wy",
}


@functools.lru_cache(maxsize=8)
def _state_jobs(state: str) -> pd.DataFrame:
    """geoid, jobs: all jobs by workplace tract in a state (LODES WAC, summed from blocks)."""
    st = STATE_ABBR[state]
    # Some states lag in LODES (Michigan: nothing after 2021 as of 2026-10; Alaska: 2016):
    # take the newest year published (LODES8 puts every year on 2020 blocks). Where a
    # downtown's jobs cluster sits barely moves.
    body = None
    for year in range(config.LODES_YEAR, config.LODES_YEAR - 8, -1):
        try:
            body = http_get(config.LODES_WAC_URL.format(st=st, year=year), binary=True,
                            cache_hint=f"lodes_wac_{st}_{year}")
        except requests.HTTPError as exc:
            if exc.response is None or exc.response.status_code != 404:
                raise
            continue
        if year != config.LODES_YEAR:
            log.warning("LODES %s: no %d file, using %d", st.upper(), config.LODES_YEAR, year)
        break
    if body is None:  # downtowns then fall back to each city's own point (_downtowns)
        log.warning("LODES %s: no file in %d–%d; downtowns use city points", st.upper(),
                    config.LODES_YEAR - 7, config.LODES_YEAR)
        return pd.DataFrame(columns=["geoid", "jobs"])
    assert isinstance(body, bytes)
    wac = pd.read_csv(io.BytesIO(body), compression="gzip", usecols=["w_geocode", "C000"],
                      dtype={"w_geocode": str})
    wac["geoid"] = current_geoids(wac["w_geocode"].str.zfill(15).str[:11])
    return wac.groupby("geoid", as_index=False)["C000"].sum().rename(columns={"C000": "jobs"})


@functools.lru_cache(maxsize=8)
def _state_centers(state: str) -> pd.DataFrame:
    """geoid, lat, lon: a point inside each of a state's tracts (shapely representative point)."""
    from shapely.geometry import shape

    feats = _state_tracts(state)
    pts = [shape(f["geometry"]).representative_point() for f in feats]
    return pd.DataFrame({"geoid": [f["properties"]["GEOID"] for f in feats],
                         "lat": [p.y for p in pts], "lon": [p.x for p in pts]})


def _metro_for(county_fips: str) -> tuple[str, str]:
    """(cbsa, name): the county's own metro if metropolitan, else the nearest 500k+ metro."""
    xw = load_cbsa_crosswalk()
    row = xw[xw["fips"] == county_fips]
    if len(row) and row["metro_type"].str.contains("Metropolitan", case=False).iloc[0]:
        return row["cbsa"].iloc[0], row["cbsa_name"].iloc[0]
    pts = origins()
    here = pts[pts["fips"] == county_fips]
    metros = _metros()
    idx, _ = nearest_points(here["lat"].to_numpy(float), here["lon"].to_numpy(float),
                            metros["lat"].to_numpy(), metros["lon"].to_numpy())
    return metros["cbsa"].iloc[idx[0, 0]], metros["cbsa_name"].iloc[idx[0, 0]]


@functools.lru_cache(maxsize=1)
def _major_cities() -> pd.DataFrame:
    """cbsa, city, lat, lon, population: each metro's major principal cities."""
    body = http_get(config.CBSA_PRINCIPAL_CITIES_URL, binary=True, cache_hint="cbsa_list2_2023")
    assert isinstance(body, bytes)
    raw = pd.read_excel(io.BytesIO(body), header=None, dtype=str)
    hdr = raw.index[raw.iloc[:, 0].astype(str).str.contains("CBSA Code", na=False)][0]
    pc = pd.read_excel(io.BytesIO(body), header=hdr, dtype=str).dropna(subset=["Principal City Name"])
    pc = pc[pc["Metropolitan/Micropolitan Statistical Area"].str.contains("Metropolitan", na=False)]
    pc["st"] = pc["FIPS State Code"].map(lambda f: STATE_ABBR.get(str(f).zfill(2), "").upper())

    gz = http_get(config.GEONAMES_CITIES_URL, binary=True, cache_hint="geonames_cities15000")
    assert isinstance(gz, bytes)
    cols = ["id", "name", "ascii", "alt", "lat", "lon", "fclass", "fcode", "country", "cc2", "admin1",
            "admin2", "admin3", "admin4", "population", "elevation", "dem", "tz", "modified"]
    gn = pd.read_csv(zipfile.ZipFile(io.BytesIO(gz)).open("cities15000.txt"), sep="\t", header=None,
                     names=cols, dtype=str, quoting=3)
    gn = gn[gn["country"] == "US"].assign(population=lambda d: pd.to_numeric(d["population"]))
    gn = gn.sort_values("population", ascending=False).drop_duplicates(["name", "admin1"])
    m = pc.merge(gn[["name", "admin1", "lat", "lon", "population"]], left_on=["Principal City Name", "st"],
                 right_on=["name", "admin1"], how="inner")
    m = m.assign(lat=pd.to_numeric(m["lat"]), lon=pd.to_numeric(m["lon"]))
    largest = m.groupby("CBSA Code")["population"].transform("max")
    m = m[m["population"] >= config.DOWNTOWN_MIN_SHARE * largest]
    return m.rename(columns={"CBSA Code": "cbsa", "Principal City Name": "city"})[
        ["cbsa", "city", "lat", "lon", "population"]].reset_index(drop=True)


def _metro_jobs(cbsa: str) -> pd.DataFrame:
    """geoid, lat, lon, jobs for every tract with jobs in a metro."""
    xw = load_cbsa_crosswalk()
    counties = set(xw.loc[xw["cbsa"] == cbsa, "fips"])
    frames = []
    for state in sorted({c[:2] for c in counties}):
        centers = _state_centers(state)
        centers = centers[centers["geoid"].str[:5].isin(counties)]
        frames.append(centers.merge(_state_jobs(state), on="geoid", how="left"))
    t = pd.concat(frames, ignore_index=True).fillna({"jobs": 0}) if frames else pd.DataFrame()
    return t[t["jobs"] > 0] if len(t) else t


@functools.lru_cache(maxsize=256)
def _downtowns(cbsa: str, name: str) -> tuple[dict, ...]:
    """One downtown per major city of the metro: the densest 1-mile job cluster
    within DOWNTOWN_SEARCH_MI of the city's point (the city point itself if the
    metro has no job data there)."""
    t = _metro_jobs(cbsa)
    cities = _major_cities()
    cities = cities[cities["cbsa"] == cbsa]
    out = []
    lat, lon, jobs = (t["lat"].to_numpy(float), t["lon"].to_numpy(float), t["jobs"].to_numpy(float)) if len(t) else (
        np.array([]), np.array([]), np.array([]))
    for c in cities.itertuples():
        near_city = haversine_miles(c.lat, c.lon, lat, lon) <= config.DOWNTOWN_SEARCH_MI if len(lat) else np.array([], bool)
        idx = np.flatnonzero(near_city)
        if len(idx) == 0:
            out.append({"city": c.city, "metro": name, "lat": c.lat, "lon": c.lon, "jobs_within_radius": 0})
            continue
        d = haversine_miles(lat[idx, None], lon[idx, None], lat[None, :], lon[None, :])
        within = ((d <= config.DOWNTOWN_RADIUS_MI) * jobs[None, :]).sum(axis=1)
        b = idx[int(np.argmax(within))]
        w = (haversine_miles(lat[b], lon[b], lat, lon) <= config.DOWNTOWN_RADIUS_MI) * jobs
        out.append({"city": c.city, "metro": name, "lat": float((lat * w).sum() / w.sum()),
                    "lon": float((lon * w).sum() / w.sum()), "jobs_within_radius": int(within.max())})
    if not out:  # no principal city matched: fall back to the metro's densest cluster
        if len(lat):
            within = np.array([((haversine_miles(a, b, lat, lon) <= config.DOWNTOWN_RADIUS_MI) * jobs).sum()
                               for a, b in zip(lat, lon)])
            k = int(np.argmax(within))
            out.append({"city": name.split("-")[0].split(",")[0], "metro": name, "lat": float(lat[k]),
                        "lon": float(lon[k]), "jobs_within_radius": int(within[k])})
    return tuple(out)


def downtowns(county_fips: str) -> tuple[dict, ...]:
    """The downtowns a county's people would mean: its own metro's major cities'
    (or the nearest 500k+ metro's, outside a metro). Computed once per metro."""
    return _downtowns(*_metro_for(county_fips))


def downtown(county_fips: str) -> dict:
    """The metro's main downtown (its largest city's) — kept for the QA report."""
    return downtowns(county_fips)[0]


if __name__ == "__main__":
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    gj = shapes(fips)
    df = table(fips, gj)
    print(len(gj["features"]), "shapes")
    print(df.describe().T.round(2).to_string())
