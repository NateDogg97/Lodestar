"""
Last month's pollution when a source is down (plan §9 Phase 11, 2026-10-13).

The inputs are fixed multi-year averages, downloaded each run and not mirrored (rule 11),
so one source being down — or answering with far too little — would fail the monthly
area refresh and hold back every other source's update with it. Instead:

    each run publishes its tables beside the area files
        public/data/tracts/pollution/{name}_{tracts,counties}.csv  -> R2 tracts/pollution/
    merged with the live ones, so a run over some states keeps the rest;
    a source that fails, or whose coverage collapses against the live table
    (COLLAPSE), falls back to the live tables and the run goes on;
    pollution.json says when each source was last computed, for the app to show.

The first run (nothing live yet) has nothing to fall back to and fails as before.
"""

from __future__ import annotations

import io
import json
from datetime import date

import pandas as pd

from .. import config
from ..tracts.publish import PUBLISH_DIR
from ..util import get_logger, http_get

log = get_logger("pollution.carry")

DIR = PUBLISH_DIR / "pollution"
STATUS = PUBLISH_DIR / "pollution.json"
STATUS_FORMAT = 1
KEYS = {"tracts": "tract", "counties": "county"}
# Each source's headline column: what its coverage is judged on.
MEASURE = {"pm25": "pm25", "smoke": "smoke_days_thick", "radon": "radon_above4"}
# A fresh table with fewer known tracts than this share of the live table's, over the same
# states, is a broken source, not a changed one.
COLLAPSE = 0.95


def _read(body: str | bytes) -> pd.DataFrame:
    text = body.decode() if isinstance(body, bytes) else body
    cols = pd.read_csv(io.StringIO(text), nrows=0).columns
    ids = {c: str for c in cols if c in KEYS.values() or c.endswith(("_tract", "_site"))}
    return pd.read_csv(io.StringIO(text), dtype=ids)


def live_table(name: str, kind: str) -> pd.DataFrame | None:
    """The table as last published (None: nothing live, or unreachable)."""
    url = f"{config.DATA_URL}/tracts/pollution/{name}_{kind}.csv"
    try:
        return _read(http_get(url, use_cache=False))
    except Exception as e:  # noqa: BLE001 — anything here just means "no fallback"
        log.info("no live %s_%s table (%s)", name, kind, e)
        return None


def live_status() -> dict:
    try:
        s = json.loads(http_get(f"{config.DATA_URL}/tracts/pollution.json", use_cache=False))
        return s if isinstance(s, dict) and isinstance(s.get("sources"), dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _in_states(t: pd.DataFrame, key: str, states: list[str]) -> pd.Series:
    return t[key].astype(str).str[:2].isin(states)


def collapsed(name: str, fresh: pd.DataFrame, live: pd.DataFrame | None, states: list[str]) -> str | None:
    """Why the fresh tracts table is broken against the live one (None: it isn't)."""
    col = MEASURE[name]
    if live is None or col not in live.columns:
        return None
    was = int(live.loc[_in_states(live, "tract", states), col].notna().sum())
    now = int(fresh[col].notna().sum()) if col in fresh.columns else 0
    if was and now < COLLAPSE * was:
        return f"{col}: {now:,} areas with a value, {was:,} live ({100 * now / was:.0f}%, floor {100 * COLLAPSE:.0f}%)"
    return None


def merged(fresh: pd.DataFrame, live: pd.DataFrame | None, key: str, states: list[str]) -> pd.DataFrame:
    """The live table with these states' rows replaced by the fresh ones."""
    if live is None:
        return fresh
    return pd.concat([live[~_in_states(live, key, states)], fresh], ignore_index=True).sort_values(key, kind="stable")


def run(name: str, compute, states: list[str], sources: dict, today: str | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(tracts, counties) for one source: computed, or the live tables if it fails. Writes
    the published copies and updates `sources[name]` (pollution.json's entry)."""
    today = today or date.today().isoformat()
    live = {kind: live_table(name, kind) for kind in KEYS}
    try:
        tracts, counties = compute()
        why = collapsed(name, tracts, live["tracts"], states)
        if why:
            raise ValueError(f"coverage collapsed: {why}")
    except Exception as e:
        if live["tracts"] is None or live["counties"] is None:
            log.error("%s failed and nothing is live to fall back to", name)
            raise
        log.error("%s failed (%s): keeping the live tables, computed %s", name, e,
                  sources.get(name, {}).get("computed", "on an unknown date"))
        sources[name] = {**sources.get(name, {}), "carried": True, "attempted": today}
        return live["tracts"], live["counties"]
    DIR.mkdir(parents=True, exist_ok=True)
    for kind, t in (("tracts", tracts), ("counties", counties)):
        merged(t, live[kind], KEYS[kind], states).to_csv(DIR / f"{name}_{kind}.csv", index=False)
    sources[name] = {"computed": today, "carried": False}
    return tracts, counties


def write_status(sources: dict, today: str | None = None) -> None:
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps({"format": STATUS_FORMAT, "checked": today or date.today().isoformat(),
                                  "sources": sources}, indent=1, sort_keys=True))
