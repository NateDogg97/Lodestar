"""
Refresh some sources' columns in the published county file, without a full rebuild.

    python -m etl.patch zillow_county            # one source
    python -m etl.patch zillow_county newbuyer nri
    python -m etl.patch --dry-run nri            # validate and report; write nothing

A full build (`python -m etl.build`) needs every source's interim file — NOAA's
thousands of station files, the hand-downloaded SEDA tables — and a fresh clone has
none of them. This runs only the named sources (each module's `fetch()`), replaces
their columns in public/data/counties.json, re-derives what depends on them, validates
the result with the build's own checks, and publishes it the build's way
(`to_app_payload`). The published file is the base, so nothing else changes.

Sources that read the county spine (FEMA NRI, the new-buyer ratio) get one written
from the published file when data/interim/ has none.
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys

import pandas as pd

from . import config, validate
from .util import get_logger, write_interim

log = get_logger("patch")

# Sources this can refresh -> module. Each `fetch()` returns a frame keyed by `fips`.
SOURCES = {
    "zillow_county": "etl.sources.zillow_county",
    "newbuyer": "etl.sources.newbuyer",
    "nri": "etl.sources.nri",
    "edges": "etl.edges",
}


def _ensure_spine(df: pd.DataFrame) -> None:
    if not (config.INTERIM_DIR / "spine.csv").exists():
        cols = [c for c in ("fips", "county_name", "state", "lat", "lon", "land_sq_mi", "pop_lat", "pop_lon",
                            "population") if c in df.columns]
        write_interim(df[cols].copy(), "spine")
        log.info("wrote an interim spine from the published file (%d counties)", len(df))


def _decode_ratings(df: pd.DataFrame) -> pd.DataFrame:
    """The published file codes FEMA's rating words (build.FEMA_RATINGS): back to words."""
    from .build import FEMA_RATINGS

    for c in [c for c in df.columns if c.startswith("hazard") and c.endswith("_rating")]:
        df[c] = df[c].map(lambda v: FEMA_RATINGS[int(v)] if isinstance(v, (int, float)) and v == v else v)
    return df


def derive(df: pd.DataFrame) -> pd.DataFrame:
    """What depends on the patched columns (the same steps `join.build` runs)."""
    from .sources.zillow_county import today_values

    # Only with Zillow's county values in hand (they're kept out of the published file):
    # recomputing without them would replace Zillow's value with the Census fallback.
    return today_values(df) if "zhvi_county" in df.columns else df


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sources", nargs="+", choices=sorted(SOURCES))
    ap.add_argument("--dry-run", action="store_true", help="validate and report; write nothing")
    args = ap.parse_args()

    from .build import to_app_payload

    payload = json.loads(config.PUBLISH_PATH.read_text(encoding="utf-8"))
    df = pd.DataFrame(payload["rows"], columns=payload["columns"])
    df = _decode_ratings(df)
    _ensure_spine(df)
    for name in args.sources:
        frame = importlib.import_module(SOURCES[name]).fetch()
        write_interim(frame, name)
        new = [c for c in frame.columns if c != "fips"]
        df = df.drop(columns=[c for c in new if c in df.columns]).merge(frame, on="fips", how="left")
        log.info("%s: %d columns, %d of %d counties covered", name, len(new),
                 int(df[new].notna().any(axis=1).sum()), len(df))
    df = derive(df)

    findings, passed = validate.validate(df)
    validate.print_report(findings, df)
    if not passed:
        print("PATCH FAILED VALIDATION — published file left untouched")
        return 1
    if args.dry_run:
        print("dry run: nothing written")
        return 0
    config.PUBLISH_PATH.write_text(json.dumps(to_app_payload(df), separators=(",", ":"), allow_nan=False),
                                   encoding="utf-8")
    print(f"Published {config.PUBLISH_PATH.relative_to(config.ETL_DIR.parent)} ({', '.join(args.sources)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
