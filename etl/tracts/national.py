"""
Every area's scoring columns in one file, for ranking areas nationwide (plan §9 Phase 8f).

    python -m etl.tracts.national               # from public/data/tracts/{fips}.json
    python -m etl.tracts.national --merge-live  # start from the live areas.json (CI, or
                                                # after building only some states)

Writes public/data/tracts/areas.json, column by column (similar values side by side
compress far better than rows: ~3.3 MB gzipped instead of ~4.5):
    {format: "areas-v1", generated, n, columns: {name: [value per area]}}

Only what ranking, the results list and its summaries need: names, population, the
measures a search can weigh or limit, the low-confidence flags, and the population
center (to pan the map). Everything else stays in the per-county files, fetched when
an area is opened. ~3–4 MB gzipped for all 84k areas; the app loads it only when a
search has an area-level filter. Bump AREAS_FORMAT with the reader in src/lib/tracts/.
"""

from __future__ import annotations

import json
import sys
from datetime import date

import requests

from .. import config
from ..util import get_logger
from .publish import PUBLISH_DIR

log = get_logger("tracts.national")

AREAS_FORMAT = "areas-v1"
LIVE_URL = "https://data.lodestarmap.com/tracts/areas.json"

# The label already holds neighborhood, place and ZIP ("Zilker, Austin · 78704").
TEXT = ["geoid", "label", "low_confidence"]
# Dollars are rounded (homes and incomes to $100, rent to $10): more than the
# estimates' precision, and they compress.
ROUND_TO = {"median_home_value": 100, "median_household_income": 100, "median_gross_rent": 10}
NUMBERS = {  # column -> decimals kept
    "population": 0, "pop_lat": 3, "pop_lon": 3,  # ~100 m: enough to pan the map
    "median_home_value": 0, "median_gross_rent": 0, "median_household_income": 0,
    "nearby_school_pctl": 0, "nearby_hs_pctl": 0,
    "walkability": 1, "violent_rate": 0, "property_rate": 0,
    "dist_downtown_mi": 1, "dist_airport_mi": 1, "dist_coast_mi": 0, "dist_metro_mi": 1,
    "kids_share": 0, "density_per_sq_mi": 0, "commute_minutes": 0,
    "hazard_risk": 0, "hazard_hurricane": 0, "hazard_wildfire": 0, "hazard_inland_flood": 0,
    "hazard_coastal_flood": 0, "hazard_earthquake": 0, "hazard_tornado": 0,
}
COLUMNS = TEXT + list(NUMBERS)


def _rows_from_county(payload: dict) -> list[list]:
    cols = payload["columns"]
    at = {c: cols.index(c) for c in COLUMNS if c in cols}
    out = []
    for r in payload["rows"]:
        row = []
        for c in COLUMNS:
            v = r[at[c]] if c in at else None
            if c in NUMBERS and v is not None:
                v = round(float(v) / ROUND_TO[c]) * ROUND_TO[c] if c in ROUND_TO else round(float(v), NUMBERS[c])
                v = int(v) if NUMBERS[c] == 0 else v
            row.append(v)
        out.append(row)
    return out


def build(merge_live: bool) -> dict:
    rows: dict[str, list[list]] = {}  # county fips -> its rows
    if merge_live:
        try:
            live = requests.get(LIVE_URL, timeout=config.HTTP_TIMEOUT).json()
            if live.get("format") == AREAS_FORMAT and list(live.get("columns", {})) == COLUMNS:
                cols = live["columns"]
                for i in range(live["n"]):
                    r = [cols[c][i] for c in COLUMNS]
                    rows.setdefault(r[0][:5], []).append(r)
                log.info("live areas.json: %d areas in %d counties", sum(map(len, rows.values())), len(rows))
            else:
                log.warning("live areas.json has another format or columns: rebuilding from local files only")
        except (requests.RequestException, ValueError) as exc:
            log.warning("no live areas.json (%s): local files only", type(exc).__name__)
    local = sorted(PUBLISH_DIR.glob("[0-9][0-9][0-9][0-9][0-9].json"))
    for path in local:
        rows[path.stem] = _rows_from_county(json.loads(path.read_text()))
    all_rows = [r for fips in sorted(rows) for r in rows[fips]]
    log.info("areas.json: %d areas in %d counties (%d from local files)", len(all_rows), len(rows), len(local))
    return {"format": AREAS_FORMAT, "generated": date.today().isoformat(), "n": len(all_rows),
            "columns": {c: [r[k] for r in all_rows] for k, c in enumerate(COLUMNS)}}


def main() -> None:
    payload = build(merge_live="--merge-live" in sys.argv)
    body = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    (PUBLISH_DIR / "areas.json").write_text(body)
    log.info("wrote %s (%.1f MB)", PUBLISH_DIR / "areas.json", len(body) / 1e6)


if __name__ == "__main__":
    main()
