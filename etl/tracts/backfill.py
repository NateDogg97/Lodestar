"""
Backfill the results-audit columns into already-published area files, without a full
rebuild (2026-10-04). A full rebuild (`python -m etl.tracts.build`) produces the same
thing; this patches public/data/tracts/{fips}.json in place:

- group_quarters_share (+ _moe): % of people in barracks, dorms, prisons, nursing homes
- mobile_home_share (+ _moe): % of owner-occupied homes that are mobile homes
- low_confidence gains "mobile_homes" where most owned homes are mobile homes, and the
  ACS margin flags for the two shares
- zero violent AND zero property crime becomes no data (and loses its "crime" flag)
- crime rates become yearly rates (full audit, 2026-10-04): a partial year's counts are
  annualized, and an agency with too little to rate (crime.rate_note: few months, too few
  person-years, implausibly little for its size) loses its rate and gains `crime_note`.
- a household income at the Census cap ($250,001) is top-coded, not low confidence
  (full audit, 2026-10-04; config.ACS_TOPCODE gained the cap).
  `--offline` does only these last two, with no network.

One Census API call per state (all tracts at once), then `python -m etl.tracts.national`
to rebuild areas.json, then `python -m etl.tracts.upload`.

    python -m etl.tracts.backfill            # every published county
    python -m etl.tracts.backfill --state TX # one state
    python -m etl.tracts.backfill --offline  # only the crime and top-code rules (no network)
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict

from ..util import get_logger
from . import acs
from .build import MOBILE_HOME_SHARE
from .crime import rate_note
from .publish import PUBLISH_DIR

log = get_logger("tracts.backfill")

NEW = ["group_quarters_share", "group_quarters_share_moe", "mobile_home_share", "mobile_home_share_moe"]
SHARES = ("group_quarters_share", "mobile_home_share")


def _num(v: object, digits: int) -> float | int | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    x = round(float(v), digits)
    return int(x) if digits == 0 else x


def patch_county(payload: dict, by_geoid: dict[str, dict]) -> dict[str, int]:
    """Add the new columns and flags to one county payload, in place. Returns counts."""
    cols: list[str] = payload["columns"]
    for c in NEW:
        if c not in cols:
            cols.append(c)
            for r in payload["rows"]:
                r.append(None)
    at = {c: cols.index(c) for c in cols}
    counts = {"mobile": 0, "gq": 0, "crime_zero": 0}
    for r in payload["rows"]:
        src = by_geoid.get(r[at["geoid"]])
        flags = [f for f in (r[at["low_confidence"]] or "").split(";") if f]
        if src:
            for c in NEW:
                r[at[c]] = _num(src.get(c), 0 if c.endswith("_moe") else 1)
            # The ACS margin flags for the two new shares, as a rebuild would add them.
            for c in SHARES:
                if c in src["flags"] and c not in flags:
                    flags.append(c)
        share = r[at["mobile_home_share"]]
        if share is not None and share >= MOBILE_HOME_SHARE and r[at["median_home_value"]] is not None:
            if "mobile_homes" not in flags:
                flags.append("mobile_homes")
            counts["mobile"] += 1
        gq = r[at["group_quarters_share"]]
        if gq is not None and gq >= 50:
            counts["gq"] += 1
        if "violent_rate" in at and r[at["violent_rate"]] == 0 and r[at["property_rate"]] == 0:
            r[at["violent_rate"]] = r[at["property_rate"]] = None
            flags = [f for f in flags if f != "crime"]
            counts["crime_zero"] += 1
        r[at["low_confidence"]] = ";".join(flags)
    return counts


def patch_crime(payload: dict) -> dict[str, int]:
    """Yearly crime rates (crime.py's rule) in one published county, in place.

    The published rate was count × 100k / population for however many months the agency
    reported: × 12 / months makes it a yearly rate. Then `rate_note` decides whether the
    agency can have a rate at all. The `crime_note` column marks a file already done, so
    running twice never annualizes twice.
    """
    cols: list[str] = payload["columns"]
    counts = {"annualized": 0, "unrated": 0}
    if "violent_rate" not in cols or "crime_note" in cols:
        return counts
    cols.append("crime_note")
    for r in payload["rows"]:
        r.append(None)
    at = {c: cols.index(c) for c in cols}
    for r in payload["rows"]:
        v, p, months, pop = r[at["violent_rate"]], r[at["property_rate"]], r[at["crime_months"]], r[at["crime_population"]]
        if v is None or not months:
            continue
        scale = 12 / months
        v, p = v * scale, (p * scale if p is not None else None)
        note = rate_note(pop, months, r[at["crime_year"]], v, p)
        if note:
            r[at["violent_rate"]] = r[at["property_rate"]] = None
            r[at["crime_note"]] = note
            r[at["low_confidence"]] = ";".join(f for f in (r[at["low_confidence"]] or "").split(";") if f and f != "crime")
            counts["unrated"] += 1
        elif months < 12:
            r[at["violent_rate"]], r[at["property_rate"]] = int(round(v)), None if p is None else int(round(p))
            counts["annualized"] += 1
    return counts


def patch_topcodes(payload: dict) -> dict[str, int]:
    """Top-coded Census medians (config.ACS_TOPCODE) noted in `topcoded`, never flagged low
    confidence for the margin the Census can't compute there. Idempotent."""
    from .. import config

    cols: list[str] = payload["columns"]
    counts = {"topcoded": 0}
    if "topcoded" not in cols or "low_confidence" not in cols:
        return counts
    at = {c: cols.index(c) for c in cols}
    for r in payload["rows"]:
        for col, cap in config.ACS_TOPCODE.items():
            if col not in at or r[at[col]] is None or r[at[col]] < cap:
                continue
            topped = [t for t in (r[at["topcoded"]] or "").split(";") if t]
            flags = [f for f in (r[at["low_confidence"]] or "").split(";") if f]
            if col in topped and col not in flags:
                continue
            if col not in topped:
                topped.append(col)
            r[at["topcoded"]] = ";".join(topped)
            r[at["low_confidence"]] = ";".join(f for f in flags if f != col)
            counts["topcoded"] += 1
    return counts


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state", help="two-digit state FIPS, comma-separated (default: all published)")
    ap.add_argument("--offline", action="store_true", help="only the crime and top-code rules (no Census calls)")
    args = ap.parse_args()
    wanted = set(args.state.split(",")) if args.state else None
    files = sorted(PUBLISH_DIR.glob("[0-9][0-9][0-9][0-9][0-9].json"))
    by_state: dict[str, list] = defaultdict(list)
    for f in files:
        if wanted is None or f.stem[:2] in wanted:
            by_state[f.stem[:2]].append(f)
    total = defaultdict(int)
    if args.offline:
        for state, paths in sorted(by_state.items()):
            for path in paths:
                payload = json.loads(path.read_text())
                counts = {**patch_crime(payload), **patch_topcodes(payload)}
                if any(counts.values()):
                    path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
                for k, v in counts.items():
                    total[k] += v
        log.info("done: %d areas' rates annualized, %d left without a rate (crime_note), %d top-codes noted",
                 total["annualized"], total["unrated"], total["topcoded"])
        return
    for state, paths in sorted(by_state.items()):
        parsed = acs.parse(acs._state_raw(state))
        by_geoid = {
            g: {**{c: v for c, v in zip(NEW, vals)}, "flags": set((lc or "").split(";"))}
            for g, lc, *vals in zip(parsed["geoid"], parsed["low_confidence"], *(parsed[c] for c in NEW))
        }
        for path in paths:
            payload = json.loads(path.read_text())
            for k, v in {**patch_county(payload, by_geoid), **patch_crime(payload), **patch_topcodes(payload)}.items():
                total[k] += v
            path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
        log.info("state %s: %d counties patched", state, len(paths))
    log.info("done: %d areas mostly mobile homes, %d mostly group quarters, %d zero-crime cleared",
             total["mobile"], total["gq"], total["crime_zero"])


if __name__ == "__main__":
    main()
