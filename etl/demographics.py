"""
Who lives here (owner, 2026-10-04: "a sense of what kind of people are there"):
race and Hispanic origin, a diversity index, and income inequality. Census ACS 5-year,
the same vintage as the rest; counties (sources/acs.py) and areas (tracts/acs.py)
derive them here so both levels mean the same thing.

    B03002  Hispanic or Latino origin by race. Five groups that add to everyone:
            Hispanic or Latino (any race), and non-Hispanic White, Black, Asian, and
            everyone else (American Indian and Alaska Native, Native Hawaiian and Pacific
            Islander, another race, two or more races).
    B19083  Gini index of household income: 0 = every household has the same income,
            1 = one household has it all. US ≈ 0.48; most areas 0.35–0.50.

DIVERSITY INDEX = the chance, 0–100, that two residents picked at random are in different
groups (1 − Σ share², the Simpson index used by the Census Bureau and USA Today's index).
0: everyone in one group. With five groups the most it can be is 80.

Shown as context on the area and county pages — not a filter (see the plan, §9 "Filters
tightened", for why that is the owner's decision).
"""

from __future__ import annotations

import pandas as pd

# ACS variable (without the E/M suffix) -> column, both levels.
RACE_VARIABLES = {
    "B03002_001": "race_total",
    "B03002_003": "race_white_nh",
    "B03002_004": "race_black_nh",
    "B03002_005": "race_aian_nh",
    "B03002_006": "race_asian_nh",
    "B03002_007": "race_nhpi_nh",
    "B03002_008": "race_other_nh",
    "B03002_009": "race_two_plus_nh",
    "B03002_012": "race_hispanic",
}
GINI_VARIABLE = {"B19083_001": "gini_index"}

# Output share -> the counts it sums.
GROUPS = {
    "hispanic_share": ["race_hispanic"],
    "white_share": ["race_white_nh"],
    "black_share": ["race_black_nh"],
    "asian_share": ["race_asian_nh"],
    "other_race_share": ["race_aian_nh", "race_nhpi_nh", "race_other_nh", "race_two_plus_nh"],
}
COLUMNS = [*GROUPS, "diversity_index", "gini_index"]


def derive(counts: pd.DataFrame) -> pd.DataFrame:
    """Shares (0–100) and the diversity index from the race counts; gini_index passed
    through. No people: all unknown."""
    total = counts["race_total"].where(counts["race_total"] > 0)
    out = pd.DataFrame(index=counts.index)
    for share, parts in GROUPS.items():
        out[share] = 100 * counts[parts].sum(axis=1, min_count=1) / total
    p = out[list(GROUPS)] / 100
    out["diversity_index"] = 100 * (1 - (p**2).sum(axis=1, min_count=1))
    out.loc[total.isna(), "diversity_index"] = float("nan")
    out["gini_index"] = counts["gini_index"] if "gini_index" in counts else float("nan")
    return out
