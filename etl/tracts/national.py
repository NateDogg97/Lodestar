"""
Every area's scoring columns in one file, for ranking areas nationwide (plan §9 Phase 8f).

    python -m etl.tracts.national               # from public/data/tracts/{fips}.json
    python -m etl.tracts.national --merge-live  # start from the live areas.json (CI, or
                                                # after building only some states)

Writes public/data/tracts/areas.json, column by column (similar values side by side
compress far better than rows: ~3.3 MB gzipped instead of ~4.5):
    {format: "areas-v1", generated, n, columns: {name: [value per area]}}

Home value and rent are the Census values **at today's prices** (owner, 2026-10-04):
each area's Census value (tract by tract, but a 2019–2023 average) times its ZIP's
Zillow / Census ratio, so areas keep their differences from their neighbours while the
level is current. Areas whose ZIP has no Zillow value take the county's typical ratio,
else the national one. A Census value that is top-coded ("$2,000,001 or more", "$3,501
or more") is a floor, not a value, and one from an area where most owned homes are mobile
homes isn't a house price (owner: a $30k park beside $400k ZIPs topped "cheapest homes"):
either way the area takes Zillow's ZIP value as is (no Zillow: a top-code keeps its floor
times the ratio; a mobile-home value is left unknown), and is left out of the ZIP's ratio
(full audit, 2026-10-04). See `today_prices`.

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
    # Results audit (2026-10-04): mostly group quarters → not a result; mostly mobile
    # homes → the home value gets a caution.
    "group_quarters_share": 0, "mobile_home_share": 0,
    "hazard_risk": 0, "hazard_hurricane": 0, "hazard_wildfire": 0, "hazard_inland_flood": 0,
    "hazard_coastal_flood": 0, "hazard_earthquake": 0, "hazard_tornado": 0,
}
COLUMNS = TEXT + list(NUMBERS)

# Census column -> the Zillow index (by ZIP) that brings it to today's prices.
TODAY = {"median_home_value": "zhvi", "median_gross_rent": "zori"}
# A ZIP whose ratio falls outside this is more likely a data mismatch than a market.
RATIO_RANGE = (0.5, 3.0)


def _median(xs: list[float]) -> float | None:
    xs = sorted(xs)
    if not xs:
        return None
    m = len(xs) // 2
    return xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2


def _topcoded(payload: dict) -> list[set[str]]:
    """Per row, the Census columns whose value is a top-code floor (publish.py `topcoded`)."""
    cols = payload["columns"]
    if "topcoded" not in cols:
        return [set() for _ in payload["rows"]]
    it = cols.index("topcoded")
    return [set(f for f in str(r[it] or "").split(";") if f) for r in payload["rows"]]


def _mobile(payload: dict) -> list[bool]:
    """Per row, whether most owned homes are mobile homes (the `mobile_homes` caution)."""
    cols = payload["columns"]
    if "low_confidence" not in cols:
        return [False] * len(payload["rows"])
    il = cols.index("low_confidence")
    return ["mobile_homes" in str(r[il] or "").split(";") for r in payload["rows"]]


def zip_ratios(payload: dict, census: str, zillow: str) -> dict[str, float]:
    """Per ZIP in a county: Zillow's value / the median Census value of its areas (top-coded
    Census values left out: a floor would pull the ratio up)."""
    cols = payload["columns"]
    at = {c: cols.index(c) for c in ("zip", census, zillow)}
    by_zip: dict[str, tuple[list[float], list[float]]] = {}
    for r, topped, mobile in zip(payload["rows"], _topcoded(payload), _mobile(payload)):
        z, c, w = r[at["zip"]], r[at[census]], r[at[zillow]]
        if not z:
            continue
        cs, ws = by_zip.setdefault(str(z), ([], []))
        if c is not None and census not in topped and not (mobile and census == "median_home_value"):
            cs.append(float(c))
        if w is not None:
            ws.append(float(w))
    out = {}
    for z, (cs, ws) in by_zip.items():
        mc, mw = _median(cs), _median(ws)
        if mc and mw:
            ratio = mw / mc
            if RATIO_RANGE[0] <= ratio <= RATIO_RANGE[1]:
                out[z] = ratio
    return out


def today_prices(payload: dict, national: dict[str, float]) -> dict[str, list[float | None]]:
    """Each area's Census home value and rent at today's prices, in row order.

    Census x its ZIP's ratio; no ratio for the ZIP: the county's median ratio, else
    `national` (the median over all ZIPs). An area with no Census value, or a top-coded
    one ("$2,000,001 or more" is a floor), takes Zillow's ZIP value as is — a top-coded
    value with no Zillow keeps the floor times the ratio (it is at least that). A home
    value where most owned homes are mobile homes isn't a house price: Zillow's ZIP value,
    or unknown.
    """
    cols = payload["columns"]
    out: dict[str, list[float | None]] = {}
    topcoded, mobile = _topcoded(payload), _mobile(payload)
    for census, zillow in TODAY.items():
        ratios = zip_ratios(payload, census, zillow)
        fallback = _median(list(ratios.values())) or national[census]
        iz, ic, iw = cols.index("zip"), cols.index(census), cols.index(zillow)
        vals: list[float | None] = []
        for r, topped, mob in zip(payload["rows"], topcoded, mobile):
            c, w = r[ic], r[iw]
            not_a_price = mob and census == "median_home_value"
            if c is not None and not not_a_price and not (census in topped and w is not None):
                vals.append(float(c) * ratios.get(str(r[iz]), fallback))
            else:
                vals.append(float(w) if w is not None else None)
        out[census] = vals
    return out


def _rows_from_county(payload: dict, national: dict[str, float]) -> list[list]:
    cols = payload["columns"]
    at = {c: cols.index(c) for c in COLUMNS if c in cols}
    today = today_prices(payload, national)
    out = []
    for k, r in enumerate(payload["rows"]):
        row = []
        for c in COLUMNS:
            v = today[c][k] if c in today else r[at[c]] if c in at else None
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
    payloads = {path.stem: json.loads(path.read_text()) for path in local}
    # The national ratio for counties with no Zillow at all: the median over every ZIP here.
    national = {}
    for census, zillow in TODAY.items():
        all_ratios = [x for p in payloads.values() for x in zip_ratios(p, census, zillow).values()]
        national[census] = _median(all_ratios) or 1.0
        log.info("%s: national Zillow/Census ratio %.2f over %d ZIPs", census, national[census], len(all_ratios))
    for fips, p in payloads.items():
        rows[fips] = _rows_from_county(p, national)
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
