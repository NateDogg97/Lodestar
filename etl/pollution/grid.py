"""
A regular latitude/longitude grid, sampled at points (plan §9 Phase 11, rule 1).

A point takes the value of the cell that contains it — index arithmetic on the cell
centres, never interpolation (interpolating is smoothing, the averaging bias). A cell
holding the file's no-data value, or a point outside the grid, is unknown (NaN), never
0 (rule 9): ACAG's PM2.5 files mark water and no-data cells −999.9 with no _FillValue
attribute, and the North America grid stops at 70°N.

Reads NetCDF-4 (HDF5) with h5py: the surfaces used are regular grids, so no GIS library.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

# Anything at or below this is a no-data marker, not a concentration (ACAG: −999.9).
NO_DATA_BELOW = -900.0


@dataclass
class Grid:
    values: np.ndarray  # (n_lat, n_lon), row 0 = lat0
    lat0: float  # centre of the first row
    lon0: float  # centre of the first column
    dlat: float
    dlon: float
    units: str = ""
    source: str = ""

    @classmethod
    def from_netcdf(cls, path: Path | str, variable: str) -> "Grid":
        """Load one 2-D variable and its `lat` / `lon` axes; checks the axes are regular."""
        import h5py

        with h5py.File(path, "r") as f:
            lat = np.asarray(f["lat"][:], dtype=float)
            lon = np.asarray(f["lon"][:], dtype=float)
            ds = f[variable]
            values = np.asarray(ds[:], dtype=np.float32)
            units = ds.attrs.get("units", b"")
            units = units.decode() if isinstance(units, bytes) else str(units)
        steps = {}
        for name, axis in (("lat", lat), ("lon", lon)):
            if len(axis) < 2:
                raise ValueError(f"{path}: {name} axis has fewer than 2 points")
            # Axes are often float32: judge regularity against a perfect lattice, to 1% of a cell.
            step = (axis[-1] - axis[0]) / (len(axis) - 1)
            if np.max(np.abs(axis - (axis[0] + step * np.arange(len(axis))))) > 0.01 * abs(step):
                raise ValueError(f"{path}: {name} axis is not regular — this sampler needs a regular grid")
            steps[name] = round(step, 9)
        if values.shape != (len(lat), len(lon)):
            raise ValueError(f"{path}: {variable} is {values.shape}, axes are {(len(lat), len(lon))}")
        return cls(values, round(float(lat[0]), 6), round(float(lon[0]), 6), steps["lat"], steps["lon"],
                   units=units, source=str(path))

    def sample(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        """The value of the cell containing each point; NaN outside the grid or on no-data."""
        lat = np.asarray(lat, dtype=float)
        lon = np.asarray(lon, dtype=float)
        i = np.floor((lat - self.lat0) / self.dlat + 0.5)
        j = np.floor((lon - self.lon0) / self.dlon + 0.5)
        n_lat, n_lon = self.values.shape
        inside = np.isfinite(i) & np.isfinite(j) & (i >= 0) & (i < n_lat) & (j >= 0) & (j < n_lon)
        out = np.full(lat.shape, np.nan, dtype=float)
        out[inside] = self.values[i[inside].astype(int), j[inside].astype(int)]
        out[out <= NO_DATA_BELOW] = np.nan
        return out


def mean_of(grids: list[Grid]) -> Grid:
    """Cell-by-cell mean of grids on the same lattice (a multi-year mean); a cell unknown in
    any year is unknown — a 3-year mean of 2 years isn't a 3-year mean."""
    first = grids[0]
    for g in grids[1:]:
        if (g.values.shape, g.lat0, g.lon0, g.dlat, g.dlon) != (first.values.shape, first.lat0, first.lon0, first.dlat, first.dlon):
            raise ValueError("grids differ in shape or origin; can't average cell by cell")
    # Accumulated a year at a time (a North America year is 78M cells): no stack in memory.
    total = np.zeros(first.values.shape, dtype=np.float64)
    missing = np.zeros(first.values.shape, dtype=bool)
    for g in grids:
        missing |= ~(g.values > NO_DATA_BELOW)  # NaN or the no-data marker, in any year
        total += np.where(missing, 0.0, g.values)
    mean = (total / len(grids)).astype(np.float32)
    mean[missing] = NO_DATA_BELOW - 1
    return Grid(mean, first.lat0, first.lon0, first.dlat, first.dlon, units=first.units,
                source=" + ".join(g.source for g in grids))
