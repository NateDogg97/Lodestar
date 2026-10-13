"""
Every pollution table in one run (plan §9 Phase 11f).

    python -m etl.pollution all          # every state -> data/interim/{pm25,smoke,radon}_{tracts,counties}.csv
    python -m etl.pollution published    # the states with an area file in public/data/tracts/ (CI)
    python -m etl.pollution MI PA        # some states

Then `python -m etl.tracts.backfill --pollution` puts the columns in the area files and
`python -m etl.patch pollution` in counties.json (needs an `all` run: a county's values
are its own blocks, so a partial run would leave other states' counties stale).

A state's areas get the same values whichever states run with it: blocks never cross a
state line, and the monitor table behind the PM2.5 doubt is always national.

Inputs, all downloaded on first use and cached in data/raw/ (nothing is mirrored yet —
plan §9 Phase 11, rule 11): the 2020 PL 94-171 block files (~2–3 GB nationally), ACAG
V6.GL.03 (3 × 94 MB), EPA AirData (3 × 4 MB), NOAA HMS smoke (3,653 daily files), the OSF
radon file (30 MB) and Census's ZCTA–block file (1 GB, streamed).
"""

from __future__ import annotations

import sys

import pandas as pd

from .. import config
from ..util import get_logger
from .blocks import BY_POSTAL, STATES

log = get_logger("pollution")


def resolve(args: list[str]) -> list[str]:
    """State FIPS codes for `all`, `published` or a list of postal codes / FIPS."""
    if args in ([], ["all"]):
        return list(STATES)
    if args == ["published"]:
        from ..tracts.publish import PUBLISH_DIR

        found = sorted({p.stem[:2] for p in PUBLISH_DIR.glob("[0-9][0-9][0-9][0-9][0-9].json")} & set(STATES))
        if not found:
            raise SystemExit("no published area files in public/data/tracts/: nothing to compute")
        return found
    out = []
    for a in args:
        for s in a.split(","):
            fips = BY_POSTAL.get(s.strip().upper(), s.strip())
            if fips not in STATES:
                raise SystemExit(f"unknown state {s!r}")
            out.append(fips)
    return sorted(set(out))


def main() -> None:
    from . import pm25, radon, smoke
    from .monitors import OUT as MONITORS
    from .monitors import fetch as fetch_monitors

    states = resolve(sys.argv[1:])
    log.info("pollution for %d states", len(states))
    monitors = fetch_monitors()
    monitors.to_csv(MONITORS, index=False)
    _, tracts, counties = pm25.compute(states, monitors=monitors)
    out: dict[str, tuple[pd.DataFrame, pd.DataFrame]] = {"pm25": (tracts, counties)}
    out["smoke"] = smoke.compute(states)
    out["radon"] = radon.compute(states)
    for name, (t, c) in out.items():
        t.to_csv(config.INTERIM_DIR / f"{name}_tracts.csv", index=False)
        c.to_csv(config.INTERIM_DIR / f"{name}_counties.csv", index=False)
        log.info("%s: %d areas, %d counties", name, len(t), len(c))


if __name__ == "__main__":
    main()
