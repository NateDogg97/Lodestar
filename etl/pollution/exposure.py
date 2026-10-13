"""
Block values -> areas (tracts) and counties (plan §9 Phase 11, rules 1, 3, 6, 9).

For each place, from its own populated blocks:
    <name>               population-weighted mean of the blocks' values (rule 1)
    <name>_above         % of its residents whose block is over the benchmark (rule 3)
    <name>_max           the highest block value (what the mean can hide)
    <name>_coverage      % of its residents whose block has a value

A county also gets its worst area (`<name>_worst_tract`, `<name>_worst`): the tract with
the highest mean. County values come from the same block rows as the tracts', never from a
county source (rule 3), and the whole country is aggregated in one pass, so a tract on a
county line gets the same value whichever county is being built (rule 6).

Unknown stays unknown (rule 9): a place where fewer than MIN_COVERAGE of its people have a
value gets no mean — a value from a sliver of its people would stand for all of them.
Nothing here smooths, interpolates or shrinks (rules 2, 5).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Below this share of a place's people with a known value, the place is unknown.
MIN_COVERAGE = 0.5


def aggregate(blocks: pd.DataFrame, by: str, name: str, benchmark: float | None = None) -> pd.DataFrame:
    """`blocks`: pop, value and the `by` key per block. One row per key."""
    b = blocks[[by, "pop", "value"]].copy()
    known = b["value"].notna()
    b["pop_known"] = np.where(known, b["pop"], 0)
    b["weighted"] = np.where(known, b["pop"] * b["value"], 0.0)
    if benchmark is not None:
        b["pop_above"] = np.where(known & (b["value"] > benchmark), b["pop"], 0)
    g = b.groupby(by)
    out = pd.DataFrame({"pop": g["pop"].sum(), "pop_known": g["pop_known"].sum(), "weighted": g["weighted"].sum(),
                        f"{name}_max": g["value"].max()})
    coverage = out["pop_known"] / out["pop"]
    out[name] = (out["weighted"] / out["pop_known"]).where(coverage >= MIN_COVERAGE)
    out[f"{name}_coverage"] = (100 * coverage).round(1)
    if benchmark is not None:
        out[f"{name}_above"] = (100 * g["pop_above"].sum() / out["pop_known"]).where(coverage >= MIN_COVERAGE).round(1)
    out.loc[coverage < MIN_COVERAGE, f"{name}_max"] = np.nan
    return out.drop(columns=["pop", "pop_known", "weighted"]).reset_index()


def share(blocks: pd.DataFrame, flag: np.ndarray, by: str, column: str) -> pd.DataFrame:
    """% of each place's residents whose block is flagged (a yes/no known for every block)."""
    b = pd.DataFrame({by: blocks[by].to_numpy(), "pop": blocks["pop"].to_numpy(),
                      "hit": np.where(np.asarray(flag, dtype=bool), blocks["pop"].to_numpy(), 0)})
    g = b.groupby(by)[["pop", "hit"]].sum()
    return (100 * g["hit"] / g["pop"]).round(1).rename(column).reset_index()


def exposure(blocks: pd.DataFrame, values: np.ndarray, name: str, benchmark: float | None = None,
             digits: int = 2) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(tracts, counties) for one measure: `values` is one value per block row (NaN unknown)."""
    b = blocks.assign(value=np.asarray(values, dtype=float))
    tracts = aggregate(b, "tract", name, benchmark)
    counties = aggregate(b, "county", name, benchmark)
    # The county's worst area: the tract with the highest mean.
    ranked = tracts.dropna(subset=[name]).assign(county=lambda t: t["tract"].str[:5])
    worst = ranked.sort_values(name, ascending=False).drop_duplicates("county")
    counties = counties.merge(
        worst[["county", "tract", name]].rename(columns={"tract": f"{name}_worst_tract", name: f"{name}_worst"}),
        on="county", how="left")
    for df in (tracts, counties):
        for c in [c for c in df.columns if c.startswith(name) and not c.endswith(("_coverage", "_above", "_tract"))]:
            df[c] = df[c].round(digits)
    return tracts, counties
