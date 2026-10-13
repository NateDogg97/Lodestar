"""
Wildfire smoke: days a year with smoke overhead, where people live (plan §9 Phase 11, Tier 1).

    python -m etl.pollution.smoke MI PA        # those states' blocks -> interim tables
    python -m etl.pollution.smoke all

WHAT THIS PRODUCES
    data/interim/smoke_tracts.csv, smoke_counties.csv — `etl.pollution.exposure` columns for
        smoke_days        days a year with any smoke plume drawn overhead
        smoke_days_thick  days a year with a Medium or Heavy plume overhead — the one to
                          rank on: across 1,013 EPA monitors it tracks the worst-day PM2.5
                          (98th percentile − mean) at rank r 0.27 (West 0.47, East 0.35);
                          any-plume days don't (0.01; East 0.06) — thin, high haze from
                          farm burning paints the Gulf and Southeast (Houston 196 days)
    each the population-weighted mean of the blocks' values, the worst block, coverage and
    each county's worst area. Averaged over **2015–2024**: fire years swing far more than
    PM2.5 does (thick days, Bakersfield: 1 in 2019, 66 in 2020, 2 in 2022; Ann Arbor 70 in
    2023, 4–15 most years), so a 3-year mean ranks whichever region burned lately — 2022–24
    gave Kern 2 a year and Washtenaw 37. Ten years cost ~5 minutes (3,653 files).

SOURCE (decided 2026-10-13, decision 6)
    NOAA's Hazard Mapping System (HMS) smoke polygons, public domain: analysts outline smoke
    on GOES imagery each day and grade it Light / Medium / Heavy. One shapefile a day:
        https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/Shapefile/
            YYYY/MM/hms_smokeYYYYMMDD.zip   (~30 KB; Alaska and Hawaii covered — the Maui
                                             plume is in 2023-08-09's file)

WHAT IT IS NOT
    A plume is smoke somewhere in the column above, not at the ground — never a
    concentration (the smoke people breathe is already inside PM2.5). A day without a
    plume can also be a cloudy day the analysts couldn't see through. Shown as "days with
    smoke overhead", kept apart from PM2.5 so nothing double counts.

METHOD
    Each day's plumes are rasterized onto a CELL-degree grid (a cell is in a plume when its
    centre is); a block takes its cell's count (rule 1: the cell containing the point, no
    interpolation). 0.05° (~5 km) is finer than the analysts' outlines, so the grid adds no
    false precision and loses none (rule 7). A day whose file doesn't exist is a day not
    analyzed; counts are scaled to 365 days by the days that were (`analyzed`), never
    treating a missing day as clear.
"""

from __future__ import annotations

import io
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import numpy as np
import pandas as pd
import requests

from .. import config
from ..util import get_logger, http_get
from .blocks import BY_POSTAL, STATES, state_blocks
from .exposure import exposure
from .grid import Grid

log = get_logger("pollution.smoke")

URL = "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/Shapefile/{d:%Y}/{d:%m}/hms_smoke{d:%Y%m%d}.zip"
YEARS = tuple(range(2015, 2025))
CELL = 0.05
# Grid edges: Hawaii to northern Alaska, the Aleutians to Maine.
SOUTH, NORTH, WEST, EAST = 17.0, 72.0, -180.0, -60.0
# Density grades; older files coded them as µg/m³ class midpoints (5 / 16 / 27).
LEVEL = {"Light": 1, "Medium": 2, "Heavy": 3, "5": 1, "16": 2, "27": 3, "5.0": 1, "16.0": 2, "27.0": 3}


def shape() -> tuple[int, int]:
    return round((NORTH - SOUTH) / CELL), round((EAST - WEST) / CELL)


def day_plumes(day: date) -> tuple[np.ndarray, np.ndarray] | None:
    """(polygons, levels 1–3) drawn that day; None when no analysis exists for it."""
    import pyogrio.raw
    import shapely

    try:
        body = http_get(URL.format(d=day), binary=True, cache_hint=f"hms_smoke_{day:%Y%m%d}")
    except requests.HTTPError:
        return None
    assert isinstance(body, bytes)
    meta, _, geom, fields = pyogrio.raw.read(io.BytesIO(body))
    density = fields[list(meta["fields"]).index("Density")]
    g = shapely.make_valid(shapely.from_wkb(geom, on_invalid="fix"))
    unknown = {str(v) for v in density} - set(LEVEL) - {k.lower() for k in LEVEL} - {k.upper() for k in LEVEL}
    if unknown:
        raise ValueError(f"HMS {day}: unknown smoke density {sorted(unknown)} — a light/thick split would be a guess")
    levels = np.array([LEVEL[str(v).strip().title()] for v in density], dtype=np.uint8)
    return g, levels


def rasterize(polygons: np.ndarray, levels: np.ndarray) -> np.ndarray:
    """The densest plume over each cell's centre (0 = none)."""
    import shapely

    n_lat, n_lon = shape()
    out = np.zeros((n_lat, n_lon), dtype=np.uint8)
    for poly, level in zip(polygons, levels):
        if poly is None or poly.is_empty:
            continue
        minx, miny, maxx, maxy = poly.bounds
        r0, r1 = max(int(np.floor((miny - SOUTH) / CELL)), 0), min(int(np.ceil((maxy - SOUTH) / CELL)), n_lat)
        c0, c1 = max(int(np.floor((minx - WEST) / CELL)), 0), min(int(np.ceil((maxx - WEST) / CELL)), n_lon)
        if r0 >= r1 or c0 >= c1:
            continue
        ys = SOUTH + (np.arange(r0, r1) + 0.5) * CELL
        xs = WEST + (np.arange(c0, c1) + 0.5) * CELL
        xx, yy = np.meshgrid(xs, ys)
        inside = shapely.contains_xy(poly, xx, yy)
        block = out[r0:r1, c0:c1]
        np.maximum(block, np.where(inside, level, 0).astype(np.uint8), out=block)
    return out


def count(plumes: list[tuple[np.ndarray, np.ndarray] | None]) -> tuple[Grid, Grid, int]:
    """Days a year with any / a Medium-or-Heavy plume, from one entry per calendar day
    (None = not analyzed): counts over the analyzed days, scaled to 365."""
    any_days = np.zeros(shape(), dtype=np.uint16)
    thick_days = np.zeros(shape(), dtype=np.uint16)
    analyzed = 0
    for p in plumes:
        if p is None:
            continue
        analyzed += 1
        level = rasterize(*p)
        any_days += level >= 1
        thick_days += level >= 2
    if not analyzed:
        raise ValueError("HMS: no analyzed days")
    per_year = 365.0 / analyzed
    grids = [Grid((d * per_year).astype(np.float32), SOUTH + CELL / 2, WEST + CELL / 2, CELL, CELL,
                  units="days/year", source="NOAA HMS smoke") for d in (any_days, thick_days)]
    return grids[0], grids[1], analyzed


def surfaces(years: tuple[int, ...] = YEARS) -> tuple[Grid, Grid, int]:
    """(days a year with any plume, with a Medium/Heavy plume, days analyzed) over `years`."""
    days = [date(years[0], 1, 1) + timedelta(k) for k in range((date(years[-1], 12, 31) - date(years[0], 1, 1)).days + 1)]
    with ThreadPoolExecutor(8) as pool:
        plumes = list(pool.map(day_plumes, days))
    any_g, thick_g, analyzed = count(plumes)
    log.info("HMS %d–%d: %d days analyzed, %d missing", years[0], years[-1], analyzed, len(days) - analyzed)
    return any_g, thick_g, analyzed


def compute(states: list[str], grids: tuple[Grid, Grid] | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(tracts, counties) with both smoke measures, from the same blocks."""
    any_g, thick_g = grids or surfaces()[:2]
    blocks = pd.concat([state_blocks(s) for s in states], ignore_index=True)
    lat, lon = blocks["lat"].to_numpy(), blocks["lon"].to_numpy()
    t1, c1 = exposure(blocks, any_g.sample(lat, lon), "smoke_days", digits=1)
    t2, c2 = exposure(blocks, thick_g.sample(lat, lon), "smoke_days_thick", digits=1)
    return t1.merge(t2, on="tract"), c1.merge(c2, on="county")


def main() -> None:
    want = sys.argv[1:] or ["all"]
    states = list(STATES) if want == ["all"] else [BY_POSTAL.get(s.upper(), s) for s in want]
    tracts, counties = compute(states)
    tracts.to_csv(config.INTERIM_DIR / "smoke_tracts.csv", index=False)
    counties.to_csv(config.INTERIM_DIR / "smoke_counties.csv", index=False)
    print(counties.describe().round(1).to_string())


if __name__ == "__main__":
    main()
