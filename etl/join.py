"""
Join every source onto the county spine and compute derived columns.

DESIGN RULE: LEFT JOIN, ALWAYS
    The spine (Census Gazetteer) decides which counties exist. Every source is
    LEFT joined onto it. A source that is missing a county leaves nulls; it
    never removes a row.

    This matters because an inner join would silently shrink the dataset to
    whatever the worst-covered source happens to have, and you would never
    notice. With left joins, missing data shows up as nulls that
    validate.py counts and reports.

DERIVED COLUMNS
    Computed here rather than in the app so the definitions live in one place
    and the app stays a pure consumer.

    home_value_to_income = median_home_value / median_household_income
        The classic affordability ratio. Around 3 is historically "normal";
        above 6 is severely unaffordable.

    rent_to_income = (median_gross_rent * 12) / median_household_income
        Annualized rent as a share of income. 0.30 is the conventional
        affordability threshold.

    price_to_rent = median_home_value / (median_gross_rent * 12)
        Valuation, not affordability: is buying cheap or dear relative to
        renting in this market? Roughly <15 favors buying, >20 favors renting.

    real_income = median_household_income / (rpp_all / 100)
        Purchasing-power-adjusted income — how far a salary actually goes.
        This is BEA's own documented use of the index: $12,000 at RPP 120
        becomes $10,000.

    CAVEAT ON real_income: rpp_all includes housing rents, so scoring on both
    real_income AND a housing metric double-counts housing to some degree. If
    that distorts rankings, compute a non-housing variant from the goods,
    utilities, and other-services components. Not done in Phase 1 because it
    needs BEA's expenditure weights, which must be read from source rather
    than assumed. Tracked as an open question in Working Master Plan.md.

    NOTE ON A SUPERSEDED FORMULA: an earlier draft had
        real_home_value = median_home_value / (rpp_rents / 100)
    That divides a housing price by a housing price index, so the two largely
    cancel and what survives is a price-to-rent signal mislabeled as
    affordability. It is deliberately NOT implemented. price_to_rent computes
    that signal directly from actual rent data instead.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .util import get_logger, read_interim

log = get_logger("join")


# Sources to merge, in order. (interim_name, description, required)
# `required=False` means the build continues with nulls if the file is absent,
# which lets you get a partial CSV out before every source is working.
SOURCES = [
    ("acs", "Census ACS 5-year", True),
    ("bea", "BEA Regional Price Parities", False),
    ("seda", "SEDA school achievement", False),
    ("popcenter", "Census 2020 centers of population", False),
    ("noaa", "NOAA climate normals", False),
]


def _safe_divide(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    """
    Divide, returning NaN wherever the denominator is zero, negative, or null.

    A zero or negative denominator here means bad upstream data (a census
    sentinel that escaped cleaning, say). Returning inf would poison the
    percentile ranking downstream, so we return NaN and let validate.py
    count it.
    """
    num = pd.to_numeric(numerator, errors="coerce")
    den = pd.to_numeric(denominator, errors="coerce")
    den = den.where(den > 0)
    result = num / den
    return result.replace([np.inf, -np.inf], np.nan)


def build_wide_table() -> pd.DataFrame:
    """Left join every available source onto the spine."""
    df = read_interim("spine")
    log.info("spine: %d counties", len(df))

    for name, description, required in SOURCES:
        try:
            source = read_interim(name)
        except FileNotFoundError:
            if required:
                raise
            log.warning("SKIPPING %s (%s) — interim file not found. "
                        "Those columns will be absent.", name, description)
            continue

        before_cols = set(df.columns)
        df = df.merge(source, on="fips", how="left", suffixes=("", f"_{name}"))
        added = [c for c in df.columns if c not in before_cols]

        # Report coverage so a half-broken source is obvious immediately.
        data_cols = [c for c in added if not c.endswith("_vintage")]
        if data_cols:
            coverage = 100.0 * df[data_cols].notna().any(axis=1).mean()
            log.info("merged %-6s (%s): +%d cols, %.1f%% of counties covered",
                     name, description, len(added), coverage)

    return df


def add_derived_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Compute the derived metrics. See module docstring for definitions."""
    df = df.copy()

    have = set(df.columns)

    if {"median_home_value", "median_household_income"} <= have:
        df["home_value_to_income"] = _safe_divide(
            df["median_home_value"], df["median_household_income"]
        )

    if {"median_gross_rent", "median_household_income"} <= have:
        df["rent_to_income"] = _safe_divide(
            df["median_gross_rent"] * 12.0, df["median_household_income"]
        )

    if {"median_home_value", "median_gross_rent"} <= have:
        df["price_to_rent"] = _safe_divide(
            df["median_home_value"], df["median_gross_rent"] * 12.0
        )

    if {"median_household_income", "rpp_all"} <= have:
        df["real_income"] = _safe_divide(
            df["median_household_income"], df["rpp_all"] / 100.0
        )

    # Effective property tax rate, percent of home value, owner-occupied homes
    # (LAWS.md: property_tax_effective_rate). Mean rate: aggregate taxes over
    # aggregate value, so it matches Tax Foundation's state table.
    if {"aggregate_real_estate_taxes", "aggregate_home_value"} <= have:
        df["property_tax_effective_rate"] = 100.0 * _safe_divide(
            df["aggregate_real_estate_taxes"], df["aggregate_home_value"]
        )

    derived = [c for c in ("home_value_to_income", "rent_to_income", "price_to_rent",
                           "real_income", "property_tax_effective_rate") if c in df.columns]
    log.info("derived %d columns: %s", len(derived), derived)
    return df


# Final column order. Anything not listed here is appended at the end, so
# adding a metric upstream will not silently disappear — it just lands last.
COLUMN_ORDER = [
    # identity
    "fips", "county_name", "state", "lat", "lon", "pop_lat", "pop_lon", "land_sq_mi",
    # ACS
    "population", "median_home_value", "median_household_income", "median_gross_rent",
    # BEA
    "rpp_all", "rpp_rents", "rpp_utilities", "rpp_goods", "rpp_services",
    "rpp_geo_level", "rpp_source_geo",
    # SEDA
    "school_achievement",
    # NOAA
    "summer_high_f", "winter_low_f", "spring_mean_f", "fall_mean_f",
    "annual_precip_in", "annual_snow_in",
    "hottest_month_high_f", "coldest_month_low_f",
    "days_above_90f", "nights_below_32f", "rainy_days", "snow_days",
    "climate_point", "climate_station_id", "climate_station_dist_mi", "climate_station_count",
    # derived
    "home_value_to_income", "rent_to_income", "price_to_rent", "real_income",
    "property_tax_effective_rate",
    # provenance
    "acs_vintage", "rpp_vintage",
]


def order_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Apply COLUMN_ORDER, appending any unlisted columns at the end."""
    present = [c for c in COLUMN_ORDER if c in df.columns]
    extra = [c for c in df.columns if c not in present]
    if extra:
        log.info("columns not in COLUMN_ORDER, appended at end: %s", extra)
    return df[present + extra]


def build() -> pd.DataFrame:
    """Full join + derive pipeline."""
    df = build_wide_table()
    df = add_derived_columns(df)
    df = order_columns(df)
    return df.sort_values("fips").reset_index(drop=True)
