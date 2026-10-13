"""
EPA's PM2.5 monitors: what was measured, for checking the surface and for showing beside it.

    python -m etl.pollution.monitors          # 2022–2024 -> data/interim/pm25_monitors.csv

WHAT THIS PRODUCES
    site (SS-CCC-NNNN), name, county (5-digit FIPS), lat, lon, pm25 (µg/m³, the mean of
    the site's complete annual means), years (how many complete years went in)

USES (plan §9 Phase 11)
    - The acceptance gate (11c): the surface against what monitors measured.
    - Decision 2(c): an area's page shows the nearest monitor's reading and how far away
      it is — as information beside the area's value, never as the area's value (rule 5).

METHOD
    EPA AirData `annual_conc_by_monitor_YYYY.zip`, parameter 88101 (FRM/FEM PM2.5), the
    "PM25 Annual 2024" standard rows, complete years only. A monitor-year can appear with
    exceptional events excluded and included; wildfire smoke is real exposure, so the
    figure with events included is kept ("No Events" where nothing was flagged). Several
    instruments (POCs) at one site are averaged; a site needs at least MIN_YEARS complete
    years.
"""

from __future__ import annotations

import io
import sys
import zipfile

import pandas as pd

from .. import config
from ..util import get_logger, http_get

log = get_logger("pollution.monitors")

URL = "https://aqs.epa.gov/aqsweb/airdata/annual_conc_by_monitor_{year}.zip"
YEARS = (2022, 2023, 2024)
MIN_YEARS = 2
OUT = config.INTERIM_DIR / "pm25_monitors.csv"


def annual(year: int) -> pd.DataFrame:
    body = http_get(URL.format(year=year), binary=True, cache_hint=f"aqs_annual_by_monitor_{year}")
    assert isinstance(body, bytes)
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv"))
        a = pd.read_csv(z.open(name), low_memory=False,
                        dtype={"State Code": str, "County Code": str, "Site Num": str})
    return a


def site_means(frames: list[pd.DataFrame]) -> pd.DataFrame:
    """One row per site: the mean of its complete annual PM2.5 means (events included)."""
    a = pd.concat(frames, ignore_index=True)
    a = a[(a["Parameter Code"] == 88101) & (a["Pollutant Standard"] == "PM25 Annual 2024")
          & (a["Completeness Indicator"] == "Y") & a["Event Type"].isin(["No Events", "Events Included"])]
    a = a.assign(site=a["State Code"].str.zfill(2) + "-" + a["County Code"].str.zfill(3) + "-" + a["Site Num"].str.zfill(4),
                 county=a["State Code"].str.zfill(2) + a["County Code"].str.zfill(3))
    yearly = a.groupby(["site", "Year"]).agg(pm25=("Arithmetic Mean", "mean"), lat=("Latitude", "first"),
                                             lon=("Longitude", "first"), name=("Local Site Name", "first"),
                                             county=("county", "first")).reset_index()
    out = yearly.groupby("site").agg(pm25=("pm25", "mean"), years=("Year", "nunique"), lat=("lat", "first"),
                                     lon=("lon", "first"), name=("name", "first"), county=("county", "first"))
    out = out[out["years"] >= MIN_YEARS].reset_index()
    out["pm25"] = out["pm25"].round(2)
    return out[["site", "name", "county", "lat", "lon", "pm25", "years"]]


def fetch(years: tuple[int, ...] = YEARS) -> pd.DataFrame:
    out = site_means([annual(y) for y in years])
    log.info("PM2.5 monitors %s: %d sites with %d+ complete years", "–".join(map(str, (years[0], years[-1]))),
             len(out), MIN_YEARS)
    return out


def main() -> None:
    df = fetch()
    df.to_csv(OUT, index=False)
    print(f"{len(df):,} sites -> {OUT}")
    if len(sys.argv) > 1:
        print(df[df["county"].isin(sys.argv[1:])].to_string(index=False))


if __name__ == "__main__":
    main()
