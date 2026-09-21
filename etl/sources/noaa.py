"""
SOURCE: NOAA NCEI 1991-2020 U.S. Climate Normals — climate.

WHAT THIS PRODUCES
    fips, summer_high_f, winter_low_f, spring_mean_f, fall_mean_f,
    annual_precip_in, annual_snow_in, climate_station_id,
    climate_station_dist_mi, climate_station_count

    Plus a SEPARATE wide file, data/interim/noaa_monthly.csv, holding all 12
    monthly values per county. Phase 1 does not use it; the Phase 7 climate
    tab does. It costs nothing to keep since we already fetched it.

WHY THIS SOURCE IS IN PHASE 1 AT ALL
    Every other source joins on a county FIPS code — a dictionary lookup.
    NOAA is weather stations with latitude and longitude, so it needs a real
    SPATIAL join: find stations near each county's internal point, average
    them, and handle counties with no nearby station.

    That is a different class of problem from the others, and it is the one
    most likely to break. Better to find out in Phase 1 than in Phase 5 after
    the whole app is built on the assumption that joins are easy.

HOW THE SPATIAL JOIN WORKS
    1. Download NOAA's station inventory (station id, lat, lon).
    2. For each county internal point, find the K_CANDIDATES nearest stations
       within MAX_STATION_DISTANCE_MI and fetch their normals.
    3. Keep the nearest STATIONS_PER_COUNTY stations that actually have
       TEMPERATURE normals. (First-run finding, 2026-09-20: ~42% of NOAA
       stations are precipitation-only. Picking the 3 nearest BEFORE knowing
       that left Maricopa, Madison AL and Pulaski AR with no climate at all
       while a full airport station sat a few miles further out.)
    4. Average their normals, weighting by inverse distance.

    Averaging several nearby stations rather than taking the single closest
    smooths out station-specific quirks — an airport station on a runway apron
    reads differently from one in a park two miles away. Inverse-distance
    weighting keeps the nearest station dominant without letting it be the
    only voice.

    Counties with no station within the radius get NaN and are counted in the
    log. In a mountainous county the nearest station may be at a very
    different elevation, so `climate_station_dist_mi` is stored per county to
    let the UI flag low-confidence values later.

    WHAT THIS DOES NOT DO: elevation adjustment, or interpolation that
    respects terrain. A proper job would use PRISM gridded data rather than
    point stations. That is a deliberate Phase 1 simplification — note it in
    the UI before anyone makes a decision on a mountain county's numbers.

THE BULK-VS-PER-STATION TRADEOFF
    NOAA publishes one CSV per station, ~15,600 of them. With K_CANDIDATES=10
    the full run touches ~13,000 of them, so this is effectively a one-time
    download of the catalog: ~15 minutes with NOAA_WORKERS threads, cached
    on disk afterwards. Re-runs and re-joins are seconds.

RUN STANDALONE
    python -m etl.sources.noaa
    python -m etl.sources.noaa --limit 200     # quick smoke test
"""

from __future__ import annotations

import argparse
import io
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd
import requests

from .. import config
from ..util import (
    BadResponse,
    describe_frame,
    get_logger,
    haversine_miles,
    http_get,
    nearest_points,
    read_interim,
    write_interim,
)

log = get_logger("source.noaa")


STATIONS_PER_COUNTY = 3
MAX_STATION_DISTANCE_MI = 60.0

# How many nearest stations to consider (and fetch) per county before we know
# which of them carry temperature normals. Measured 2026-09-20: K=3 -> 7,759
# distinct stations, K=10 -> 13,268 of 15,615. Since most of the catalog gets
# fetched either way, 10 buys robustness for little extra.
K_CANDIDATES = 10

# Parallel station fetches. NCEI is a public file server; 6 workers with the
# per-request delay works out to roughly 15-20 requests/second.
NOAA_WORKERS = 6

# Station-ID prefixes to drop from the inventory BEFORE the spatial search.
# "US1" is the CoCoRaHS network: volunteer backyard rain gauges, precipitation
# only by definition, and densest exactly where people live. First run
# (2026-09-20): all 10 nearest stations to Madison County AL (Huntsville) were
# US1 gauges, so a 400k-person county got no temperature while the airport
# station sat just outside the candidate list. 5,440 of 15,615 inventory
# entries are US1. They can never contribute, so they never compete.
EXCLUDED_NETWORK_PREFIXES = ("US1",)

# A station that 404s is a normal, expected outcome (the inventory lists
# stations with no monthly file). Anything ELSE — timeouts, 5xx, DNS — is a
# transport problem. A handful can be tolerated; more than this many means
# the network is down mid-run, and continuing would quietly produce a
# mostly-null climate table. Stop instead.
MAX_TRANSPORT_FAILURES = 25

# Interim file name used when --limit is active. Deliberately NOT "noaa", so
# a 200-row smoke test can never be picked up by `build --skip-fetch` as if
# it were the real thing.
SMOKE_TEST_INTERIM_NAME = "noaa_smoke"

# Northern-hemisphere meteorological seasons.
SEASON_MONTHS = {
    "winter": [12, 1, 2],
    "spring": [3, 4, 5],
    "summer": [6, 7, 8],
    "fall":   [9, 10, 11],
}

# NOAA monthly normals column names. The monthly files use MLY-prefixed
# variables. We look for these, case-insensitively, and tolerate absence.
#   MLY-TMAX-NORMAL   monthly normal daily maximum temperature (F)
#   MLY-TMIN-NORMAL   monthly normal daily minimum temperature (F)
#   MLY-TAVG-NORMAL   monthly normal daily average temperature (F)
#   MLY-PRCP-NORMAL   monthly normal precipitation (inches)
#   MLY-SNOW-NORMAL   monthly normal snowfall (inches)
VAR_TMAX = "MLY-TMAX-NORMAL"
VAR_TMIN = "MLY-TMIN-NORMAL"
VAR_TAVG = "MLY-TAVG-NORMAL"
VAR_PRCP = "MLY-PRCP-NORMAL"
VAR_SNOW = "MLY-SNOW-NORMAL"

# NOAA uses -9999 and similar for missing values.
NOAA_MISSING = {-9999, -8888, -7777, -6666, -5555}


def fetch_station_inventory() -> pd.DataFrame:
    """
    Download the station inventory: station id, lat, lon, name.

    If the inventory URL has moved, this raises with the URL so you can find
    the current one at
    https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals
    """
    log.info("fetching NOAA station inventory")
    try:
        body = http_get(config.NOAA_STATION_INVENTORY)
    except Exception as exc:
        raise RuntimeError(
            f"Could not fetch the NOAA station inventory from "
            f"{config.NOAA_STATION_INVENTORY}. The path changes between "
            f"product versions; check "
            f"https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals"
        ) from exc

    assert isinstance(body, str)
    out = parse_station_inventory(body)
    log.info("station inventory: %d stations with coordinates", len(out))

    excluded = out["station"].str.startswith(EXCLUDED_NETWORK_PREFIXES)
    if excluded.any():
        log.info("dropping %d precipitation-only network stations (prefixes %s); %d remain",
                 int(excluded.sum()), EXCLUDED_NETWORK_PREFIXES, int((~excluded).sum()))
        out = out[~excluded].reset_index(drop=True)
    return out


def parse_station_inventory(body: str) -> pd.DataFrame:
    """
    Parse the inventory into (station, lat, lon). Handles both layouts NOAA
    has used:

      - the current one (2026-09): headerless fixed-width GHCN station list,
            USW00013904  30.1831  -97.6800  146.3 TX AUSTIN BERGSTROM AP   74745
        The first four whitespace-separated tokens are id, lat, lon, elev;
        the name after them may contain spaces, so only those four are used.
      - the earlier CSV with a header row (STATION, LATITUDE, LONGITUDE, ...).

    Raises if neither yields coordinates, so a format change is loud.
    """
    first = body.lstrip().splitlines()[0] if body.strip() else ""
    looks_like_csv = "," in first and any(
        h in first.upper() for h in ("STATION", "LATITUDE", "LAT")
    )

    if looks_like_csv:
        df = pd.read_csv(io.StringIO(body), dtype=str)
        df.columns = [c.strip().upper() for c in df.columns]

        def _col(*names: str) -> str:
            for n in names:
                if n in df.columns:
                    return n
            raise KeyError(f"None of {names} in inventory columns {list(df.columns)}")

        ids = df[_col("STATION", "STATION_ID", "GHCN_ID", "ID")]
        lats = df[_col("LATITUDE", "LAT")]
        lons = df[_col("LONGITUDE", "LON", "LONG")]
    else:
        rows = []
        for line in body.splitlines():
            parts = line.split(None, 4)
            if len(parts) < 3:
                continue
            rows.append(parts[:3])
        if not rows:
            raise ValueError("Station inventory is neither CSV nor fixed-width; first line: "
                             f"{first[:120]!r}")
        df = pd.DataFrame(rows, columns=["id", "lat", "lon"])
        ids, lats, lons = df["id"], df["lat"], df["lon"]

    out = pd.DataFrame({
        "station": ids.astype(str).str.strip(),
        "lat": pd.to_numeric(lats, errors="coerce"),
        "lon": pd.to_numeric(lons, errors="coerce"),
    }).dropna(subset=["lat", "lon"]).drop_duplicates(subset=["station"])

    if out.empty:
        raise ValueError("Station inventory parsed to zero stations with coordinates; "
                         f"first line: {first[:120]!r}")
    return out.reset_index(drop=True)


def _parse_station_csv(text: str, station: str) -> pd.DataFrame | None:
    """
    Parse one station's monthly normals into a tidy 12-row frame.

    Returns None if the file has no usable temperature data, which happens for
    precipitation-only stations.
    """
    try:
        df = pd.read_csv(io.StringIO(text), dtype=str)
    except Exception:
        return None

    df.columns = [c.strip().upper() for c in df.columns]

    if "DATE" not in df.columns:
        return None

    # DATE is "01".."12" for monthly normals.
    month = pd.to_numeric(df["DATE"].astype(str).str.extract(r"(\d{1,2})$")[0],
                          errors="coerce")

    def _num(varname: str) -> pd.Series:
        if varname not in df.columns:
            return pd.Series([np.nan] * len(df))
        s = pd.to_numeric(df[varname], errors="coerce")
        return s.mask(s.isin(NOAA_MISSING))

    out = pd.DataFrame({
        "station": station,
        "month": month,
        "tmax": _num(VAR_TMAX),
        "tmin": _num(VAR_TMIN),
        "tavg": _num(VAR_TAVG),
        "prcp": _num(VAR_PRCP),
        "snow": _num(VAR_SNOW),
    }).dropna(subset=["month"])

    if out[["tmax", "tmin", "tavg"]].notna().sum().sum() == 0:
        return None

    out["month"] = out["month"].astype(int)
    return out


def fetch_station_normals(stations: list[str]) -> pd.DataFrame:
    """
    Fetch monthly normals for the given stations, skipping ones that 404.

    Cached per station by util.http_get, so a re-run is fast and an
    interrupted run resumes.
    """
    frames: list[pd.DataFrame] = []
    n_404 = 0        # station has no monthly file — expected, harmless
    n_unusable = 0   # file exists but has no temperature data (precip-only)
    n_transport = 0  # timeouts, 5xx, connection errors — NOT harmless
    transport_examples: list[str] = []
    lock = threading.Lock()
    abort = threading.Event()

    def _one(station: str) -> tuple[str, str, object]:
        """Fetch + parse one station in a worker. Returns (station, outcome, payload)."""
        if abort.is_set():
            return station, "skipped", None
        url = f"{config.NOAA_NORMALS_BASE}/{station}.csv"
        try:
            body = http_get(url, cache_hint=f"noaa_{station}")
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 404:
                return station, "404", None
            return station, "transport", str(exc)
        except BadResponse:
            # Empty file. Treat like a precip-only station: no data, not an outage.
            return station, "unusable", None
        except Exception as exc:  # noqa: BLE001 - classified and counted below
            return station, "transport", str(exc)
        finally:
            time.sleep(config.NOAA_REQUEST_DELAY)
        assert isinstance(body, str)
        parsed = _parse_station_csv(body, station)
        return (station, "ok", parsed) if parsed is not None else (station, "unusable", None)

    with ThreadPoolExecutor(max_workers=NOAA_WORKERS) as pool:
        futures = [pool.submit(_one, st) for st in stations]
        for i, fut in enumerate(as_completed(futures), start=1):
            station, outcome, payload = fut.result()
            with lock:
                if outcome == "ok":
                    frames.append(payload)
                elif outcome == "404":
                    n_404 += 1
                elif outcome == "unusable":
                    n_unusable += 1
                elif outcome == "transport":
                    n_transport += 1
                    transport_examples.append(f"{station}: {payload}")

                if n_transport > MAX_TRANSPORT_FAILURES and not abort.is_set():
                    abort.set()
                    for f in futures:
                        f.cancel()
                    raise RuntimeError(
                        f"{n_transport} non-404 fetch failures (limit {MAX_TRANSPORT_FAILURES}) "
                        f"after {i}/{len(stations)} stations — the network is probably down. "
                        f"Stopping rather than producing a mostly-null climate table. "
                        f"Re-run to resume from cache. Examples:\n  "
                        + "\n  ".join(transport_examples[:5])
                    )

            if i % 500 == 0:
                log.info("  fetched %d/%d stations (%d no file, %d unusable, %d transport errors)",
                         i, len(stations), n_404, n_unusable, n_transport)

    if not frames:
        raise RuntimeError(
            "No usable station normals were fetched. Check that "
            f"{config.NOAA_NORMALS_BASE}/<STATION>.csv is still the correct "
            "access pattern."
        )

    log.info("parsed normals for %d stations (%d no file, %d unusable, %d transport errors)",
             len(frames), n_404, n_unusable, n_transport)
    if n_transport:
        log.warning("%d stations failed on transport errors and are absent: %s",
                    n_transport, transport_examples[:5])
    return pd.concat(frames, ignore_index=True)


def fetch(limit: int | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Build per-county climate normals.

    Returns (seasonal_summary, monthly_wide).
    `limit` caps the number of counties processed, for smoke tests.
    """
    spine = read_interim("spine").dropna(subset=["lat", "lon"])
    if limit:
        spine = spine.head(limit)
        log.warning("LIMIT active: only %d counties", len(spine))

    inventory = fetch_station_inventory()

    # --- candidate stations per county -------------------------------------
    log.info("computing nearest %d candidate stations for %d counties",
             K_CANDIDATES, len(spine))
    idx, dist = nearest_points(
        spine["lat"].to_numpy(dtype=float),
        spine["lon"].to_numpy(dtype=float),
        inventory["lat"].to_numpy(dtype=float),
        inventory["lon"].to_numpy(dtype=float),
        k=K_CANDIDATES,
    )

    # Long county-station-distance table of candidates, filtered by radius.
    pairs = []
    station_ids = inventory["station"].to_numpy()
    for row, fips in enumerate(spine["fips"].tolist()):
        for slot in range(idx.shape[1]):
            d = float(dist[row, slot])
            if d <= MAX_STATION_DISTANCE_MI:
                pairs.append((fips, station_ids[idx[row, slot]], d))

    candidates = pd.DataFrame(pairs, columns=["fips", "station", "dist_mi"])
    needed = sorted(candidates["station"].unique())
    log.info("%d counties have candidates; %d distinct stations to fetch (within %.0f mi)",
             candidates["fips"].nunique(), len(needed), MAX_STATION_DISTANCE_MI)

    orphans = set(spine["fips"]) - set(candidates["fips"])
    if orphans:
        log.warning("%d counties have no station within %.0f mi and will be null",
                    len(orphans), MAX_STATION_DISTANCE_MI)

    # --- fetch, then keep the nearest USABLE stations -----------------------
    normals = fetch_station_normals(needed)
    usable = set(normals["station"].unique())

    links = (
        candidates[candidates["station"].isin(usable)]
        .sort_values(["fips", "dist_mi"])
        .groupby("fips", as_index=False)
        .head(STATIONS_PER_COUNTY)
        .reset_index(drop=True)
    )
    per_county = links.groupby("fips").size()
    n_zero = int((~spine["fips"].isin(per_county.index)).sum())
    n_short = int((per_county < STATIONS_PER_COUNTY).sum())
    log.info("usable stations per county: %d counties with %d, %d with fewer, %d with none "
             "(of %d)", int((per_county == STATIONS_PER_COUNTY).sum()), STATIONS_PER_COUNTY,
             n_short, n_zero, len(spine))
    if n_zero:
        log.warning("%d counties have candidates within %.0f mi but none with temperature "
                    "normals; they will be null", n_zero - len(orphans), MAX_STATION_DISTANCE_MI)

    merged = links.merge(normals, on="station", how="inner")
    if merged.empty:
        raise RuntimeError("No county-station matches survived the normals join")

    # Inverse-distance weight. +1 mile guards against divide-by-zero for a
    # station sitting exactly on the internal point.
    merged["w"] = 1.0 / (merged["dist_mi"] + 1.0)

    def _wmean(group: pd.DataFrame, col: str) -> float:
        valid = group[group[col].notna()]
        if valid.empty:
            return float("nan")
        return float(np.average(valid[col], weights=valid["w"]))

    monthly_rows = []
    for (fips, month), group in merged.groupby(["fips", "month"]):
        monthly_rows.append({
            "fips": fips,
            "month": int(month),
            "tmax_f": _wmean(group, "tmax"),
            "tmin_f": _wmean(group, "tmin"),
            "tavg_f": _wmean(group, "tavg"),
            "precip_in": _wmean(group, "prcp"),
            "snow_in": _wmean(group, "snow"),
        })

    monthly = pd.DataFrame(monthly_rows).sort_values(["fips", "month"])

    # Fill tavg where absent but tmax/tmin present.
    missing_avg = monthly["tavg_f"].isna() & monthly["tmax_f"].notna() & monthly["tmin_f"].notna()
    monthly.loc[missing_avg, "tavg_f"] = (
        monthly.loc[missing_avg, "tmax_f"] + monthly.loc[missing_avg, "tmin_f"]
    ) / 2.0

    # --- seasonal aggregation ----------------------------------------------
    def _season(fips_group: pd.DataFrame, months: list[int], col: str, how: str) -> float:
        sub = fips_group[fips_group["month"].isin(months)][col].dropna()
        if sub.empty:
            return float("nan")
        return float(sub.mean() if how == "mean" else sub.sum())

    summary_rows = []
    for fips, group in monthly.groupby("fips"):
        summary_rows.append({
            "fips": fips,
            # Summer high: average of Jun/Jul/Aug daily-max normals.
            "summer_high_f": _season(group, SEASON_MONTHS["summer"], "tmax_f", "mean"),
            # Winter low: average of Dec/Jan/Feb daily-min normals.
            "winter_low_f": _season(group, SEASON_MONTHS["winter"], "tmin_f", "mean"),
            "spring_mean_f": _season(group, SEASON_MONTHS["spring"], "tavg_f", "mean"),
            "fall_mean_f": _season(group, SEASON_MONTHS["fall"], "tavg_f", "mean"),
            # Annual totals are sums across the 12 monthly normals.
            "annual_precip_in": _season(group, list(range(1, 13)), "precip_in", "sum"),
            "annual_snow_in": _season(group, list(range(1, 13)), "snow_in", "sum"),
        })

    summary = pd.DataFrame(summary_rows)

    # Attach provenance: which station, how far, how many contributed.
    # `links` already holds only usable stations, so these are exact.
    prov = (
        links.sort_values("dist_mi")
        .groupby("fips")
        .agg(climate_station_id=("station", "first"),
             climate_station_dist_mi=("dist_mi", "first"),
             climate_station_count=("station", "size"))
        .reset_index()
    )
    summary = summary.merge(prov, on="fips", how="left")

    # Re-attach counties that got nothing, so the frame stays one-row-per-county.
    summary = (
        spine[["fips"]]
        .merge(summary, on="fips", how="left")
        .sort_values("fips")
        .reset_index(drop=True)
    )

    n_null = int(summary["summer_high_f"].isna().sum())
    log.info("NOAA: %d counties, %d with no climate data (%.1f%%)",
             len(summary), n_null, 100.0 * n_null / max(len(summary), 1))
    if summary["climate_station_dist_mi"].notna().any():
        log.info("station distance: median %.1f mi, max %.1f mi",
                 summary["climate_station_dist_mi"].median(),
                 summary["climate_station_dist_mi"].max())

    return summary, monthly


def main() -> None:
    parser = argparse.ArgumentParser(description="NOAA climate normals by county")
    parser.add_argument("--limit", type=int, default=None,
                        help="Only process the first N counties (smoke test)")
    args = parser.parse_args()

    summary, monthly = fetch(limit=args.limit)
    if args.limit:
        name = SMOKE_TEST_INTERIM_NAME
        log.warning("--limit active: writing %s.csv, NOT noaa.csv. "
                    "The join will not see this file.", name)
    else:
        name = "noaa"
    write_interim(summary, name)
    write_interim(monthly, f"{name}_monthly")

    print(describe_frame(summary, "noaa"))
    print("\nSpot checks:")
    for fips, label in config.SPOT_CHECK_FIPS.items():
        row = summary[summary["fips"] == fips]
        if row.empty:
            print(f"  {fips}  MISSING  — {label}")
        else:
            r = row.iloc[0]
            print(f"  {fips}  summer_high={r['summer_high_f']!s:>6}  "
                  f"winter_low={r['winter_low_f']!s:>6}  "
                  f"station={r['climate_station_id']} "
                  f"@{r['climate_station_dist_mi']!s:>5} mi  — {label}")


if __name__ == "__main__":
    sys.exit(main())
