"""
Older housing — lead-paint risk, by county (plan §9 Phase 11d).

    python -m etl.pollution.lead          # -> data/interim/lead_counties.csv

WHAT THIS PRODUCES
    fips, pre1960_share, pre1980_share (% of housing units), each with its _moe, and
    lead_low_confidence ("1" when the pre-1960 margin passes TRACT_MAX_SHARE_MOE)

    Areas get the same two shares from `etl.tracts.acs` (same table, same rule).

WHAT IT IS AND ISN'T
    An old house is not a lead hazard: paint may be removed, covered or intact. The
    label is "older housing (lead-paint risk)", never "lead exposure" or a blood-lead
    claim. Lead paint was banned for homes in 1978; ACS table B25034 bins by decade, so
    the cut is 1960 (EJScreen's lead-paint indicator) with 1980 shown beside it.

WHY NOT FROM THE AREAS
    Rule 3 (counties from blocks) is about modeled surfaces averaged over space. This is a
    count of homes: the county's own ACS estimate is the same survey at a larger sample,
    with its own published margin — summing tract estimates would only widen it.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .. import config
from ..tracts.acs import SHARES, _share_moe
from ..util import BadResponse, clean_census_nulls, expect_json, get_logger, http_get

log = get_logger("pollution.lead")

OUT = config.INTERIM_DIR / "lead_counties.csv"
COLUMNS = ("pre1960_share", "pre1980_share")


def shares(est: pd.DataFrame, moe: pd.DataFrame) -> pd.DataFrame:
    """The two shares and their MOEs from B25034 counts (named as in ACS_TRACT_VARIABLES)."""
    out = pd.DataFrame(index=est.index)
    for col in COLUMNS:
        nums, den = SHARES[col]
        num = est[nums].sum(axis=1, min_count=1)
        num_moe = np.sqrt((moe[nums] ** 2).sum(axis=1, min_count=1))
        denom = est[den].where(est[den] > 0)
        out[col] = (100 * num / denom).round(1)
        out[f"{col}_moe"] = (100 * _share_moe(num, num_moe, denom, moe[den])).round(1)
    out["lead_low_confidence"] = (out["pre1960_share_moe"] > config.TRACT_MAX_SHARE_MOE).map({True: "1", False: ""})
    return out


def fetch() -> pd.DataFrame:
    names = {v: n for v, n in config.ACS_TRACT_VARIABLES.items() if v.startswith("B25034_")}
    get = ",".join(f"{v}{s}" for v in names for s in ("E", "M"))
    params = {"get": get, "for": "county:*"}
    if config.CENSUS_API_KEY:
        params["key"] = config.CENSUS_API_KEY

    def _check(payload: object) -> None:
        rows = expect_json(payload)
        if not isinstance(rows, list) or len(rows) < 3000:
            raise BadResponse(f"Census API returned too few counties: {str(rows)[:200]}")

    body = http_get(f"{config.CENSUS_API_BASE}/{config.ACS_YEAR}/acs/acs5", params=params,
                    cache_hint=f"acs5_{config.ACS_YEAR}_counties_b25034", check=_check)
    assert isinstance(body, str)
    header, *rows = json.loads(body)
    raw = pd.DataFrame(rows, columns=header)
    est = pd.DataFrame({n: clean_census_nulls(pd.to_numeric(raw[f"{v}E"], errors="coerce")) for v, n in names.items()})
    m = pd.DataFrame({n: pd.to_numeric(raw[f"{v}M"], errors="coerce") for v, n in names.items()})
    moe = m.where(m >= 0).mask(m == -555555555, 0.0)
    out = shares(est, moe)
    out.insert(0, "fips", (raw["state"] + raw["county"]).to_numpy())
    log.info("B25034 %d: %d counties; %d low confidence", config.ACS_YEAR, len(out),
             (out["lead_low_confidence"] == "1").sum())
    return out


def main() -> None:
    df = fetch()
    df.to_csv(OUT, index=False)
    print(df.describe().round(1).to_string())
    print(df[df["fips"].isin(["26161", "42003", "56039", "36047", "48201", "06029"])].to_string(index=False))


if __name__ == "__main__":
    main()
