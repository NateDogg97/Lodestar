"""
Post-build validation. Catches structural breakage, not data subtleties.

PHILOSOPHY
    These checks exist to catch the failures that are easy to miss because
    they produce plausible-looking output:

      - the FIPS leading-zero bug (California vanishes, 2,900 rows still emit)
      - an unhandled Census sentinel (a county with -666,666,666 income)
      - a unit error (rent in dollars vs. hundreds of dollars)
      - a failed join that nulls one whole source
      - duplicate rows from a many-to-many merge

    None of these throw an exception on their own. All of them would quietly
    corrupt the scoring engine.

SEVERITY
    FAIL   structural problem; the output should not be trusted. Exit code 1.
    WARN   worth a look; build still completes.
    INFO   informational coverage reporting.

    `python -m etl.build --strict` turns WARN into FAIL.
"""

from __future__ import annotations

import pandas as pd

from . import config
from .util import get_logger

log = get_logger("validate")


class Finding:
    def __init__(self, severity: str, message: str):
        self.severity = severity
        self.message = message

    def __str__(self) -> str:
        return f"[{self.severity}] {self.message}"


def _check_row_count(df: pd.DataFrame) -> list[Finding]:
    n = len(df)
    if n < config.EXPECTED_COUNTY_COUNT_MIN:
        return [Finding("FAIL",
                        f"Only {n} counties; expected at least "
                        f"{config.EXPECTED_COUNTY_COUNT_MIN}. A join probably "
                        f"dropped rows — check that every merge is a LEFT join "
                        f"and that FIPS is a zero-padded string everywhere.")]
    if n > config.EXPECTED_COUNTY_COUNT_MAX:
        return [Finding("FAIL",
                        f"{n} counties; expected at most "
                        f"{config.EXPECTED_COUNTY_COUNT_MAX}. A merge probably "
                        f"fanned out (many-to-many). Check for duplicate keys "
                        f"in the source tables.")]
    return [Finding("INFO", f"{n} counties — within expected range")]


def _check_fips_integrity(df: pd.DataFrame) -> list[Finding]:
    findings: list[Finding] = []

    if df["fips"].duplicated().any():
        dupes = df.loc[df["fips"].duplicated(keep=False), "fips"].unique()[:10]
        findings.append(Finding("FAIL", f"Duplicate FIPS values: {list(dupes)}"))

    bad_len = df[df["fips"].astype(str).str.len() != 5]
    if not bad_len.empty:
        findings.append(Finding(
            "FAIL",
            f"{len(bad_len)} FIPS values are not 5 characters: "
            f"{bad_len['fips'].head(5).tolist()}. This is the leading-zero bug."
        ))

    # The leading-zero bug's signature: states with FIPS < 10 go missing.
    low_states = df[df["fips"].astype(str).str[:2] < "10"]
    if len(low_states) < 200:
        findings.append(Finding(
            "FAIL",
            f"Only {len(low_states)} counties in states with FIPS < 10 "
            f"(AL, AK, AZ, AR, CA, CO, CT, DE, DC, FL, GA). Expected ~600+. "
            f"This is the classic FIPS-as-integer bug — somewhere a read_csv "
            f"is missing dtype=str."
        ))
    else:
        findings.append(Finding(
            "INFO", f"{len(low_states)} counties in low-FIPS states — looks right"
        ))

    n_states = df["state"].nunique()
    if n_states < 50:
        findings.append(Finding("FAIL", f"Only {n_states} distinct states present"))

    return findings


# Marker columns: one per source, used to test whether that source joined at
# all. Each is a column that source alone provides and that should be present
# for essentially every county.
SOURCE_MARKERS = {
    "ACS": "median_household_income",
    "BEA": "rpp_all",
    "SEDA": "school_achievement",
    "NOAA": "summer_high_f",
}


def _check_source_join_rates(df: pd.DataFrame) -> list[Finding]:
    """
    Verify each source actually matched the spine, per state-FIPS band.

    WHY THIS EXISTS, SPECIFICALLY
        The FIPS leading-zero bug does not corrupt the spine — the spine is
        built from a single clean source. It corrupts the MERGE: the source's
        keys become 4-character integers, so every county in a state with
        FIPS < 10 fails to match and comes back null.

        That is ~600 of 3,144 counties, or 19% — which sails under a global
        50%-null warning threshold. A caught-in-testing gap: the earlier
        version of this file checked only the spine's own FIPS and reported
        the resulting nulls as routine coverage.

        So we check the join rate WITHIN the low-FIPS band separately. If a
        source covers 95% of high-FIPS counties but 0% of low-FIPS ones, that
        is not sparse data — that is a broken key, and it is unambiguous.
    """
    findings: list[Finding] = []
    is_low = df["fips"].astype(str).str[:2] < "10"

    for source_name, marker in SOURCE_MARKERS.items():
        if marker not in df.columns:
            continue

        present = df[marker].notna()
        overall = present.mean()

        # The column exists, so the source RAN and wrote an interim file. If
        # it then matched (almost) nothing, that is a broken join key, not
        # sparse data — and it is a FAIL regardless of whether the source is
        # optional. An optional source that is genuinely absent has no column
        # at all and never reaches this check.
        if overall < config.SOURCE_JOIN_FAIL_BELOW:
            findings.append(Finding(
                "FAIL",
                f"{source_name}: interim file exists but only {overall:.1%} of counties "
                f"have a value ({marker}). That is a broken join key, not sparsity — "
                f"check that source's FIPS column choice and dtype=str."
            ))
            continue

        low_rate = present[is_low].mean() if is_low.any() else 1.0
        high_rate = present[~is_low].mean() if (~is_low).any() else 1.0

        # A 3x disparity between bands is not plausible as real data sparsity.
        if high_rate > 0.5 and low_rate < high_rate / 3.0:
            findings.append(Finding(
                "FAIL",
                f"{source_name}: joined {high_rate:.0%} of counties in states with "
                f"FIPS >= 10 but only {low_rate:.0%} of those below. That is the "
                f"FIPS leading-zero bug in the {source_name} source — its key was "
                f"read as an integer somewhere, dropping AL/AK/AZ/AR/CA/CO/CT/DE/"
                f"DC/FL/GA. Check dtype=str on that source's read."
            ))
        elif overall < 0.80:
            findings.append(Finding(
                "WARN",
                f"{source_name}: only {overall:.0%} of counties have a value "
                f"({marker}). Verify this is genuine sparsity, not a join failure."
            ))
        else:
            findings.append(Finding(
                "INFO", f"{source_name}: joined {overall:.0%} of counties"
            ))

    return findings


def _check_coverage(df: pd.DataFrame) -> list[Finding]:
    """Report null rates per column; flag any metric that is mostly empty."""
    findings: list[Finding] = []
    for col in df.columns:
        if col in {"fips", "county_name", "state", "rpp_geo_level",
                   "rpp_source_geo", "climate_station_id"}:
            continue
        null_rate = df[col].isna().mean()
        if null_rate > 0.5:
            findings.append(Finding(
                "WARN",
                f"{col}: {null_rate:.0%} null. That source may have failed to join."
            ))
        elif null_rate > 0.10:
            findings.append(Finding("INFO", f"{col}: {null_rate:.0%} null"))
    return findings


def _check_plausible_ranges(df: pd.DataFrame) -> list[Finding]:
    """Values outside a generous range usually mean a unit or sentinel error."""
    findings: list[Finding] = []
    for col, (lo, hi) in config.PLAUSIBLE_RANGES.items():
        if col not in df.columns:
            continue
        series = pd.to_numeric(df[col], errors="coerce").dropna()
        if series.empty:
            continue
        out_of_range = series[(series < lo) | (series > hi)]
        if not out_of_range.empty:
            examples = df.loc[out_of_range.index[:3], ["fips", "county_name", "state", col]]
            findings.append(Finding(
                "WARN",
                f"{col}: {len(out_of_range)} values outside [{lo:,}, {hi:,}]. "
                f"Examples:\n{examples.to_string(index=False)}"
            ))
    return findings


def _check_census_sentinels(df: pd.DataFrame) -> list[Finding]:
    """Any large negative in a money column means a sentinel escaped cleaning."""
    findings: list[Finding] = []
    money_cols = ["median_home_value", "median_household_income",
                  "median_gross_rent", "population", "real_income"]
    for col in money_cols:
        if col not in df.columns:
            continue
        series = pd.to_numeric(df[col], errors="coerce")
        bad = series[series < 0]
        if not bad.empty:
            findings.append(Finding(
                "FAIL",
                f"{col} has {len(bad)} negative values (min {bad.min():,.0f}). "
                f"A Census jam value escaped util.clean_census_nulls."
            ))
    return findings


def _check_spot_counties(df: pd.DataFrame) -> list[Finding]:
    """Every hand-picked spot-check county must be present."""
    findings: list[Finding] = []
    for fips, label in config.SPOT_CHECK_FIPS.items():
        if fips not in set(df["fips"]):
            findings.append(Finding("FAIL", f"Spot-check county {fips} missing — {label}"))
    return findings


def _check_rpp_assignment(df: pd.DataFrame) -> list[Finding]:
    """
    Assert the BEA inheritance rules fired in a plausible mix.

    About 60% of counties sit outside a metropolitan CBSA and take the
    statewide RPP by design. If the "state" share climbs well past that, or
    the "metro" share collapses, the CBSA crosswalk and MARPP have stopped
    lining up and metro counties are being treated as rural — which looks
    like perfectly good data. FAIL on either.
    """
    findings: list[Finding] = []
    if "rpp_geo_level" not in df.columns:
        return findings

    level = df["rpp_geo_level"]
    assigned = level.notna()
    if not assigned.any():
        return findings  # the join-rate check already reports an empty source

    counts = level.value_counts(dropna=False).to_dict()
    share_state = float((level == "state").mean())
    share_metro = float((level == "metro").mean())
    share_nonmetro = float((level == "nonmetro").mean())

    findings.append(Finding(
        "INFO",
        f"rpp_geo_level: metro {share_metro:.0%}, nonmetro {share_nonmetro:.0%}, "
        f"state {share_state:.0%} ({counts})"
    ))

    if share_state > config.RPP_STATE_LEVEL_MAX_SHARE:
        findings.append(Finding(
            "FAIL",
            f"{share_state:.0%} of counties have rpp_geo_level == 'state' "
            f"(bound {config.RPP_STATE_LEVEL_MAX_SHARE:.0%}, derived from the share of "
            f"counties outside a metropolitan CBSA). Metro counties are being treated "
            f"as rural — the CBSA crosswalk and MARPP GeoFips are not lining up."
        ))

    # Roughly 1,100-1,200 of ~3,144 counties sit in a metropolitan CBSA. If
    # rule 1 matched almost none of them, the CBSA codes did not line up
    # between the crosswalk and MARPP.
    if share_metro < 0.15:
        findings.append(Finding(
            "FAIL",
            f"Only {share_metro:.0%} of counties got a metro RPP; expect roughly a third. "
            f"The CBSA crosswalk and BEA's MARPP GeoFips are probably not lining up."
        ))

    return findings


def _check_derived_sanity(df: pd.DataFrame) -> list[Finding]:
    """
    Cross-check derived columns against an independent recomputation.

    Cheap, and it catches the case where a formula is edited in one place but
    not the other.
    """
    findings: list[Finding] = []

    if {"price_to_rent", "median_home_value", "median_gross_rent"} <= set(df.columns):
        mask = df["price_to_rent"].notna()
        expected = df.loc[mask, "median_home_value"] / (df.loc[mask, "median_gross_rent"] * 12.0)
        diff = (df.loc[mask, "price_to_rent"] - expected).abs()
        if (diff > 1e-6).any():
            findings.append(Finding("FAIL", "price_to_rent does not match its definition"))

    if "price_to_rent" in df.columns:
        series = df["price_to_rent"].dropna()
        if not series.empty and (series.median() < 5 or series.median() > 40):
            findings.append(Finding(
                "WARN",
                f"Median price_to_rent is {series.median():.1f}, outside the "
                f"typical 10-25 band. Possible unit error in rent (monthly vs annual)."
            ))

    return findings


def _check_boundaries(df: pd.DataFrame) -> list[Finding]:
    """
    The map joins shapes to scores by GEOID in the browser. A county with data
    but no shape silently vanishes from the map; a shape with no data paints
    as unknown forever. Either means the two files have drifted — FAIL.
    """
    from .sources import boundaries

    if not boundaries.output_path().exists():
        return [Finding("WARN", "No county boundaries built (run `python -m etl.sources.boundaries`); "
                                "the map will have no shapes to draw")]
    shapes = boundaries.topo_geoids()
    data = set(df["fips"].astype(str))
    missing_shape = sorted(data - shapes)
    missing_data = sorted(shapes - data)
    if missing_shape or missing_data:
        return [Finding("FAIL", f"Boundaries and data disagree: {len(missing_shape)} counties have no "
                                f"shape (e.g. {missing_shape[:5]}), {len(missing_data)} shapes have no "
                                f"data (e.g. {missing_data[:5]})")]
    return [Finding("INFO", f"Boundaries cover exactly the {len(shapes)} counties in the data")]


# (fips, column, test, description) — well-known places whose values aren't
# in doubt. A miss means a broken join, column or distance, not a borderline case.
PHASE5_SPOT = [
    ("22071", "hazard_hurricane", lambda v: v > 90, "New Orleans hurricane loss-rate percentile > 90"),
    ("48453", "nearest_airport", lambda v: v == "AUS", "Austin's nearest large airport is AUS"),
    ("48453", "dist_airport_mi", lambda v: v < 25, "Austin is < 25 mi from AUS"),
    ("08031", "dist_coast_mi", lambda v: v > 600, "Denver is > 600 mi from the coast"),
    ("12086", "dist_coast_mi", lambda v: v < 15, "Miami-Dade is < 15 mi from the coast"),
    ("17031", "dist_metro_mi", lambda v: v < 15, "Cook County is < 15 mi from Chicago's metro center"),
    ("06075", "unemployment_rate", lambda v: 1 < v < 15, "San Francisco unemployment is 1–15%"),
]


def _check_phase5(df: pd.DataFrame) -> list[Finding]:
    """Hazards, unemployment and distances: coverage and well-known places."""
    findings: list[Finding] = []
    idx = df.set_index("fips")
    for fips, col, ok, what in PHASE5_SPOT:
        if col not in idx.columns or fips not in idx.index:
            continue
        v = idx.at[fips, col]
        if pd.isna(v) or not ok(v):
            findings.append(Finding("FAIL", f"Spot check failed: {what} (got {v!r})"))
    for col, min_share in (("hazard_risk", 0.99), ("unemployment_rate", 0.99), ("dist_airport_mi", 1.0),
                           ("dist_coast_mi", 1.0), ("dist_metro_mi", 1.0)):
        if col in df.columns:
            share = float(df[col].notna().mean())
            if share < min_share:
                findings.append(Finding("FAIL", f"{col} covers only {share:.1%} of counties"))
    return findings


def _check_monthly_climate(df: pd.DataFrame) -> list[Finding]:
    """The Climate tab's monthly file must cover the same counties, and agree
    with the annual climate columns it shares stations with (etl/climate.py)."""
    from . import climate

    if not climate.monthly_path().exists():
        return [Finding("WARN", "No monthly climate file (data/interim/noaa_monthly.csv); "
                                "the app's Climate tab will have no chart")]
    return [Finding(sev, msg) for sev, msg in climate.check(climate.load_monthly(), df)]


def validate(df: pd.DataFrame) -> tuple[list[Finding], bool]:
    """Run all checks. Returns (findings, passed)."""
    findings: list[Finding] = []
    findings += _check_row_count(df)
    findings += _check_fips_integrity(df)
    findings += _check_census_sentinels(df)
    findings += _check_spot_counties(df)
    findings += _check_source_join_rates(df)
    findings += _check_rpp_assignment(df)
    findings += _check_coverage(df)
    findings += _check_plausible_ranges(df)
    findings += _check_derived_sanity(df)
    findings += _check_boundaries(df)
    findings += _check_monthly_climate(df)
    findings += _check_phase5(df)

    passed = not any(f.severity == "FAIL" for f in findings)
    return findings, passed


def print_report(findings: list[Finding], df: pd.DataFrame) -> None:
    """Human-readable validation report."""
    print("\n" + "=" * 78)
    print("VALIDATION REPORT")
    print("=" * 78)

    for severity in ("FAIL", "WARN", "INFO"):
        subset = [f for f in findings if f.severity == severity]
        if not subset:
            continue
        print(f"\n{severity} ({len(subset)})")
        print("-" * 78)
        for finding in subset:
            print(f"  {finding.message}")

    print("\n" + "=" * 78)
    print("SPOT CHECKS")
    print("=" * 78)
    cols = [c for c in ["fips", "county_name", "state", "population",
                        "median_home_value", "median_household_income",
                        "median_gross_rent", "rpp_all", "rpp_geo_level",
                        "school_achievement", "summer_high_f", "winter_low_f",
                        "price_to_rent", "real_income"]
            if c in df.columns]
    spot = df[df["fips"].isin(config.SPOT_CHECK_FIPS.keys())][cols]
    if not spot.empty:
        print(spot.to_string(index=False))
    print()
