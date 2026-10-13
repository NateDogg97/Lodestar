"""
Where a monitor says the surface reads too low (plan §9 Phase 11, 11c owner decision 2026-10-13).

The ~1 km surface misses local sources — Clairton's coke works, the Houston ship channel,
wood smoke in mountain valleys (11c contrast check). Where an EPA monitor measured more
than the surface gives at the monitor's own cell by over DOUBT_GAP (about one out-of-sample
RMSE), the surface is doubted for everyone within DOUBT_MILES of that monitor:

    <name>_doubt         % of a place's residents whose block is within DOUBT_MILES of such
                         a monitor. The app gives the value the low-confidence caution and
                         caps its score at "typical" (11e) — the monitor only *doubts* the
                         surface, it never *gives* a place a value (rule 5).

And for showing beside an area's value (decision 2c), never as its value:

    <name>_monitor_site / _name / _km / <name>_monitor
                         the nearest monitor to the area's population center, its distance
                         and what it measured.

A surface that reads *higher* than a monitor raises no doubt: the caution is for false
comfort, the direction that misleads a clean-air search.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..util import haversine_miles
from .grid import Grid

DOUBT_GAP = 2.0  # µg/m³; ACAG's out-of-sample RMSE is 1.7–2.3
DOUBT_MILES = 5.0


def disagreeing(monitors: pd.DataFrame, grid: Grid, gap: float = DOUBT_GAP) -> pd.DataFrame:
    """Monitors that measured more than the surface at their own cell by over `gap`."""
    m = monitors.assign(model=grid.sample(monitors["lat"].to_numpy(), monitors["lon"].to_numpy()))
    m = m.dropna(subset=["model"])
    return m[m["pm25"] - m["model"] > gap].assign(gap=lambda d: (d["pm25"] - d["model"]).round(2))


def within(lat: np.ndarray, lon: np.ndarray, points: pd.DataFrame, miles: float = DOUBT_MILES) -> np.ndarray:
    """True where (lat, lon) is within `miles` of any of `points` (lat, lon columns)."""
    out = np.zeros(len(lat), dtype=bool)
    dlat = miles / 69.0
    for plat, plon in zip(points["lat"].to_numpy(), points["lon"].to_numpy()):
        dlon = miles / (69.0 * max(np.cos(np.radians(plat)), 0.05))
        box = (np.abs(lat - plat) <= dlat) & (np.abs(lon - plon) <= dlon)
        k = np.flatnonzero(box)
        if len(k):
            out[k[haversine_miles(lat[k], lon[k], plat, plon) <= miles]] = True
    return out


def centers(blocks: pd.DataFrame, by: str) -> pd.DataFrame:
    """Each place's population center from its blocks (averaged on the sphere, so a place
    across the antimeridian doesn't land on the other side of the world)."""
    la, lo = np.radians(blocks["lat"].to_numpy()), np.radians(blocks["lon"].to_numpy())
    w = blocks["pop"].to_numpy(dtype=float)
    v = pd.DataFrame({by: blocks[by].to_numpy(), "x": w * np.cos(la) * np.cos(lo), "y": w * np.cos(la) * np.sin(lo),
                      "z": w * np.sin(la)}).groupby(by).sum()
    return pd.DataFrame({"lat": np.degrees(np.arctan2(v["z"], np.hypot(v["x"], v["y"]))),
                         "lon": np.degrees(np.arctan2(v["y"], v["x"]))}, index=v.index).reset_index()


def nearest(lat: np.ndarray, lon: np.ndarray, monitors: pd.DataFrame, chunk: int = 2000) -> tuple[np.ndarray, np.ndarray]:
    """(row of `monitors`, miles) of the nearest monitor to each point."""
    mlat, mlon = monitors["lat"].to_numpy()[None, :], monitors["lon"].to_numpy()[None, :]
    idx, dist = np.empty(len(lat), dtype=int), np.empty(len(lat))
    for s in range(0, len(lat), chunk):
        d = haversine_miles(lat[s:s + chunk, None], lon[s:s + chunk, None], mlat, mlon)
        idx[s:s + chunk] = d.argmin(axis=1)
        dist[s:s + chunk] = d[np.arange(len(d)), idx[s:s + chunk]]
    return idx, dist


def nearest_monitor(blocks: pd.DataFrame, monitors: pd.DataFrame, name: str, by: str = "tract") -> pd.DataFrame:
    """Each place's nearest monitor: site, name, distance (km) and reading."""
    c = centers(blocks, by)
    i, miles = nearest(c["lat"].to_numpy(), c["lon"].to_numpy(), monitors)
    m = monitors.iloc[i].reset_index(drop=True)
    return pd.DataFrame({by: c[by], f"{name}_monitor_site": m["site"], f"{name}_monitor_name": m["name"],
                         f"{name}_monitor_km": (1.609344 * miles).round(1), f"{name}_monitor": m["pm25"]})
