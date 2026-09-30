"""
The Phase 8a "does the data tell the story?" check (plan §9 Phase 8a).

Groups a county's tracts into downtown / north / south / east / west around a
reference point, and prints population-weighted medians of the measures the
owner described, so the numbers can be compared with what locals know.

    python -m etl.tracts.report 48453

Reference points are the pilot counties' downtowns (city halls). A QA tool
only: the app never uses these regions.
"""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd

from .. import config
from ..util import haversine_miles

# (lat, lon, downtown radius in miles)
DOWNTOWNS = {
    "48453": (30.2650, -97.7470, 2.0),   # Austin City Hall
    "17031": (41.8837, -87.6320, 1.5),   # Chicago City Hall (the Loop)
    "48507": (28.6922, -99.8281, 1.0),   # Crystal City
}

MEASURES = [
    ("median_home_value", "home value", "${:,.0f}"),
    ("median_household_income", "household income", "${:,.0f}"),
    ("per_capita_income", "income per person", "${:,.0f}"),
    ("median_gross_rent", "rent", "${:,.0f}"),
    ("density_per_sq_mi", "people/sq mi", "{:,.0f}"),
    ("highrise_share", "high-rise %", "{:.0f}%"),
    ("single_family_share", "single-family %", "{:.0f}%"),
    ("kids_share", "households w/ kids", "{:.0f}%"),
    ("median_age", "median age", "{:.0f}"),
    ("bachelors_share", "bachelor's+", "{:.0f}%"),
    ("work_from_home_share", "work from home", "{:.0f}%"),
    ("commute_minutes", "commute min", "{:.0f}"),
    ("dist_airport_mi", "to airport mi", "{:.1f}"),
    ("dist_metro_mi", "to metro ctr mi", "{:.1f}"),
    ("hazard_wildfire", "wildfire pctl", "{:.0f}"),
    ("hazard_inland_flood", "flood pctl", "{:.0f}"),
]


def region(lat: float, lon: float, ref: tuple[float, float, float]) -> str:
    if haversine_miles(lat, lon, ref[0], ref[1]) <= ref[2]:
        return "Downtown"
    # Compass bearing from downtown (flat approximation is fine at county scale).
    dy = lat - ref[0]
    dx = (lon - ref[1]) * np.cos(np.radians(ref[0]))
    deg = (np.degrees(np.arctan2(dx, dy)) + 360) % 360
    return ["North", "East", "South", "West"][int(((deg + 45) % 360) // 90)]


def weighted_median(values: pd.Series, weights: pd.Series) -> float:
    ok = values.notna() & weights.notna() & (weights > 0)
    if not ok.any():
        return float("nan")
    v, w = values[ok].to_numpy(float), weights[ok].to_numpy(float)
    order = np.argsort(v)
    cum = np.cumsum(w[order])
    return float(v[order][np.searchsorted(cum, cum[-1] / 2)])


def main() -> None:
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    df = pd.read_csv(config.TRACT_OUT_DIR / f"{fips}.csv", dtype={"geoid": str, "county_fips": str})
    ref = DOWNTOWNS[fips]
    df["region"] = [region(a, b, ref) for a, b in zip(df["pop_lat"], df["pop_lon"])]
    order = ["Downtown", "North", "South", "East", "West"]
    rows = []
    for label, grp in df.groupby("region"):
        row = {"region": label, "tracts": len(grp), "people": int(grp["population"].sum())}
        for col, name, _ in MEASURES:
            row[name] = weighted_median(grp[col], grp["population"])
        rows.append(row)
    table = pd.DataFrame(rows).set_index("region").reindex([r for r in order if r in set(df["region"])])
    fmt = {name: f for _, name, f in MEASURES}
    shown = pd.DataFrame(
        {reg: {m: ("—" if pd.isna(v) else fmt.get(m, "{:,.0f}").format(v)) for m, v in table.loc[reg].items()}
         for reg in table.index}
    )
    print(f"{config.TRACT_PILOT_COUNTIES.get(fips, fips)} — population-weighted medians by region")
    print(shown.to_string())
    print(f"\nLow confidence: {(df['low_confidence'].fillna('') != '').sum()} of {len(df)} tracts have at least one flagged value.")


if __name__ == "__main__":
    main()
