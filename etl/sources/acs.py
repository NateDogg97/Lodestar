"""
SOURCE: Census American Community Survey (ACS) 5-year estimates.

WHAT THIS PRODUCES
    fips, population, median_home_value, median_household_income,
    median_gross_rent

WHY 5-YEAR
    The ACS 1-year release only publishes for geographies above 65,000
    population, which excludes roughly two-thirds of US counties. The 5-year
    release covers every county. For a tool whose whole job is comparing
    places, partial coverage is worse than slightly older data.

    The tradeoff: a 5-year estimate is an average over five years of sampling,
    so it lags and it smooths. For relative ranking across counties — which is
    all the scoring engine needs — this is fine.

VINTAGE DISCOVERY
    Census publishes a new 5-year release each December, and the exact
    availability date moves. Rather than hardcode a year that might 404, this
    module starts at config.ACS_YEAR and walks backwards until it finds a
    release that responds, then logs which one it used. The chosen vintage is
    recorded in the output so the app can display it.

THE SENTINEL TRAP
    The Census API does not return nulls. It returns jam values like
    -666666666 for "no data available". If you skip the cleaning step, a
    county with no median rent gets a rent of negative 666 million, which
    passes silently through percentile ranking and lands at an extreme of every
    derived metric. util.clean_census_nulls handles this. Do not remove it.

VARIABLE IDS
    Defined in config.ACS_VARIABLES so they are readable in one place.
    Verify any of them at:
    https://api.census.gov/data/{year}/acs/acs5/variables.html

RUN STANDALONE
    python -m etl.sources.acs
"""

from __future__ import annotations

import json

import pandas as pd
import requests

from .. import config
from ..util import (
    BadResponse,
    add_fips_column,
    clean_census_nulls,
    describe_frame,
    expect_json,
    get_logger,
    http_get,
    write_interim,
)

log = get_logger("source.acs")


# How many years to walk backwards before giving up on finding a live vintage.
MAX_VINTAGE_LOOKBACK = 4


def _try_vintage(year: int) -> pd.DataFrame | None:
    """
    Attempt one ACS vintage. Returns None on 404 (vintage not published).

    Any other failure propagates — a 500 or a timeout is a real problem, not
    a signal to try a different year.
    """
    url = f"{config.CENSUS_API_BASE}/{year}/acs/acs5"
    params = {
        "get": "NAME," + ",".join(config.ACS_VARIABLES.keys()),
        "for": "county:*",
        "in": "state:*",
    }
    if config.CENSUS_API_KEY:
        params["key"] = config.CENSUS_API_KEY
    else:
        log.warning(
            "No CENSUS_API_KEY set. The API may work unauthenticated at low "
            "volume but will rate-limit you. Get one at "
            "https://api.census.gov/data/key_signup.html"
        )

    # The Census API returns a JSON array-of-arrays with the header as row 0.
    # On error it sometimes returns HTML or a bare error string, and on "no
    # results" a 204. The check hook rejects all of those BEFORE they reach
    # the cache, so a bad answer is never replayed on the next run.
    def _check(payload: object) -> None:
        rows = expect_json(payload)
        if not isinstance(rows, list) or len(rows) < 2:
            raise BadResponse(f"Census API returned no data rows: {str(rows)[:200]}")
        if not isinstance(rows[0], list):
            raise BadResponse(f"Census API returned an unexpected shape: {str(rows)[:200]}")

    try:
        body = http_get(url, params=params, cache_hint=f"acs5_{year}_county", check=_check)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            log.info("ACS %s not available (404)", year)
            return None
        raise
    except BadResponse as exc:
        raise ValueError(f"Census API answered for {year} but the body is unusable: {exc}") from exc

    assert isinstance(body, str)
    rows = json.loads(body)
    header, *data = rows
    return pd.DataFrame(data, columns=header)


def fetch(year: int | None = None) -> pd.DataFrame:
    """Pull ACS county data, walking back through vintages until one responds."""
    start_year = year or config.ACS_YEAR

    raw: pd.DataFrame | None = None
    used_year: int | None = None

    for candidate in range(start_year, start_year - MAX_VINTAGE_LOOKBACK - 1, -1):
        log.info("trying ACS 5-year vintage %s", candidate)
        raw = _try_vintage(candidate)
        if raw is not None:
            used_year = candidate
            break

    if raw is None or used_year is None:
        raise RuntimeError(
            f"No ACS 5-year release responded between {start_year} and "
            f"{start_year - MAX_VINTAGE_LOOKBACK}. Check network access and "
            f"https://api.census.gov/data.html for what is published."
        )

    log.info("using ACS 5-year vintage %s (%d–%d)", used_year, used_year - 4, used_year)

    df = add_fips_column(raw, state_col="state", county_col="county")

    out = pd.DataFrame({"fips": df["fips"]})
    for var_id, friendly in config.ACS_VARIABLES.items():
        if var_id not in df.columns:
            raise ValueError(
                f"ACS response is missing variable {var_id} ({friendly}). "
                f"Columns returned: {list(df.columns)}. "
                f"Check the variable still exists in vintage {used_year}."
            )
        out[friendly] = clean_census_nulls(df[var_id])

    out = out.dropna(subset=["fips"]).sort_values("fips").reset_index(drop=True)
    # Who lives here: shares by race and Hispanic origin, the diversity index (2026-10-04).
    from ..demographics import RACE_VARIABLES, derive

    derived = derive(out)
    out = pd.concat([out.drop(columns=list(RACE_VARIABLES.values()) + ["gini_index"]), derived], axis=1)

    # Record the vintage alongside the data. The app should surface this —
    # "data as of" is the first thing anyone asks of a tool like this.
    out["acs_vintage"] = used_year

    if out["fips"].duplicated().any():
        raise ValueError("Duplicate FIPS in ACS output — the API returned unexpected rows")

    # Report how much got nulled, because a sudden jump means something broke.
    for friendly in [c for c in config.ACS_VARIABLES.values() if c in out] + ["diversity_index", "gini_index"]:
        n_null = int(out[friendly].isna().sum())
        if n_null:
            log.info("%s: %d counties with no value (%.1f%%)",
                     friendly, n_null, 100.0 * n_null / len(out))

    log.info("ACS: %d counties", len(out))
    return out


def main() -> None:
    df = fetch()
    write_interim(df, "acs")
    print(describe_frame(df, "acs"))
    print("\nSpot checks:")
    for fips, label in config.SPOT_CHECK_FIPS.items():
        row = df[df["fips"] == fips]
        if row.empty:
            print(f"  {fips}  MISSING  — {label}")
        else:
            r = row.iloc[0]
            print(f"  {fips}  pop={r['population']:>10,.0f}  "
                  f"home=${r['median_home_value']:>10,.0f}  "
                  f"inc=${r['median_household_income']:>9,.0f}  "
                  f"rent=${r['median_gross_rent']:>7,.0f}  — {label}")


if __name__ == "__main__":
    main()
