"""
Reference counties: the regression check after changing shared tract code (8c).

    python -m etl.tracts.sentinels            # rebuild them, show what changed
    python -m etl.tracts.sentinels --crime    # only the crime columns, in detail

Adding a state needs only that state built. But a change to shared code (crime
matching, names, schools) can move numbers in states already live; rebuilding
every state to find out doesn't scale. Instead: rebuild these counties, each
here because it exercises a case that once went wrong, and compare with the
build that was there before. The monthly CI run then carries the change to
every live state. A state that reveals a new case adds its county here.
"""

from __future__ import annotations

import sys

import pandas as pd

from .. import config
from .build import build_county, ensure_prereqs

SENTINELS = {
    "48453": "Travis, TX — city police vs sheriff, unincorporated areas",
    "48507": "Zavala, TX — tiny rural county",
    "06037": "Los Angeles, CA — contract cities, sheriff population derived",
    "06075": "San Francisco, CA — agency only in the yearly tables",
    "06065": "Riverside, CA — El Cerrito: a CDP named like a city elsewhere",
    "36059": "Nassau, NY — county police; Hempstead village vs town",
    "36119": "Westchester, NY — Mamaroneck Town and Village",
    "36103": "Suffolk, NY — implausibly low sheriff dropped",
    "44001": "Bristol, RI — town police, no sheriff",
    "17031": "Cook, IL — the first pilot",
}
CRIME = ["crime_agency", "violent_rate", "property_rate", "crime_year", "crime_months", "crime_population"]


def _changed(old: pd.DataFrame, new: pd.DataFrame) -> dict[str, int]:
    """Column -> how many tracts' values changed (rounded, so float noise isn't a change)."""
    both = old.merge(new, on="geoid", suffixes=("_o", "_n"))
    out = {}
    for c in sorted(set(old.columns) & set(new.columns) - {"geoid"}):
        a, b = both[f"{c}_o"], both[f"{c}_n"]
        if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
            a, b = a.round(3), b.round(3)
        diff = ~((a == b) | (a.isna() & b.isna()))
        if diff.any():
            out[c] = int(diff.sum())
    for c in sorted(set(new.columns) - set(old.columns)):
        out[f"{c} (new column)"] = len(new)
    for c in sorted(set(old.columns) - set(new.columns)):
        out[f"{c} (gone)"] = len(old)
    return out


def _crime_detail(old: pd.DataFrame, new: pd.DataFrame) -> list[str]:
    def by_agency(df: pd.DataFrame) -> pd.DataFrame:
        return df.groupby(df["crime_agency"].fillna("(none)")).agg(
            tracts=("geoid", "size"), violent=("violent_rate", "first")).round(0)

    o, n = by_agency(old), by_agency(new)
    j = o.join(n, how="outer", lsuffix="_before", rsuffix="_after").fillna({"tracts_before": 0, "tracts_after": 0})
    j = j[(j["tracts_before"] != j["tracts_after"]) | (j["violent_before"] != j["violent_after"])]
    return [f"      {name}: {int(r.tracts_before)} → {int(r.tracts_after)} tracts, "
            f"violent {r.violent_before} → {r.violent_after}" for name, r in j.iterrows()]


def main() -> None:
    crime_only = "--crime" in sys.argv
    ensure_prereqs()
    for fips, why in SENTINELS.items():
        path = config.TRACT_OUT_DIR / f"{fips}.csv"
        old = pd.read_csv(path, dtype={"geoid": str}) if path.exists() else None
        new = build_county(fips).astype({"geoid": str})
        new = pd.read_csv(path, dtype={"geoid": str})  # as written, so types match the old file
        print(f"\n{fips}  {why}")
        if old is None:
            print("    (no previous build to compare)")
            continue
        changed = _changed(old[["geoid", *CRIME]] if crime_only else old,
                           new[["geoid", *CRIME]] if crime_only else new)
        print("    unchanged" if not changed else "    changed: " + ", ".join(f"{c} ({n})" for c, n in changed.items()))
        if any(c in changed for c in CRIME):
            print("\n".join(_crime_detail(old, new)))


if __name__ == "__main__":
    main()
