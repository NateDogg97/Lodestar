"""
The acceptance gate for PM2.5 (plan §9 Phase 11, "Acceptance gate", bars decided 2026-10-13).

    python -m etl.pollution.gate     # -> data/out/pm25_gate.md, and the numbers printed

Checks, on the 2022–2024 V6.GL.03 surface:
    monitor    every EPA monitor with 2+ complete years: the surface at the monitor against
               its measured mean. Bar: |bias| <= 0.5 and RMSE <= 2.0 µg/m³ (in-sample: ACAG
               calibrated on these monitors; its own out-of-sample RMSE is 1.7–2.3).
    contrast   pairs of monitors known to differ: the surface's gap has the monitors' sign
               and at least half their size.
    dilution   in the pilot counties, each area's population-weighted value from blocks
               against one point (its population center's cell) and its polygon's mean.
    edge       a county run alone gives its areas the national run's values (rule 6).
    coverage   share of the pilot states' residents with a value (rule 9).
    doubt      the contrast failures' remedy (owner, 2026-10-13): monitors over the surface
               by > 2 µg/m³, and the share of each pilot county's residents within 5 mi of
               one — each failed pair's hot side must be covered.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .. import config
from ..util import get_logger
from .exposure import exposure
from .doubt import DOUBT_GAP, DOUBT_MILES, disagreeing
from .grid import Grid
from .pm25 import compute, surface

log = get_logger("pollution.gate")

PILOT_STATES = ["26", "42", "48", "06", "56"]
PILOT_COUNTIES = {"42003": "Allegheny, PA", "48201": "Harris, TX", "06029": "Kern, CA", "56039": "Teton, WY",
                  "26161": "Washtenaw, MI", "56007": "Carbon, WY (rural, no PM2.5 monitor)"}
# (hot, clean, what the pair tests)
PAIRS = [
    ("42-003-0064", "42-003-0067", "Allegheny: Liberty (Clairton coke works) vs South Fayette"),
    ("48-201-0046", "48-201-0066", "Harris: North Wayside (ship channel side) vs Westhollow (west Houston)"),
    ("06-029-0016", "06-083-0011", "Kern vs the coast: Bakersfield-Airport vs Santa Barbara"),
    ("06-029-0016", "06-029-0018", "Inside Kern: Bakersfield-Airport vs Ridgecrest (desert)"),
    ("06-063-1010", "32-031-0031", "Wood-smoke valley: Portola, CA vs Reno, NV"),
]
LOWER_48_EXCLUDE = ("02", "15", "72", "78", "80")
BIAS_BAR, RMSE_BAR, CONTRAST_SHARE = 0.5, 2.0, 0.5


def monitor_check(grid: Grid, monitors: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    m = monitors[~monitors["site"].str[:2].isin(LOWER_48_EXCLUDE)].copy()
    m["model"] = grid.sample(m["lat"].to_numpy(), m["lon"].to_numpy())
    m = m.dropna(subset=["model"])
    d = m["model"] - m["pm25"]
    stats = {"monitors": len(m), "bias": float(d.mean()), "rmse": float(np.sqrt((d**2).mean())),
             "mae": float(d.abs().mean()), "r": float(np.corrcoef(m["model"], m["pm25"])[0, 1])}
    stats["pass"] = abs(stats["bias"]) <= BIAS_BAR and stats["rmse"] <= RMSE_BAR
    return stats, m.assign(error=d)


def contrast_check(m: pd.DataFrame) -> pd.DataFrame:
    by = m.set_index("site")
    rows = []
    for hot, clean, what in PAIRS:
        if hot not in by.index or clean not in by.index:
            rows.append({"pair": what, "measured": np.nan, "model": np.nan, "pass": False})
            continue
        measured = by.at[hot, "pm25"] - by.at[clean, "pm25"]
        model = by.at[hot, "model"] - by.at[clean, "model"]
        ok = np.sign(model) == np.sign(measured) and abs(model) >= CONTRAST_SHARE * abs(measured)
        rows.append({"pair": what, "measured": round(measured, 2), "model": round(model, 2), "pass": bool(ok)})
    return pd.DataFrame(rows)


def dilution_check(grid: Grid, blocks: pd.DataFrame, tracts: pd.DataFrame) -> pd.DataFrame:
    """Per pilot county: how far one point, and the polygon mean, are from the blocks' value."""
    import json

    import shapely

    from ..tracts.geo import _state_tracts
    from ..tracts.publish import PUBLISH_DIR

    rows = []
    for fips, label in PILOT_COUNTIES.items():
        path = PUBLISH_DIR / f"{fips}.json"
        payload = json.loads(path.read_text()) if path.exists() else None
        t = tracts[tracts["tract"].str[:5] == fips].set_index("tract")
        if payload is None or t.empty:
            continue
        cols = payload["columns"]
        pts = {r[cols.index("geoid")]: (r[cols.index("pop_lat")], r[cols.index("pop_lon")]) for r in payload["rows"]}
        shapes = {f["properties"]["GEOID"]: shapely.geometry.shape(f["geometry"]) for f in _state_tracts(fips[:2])
                  if f["properties"]["GEOID"].startswith(fips)}
        point_d, poly_d = [], []
        for g, row in t.iterrows():
            if np.isnan(row["pm25"]) or g not in pts or g not in shapes:
                continue
            lat, lon = pts[g]
            point_d.append(abs(row["pm25"] - grid.sample(np.array([lat]), np.array([lon]))[0]))
            minx, miny, maxx, maxy = shapes[g].bounds
            ys = np.arange(np.floor((miny - grid.lat0) / grid.dlat), np.ceil((maxy - grid.lat0) / grid.dlat) + 1) * grid.dlat + grid.lat0
            xs = np.arange(np.floor((minx - grid.lon0) / grid.dlon), np.ceil((maxx - grid.lon0) / grid.dlon) + 1) * grid.dlon + grid.lon0
            xx, yy = np.meshgrid(xs, ys)
            inside = shapely.contains_xy(shapes[g], xx.ravel(), yy.ravel())
            vals = grid.sample(yy.ravel()[inside], xx.ravel()[inside])
            vals = vals[~np.isnan(vals)]
            if len(vals):
                poly_d.append(abs(row["pm25"] - vals.mean()) / row["pm25"])
        rows.append({"county": label, "areas": len(t), "point: median |Δ|": round(float(np.median(point_d)), 2),
                     "point: max |Δ|": round(float(np.max(point_d)), 2),
                     "polygon mean off >10%": f"{sum(x > 0.10 for x in poly_d)} of {len(poly_d)}",
                     "polygon: max off": f"{100 * max(poly_d):.0f}%"})
    return pd.DataFrame(rows)


def edge_check(blocks: pd.DataFrame, tracts: pd.DataFrame) -> bool:
    one = blocks[blocks["county"] == "42003"]
    alone, _ = exposure(one, one["pm25"].to_numpy(), "pm25", benchmark=9.0)
    national = tracts.set_index("tract").loc[alone["tract"], "pm25"]
    return bool(np.allclose(alone["pm25"].to_numpy(), national.to_numpy(), equal_nan=True))


def doubt_check(grid: Grid, monitors: pd.DataFrame, blocks: pd.DataFrame, tracts: pd.DataFrame,
                counties: pd.DataFrame, contrast: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, bool]:
    """(pilot counties' doubt, the failed pairs' hot monitors and their area's doubt, all covered)."""
    from .doubt import within

    d = disagreeing(monitors, grid)
    c = counties[counties["county"].isin(PILOT_COUNTIES)].assign(name=lambda x: x["county"].map(PILOT_COUNTIES))
    by_county = d.groupby("county").size()
    c = c.assign(monitors_over=c["county"].map(by_county).fillna(0).astype(int))[
        ["name", "pm25", "pm25_doubt", "monitors_over"]]
    rows = []
    for (hot, _, what), ok in zip(PAIRS, contrast["pass"]):
        if ok:
            continue
        mon = monitors[monitors["site"] == hot].iloc[0]
        here = within(np.array([mon["lat"]]), np.array([mon["lon"]]), d)[0]
        b = blocks.iloc[np.argmin((blocks["lat"] - mon["lat"]) ** 2 + (blocks["lon"] - mon["lon"]) ** 2)]
        t = tracts.set_index("tract").loc[b["tract"]]
        rows.append({"pair": what, "hot monitor": mon["name"], "its area": b["tract"], "area pm25": t["pm25"],
                     "area doubt %": t["pm25_doubt"], "flagged": bool(here and t["pm25_doubt"] > 0)})
    pairs = pd.DataFrame(rows)
    return c, pairs, bool(pairs.empty or pairs["flagged"].all())


def main() -> None:
    from .monitors import OUT as MONITORS
    from .monitors import fetch as fetch_monitors

    monitors = pd.read_csv(MONITORS, dtype={"county": str, "site": str}) if MONITORS.exists() else fetch_monitors()
    grid = surface()
    blocks, tracts, counties = compute(PILOT_STATES, grid, monitors)
    stats, m = monitor_check(grid, monitors)
    contrast = contrast_check(m)
    dilution = dilution_check(grid, blocks, tracts)
    edge = edge_check(blocks, tracts)
    coverage = 100 * blocks["pop"][blocks["pm25"].notna()].sum() / blocks["pop"].sum()
    doubt_counties, doubt_pairs, doubt_ok = doubt_check(grid, monitors, blocks, tracts, counties, contrast)
    lower48 = monitors[~monitors["site"].str[:2].isin(LOWER_48_EXCLUDE)]
    n_over = len(disagreeing(lower48, grid))
    pilot_tracts = tracts[tracts["tract"].str[:2].isin(PILOT_STATES)]
    flagged = 100 * (pilot_tracts["pm25_doubt"] > 0).mean()
    pilot = m[m["county"].isin(PILOT_COUNTIES)][["county", "name", "pm25", "model", "error"]].round(2)

    lines = ["# PM2.5 acceptance gate (V6.GL.03, 2022–2024 mean)", "",
             f"**Monitor check** ({stats['monitors']} monitors, lower 48, in-sample): bias {stats['bias']:+.2f}, "
             f"RMSE {stats['rmse']:.2f}, MAE {stats['mae']:.2f} µg/m³, r {stats['r']:.3f} — "
             f"{'PASS' if stats['pass'] else 'FAIL'} (bars |bias| ≤ {BIAS_BAR}, RMSE ≤ {RMSE_BAR})", "",
             "Pilot counties' monitors (measured, model, model − measured):", "", pilot.to_string(index=False), "",
             f"**Contrast check** (model gap ≥ {CONTRAST_SHARE:.0%} of the measured gap, same sign):", "",
             contrast.to_string(index=False), "",
             "**Dilution check** (blocks' population-weighted value vs one point, and vs the polygon mean):", "",
             dilution.to_string(index=False), "",
             f"**Edge check:** {'PASS' if edge else 'FAIL'} — Allegheny alone = national run. ",
             f"**Coverage:** {coverage:.2f}% of the pilot states' residents have a value.", "",
             f"**Doubt (the contrast remedy):** {n_over} of {len(lower48)} lower-48 monitors read over the "
             f"surface by > {DOUBT_GAP:g} µg/m³; {flagged:.1f}% of the pilot states' areas have residents within "
             f"{DOUBT_MILES:g} mi of one. Failed pairs' hot sides — {'PASS' if doubt_ok else 'FAIL'}:", "",
             doubt_pairs.to_string(index=False), "", "Pilot counties:", "", doubt_counties.to_string(index=False)]
    text = "\n".join(lines)
    out = config.OUT_DIR / "pm25_gate.md"
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
