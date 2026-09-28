"""
SOURCE: precomputed distances — airport, ocean coast, big metro.

WHAT THIS PRODUCES
    fips, dist_airport_mi, nearest_airport, dist_coast_mi,
    dist_metro_mi, nearest_metro

    Great-circle miles from each county's 2020 POPULATION CENTER (where people
    live; the Gazetteer internal point for Connecticut's 9 planning regions,
    which postdate the 2020 file) — the same origin the climate search uses.

    dist_airport_mi   nearest LARGE US airport with scheduled service
                      (OurAirports, type=large_airport — the major hubs).
    dist_coast_mi     nearest coast — ocean, bays and TIDAL ESTUARIES (Natural
                      Earth 1:10m follows tidal water inland: the Potomac to
                      Washington, the Delaware to Philadelphia, the lower
                      Hudson, the Sacramento delta). Great Lakes shores are not
                      coast. Dropped: Canadian coast north of 49.5°N east of
                      129°W (Hudson Bay, the Arctic) and the St. Lawrence above
                      Quebec City (a freshwater river). Alaska, the Maritimes
                      and the Gulf of California stay.
    dist_metro_mi     population-weighted center of the nearest METRO area
                      with 500k+ people (OMB CBSA delineation, the one BEA
                      uses, + ACS county populations). A county inside such a
                      metro gets the distance to that metro's center.

    Distances are to the nearest vertex of the (densified) coastline, so they
    are accurate to about a mile — far finer than a county.

RUN STANDALONE
    python -m etl.sources.distances    (needs spine, popcenter and acs interim files)
"""

from __future__ import annotations

import io
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from .. import config
from ..util import describe_frame, get_logger, haversine_miles, http_get, nearest_points, read_interim, write_interim

log = get_logger("source.distances")

COAST_STEP_MI = 1.0  # densify coastline segments to about this spacing


# ---------------------------------------------------------------------------
# Origins
# ---------------------------------------------------------------------------


def origins() -> pd.DataFrame:
    """fips, lat, lon — population center where known, else the internal point."""
    spine = read_interim("spine")[["fips", "lat", "lon"]]
    try:
        pop = read_interim("popcenter")[["fips", "pop_lat", "pop_lon"]]
    except FileNotFoundError:
        pop = pd.DataFrame(columns=["fips", "pop_lat", "pop_lon"])
    df = spine.merge(pop, on="fips", how="left")
    df["lat"] = df["pop_lat"].fillna(df["lat"])
    df["lon"] = df["pop_lon"].fillna(df["lon"])
    return df[["fips", "lat", "lon"]]


# ---------------------------------------------------------------------------
# Airports
# ---------------------------------------------------------------------------


def large_airports(csv_text: str) -> pd.DataFrame:
    a = pd.read_csv(io.StringIO(csv_text), dtype=str, keep_default_na=False)
    a = a[(a["type"] == "large_airport") & (a["iso_country"] == "US") & (a["scheduled_service"] == "yes")]
    a = a.assign(lat=pd.to_numeric(a["latitude_deg"]), lon=pd.to_numeric(a["longitude_deg"]),
                 code=a["iata_code"].where(a["iata_code"] != "", a["ident"]))
    if len(a) < 50:
        raise ValueError(f"only {len(a)} large US airports — has the OurAirports format changed?")
    return a[["code", "name", "lat", "lon"]].reset_index(drop=True)


# ---------------------------------------------------------------------------
# Coast
# ---------------------------------------------------------------------------


def keep_coast_vertex(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """US-relevant coast: drop the Canadian Arctic and Hudson Bay, and the St.
    Lawrence above Quebec City, where it is a freshwater river (Natural Earth
    runs it past Montreal, which made Minneapolis 'coastal' at 908 mi)."""
    in_region = (lon < -50) & (lat > 10) & (lat < 75)
    canada_north = (lat > 49.5) & (lon > -129)
    # No US coast lies in this band north of 44°N (Maine and NH are east of -71.3).
    st_lawrence_river = (lat > 44.0) & (lon > -80) & (lon < -71.3)
    return in_region & ~canada_north & ~st_lawrence_river


def densify(coords: list[list[float]], step_mi: float = COAST_STEP_MI) -> np.ndarray:
    """(n, 2) lon/lat array with extra points so no segment is longer than ~step_mi."""
    pts = np.asarray(coords, dtype=float)
    if len(pts) < 2:
        return pts
    out = [pts[:1]]
    for a, b in zip(pts[:-1], pts[1:]):
        d = float(haversine_miles(a[1], a[0], b[1], b[0]))
        n = max(1, int(np.ceil(d / step_mi)))
        t = np.linspace(0, 1, n + 1)[1:, None]
        out.append(a + (b - a) * t)
    return np.vstack(out)


def coastline_points(geojson: dict) -> tuple[np.ndarray, np.ndarray]:
    parts: list[np.ndarray] = []
    for f in geojson.get("features", []):
        g = f.get("geometry") or {}
        kind = g.get("type")
        if kind == "LineString":
            lines = [g["coordinates"]]
        elif kind == "MultiLineString":
            lines = g["coordinates"]
        else:
            lines = []
        for line in lines:
            parts.append(densify(line))
    pts = np.vstack(parts)
    keep = keep_coast_vertex(pts[:, 1], pts[:, 0])
    return pts[keep, 1], pts[keep, 0]


def load_coastline() -> tuple[np.ndarray, np.ndarray]:
    body = http_get(config.COASTLINE_URL, binary=True, cache_hint="ne_10m_coastline")
    assert isinstance(body, bytes)
    with tempfile.TemporaryDirectory() as tmp:
        zipfile.ZipFile(io.BytesIO(body)).extractall(tmp)
        shp = next(Path(tmp).glob("*.shp"))
        out = Path(tmp) / "coast.json"
        subprocess.run(["npx", "-y", f"mapshaper@{config.MAPSHAPER_VERSION}", str(shp),
                        "-o", "format=geojson", str(out)], check=True, capture_output=True)
        return coastline_points(json.loads(out.read_text()))


def nearest_distance(lat: np.ndarray, lon: np.ndarray, plat: np.ndarray, plon: np.ndarray,
                     chunk: int = 16) -> np.ndarray:
    """Distance from each (lat, lon) to the nearest of many points, in small chunks."""
    out = np.empty(len(lat))
    for s in range(0, len(lat), chunk):
        d = haversine_miles(lat[s:s + chunk, None], lon[s:s + chunk, None], plat[None, :], plon[None, :])
        out[s:s + chunk] = d.min(axis=1)
    return out


# ---------------------------------------------------------------------------
# Metros
# ---------------------------------------------------------------------------


def big_metros(crosswalk: pd.DataFrame, points: pd.DataFrame, population: pd.DataFrame,
               min_pop: int = config.METRO_MIN_POPULATION) -> pd.DataFrame:
    """cbsa, name, lat, lon, population for metropolitan areas with at least min_pop people."""
    m = crosswalk[crosswalk["metro_type"].str.contains("Metropolitan", case=False, na=False)]
    m = m.merge(points, on="fips").merge(population[["fips", "population"]], on="fips")
    m = m.dropna(subset=["population"])
    g = m.assign(wlat=m["lat"] * m["population"], wlon=m["lon"] * m["population"]).groupby(
        ["cbsa", "cbsa_name"], as_index=False)[["population", "wlat", "wlon"]].sum()
    g = g[g["population"] >= min_pop]
    g["lat"] = g["wlat"] / g["population"]
    g["lon"] = g["wlon"] / g["population"]
    return g[["cbsa", "cbsa_name", "lat", "lon", "population"]].reset_index(drop=True)


# ---------------------------------------------------------------------------


def fetch() -> pd.DataFrame:
    from .bea import load_cbsa_crosswalk

    pts = origins()
    lat, lon = pts["lat"].to_numpy(float), pts["lon"].to_numpy(float)
    out = pd.DataFrame({"fips": pts["fips"]})

    airports = large_airports(http_get(config.OURAIRPORTS_URL, cache_hint="ourairports"))  # type: ignore[arg-type]
    idx, dist = nearest_points(lat, lon, airports["lat"].to_numpy(), airports["lon"].to_numpy())
    out["dist_airport_mi"] = dist[:, 0]
    out["nearest_airport"] = airports["code"].to_numpy()[idx[:, 0]]
    log.info("airports: %d large US airports", len(airports))

    clat, clon = load_coastline()
    out["dist_coast_mi"] = nearest_distance(lat, lon, clat, clon)
    log.info("coast: %d coastline points after densifying", len(clat))

    metros = big_metros(load_cbsa_crosswalk(), pts, read_interim("acs"))
    idx, dist = nearest_points(lat, lon, metros["lat"].to_numpy(), metros["lon"].to_numpy())
    out["dist_metro_mi"] = dist[:, 0]
    out["nearest_metro"] = metros["cbsa_name"].to_numpy()[idx[:, 0]]
    log.info("metros: %d metro areas with %d+ people", len(metros), config.METRO_MIN_POPULATION)
    return out


def main() -> None:
    df = fetch()
    write_interim(df, "distances")
    print(describe_frame(df, "distances"))
    spot = ["48453", "08031", "06075", "12086", "17031", "48301", "27053", "04027", "02020", "15003"]
    print(df[df["fips"].isin(spot)].round(1).to_string())


if __name__ == "__main__":
    main()
