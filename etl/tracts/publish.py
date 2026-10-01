"""
Publish built counties for the app (plan §9 Phase 8b): data/out/tracts/ ->
public/data/tracts/ (git-ignored; served locally by Next.js; R2 later).

    python -m etl.tracts.publish            # every county built in data/out/tracts/
    python -m etl.tracts.publish 48453      # just these

Per county:
    {fips}.json       {format, county, generated, downtown_metro,
                       columns, rows,                 one row per tract
                       schools: {columns, rows}}      the county's scored schools
    {fips}.topo.json  tract shapes (layer `tracts`, property GEOID)
And index.json: {format, counties: {fips: {tracts, generated}}} — the app reads
this to know which counties can be explored inside.

Compact like counties.json: columnar, numbers rounded per column, IDs kept as
strings. Bump PAYLOAD_FORMAT with the reader in src/lib/tracts/ together.
"""

from __future__ import annotations

import json
import shutil
import sys
from datetime import date

import numpy as np
import pandas as pd

from .. import config
from ..util import get_logger

log = get_logger("tracts.publish")

PAYLOAD_FORMAT = "tracts-v1"
PUBLISH_DIR = config.ETL_DIR.parent / "public" / "data" / "tracts"

TEXT = {"geoid", "district_id", "zip", "nearby_schools", "nearby_high_schools", "low_confidence", "topcoded", "label", "place",
        "near_place", "neighborhood", "district_name", "nearest_airport", "nearest_metro", "downtown_metro",
        "crime_agency", "nearest_downtown", "zillow_month", "redfin_period", "school_id", "name", "level", "city", "county_name"}
DROP = {"county_fips", "downtown_metro"}


def _digits(col: str) -> int:
    """Rounding per column: money and counts whole; rates, shares, miles 1–2 decimals."""
    if col in ("pop_lat", "pop_lon", "lat", "lon"):
        return 5
    if col.endswith(("_value", "_income", "_rent", "zhvi", "zori", "sale_price", "_moe")) or col in (
            "population", "homes_sold", "crime_population", "violent_rate", "property_rate"):
        return 0
    if col in ("district_score", "score"):
        return 3
    if col in ("ap_courses", "enrollment"):
        return 0
    return 1


def _columnar(df: pd.DataFrame) -> dict:
    cols = list(df.columns)
    out_rows = []
    for rec in df.itertuples(index=False):
        row = []
        for c, v in zip(cols, rec):
            if v is None or (isinstance(v, float) and np.isnan(v)):
                row.append(None)
            elif c in TEXT:
                row.append(str(v))
            elif isinstance(v, (bool, np.bool_)):
                row.append(bool(v))
            else:
                x = round(float(v), _digits(c))
                row.append(int(x) if x == int(x) and _digits(c) == 0 else x)
        out_rows.append(row)
    return {"columns": cols, "rows": out_rows}


def publish(fips: str) -> dict:
    src = config.TRACT_OUT_DIR
    df = pd.read_csv(src / f"{fips}.csv", dtype={c: str for c in TEXT})
    schools = pd.read_csv(src / f"{fips}_schools.csv", dtype={c: str for c in TEXT})
    payload = {
        "format": PAYLOAD_FORMAT,
        "county": fips,
        "generated": date.today().isoformat(),
        "downtown_metro": df["downtown_metro"].dropna().iloc[0] if df["downtown_metro"].notna().any() else None,
        **_columnar(df.drop(columns=[c for c in DROP if c in df.columns])),
        "schools": _columnar(schools),
    }
    PUBLISH_DIR.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    (PUBLISH_DIR / f"{fips}.json").write_text(body)
    shutil.copyfile(src / f"{fips}.topo.json", PUBLISH_DIR / f"{fips}.topo.json")
    log.info("published %s: %d tracts, %d schools, %.0f KB", fips, len(df), len(schools), len(body) / 1024)
    return {"tracts": len(df), "generated": payload["generated"]}


def main() -> None:
    wanted = sys.argv[1:] or sorted(p.stem for p in config.TRACT_OUT_DIR.glob("[0-9]" * 5 + ".csv"))
    index_path = PUBLISH_DIR / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"format": PAYLOAD_FORMAT, "counties": {}}
    for fips in wanted:
        index["counties"][fips] = publish(fips)
    index["format"] = PAYLOAD_FORMAT
    index_path.write_text(json.dumps(index, indent=1, sort_keys=True))
    log.info("index.json: %d counties", len(index["counties"]))


if __name__ == "__main__":
    main()
