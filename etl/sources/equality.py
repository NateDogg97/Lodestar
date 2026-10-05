"""
SOURCE: racial equality by county (owner, 2026-10-04): "different racial groups have
similar household incomes, live in similar areas…". Census ACS 5-year.

WHAT THIS PRODUCES
    fips, income_parity, integration, racial_equality

    income_parity   0–100: the lowest-earning group's median household income as a
                    share of the highest-earning group's (B19013 by race of
                    householder: White not Hispanic, Black, Asian, American Indian and
                    Alaska Native, Hispanic or Latino). Only groups with at least
                    MIN_GROUP_SHARE of the county's households, MIN_GROUP_HOUSEHOLDS
                    households, and a median whose margin of error is under
                    config.TRACT_MAX_CV count — a median from a few hundred households
                    can be off by half. Fewer than two groups: unknown.
    integration     0–100: 100 × (1 − Theil's H), the Census Bureau's entropy index of
                    residential segregation, over the county's census tracts and the
                    five groups of etl/demographics.py. 100: every neighborhood has the
                    county's mix; 0: every group lives apart. Unknown where the county
                    is nearly one group (diversity index under MIN_DIVERSITY: there's
                    nothing to integrate) or has fewer than MIN_TRACTS populated tracts.
    racial_equality the mean of the two — only when both are known (full audit of the
                    measure, 2026-10-04: with one part, small two-group counties scored
                    99–100 on a single noisy median).

WHY COUNTY-WIDE
    Both compare groups across neighborhoods; inside one census tract there's no
    "across", and income by race for a tract rests on a few dozen households.

NOT INCLUDED
    Jobs: occupation by race (C24010A–I) is sparse below big counties. Noted in the plan.

RUN STANDALONE
    python -m etl.sources.equality
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .. import config
from ..demographics import GROUPS, RACE_VARIABLES
from ..util import BadResponse, add_fips_column, clean_census_nulls, expect_json, get_logger, http_get

log = get_logger("source.equality")

MIN_GROUP_SHARE = 0.05
MIN_GROUP_HOUSEHOLDS = 100
MIN_DIVERSITY = 15.0
MIN_TRACTS = 4

# Group -> (median household income, households) by race of householder.
INCOME_GROUPS = {
    "White": ("B19013H_001E", "B19001H_001E"),
    "Black": ("B19013B_001E", "B19001B_001E"),
    "American Indian and Alaska Native": ("B19013C_001E", "B19001C_001E"),
    "Asian": ("B19013D_001E", "B19001D_001E"),
    "Hispanic or Latino": ("B19013I_001E", "B19001I_001E"),
}
ALL_HOUSEHOLDS = "B19001_001E"


def income_parity(medians: dict[str, float], households: dict[str, float], total: float,
                  moes: dict[str, float] | None = None) -> float:
    """Lowest group median / highest, ×100, over groups big enough to measure."""
    def reliable(g: str, m: float) -> bool:
        moe = (moes or {}).get(g)
        return moe is None or (not np.isnan(moe) and moe / 1.645 / m <= config.TRACT_MAX_CV)

    usable = [m for g, m in medians.items()
              if m is not None and not np.isnan(m) and m > 0
              and households.get(g, 0) >= MIN_GROUP_HOUSEHOLDS and total > 0
              and households.get(g, 0) / total >= MIN_GROUP_SHARE and reliable(g, m)]
    if len(usable) < 2:
        return float("nan")
    return 100 * min(usable) / max(usable)


def _entropy(p: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return -np.nansum(np.where(p > 0, p * np.log(p), 0.0), axis=-1)


def integration(tract_counts: np.ndarray) -> float:
    """100 × (1 − Theil's H) for one county. `tract_counts`: tracts × groups, people."""
    totals = tract_counts.sum(axis=1)
    counts = tract_counts[totals > 0]
    totals = totals[totals > 0]
    if len(counts) < MIN_TRACTS:
        return float("nan")
    county = counts.sum(axis=0)
    p = county / county.sum()
    if 100 * (1 - (p**2).sum()) < MIN_DIVERSITY:
        return float("nan")
    e = _entropy(p)
    e_t = _entropy(counts / totals[:, None])
    h = float((totals / totals.sum() * (e - e_t)).sum() / e)
    return 100 * (1 - h)


def _county_incomes() -> pd.DataFrame:
    variables = [v for pair in INCOME_GROUPS.values() for v in pair] + [ALL_HOUSEHOLDS] + [
        m.replace("_001E", "_001M") for m, _ in INCOME_GROUPS.values()]
    params = {"get": ",".join(variables), "for": "county:*", "in": "state:*"}
    if config.CENSUS_API_KEY:
        params["key"] = config.CENSUS_API_KEY

    def _check(payload: object) -> None:
        rows = expect_json(payload)
        if not isinstance(rows, list) or len(rows) < 2 or not isinstance(rows[0], list):
            raise BadResponse(f"Census API returned no county rows: {str(rows)[:200]}")

    import json

    body = http_get(f"{config.CENSUS_API_BASE}/{config.ACS_YEAR}/acs/acs5", params=params,
                    cache_hint=f"acs5_{config.ACS_YEAR}_income_by_race_v2", check=_check)
    header, *rows = json.loads(body)
    df = add_fips_column(pd.DataFrame(rows, columns=header), state_col="state", county_col="county")
    for v in variables:
        x = pd.to_numeric(df[v], errors="coerce")
        # A negative MOE is a Census code (couldn't compute): unknown, so not reliable.
        df[v] = x.where(x >= 0) if v.endswith("M") else clean_census_nulls(x)
    return df


def _county_integration() -> dict[str, float]:
    from ..tracts import acs as tract_acs
    from ..util import read_interim

    spine = read_interim("spine")
    states = sorted(spine["fips"].str[:2].unique())
    group_cols = [[f"{v}E" for v, name in RACE_VARIABLES.items() if name in parts] for parts in GROUPS.values()]
    out: dict[str, float] = {}
    for st in states:
        raw = tract_acs._state_raw(st)
        counts = np.column_stack([
            sum(clean_census_nulls(pd.to_numeric(raw[c], errors="coerce")).fillna(0) for c in cols) for cols in group_cols
        ])
        fips = (raw["state"] + raw["county"]).to_numpy()
        for f in np.unique(fips):
            out[f] = integration(counts[fips == f])
    return out


def fetch() -> pd.DataFrame:
    inc = _county_incomes()
    parity = [
        income_parity({g: r[m] for g, (m, _) in INCOME_GROUPS.items()},
                      {g: r[h] for g, (_, h) in INCOME_GROUPS.items()}, r[ALL_HOUSEHOLDS],
                      {g: r[m.replace("_001E", "_001M")] for g, (m, _) in INCOME_GROUPS.items()})
        for _, r in inc.iterrows()
    ]
    out = pd.DataFrame({"fips": inc["fips"], "income_parity": parity})
    integ = _county_integration()
    out["integration"] = out["fips"].map(integ)
    out["racial_equality"] = out[["income_parity", "integration"]].mean(axis=1, skipna=False)
    for c in ("income_parity", "integration", "racial_equality"):
        log.info("%s: %d counties known, median %.1f", c, out[c].notna().sum(), out[c].median())
    return out.sort_values("fips").reset_index(drop=True)


def main() -> None:
    df = fetch()
    print(df.describe().round(1).to_string())


if __name__ == "__main__":
    main()
