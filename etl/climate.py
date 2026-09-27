"""
Monthly climate for the app's Climate tab (Working Master Plan, Phase 6).

    public/data/climate.json  —  every county's 12 monthly NOAA 1991–2020 normals

The NOAA step already writes one row per county per month to
data/interim/noaa_monthly.csv (the same stations and averaging as the
county columns). This module reshapes it for the browser, and validates it
against the county table: the monthly file and the annual columns come from
the same stations, so they must agree — the hottest month's high is the max
of the monthly highs, days above 90°F is the sum of the monthly counts.

Payload:
    {"format": "climate-monthly-v1",
     "source": {...}, "measures": [{"key", "label", "unit"}, ...],
     "counties": {"48453": [[12 tmax], [12 tmin], [12 precip], ...], ...}}

Measures are in `MEASURES` order; each is 12 values, January first, rounded
to one decimal; null where a station doesn't report it. Counties with no
climate data at all (4 remote Alaska areas) are absent.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path

import pandas as pd

from . import config

log = logging.getLogger(__name__)

FORMAT = "climate-monthly-v1"
PUBLISH_PATH = config.PUBLISH_PATH.parent / "climate.json"


def monthly_path() -> Path:
    """Where the NOAA step writes the monthly table (read at call time, so tests can redirect it)."""
    return config.INTERIM_DIR / "noaa_monthly.csv"

# (column in noaa_monthly.csv, label, unit, plausible monthly range)
MEASURES = [
    ("tmax_f", "Average high", "°F", (-30, 125)),
    ("tmin_f", "Average low", "°F", (-60, 95)),
    ("precip_in", "Precipitation", "in", (0, 40)),
    ("snow_in", "Snowfall", "in", (0, 250)),
    ("days_above_90f", "Days above 90°F", "days", (0, 31)),
    ("nights_below_32f", "Nights below freezing", "nights", (0, 31)),
    ("rainy_days", "Rainy days (≥ 0.01 in)", "days", (0, 31)),
    ("snow_days", "Snowy days (≥ 1 in)", "days", (0, 31)),
]

# Monthly sums/extremes that must reproduce the annual county columns.
ANNUAL_CHECKS = [
    ("hottest_month_high_f", "tmax_f", "max"),
    ("coldest_month_low_f", "tmin_f", "min"),
    ("annual_precip_in", "precip_in", "sum"),
    ("annual_snow_in", "snow_in", "sum"),
    ("days_above_90f", "days_above_90f", "sum"),
    ("nights_below_32f", "nights_below_32f", "sum"),
    ("rainy_days", "rainy_days", "sum"),
    ("snow_days", "snow_days", "sum"),
]


def load_monthly(path: Path | None = None) -> pd.DataFrame:
    return pd.read_csv(path or monthly_path(), dtype={"fips": str})


def _round(v: object) -> float | None:
    if v is None:
        return None
    f = float(v)
    return None if math.isnan(f) else round(f, 1)


def to_payload(monthly: pd.DataFrame, fips: list[str]) -> dict:
    """Payload for the counties in `fips` (the published county order) that have monthly data."""
    keep = set(fips)
    counties = {}
    for code, g in monthly[monthly["fips"].isin(keep)].groupby("fips", sort=False):
        g = g.sort_values("month")
        counties[code] = [[_round(v) for v in g[col]] for col, *_ in MEASURES]
    return {
        "format": FORMAT,
        "source": {
            "name": "NOAA NCEI U.S. Climate Normals, 1991–2020 (monthly)",
            "url": "https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals",
            "method": "Nearest reporting stations to each county's population center, "
                      "chosen per measure (see etl/sources/noaa.py).",
        },
        "measures": [{"key": col, "label": label, "unit": unit} for col, label, unit, _ in MEASURES],
        "counties": {code: counties[code] for code in fips if code in counties},
    }


def check(monthly: pd.DataFrame, df: pd.DataFrame) -> list[tuple[str, str]]:
    """(severity, message) findings; severity is FAIL, WARN or INFO."""
    out: list[tuple[str, str]] = []
    fips = set(df["fips"].astype(str))

    counts = monthly.groupby("fips")["month"].agg(lambda m: sorted(m.tolist()))
    bad_months = [f for f, m in counts.items() if m != list(range(1, 13))]
    if bad_months:
        out.append(("FAIL", f"{len(bad_months)} counties don't have exactly months 1–12 "
                            f"(e.g. {bad_months[:5]})"))

    unknown = sorted(set(counts.index) - fips)
    if unknown:
        out.append(("WARN", f"{len(unknown)} counties in the monthly file aren't in the county "
                            f"table and won't be published (e.g. {unknown[:5]})"))

    # Every county the app shows climate numbers for must have a chart too.
    has_climate = set(df.loc[df["hottest_month_high_f"].notna(), "fips"].astype(str))
    no_monthly = sorted(has_climate - set(counts.index))
    if no_monthly:
        out.append(("FAIL", f"{len(no_monthly)} counties have annual climate columns but no "
                            f"monthly rows (e.g. {no_monthly[:5]})"))

    for col, label, _, (lo, hi) in MEASURES:
        s = monthly[col]
        eps = 1e-6  # station averaging leaves 31.000000000000004-style float noise
        outside = monthly.loc[s.notna() & ((s < lo - eps) | (s > hi + eps)), ["fips", "month", col]]
        if len(outside):
            out.append(("FAIL", f"{label}: {len(outside)} monthly values outside {lo}–{hi} "
                                f"(e.g. {outside.head(3).to_dict('records')})"))
    inverted = monthly[monthly["tmin_f"] > monthly["tmax_f"]]
    if len(inverted):
        out.append(("FAIL", f"{len(inverted)} months where the average low is above the average "
                            f"high (e.g. {inverted[['fips', 'month']].head(3).to_dict('records')})"))

    # Same stations, same numbers: the monthly file must reproduce the annual columns.
    agg = monthly.groupby("fips").agg(**{
        f"{annual}": (col, how) for annual, col, how in ANNUAL_CHECKS
    })
    joined = df.set_index("fips")[[a for a, *_ in ANNUAL_CHECKS]].join(agg, rsuffix="_monthly", how="inner")
    for annual, _, how in ANNUAL_CHECKS:
        a, m = joined[annual], joined[f"{annual}_monthly"]
        both = a.notna() & m.notna()
        diff = (a[both] - m[both]).abs()
        tol = 0.05 if how in ("max", "min") else max(0.5, 0.01 * float(a[both].abs().median() or 0))
        off = diff[diff > tol]
        if len(off):
            out.append(("FAIL", f"{annual} disagrees with its monthly {how} in {len(off)} counties "
                                f"(worst {off.max():.2f}, e.g. {list(off.index[:3])})"))

    if not any(s == "FAIL" for s, _ in out):
        out.append(("INFO", f"Monthly climate: {len(set(counts.index) & fips)} counties × 12 months, "
                            f"consistent with the annual columns"))
    return out


def publish(df: pd.DataFrame, monthly: pd.DataFrame | None = None) -> Path:
    monthly = load_monthly() if monthly is None else monthly
    payload = to_payload(monthly, df["fips"].astype(str).tolist())
    PUBLISH_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PUBLISH_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    log.info("published %s (%d counties)", PUBLISH_PATH, len(payload["counties"]))
    return PUBLISH_PATH
