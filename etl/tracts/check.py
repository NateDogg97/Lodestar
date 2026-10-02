"""
Quality gate for a tract build (plan §9 Phase 8c): run before uploading.

    python -m etl.tracts.check            # every _coverage_{ST}.csv in data/out/tracts/
    python -m etl.tracts.check --md       # the same as Markdown (CI job summary)

Reads the coverage reports `build --state` writes and fails (exit 1) when:
  - more counties failed than MAX_FAILED (a source broke, not one odd county), or
  - nationally, a core measure covers fewer populated tracts than its FLOOR
    (a source changed format and silently came back empty).
A state where a core measure is below half its floor is listed as a warning:
one state's source can lapse (e.g. no FBI file yet) without blocking the rest.

Floors sit under what the Texas rehearsal reached (2026-10-01) with room for
states that differ; tighten them once the national run shows real numbers.
"""

from __future__ import annotations

import sys

import pandas as pd

from .. import config

FLOORS = {  # % of populated tracts, nationally
    "income": 95, "district": 90, "schools": 90, "high_schools": 90, "walkability": 95,
    "hazards": 95, "downtown": 95, "home_value": 85, "crime": 70, "named": 99,
}
MAX_FAILED_SHARE = 0.01  # of counties built in the run
MAX_FAILED_MIN = 3


def load() -> pd.DataFrame:
    frames = []
    for path in sorted(config.TRACT_OUT_DIR.glob("_coverage_*.csv")):
        df = pd.read_csv(path, dtype={"fips": str})
        frames.append(df.assign(state=path.stem.removeprefix("_coverage_")))
    if not frames:
        raise SystemExit("no _coverage_*.csv: run `python -m etl.tracts.build --state …` first")
    return pd.concat(frames, ignore_index=True)


def check(df: pd.DataFrame) -> tuple[bool, list[str]]:
    failed = df[df["error"].notna()] if "error" in df else df.iloc[0:0]
    ok_rows = df.drop(failed.index)
    w = ok_rows["populated"].fillna(0)
    lines = [f"**{len(ok_rows):,} counties built, {len(failed)} failed**, "
             f"{int(ok_rows['tracts'].sum()):,} tracts, {df['state'].nunique()} states", ""]
    ok = True
    limit = max(MAX_FAILED_MIN, int(MAX_FAILED_SHARE * len(df)))
    if len(failed) > limit:
        ok = False
        lines.append(f"❌ {len(failed)} counties failed (limit {limit})")
    for r in failed.head(20).itertuples():
        lines.append(f"- failed {r.fips}: {r.error}")

    lines += ["", "| Measure | National coverage | Floor | |", "|---|---:|---:|---|"]
    for col in [c for c in FLOORS] + ["zillow", "redfin", "in_place", "low_conf"]:
        if col not in ok_rows:
            continue
        pct = (ok_rows[col].fillna(0) * w).sum() / max(w.sum(), 1)
        floor = FLOORS.get(col)
        bad = floor is not None and pct < floor
        ok &= not bad
        lines.append(f"| {col} | {pct:.1f}% | {floor if floor is not None else '—'} | {'❌' if bad else ''} |")

    warn = []
    for st, g in ok_rows.groupby("state"):
        gw = g["populated"].fillna(0)
        for col, floor in FLOORS.items():
            if col in g:
                pct = (g[col].fillna(0) * gw).sum() / max(gw.sum(), 1)
                if pct < floor / 2:
                    warn.append(f"- ⚠️ {st}: {col} {pct:.0f}%")
    if warn:
        lines += ["", "Low in a state (warning only):", *warn]
    lines.insert(0, "### Tract build: " + ("passed ✅" if ok else "FAILED ❌"))
    return ok, lines


def main() -> None:
    ok, lines = check(load())
    print("\n".join(lines) if "--md" in sys.argv else "\n".join(l.replace("**", "") for l in lines))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
