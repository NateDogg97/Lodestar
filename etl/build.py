"""
Orchestrator. Runs the whole Phase 1 pipeline end to end.

USAGE
    python -m etl.build                    # fetch everything, join, validate, publish
    python -m etl.build --skip-fetch       # re-join from cached interim files
    python -m etl.build --only spine,acs   # run just those source modules
    python -m etl.build --strict           # treat warnings as failures
    python -m etl.build --no-publish       # skip copying to public/data/

PUBLISH STEP
    When validation passes, data/out/counties.json is copied to
    config.PUBLISH_PATH (public/data/counties.json) for the Next.js app.
    A build that fails validation never touches the published file, so what
    the app ships is always a build that was green. data/out/ remains the
    canonical output.

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
import shutil
import sys
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
    ("noaa", "etl.sources.noaa", False),
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

        # NOAA returns (summary, monthly); everything else returns one frame.
        if isinstance(result, tuple):
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

    publish(out_json)
    print("BUILD OK")
    return 0


def publish(out_json) -> None:
    """Copy the validated JSON to where the app reads it."""
    config.PUBLISH_PATH.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(out_json, config.PUBLISH_PATH)
    size_kb = config.PUBLISH_PATH.stat().st_size / 1024
    log.info("published %s  (%.0f KB)", config.PUBLISH_PATH, size_kb)
    print(f"Published to {config.PUBLISH_PATH.relative_to(config.ETL_DIR.parent)} "
          f"({size_kb:,.0f} KB)")


if __name__ == "__main__":
    sys.exit(main())
