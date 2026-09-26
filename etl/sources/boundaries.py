"""
SOURCE: Census cartographic boundary files — county shapes for the map.

WHAT THIS PRODUCES
    data/interim/counties.topo.json — one TopoJSON with two layers that share
    arcs:
        counties   one polygon per county, property GEOID (the 5-char FIPS)
        states     counties dissolved by STATEFP, for drawing state outlines

    Unlike the other sources this is not a table and is not joined: the app
    loads it beside counties.json and joins shapes to scores client-side by
    GEOID. build.py validates that the two files cover exactly the same
    counties, then publishes it to public/data/counties.topo.json.

WHY CARTOGRAPHIC BOUNDARIES, 2024
    The cartographic ("cb") files are clipped to the shoreline, so coastal
    counties look like land rather than extending into the sea as the TIGER
    legal boundaries do. The 2024 vintage uses Connecticut's planning regions,
    so its GEOIDs match the spine exactly — measured 2026-09-26: 3,114 = 3,114,
    no crosswalk.

WHY MAPSHAPER, VIA NPX
    Simplification with shared-arc topology (neighbouring counties stay
    gap-free) and a TopoJSON writer, in one well-tested tool. It is Node, so it
    runs through `npx`, pinned to MAPSHAPER_VERSION — build-time only, nothing
    reaches the app bundle. Requires Node on the machine running the ETL.

SIZE
    500k source simplified to 5% (keep-shapes, so no small county vanishes):
    ~810 KB, ~245 KB gzipped — under Serwist's 2 MB precache cap, so the
    county map works offline. One file serves every zoom level (plan §11).

RUN STANDALONE
    python -m etl.sources.boundaries
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from .. import config
from ..util import get_logger, http_get
from .spine import EXCLUDED_STATES, TERRITORY_PREFIXES

log = get_logger("source.boundaries")


def output_path() -> Path:
    """Resolved at call time, so tests that redirect config.INTERIM_DIR are honoured."""
    return config.INTERIM_DIR / "counties.topo.json"


def _mapshaper_args(src: Path, out: Path) -> list[str]:
    dropped = sorted(EXCLUDED_STATES | TERRITORY_PREFIXES)
    return [
        "npx", "-y", f"mapshaper@{config.MAPSHAPER_VERSION}",
        "-i", str(src),
        # Same exclusions as the spine, so shapes and data cover the same counties.
        "-filter", f"!{json.dumps(dropped)}.includes(STATEFP)",
        "-simplify", config.BOUNDARY_SIMPLIFY, "keep-shapes",
        "-filter-fields", "GEOID,STATEFP",
        "-rename-layers", "counties",
        "-dissolve", "STATEFP", "+", "name=states",
        "-o", "target=*", "format=topojson", "quantization=1e5", str(out),
    ]


def topo_geoids(path: Path | None = None) -> set[str]:
    """GEOIDs in the counties layer of a written TopoJSON."""
    topo = json.loads((path or output_path()).read_text(encoding="utf-8"))
    return {g["properties"]["GEOID"] for g in topo["objects"]["counties"]["geometries"]}


def fetch() -> Path:
    if shutil.which("npx") is None:
        raise RuntimeError("npx not found. The boundary step runs mapshaper through Node; "
                           "install Node (the app already needs it) and re-run.")

    log.info("fetching county cartographic boundaries (%s)", config.BOUNDARY_URL)
    blob = http_get(config.BOUNDARY_URL, binary=True, cache_hint="cb_county_boundaries")
    assert isinstance(blob, bytes)
    # mapshaper reads the zipped shapefile directly; it just needs a real path.
    src = config.RAW_DIR / Path(config.BOUNDARY_URL).name
    if not src.exists() or src.stat().st_size != len(blob):
        src.write_bytes(blob)

    out = output_path()
    tmp = out.with_suffix(".tmp.json")
    log.info("simplifying to %s with mapshaper %s", config.BOUNDARY_SIMPLIFY, config.MAPSHAPER_VERSION)
    result = subprocess.run(_mapshaper_args(src, tmp), capture_output=True, text=True)
    if result.returncode != 0 or not tmp.exists():
        raise RuntimeError(f"mapshaper failed (exit {result.returncode}):\n{result.stderr[-2000:]}")
    tmp.replace(out)

    topo = json.loads(out.read_text(encoding="utf-8"))
    counts = {k: len(v["geometries"]) for k, v in topo["objects"].items()}
    log.info("wrote %s (%d KB): %s", out.name, out.stat().st_size // 1024, counts)
    return out


def main() -> None:
    fetch()


if __name__ == "__main__":
    main()
