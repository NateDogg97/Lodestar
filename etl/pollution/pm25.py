"""
Fine particles (PM2.5): a typical year, where people live (plan §9 Phase 11, Tier 1).

    python -m etl.pollution.pm25 MI PA        # those states' blocks -> interim tables
    python -m etl.pollution.pm25 all

WHAT THIS PRODUCES
    data/interim/pm25_tracts.csv, pm25_counties.csv — `etl.pollution.exposure` columns for
    "pm25": population-weighted mean (µg/m³), % of residents above EPA's annual standard
    (9.0), the worst block, coverage, and each county's worst area.

SOURCE (decided 2026-10-13)
    WashU ACAG SatPM2.5 **V6.GL.03**, North America annual files, 0.01°, CC BY 4.0 —
    satellite AOD + GEOS-Chem, calibrated to ground monitors by a residual CNN. The mean of
    2022–2024, so no single smoke year decides. Public S3 bucket `satpmdata` (us-east-1),
    ~94 MB a year. Cite: Shen et al. (2024), ACS ES&T Air, doi:10.1021/acsestair.3c00054.

KNOWN LIMITS (11a)
    Out-of-sample error 1.7–2.3 µg/m³ (ACAG's spatial cross-validation); local hot spots —
    industrial valleys, wood-smoke mountain towns — read several µg/m³ low. Scoring uses
    coarse bands, and pages show the nearest EPA monitor beside the value (decision 2).
    Where a monitor measured well above the surface, `pm25_doubt` marks the residents
    within 5 miles of it (etl.pollution.doubt; the 11c gate's remedy).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .. import config
from ..util import get_logger, http_get
from .blocks import BY_POSTAL, STATES, state_blocks
from .doubt import disagreeing, nearest_monitor, within
from .exposure import exposure, share
from .grid import NO_DATA_BELOW, Grid

log = get_logger("pollution.pm25")

URL = "https://satpmdata.s3.us-east-1.amazonaws.com/V6GL03/CNNPM25/Annual/NA/V6GL03.CNNPM25.NA.{y}01-{y}12.nc"
YEARS = (2022, 2023, 2024)
VARIABLE = "PM25"
EPA_ANNUAL = 9.0  # µg/m³, current federal annual standard (under review; plan §9 Phase 11)
WHO_ANNUAL = 5.0  # µg/m³, WHO 2021 guideline


def year_file(year: int) -> Path:
    """The year's NetCDF, downloaded once into data/raw/."""
    path = config.RAW_DIR / f"V6GL03.CNNPM25.NA.{year}.nc"
    if not path.exists():
        body = http_get(URL.format(y=year), binary=True, use_cache=False)
        assert isinstance(body, bytes)
        if body[:4] != b"\x89HDF":
            raise ValueError(f"V6.GL.03 {year}: not a NetCDF-4 file (the bucket layout may have changed)")
        path.write_bytes(body)
        log.info("downloaded %s (%.0f MB)", path.name, len(body) / 1e6)
    return path


def surface(years: tuple[int, ...] = YEARS) -> Grid:
    """The cell-by-cell mean over `years`, read one year at a time; a cell unknown in any
    year is unknown."""
    total = missing = first = None
    for y in years:
        g = Grid.from_netcdf(year_file(y), VARIABLE)
        if first is None:
            first, total = g, np.zeros(g.values.shape, dtype=np.float64)
            missing = np.zeros(g.values.shape, dtype=bool)
        elif (g.values.shape, g.lat0, g.lon0) != (first.values.shape, first.lat0, first.lon0):
            raise ValueError(f"V6.GL.03 {y}: grid differs from {years[0]}'s")
        missing |= ~(g.values > NO_DATA_BELOW)
        total += np.where(missing, 0.0, g.values)
        del g
    mean = (total / len(years)).astype(np.float32)
    mean[missing] = NO_DATA_BELOW - 1
    return Grid(mean, first.lat0, first.lon0, first.dlat, first.dlon, units=first.units,
                source=f"ACAG V6.GL.03 {years[0]}–{years[-1]} mean")


def compute(states: list[str], grid: Grid | None = None,
            monitors: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """(blocks with their value, tracts, counties) for the given states, in one pass.
    With `monitors` (etl.pollution.monitors), also the doubt share and each area's nearest
    monitor."""
    grid = grid or surface()
    blocks = pd.concat([state_blocks(s) for s in states], ignore_index=True)
    values = grid.sample(blocks["lat"].to_numpy(), blocks["lon"].to_numpy())
    tracts, counties = exposure(blocks, values, "pm25", benchmark=EPA_ANNUAL)
    if monitors is not None:
        doubted = within(blocks["lat"].to_numpy(), blocks["lon"].to_numpy(), disagreeing(monitors, grid))
        tracts = tracts.merge(share(blocks, doubted, "tract", "pm25_doubt"), on="tract", how="left")
        counties = counties.merge(share(blocks, doubted, "county", "pm25_doubt"), on="county", how="left")
        tracts = tracts.merge(nearest_monitor(blocks, monitors, "pm25"), on="tract", how="left")
    log.info("PM2.5: %d blocks, %d tracts, %d counties; %.2f%% of residents with a value",
             len(blocks), len(tracts), len(counties),
             100 * blocks["pop"][~np.isnan(values)].sum() / blocks["pop"].sum())
    return blocks.assign(pm25=values), tracts, counties


def main() -> None:
    want = sys.argv[1:] or ["all"]
    states = list(STATES) if want == ["all"] else [BY_POSTAL.get(s.upper(), s) for s in want]
    from .monitors import OUT as MONITORS
    from .monitors import fetch as fetch_monitors

    monitors = pd.read_csv(MONITORS, dtype={"site": str, "county": str}) if MONITORS.exists() else fetch_monitors()
    _, tracts, counties = compute(states, monitors=monitors)
    tracts.to_csv(config.INTERIM_DIR / "pm25_tracts.csv", index=False)
    counties.to_csv(config.INTERIM_DIR / "pm25_counties.csv", index=False)
    print(counties.describe().round(2).to_string())


if __name__ == "__main__":
    main()
