"""
SOURCE: Census ACS 5-year estimates, by tract — the heart of "inside the county".

WHAT THIS PRODUCES (one row per tract)
    geoid, population,
    median_home_value, median_household_income, per_capita_income,
    median_gross_rent,
    median_year_built, median_age,
    highrise_share        % of housing units in buildings of 20+ units
    single_family_share   % of units that are detached single-family homes
    owner_share           % of occupied homes that are owner-occupied
    kids_share            % of households with someone under 18
    bachelors_share       % of adults 25+ with a bachelor's degree or higher
    work_from_home_share  % of workers who work from home
    group_quarters_share  % of people living in group quarters (barracks, dorms,
                          prisons, nursing homes) — mostly that, and an area isn't
                          a place to move to (results audit, 2026-10-04)
    mobile_home_share     % of owner-occupied homes that are mobile homes — the
                          home value then isn't a house price
    commute_minutes       mean one-way commute of those who don't
    low_confidence        ";"-separated list of the columns above whose
                          margin of error is too wide to trust (see below)
    + a *_moe column for each value, for the app's caution-icon details

MARGINS OF ERROR
    Every estimate comes with a 90% margin of error (the ...M variables). Small
    tracts sample few households, so margins get wide. Medians and ratios are
    flagged when their coefficient of variation (MOE / 1.645 / estimate) passes
    config.TRACT_MAX_CV; shares when their MOE passes TRACT_MAX_SHARE_MOE
    percentage points. Derived MOEs use the Census Bureau's approximations
    (ACS General Handbook, ch. 8): sums in quadrature, proportions, ratios.

TOP-CODES
    Median home value is top-coded at $2,000,001 and rent at $3,501 ("that
    much or more"). Kept as the value, and noted in `topcoded`.

RUN STANDALONE
    python -m etl.tracts.acs 48453
"""

from __future__ import annotations

import functools
import hashlib
import json
import sys

import numpy as np
import pandas as pd

from .. import config
from ..util import BadResponse, clean_census_nulls, expect_json, get_logger, http_get

log = get_logger("tracts.acs")

# The share and ratio columns: output -> (numerator columns, denominator column)
SHARES = {
    "highrise_share": (["units_20_49", "units_50_plus"], "units_total"),
    "single_family_share": (["units_1_detached"], "units_total"),
    "owner_share": (["tenure_owner"], "tenure_total"),
    "kids_share": (["households_with_kids"], "households"),
    "bachelors_share": (["edu_bachelors", "edu_masters", "edu_professional", "edu_doctorate"], "adults_25_plus"),
    "work_from_home_share": (["workers_from_home"], "workers"),
    "group_quarters_share": (["group_quarters"], "population"),
    "mobile_home_share": (["owner_mobile_homes"], "owner_occupied"),
}
MEDIANS = ["median_home_value", "median_household_income", "per_capita_income", "median_gross_rent",
           "median_year_built", "median_age"]


# The Census API takes at most 50 variables per call (estimate and MOE each count).
MAX_VARIABLES_PER_CALL = 48


@functools.lru_cache(maxsize=4)
def _state_raw(state: str) -> pd.DataFrame:
    """Every tract in a state (cached on disk and per run): one Census API call per chunk
    of variables, joined on the tract."""
    names = [f"{v}{s}" for v in config.ACS_TRACT_VARIABLES for s in ("E", "M")]
    keys = ["state", "county", "tract"]

    def _check(payload: object) -> None:
        rows = expect_json(payload)
        if not isinstance(rows, list) or len(rows) < 2 or not isinstance(rows[0], list):
            raise BadResponse(f"Census API returned no tract rows: {str(rows)[:200]}")

    url = f"{config.CENSUS_API_BASE}/{config.ACS_YEAR}/acs/acs5"
    out: pd.DataFrame | None = None
    for k in range(0, len(names), MAX_VARIABLES_PER_CALL):
        chunk = names[k : k + MAX_VARIABLES_PER_CALL]
        params = {"get": ",".join(chunk), "for": "tract:*", "in": f"state:{state} county:*"}
        if config.CENSUS_API_KEY:
            params["key"] = config.CENSUS_API_KEY
        # The chunk's own variables are in the cache key: adding a variable shifts what each
        # chunk holds, and a key by position alone would hand back a stale chunk.
        tag = hashlib.sha1(",".join(chunk).encode()).hexdigest()[:8]
        body = http_get(url, params=params, cache_hint=f"acs5_{config.ACS_YEAR}_tracts_{state}_{k // MAX_VARIABLES_PER_CALL}_{tag}",
                        check=_check)
        assert isinstance(body, str)
        header, *rows = json.loads(body)
        part = pd.DataFrame(rows, columns=header)
        out = part if out is None else out.merge(part, on=keys, how="outer")
    assert out is not None
    return out


def _share_moe(num: pd.Series, num_moe: pd.Series, den: pd.Series, den_moe: pd.Series) -> pd.Series:
    """MOE of a proportion num/den (Census handbook); falls back to the ratio form
    when the proportion formula's radicand goes negative."""
    p = num / den
    rad = num_moe**2 - p**2 * den_moe**2
    ratio = num_moe**2 + p**2 * den_moe**2
    return np.sqrt(rad.where(rad >= 0, ratio)) / den


def parse(raw: pd.DataFrame) -> pd.DataFrame:
    """Census API rows -> one tidy row per tract (see module docstring)."""
    geoid = raw["state"] + raw["county"] + raw["tract"]
    est = pd.DataFrame({name: clean_census_nulls(pd.to_numeric(raw[f"{v}E"], errors="coerce"))
                        for v, name in config.ACS_TRACT_VARIABLES.items()})
    moe_raw = pd.DataFrame({name: pd.to_numeric(raw[f"{v}M"], errors="coerce")
                            for v, name in config.ACS_TRACT_VARIABLES.items()})
    # MOE codes: -555555555 = "controlled, no sampling error" -> 0. Any other
    # negative code means the MOE couldn't be computed (too few samples, an
    # open-ended median) -> unknown, which counts as low confidence below.
    moe = moe_raw.where(moe_raw >= 0).mask(moe_raw == -555555555, 0.0)

    out = pd.DataFrame({"geoid": geoid, "population": est["population"]})
    flags: list[list[str]] = [[] for _ in range(len(out))]

    def flag(mask: pd.Series, col: str) -> None:
        for i in np.flatnonzero(mask.fillna(False).to_numpy()):
            flags[i].append(col)

    topped = pd.DataFrame({c: est[c] >= cap for c, cap in config.ACS_TOPCODE.items()})
    for col in MEDIANS:
        out[col] = est[col]
        out[f"{col}_moe"] = moe[col]
        cv = moe[col] / 1.645 / est[col]
        # An estimate whose MOE couldn't be computed is low confidence too,
        # unless it is top-coded ("$2M or more" has no MOE by design).
        no_moe = est[col].notna() & moe[col].isna() & ~topped.get(col, pd.Series(False, index=est.index))
        flag((cv > config.TRACT_MAX_CV) | no_moe, col)

    for col, (nums, den) in SHARES.items():
        num = est[nums].sum(axis=1, min_count=1)
        num_moe = np.sqrt((moe[nums] ** 2).sum(axis=1, min_count=1))
        denom = est[den].where(est[den] > 0)
        out[col] = 100 * num / denom
        out[f"{col}_moe"] = 100 * _share_moe(num, num_moe, denom, moe[den])
        flag(out[f"{col}_moe"] > config.TRACT_MAX_SHARE_MOE, col)

    commuters = (est["workers"] - est["workers_from_home"]).where(lambda s: s > 0)
    commuters_moe = np.sqrt(moe["workers"] ** 2 + moe["workers_from_home"] ** 2)
    r = est["commute_minutes_total"] / commuters
    out["commute_minutes"] = r
    out["commute_minutes_moe"] = np.sqrt(moe["commute_minutes_total"] ** 2 + r**2 * commuters_moe**2) / commuters
    flag(out["commute_minutes_moe"] / 1.645 / r > config.TRACT_MAX_CV, "commute_minutes")

    # Who lives here (2026-10-04, etl/demographics.py): shares by race and Hispanic origin
    # and the diversity index — context on the area page, never flagged (small areas'
    # margins are wide; the page says so); the Gini index flagged like a median.
    from ..demographics import derive

    for col, values in derive(est).items():
        out[col] = values
    gini_cv = moe["gini_index"] / 1.645 / est["gini_index"]
    flag(gini_cv > config.TRACT_MAX_CV, "gini_index")

    out["topcoded"] = [";".join(c for c in topped.columns if topped.at[i, c]) for i in est.index]
    out["low_confidence"] = [";".join(f) for f in flags]
    # Tracts with no people (parks, airports, water) carry no estimates worth showing.
    return out.reset_index(drop=True)


def _fetch_raw(county_fips: str) -> pd.DataFrame:
    raw = _state_raw(county_fips[:2])
    return raw[raw["county"] == county_fips[2:]].reset_index(drop=True)


def fetch(county_fips: str) -> pd.DataFrame:
    df = parse(_fetch_raw(county_fips))
    lowc = (df["low_confidence"] != "").sum()
    log.info("ACS %s: %d tracts for %s; %d have a low-confidence value",
             config.ACS_YEAR, len(df), county_fips, lowc)
    return df


if __name__ == "__main__":
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    df = fetch(fips)
    print(df.drop(columns=[c for c in df.columns if c.endswith("_moe")]).describe().T.round(1).to_string())
