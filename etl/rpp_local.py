"""
Cost of living below the metro: each county's own rents in BEA's index.

    python -m etl.rpp_local --published   # re-localize public/data/counties.json in place
    python -m etl.rpp_local --check       # print the fit and the check, write nothing

WHY (plan §9 Phase 10a, 2026-10-12)
    BEA publishes RPP for metros and states only (etl/sources/bea.py), so every
    county outside a metro took its whole state's index — a blend that includes
    the state's metros. That isn't just coarse, it orders places wrongly: Teton
    County, WY (Jackson, median home $1.37M) read 92.7, cheaper than four in five
    US areas, because Wyoming as a whole is cheap. Non-metro counties averaged
    95.3 against BEA's own national non-metro figure of 88.7.

THE METHOD (Working Master Plan §4 "Making cost of living work below metro level")
    Housing rents are the part that varies within a metro or state, and the part
    we can see by county: BEA builds its rents index from ACS rents.

    1. Parent: the county's metro (rpp_geo_level "metro"), or its state. A
       state's index covers all of its counties, so its reference rent is taken
       over all of them.
    2. Rents:  rents_county = rents_parent × (rent_county / rent_parent) ** b
       rent_parent is the population-weighted geometric mean of the parent's
       county ACS rents; b is fitted across metros (log RPP rents on log rent).
    3. All items: all_county = all_parent × (rents_county / rents_parent) ** g
       g is fitted across metros (log RPP all items on log RPP rents). It carries
       what moves with rent — local services, mostly — not just the rent share.
    4. A county with no ACS rent keeps its parent's values.

    Both exponents come from BEA's published metro values in this run, never typed
    in. Parents keep their published level: a metro's counties average back to
    the metro's figure (the "releveled" idea of the Commerce working paper, §4).

THE CHECK
    BEA publishes one non-metro figure, for the whole country (GeoFips 00999).
    The method is not fitted to it, so the population-weighted mean of the
    localized non-metro counties landing near it is an honest test. 2026-10-12:
    89.1 against BEA's 88.7 for all items (was 95.3), 62.6 against 59.9 for rents.

COLUMNS
    rpp_all, rpp_rents         localized (what the app ranks and shows)
    rpp_all_parent,            the parent's published BEA values, kept so the
    rpp_rents_parent           step is repeatable on a published file and
                               auditable ("Wyoming 92.7, Teton 107.8")
    real_income                recomputed from the localized rpp_all
"""

from __future__ import annotations

import argparse
import json
import sys

import numpy as np
import pandas as pd

from . import config
from .util import get_logger

log = get_logger("rpp_local")

# BEA's national non-metro portion: the check, read live by `national_nonmetro()`.
NONMETRO_GEOFIPS = "00999"


def _parent(df: pd.DataFrame) -> pd.Series:
    return np.where(df["rpp_geo_level"] == "metro", "M:" + df["rpp_source_geo"].astype(str), "S:" + df["state"])


def _log_rent_mean(g: pd.DataFrame) -> float:
    g = g[g["median_gross_rent"] > 0]
    if g.empty:
        return np.nan
    w = g["population"].fillna(0).clip(lower=1)
    return float(np.exp(np.average(np.log(g["median_gross_rent"]), weights=w)))


def localize(df: pd.DataFrame) -> pd.DataFrame:
    """Localized rpp_rents / rpp_all (and real_income); see the module docstring."""
    df = df.copy()
    need = {"rpp_all", "rpp_rents", "rpp_geo_level", "rpp_source_geo", "state", "median_gross_rent", "population"}
    if not need <= set(df.columns):
        log.warning("rpp_local: missing %s — left as published", sorted(need - set(df.columns)))
        return df

    # The published (parent) values: from an earlier run if there was one, so this is idempotent.
    for col in ("rpp_all", "rpp_rents"):
        if f"{col}_parent" not in df.columns:
            df[f"{col}_parent"] = df[col]
    parent = pd.Series(_parent(df), index=df.index)
    known = df["rpp_all_parent"].notna()

    ref: dict[str, float] = {}
    for key in parent[known].unique():
        members = df[df["state"] == key[2:]] if key.startswith("S:") else df[parent == key]
        ref[key] = _log_rent_mean(members)
    rent_ref = parent.map(ref)

    metros = df[known & (df["rpp_geo_level"] == "metro")].assign(parent=parent, ref=rent_ref)
    metros = metros.groupby("parent").agg(rents=("rpp_rents_parent", "first"), all=("rpp_all_parent", "first"),
                                          ref=("ref", "first")).dropna()
    if len(metros) < 5:
        log.warning("rpp_local: %d metros with rents — too few to fit; left as published", len(metros))
        return df
    b = float(np.polyfit(np.log(metros["ref"]), np.log(metros["rents"]), 1)[0])
    g = float(np.polyfit(np.log(metros["rents"]), np.log(metros["all"]), 1)[0])
    log.info("fitted over %d metros: rents elasticity to ACS rent b=%.3f, all items to rents g=%.3f", len(metros), b, g)
    if not (0.5 < b < 2.0 and 0.05 < g < 0.6):
        # Far outside what BEA's metros show (b≈1.2, g≈0.2): the inputs are wrong, so
        # nothing is localized and validate.py's checks see the published values.
        log.warning("rpp_local: implausible fit (b=%.3f, g=%.3f) — left as published", b, g)
        return df

    ratio = df["median_gross_rent"].where(df["median_gross_rent"] > 0) / rent_ref
    rents = df["rpp_rents_parent"] * ratio**b
    df["rpp_rents"] = rents.fillna(df["rpp_rents_parent"])
    df["rpp_all"] = (df["rpp_all_parent"] * (df["rpp_rents"] / df["rpp_rents_parent"]) ** g).fillna(df["rpp_all_parent"])
    if "median_household_income" in df.columns:
        rpp = df["rpp_all"].where(df["rpp_all"] > 0)
        df["real_income"] = df["median_household_income"] / (rpp / 100.0)

    non = df[(df["rpp_geo_level"] != "metro") & df["rpp_all"].notna()]
    if not non.empty:
        w = non["population"].fillna(0).clip(lower=1)
        log.info("non-metro counties, population-weighted: all items %.1f (was %.1f), rents %.1f (was %.1f)",
                 np.average(non["rpp_all"], weights=w), np.average(non["rpp_all_parent"], weights=w),
                 np.average(non["rpp_rents"], weights=w), np.average(non["rpp_rents_parent"], weights=w))
    return df


def national_nonmetro(year: int | None = None) -> dict[str, float] | None:
    """BEA's national non-metro portion (all items, rents) for the check, or None without a key."""
    if not config.BEA_API_KEY:
        return None
    from .sources import bea

    start = year or config.BEA_YEAR
    for candidate in range(start, start - bea.MAX_VINTAGE_LOOKBACK - 1, -1):
        out = {}
        for line, name in ((1, "rpp_all"), (3, "rpp_rents")):
            try:
                body = bea._bea_request({"method": "GetData", "datasetname": "Regional",
                                         "TableName": "MARPP", "LineCode": str(line),
                                         "GeoFips": NONMETRO_GEOFIPS, "Year": str(candidate)})
            except RuntimeError:
                break
            rows = body.get("Data", [])
            if rows:
                out[name] = float(rows[0]["DataValue"])
        if len(out) == 2:
            log.info("BEA national non-metro portion, %d: %s", candidate, out)
            return out
    return None


def _published_frame() -> tuple[dict, pd.DataFrame]:
    payload = json.loads(config.PUBLISH_PATH.read_text(encoding="utf-8"))
    return payload, pd.DataFrame(payload["rows"], columns=payload["columns"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument("--published", action="store_true", help="Re-localize public/data/counties.json in place")
    parser.add_argument("--check", action="store_true", help="Report only; write nothing")
    args = parser.parse_args()
    if not (args.published or args.check):
        parser.print_help()
        return 2

    from .build import to_app_payload

    _, df = _published_frame()
    out = localize(df)
    check = national_nonmetro()
    non = out[out["rpp_geo_level"] != "metro"]
    w = non["population"].fillna(0).clip(lower=1)
    mine = {c: float(np.average(non[c].dropna(), weights=w[non[c].notna()])) for c in ("rpp_all", "rpp_rents")}
    print(f"non-metro, population-weighted: all items {mine['rpp_all']:.1f}, rents {mine['rpp_rents']:.1f}"
          + (f"  |  BEA national non-metro: {check['rpp_all']:.1f}, {check['rpp_rents']:.1f}" if check else ""))
    for fips in ("56039", "08097", "16013", "25019", "36061", "36005"):
        r = out[out["fips"] == fips]
        if len(r):
            r = r.iloc[0]
            print(f"  {r['county_name']}, {r['state']}: {r['rpp_all_parent']:.1f} -> {r['rpp_all']:.1f}")
    if args.check:
        return 0
    if (out["rpp_all"] == out["rpp_all_parent"]).all():
        print("Nothing was localized — not published.")
        return 1
    if check and abs(mine["rpp_all"] - check["rpp_all"]) > 3:
        print("Non-metro mean is more than 3 points from BEA's figure — not published.")
        return 1
    payload = to_app_payload(out)
    config.PUBLISH_PATH.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(f"Published {config.PUBLISH_PATH.relative_to(config.ETL_DIR.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
