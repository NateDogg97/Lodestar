"""
Orchestrator. Runs the whole Phase 1 pipeline end to end.

USAGE
    python -m etl.build                    # fetch everything, join, validate, publish
    python -m etl.build --skip-fetch       # re-join from cached interim files
    python -m etl.build --only spine,acs   # run just those source modules
    python -m etl.build --strict           # treat warnings as failures
    python -m etl.build --no-publish       # skip copying to public/data/

PUBLISH STEP
    When validation passes, the table is written to config.PUBLISH_PATH
    (public/data/counties.json) for the Next.js app, in a compact COLUMNAR
    format — see to_app_payload(). A build that fails validation never
    touches the published file, so what the app ships is always a build that
    was green. data/out/ remains the canonical, human-readable output
    (one JSON object per county).

WHY THE SOURCES RUN INDEPENDENTLY
    Each source writes its own tidy file to data/interim/ before anything is
    joined. That means:
      - a broken source does not block the others
      - you can inspect one source's output without running the pipeline
      - re-joining after a parsing fix takes seconds, not a re-fetch
      - an interrupted NOAA run resumes from its HTTP cache

    If you are debugging, run the single source module directly
    (python -m etl.sources.bea) and read its probe output before touching
    anything here.

EXIT CODES
    0  build succeeded and validation passed
    1  validation found a FAIL (or a WARN under --strict)
    2  a required source failed to fetch
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from pathlib import Path
import traceback

import pandas as pd

from . import config, join, validate
from .util import get_logger, write_interim

log = get_logger("build")


# (name, module_path, required)
# `required=False` sources let the pipeline produce a partial CSV while you
# are still getting that source working — useful, since SEDA needs a manual
# download and BEA needs a key.
PIPELINE = [
    ("spine", "etl.sources.spine", True),
    ("acs", "etl.sources.acs", True),
    ("bea", "etl.sources.bea", False),
    ("seda", "etl.sources.seda", False),
    # Before NOAA: the station search starts from these points when present.
    ("popcenter", "etl.sources.popcenter", False),
    ("noaa", "etl.sources.noaa", False),
    # Phase 5
    ("nri", "etl.sources.nri", False),
    ("bls", "etl.sources.bls", False),
    # After spine, popcenter and acs: measures from population centers, sizes metros.
    ("distances", "etl.sources.distances", False),
    # Map shapes. Not joined — written as its own file and published beside
    # the data after validation confirms both cover the same counties.
    ("boundaries", "etl.sources.boundaries", False),
]


def run_source(name: str, module_path: str) -> bool:
    """Import a source module, call fetch(), write its interim file."""
    import importlib

    log.info("=" * 60)
    log.info("SOURCE: %s", name)
    log.info("=" * 60)

    try:
        module = importlib.import_module(module_path)
        result = module.fetch()

        # NOAA returns (summary, monthly); boundaries writes its own file and
        # returns its path; everything else returns one frame.
        if isinstance(result, Path):
            pass
        elif isinstance(result, tuple):
            summary, extra = result
            write_interim(summary, name)
            write_interim(extra, f"{name}_monthly")
        else:
            write_interim(result, name)

        return True

    except Exception as exc:  # noqa: BLE001 - we want the full picture per source
        log.error("source %s FAILED: %s", name, exc)
        log.debug("%s", traceback.format_exc())
        print(f"\n--- traceback for {name} ---", file=sys.stderr)
        traceback.print_exc()
        print("---\n", file=sys.stderr)
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Relocation Finder ETL — Phase 1")
    parser.add_argument("--skip-fetch", action="store_true",
                        help="Skip source fetching; re-join existing interim files")
    parser.add_argument("--only", type=str, default=None,
                        help="Comma-separated source names to run (e.g. spine,acs)")
    parser.add_argument("--strict", action="store_true",
                        help="Treat validation warnings as failures")
    parser.add_argument("--no-publish", action="store_true",
                        help="Do not copy the validated JSON to public/data/")
    args = parser.parse_args()

    # --- key check, up front so you do not discover it three minutes in -----
    if not args.skip_fetch:
        if not config.CENSUS_API_KEY:
            log.warning("CENSUS_API_KEY not set — ACS may rate-limit. "
                        "https://api.census.gov/data/key_signup.html")
        if not config.BEA_API_KEY:
            log.warning("BEA_API_KEY not set — the BEA source will fail. "
                        "https://apps.bea.gov/API/signup/")

    # --- fetch ---------------------------------------------------------------
    failures: list[str] = []

    if not args.skip_fetch:
        selected = set(args.only.split(",")) if args.only else None

        for name, module_path, required in PIPELINE:
            if selected and name not in selected:
                continue
            ok = run_source(name, module_path)
            if not ok:
                failures.append(name)
                if required:
                    log.error("REQUIRED source %s failed — cannot continue", name)
                    return 2

        if failures:
            log.warning("optional sources failed and will be absent from the "
                        "output: %s", failures)
    else:
        log.info("--skip-fetch: re-joining from data/interim/")

    # --- join ---------------------------------------------------------------
    log.info("=" * 60)
    log.info("JOIN")
    log.info("=" * 60)
    df = join.build()

    out_csv = config.OUT_DIR / "counties.csv"
    df.to_csv(out_csv, index=False)
    log.info("wrote %s  (%d rows x %d cols)", out_csv, len(df), len(df.columns))

    # JSON for the app to consume directly. Records orientation keeps it
    # readable; the Phase 2 scoring engine can reshape as needed.
    out_json = config.OUT_DIR / "counties.json"
    df.to_json(out_json, orient="records", indent=None)
    log.info("wrote %s", out_json)

    # --- validate ------------------------------------------------------------
    findings, passed = validate.validate(df)
    validate.print_report(findings, df)

    n_warn = sum(1 for f in findings if f.severity == "WARN")
    if args.strict and n_warn:
        log.error("--strict: %d warnings treated as failure", n_warn)
        passed = False

    if failures:
        print(f"NOTE: these sources did not run and their columns are absent: "
              f"{failures}\n")

    if not passed:
        print("BUILD FAILED VALIDATION — see FAIL items above")
        print(f"NOT published: {config.PUBLISH_PATH} left untouched.")
        return 1

    if args.no_publish:
        print("BUILD OK (--no-publish: public/data/ not updated)")
        return 0

    publish(df)
    print("BUILD OK")
    return 0


# Published-file format. Bump when the shape changes; the app checks it.
APP_PAYLOAD_FORMAT = "counties-columnar-v1"

# Decimal places kept per column in the published file. Everything not listed
# gets DEFAULT_DECIMALS. Chosen well below any difference that could matter
# for ranking: dollars to the dollar, temperatures to 0.01 F, ratios to 4 dp.
# Rounding is most of the size win after the columnar layout — pandas writes
# 10+ significant digits by default.
DEFAULT_DECIMALS = 3
COLUMN_DECIMALS = {
    "lat": 4, "lon": 4, "pop_lat": 4, "pop_lon": 4, "land_sq_mi": 1,
    "population": 0, "median_home_value": 0, "median_household_income": 0,
    "median_gross_rent": 0, "real_income": 0,
    "summer_high_f": 2, "winter_low_f": 2, "spring_mean_f": 2, "fall_mean_f": 2,
    "annual_precip_in": 2, "annual_snow_in": 2,
    "hottest_month_high_f": 2, "coldest_month_low_f": 2,
    "days_above_90f": 1, "nights_below_32f": 1, "rainy_days": 1, "snow_days": 1,
    "climate_station_dist_mi": 1, "climate_station_count": 0,
    "rent_to_income": 4,
    "hispanic_share": 1, "white_share": 1, "black_share": 1, "asian_share": 1, "other_race_share": 1,
    "diversity_index": 1, "gini_index": 3,
    "property_tax_effective_rate": 3,
    "hazard_risk": 1, "hazard_hurricane": 1, "hazard_wildfire": 1, "hazard_inland_flood": 1,
    "hazard_coastal_flood": 1, "hazard_earthquake": 1, "hazard_tornado": 1,
    "unemployment_rate": 1, "unemployment_year": 0,
    "dist_airport_mi": 1, "dist_coast_mi": 1, "dist_metro_mi": 1,
    "acs_vintage": 0, "rpp_vintage": 0,
}


# Raw inputs to a derived column; the app never reads them. Kept in
# etl/data/out/ for auditing.
APP_EXCLUDED_COLUMNS = ("aggregate_real_estate_taxes", "aggregate_home_value")


def _compact(value: object, decimals: int) -> object:
    """JSON-safe, rounded scalar. NaN/None -> None; whole-number columns -> int."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        f = float(value)  # numpy scalars included
    except (TypeError, ValueError):
        return value
    if math.isnan(f):
        return None
    return int(round(f)) if decimals == 0 else round(f, decimals)


def to_app_payload(df: pd.DataFrame) -> dict:
    """
    Reshape the county table for the browser.

    {"format": ..., "columns": [name, ...], "rows": [[value, ...], ...]}

    WHY COLUMNAR: the records layout repeats all 33 column names in every one
    of ~3,100 rows, which is most of the file. Measured 2026-09-22: records
    2.6 MB; rounding alone 2.4 MB; columns + rows + rounding ~0.8 MB raw,
    ~0.26 MB gzipped. That puts it under Serwist's 2 MB precache cap, so the
    dataset is available offline.

    Nulls are JSON null — the app treats them as "unknown", never as zero.
    Inputs that only exist to derive another column stay in the readable CSV
    but are left out of the app payload (APP_EXCLUDED_COLUMNS).
    """
    df = df.drop(columns=[c for c in APP_EXCLUDED_COLUMNS if c in df.columns])
    columns = list(df.columns)
    decimals = [COLUMN_DECIMALS.get(c, DEFAULT_DECIMALS) for c in columns]
    rows = [
        [_compact(v, d) for v, d in zip(record, decimals)]
        for record in df.itertuples(index=False, name=None)
    ]
    return {"format": APP_PAYLOAD_FORMAT, "columns": columns, "rows": rows}


def publish(df: pd.DataFrame) -> None:
    """Write the validated table, in the app's compact format, to where the app reads it."""
    config.PUBLISH_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = to_app_payload(df)
    with open(config.PUBLISH_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), allow_nan=False)
    size_kb = config.PUBLISH_PATH.stat().st_size / 1024
    log.info("published %s  (%.0f KB)", config.PUBLISH_PATH, size_kb)
    print(f"Published to {config.PUBLISH_PATH.relative_to(config.ETL_DIR.parent)} "
          f"({size_kb:,.0f} KB)")

    # Monthly climate goes out with the county table it was validated against.
    from . import climate
    if climate.monthly_path().exists():
        path = climate.publish(df)
        print(f"Published to {path.relative_to(config.ETL_DIR.parent)} "
              f"({path.stat().st_size / 1024:,.0f} KB)")

    # Boundaries go out with the data they were validated against.
    from .sources import boundaries
    if boundaries.output_path().exists():
        shutil.copyfile(boundaries.output_path(), config.BOUNDARY_PUBLISH_PATH)
        kb = config.BOUNDARY_PUBLISH_PATH.stat().st_size / 1024
        print(f"Published to {config.BOUNDARY_PUBLISH_PATH.relative_to(config.ETL_DIR.parent)} "
              f"({kb:,.0f} KB)")


if __name__ == "__main__":
    sys.exit(main())
