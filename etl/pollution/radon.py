"""
Radon: the share of homes above EPA's action level, where people live (plan §9 Phase 11d).

    python -m etl.pollution.radon MI PA       # those states' blocks -> interim tables
    python -m etl.pollution.radon all

WHAT THIS PRODUCES
    data/interim/radon_tracts.csv, radon_counties.csv — `etl.pollution.exposure` columns:
        radon_above4      the chance (%) a home test reads above 4 pCi/L (148 Bq/m³, EPA's
                          action level) — tests are mostly basements and lowest floors
        radon_above2      the same above 2 pCi/L (74 Bq/m³, EPA's "consider fixing")
        radon_ci          the ZIP model's own uncertainty: mean bootstrap 95% CI width of
                          the 4 pCi/L share, in percentage points (for the caution icon)
    each the population-weighted mean over the place's blocks, by the block's ZIP area.

SOURCE (decided 2026-10-13, decision 4)
    Li, Coull, Zilli Vieira, Koutrakis, PNAS 2025: a model of 6M+ home tests, 2001–2021,
    published on OSF (doi:10.17605/OSF.IO/3SHC4) under CC0:
        ZIPCODE_Monthly_Exceedency_Estimation_2001_2021.xlsx   (https://osf.io/download/2sdap/)
    One row per ZCTA × month × threshold (">148 Bq/m3", ">74 Bq/m3"): the probability a
    home's test exceeds it, and its bootstrap 95% CI width. The year is the mean of the 12
    months (tests read higher in winter). Lower 48 only: Alaska and Hawaii are unknown.
    Units, checked: the thresholds are stated in Bq/m³ (148 = 4 pCi/L); the companion
    average file's values are geometric means in pCi/L (ZIP 01001: 1.16 with 12% above 4,
    what a lognormal with the usual radon GSD of ~3 gives).

WHY NOT EPA'S ZONES
    A county zone is the averaging bias at its purest: the paper finds most homes above
    4 pCi/L are in "low-radon" zones. And even a ZIP is not a house — radon varies house to
    house on the same street. The page says "test your home", always.

BLOCKS -> ZIP AREAS
    Census's 2020 ZCTA–block relationship file (1 GB, streamed once; ZCTAs are built from
    whole blocks, so each block is in one ZCTA or none):
        https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt
    cached as data/interim/blocks/zcta.csv.gz (block, zcta).
"""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd
import requests

from .. import config
from ..util import get_logger, http_get
from .blocks import BY_POSTAL, CACHE_DIR, STATES, state_blocks
from .exposure import exposure

log = get_logger("pollution.radon")

EXCEEDANCE_URL = "https://osf.io/download/2sdap/"
RELATIONSHIP_URL = ("https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/"
                    "tab20_zcta520_tabblock20_natl.txt")
ZCTA_CACHE = CACHE_DIR / "zcta.csv.gz"
ZIP_CACHE = config.INTERIM_DIR / "radon_zcta.csv"
THRESHOLDS = {">148 Bq/m3": "above4", ">74 Bq/m3": "above2"}


def block_zctas() -> pd.DataFrame:
    """block (15) -> zcta (5), for blocks inside a ZCTA; streamed from the national file."""
    if ZCTA_CACHE.exists():
        return pd.read_csv(ZCTA_CACHE, dtype=str)
    rows: list[tuple[str, str]] = []
    with requests.get(RELATIONSHIP_URL, stream=True, timeout=120,
                      headers={"User-Agent": "lodestar-etl"}) as r:
        r.raise_for_status()
        lines = r.iter_lines(decode_unicode=False)
        header = next(lines).decode("utf-8-sig").split("|")
        zi, bi = header.index("GEOID_ZCTA5_20"), header.index("GEOID_TABBLOCK_20")
        for raw in lines:
            f = raw.decode("latin-1").split("|")
            if f[zi]:
                rows.append((f[bi], f[zi]))
    df = pd.DataFrame(rows, columns=["block", "zcta"])
    if df["block"].duplicated().any():
        raise ValueError("ZCTA relationship: a block in two ZCTAs — the file isn't what it was")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(ZCTA_CACHE, index=False, compression="gzip")
    log.info("ZCTA relationship: %d blocks in %d ZCTAs", len(df), df["zcta"].nunique())
    return df


def annual(monthly: pd.DataFrame) -> pd.DataFrame:
    """Monthly exceedance rows -> zcta, above4, above2 (%), radon_ci (pp): the year as the
    mean of its 12 months; a ZCTA missing a month is unknown, not a part year."""
    m = monthly.assign(zcta=monthly["ZCTA"].astype(int).astype(str).str.zfill(5),
                       k=monthly["threshold_label"].map(THRESHOLDS))
    if m["k"].isna().any():
        raise ValueError(f"radon: unknown thresholds {sorted(set(monthly['threshold_label']) - set(THRESHOLDS))}")
    g = m.groupby(["zcta", "k"])
    out = pd.DataFrame({"p": g["exceedance_probability"].mean(), "ci": g["bootstrap_95ci_width"].mean(),
                        "months": g["exceedance_probability"].count()}).reset_index()
    out = out[out["months"] == 12]
    wide = out.pivot(index="zcta", columns="k", values="p") * 100
    wide["radon_ci"] = out[out["k"] == "above4"].set_index("zcta")["ci"] * 100
    return wide.reset_index().rename_axis(columns=None)


def zip_values() -> pd.DataFrame:
    if ZIP_CACHE.exists():
        return pd.read_csv(ZIP_CACHE, dtype={"zcta": str})
    import io

    body = http_get(EXCEEDANCE_URL, binary=True, cache_hint="osf_radon_monthly_exceedance")
    assert isinstance(body, bytes)
    monthly = pd.read_excel(io.BytesIO(body), engine="openpyxl")
    out = annual(monthly)
    out.to_csv(ZIP_CACHE, index=False)
    log.info("radon: %d ZCTAs with all 12 months", len(out))
    return out


def compute(states: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(tracts, counties): each measure population-weighted over blocks by their ZCTA."""
    blocks = pd.concat([state_blocks(s) for s in states], ignore_index=True)
    z = zip_values().set_index("zcta")
    zc = block_zctas().set_index("block")["zcta"]
    by_block = blocks["block"].map(zc)
    tracts = counties = None
    for col, name in (("above4", "radon_above4"), ("above2", "radon_above2"), ("radon_ci", "radon_ci")):
        values = by_block.map(z[col]).to_numpy(dtype=float)
        t, c = exposure(blocks, values, name, digits=1)
        if name == "radon_ci":  # only its mean: the max of a CI width isn't a measure
            t, c = t[["tract", name]], c[["county", name]]
        tracts = t if tracts is None else tracts.merge(t, on="tract")
        counties = c if counties is None else counties.merge(c, on="county")
    known = 100 * blocks["pop"][~np.isnan(by_block.map(z["above4"]).to_numpy(dtype=float))].sum() / blocks["pop"].sum()
    log.info("radon: %.2f%% of residents in a ZCTA the model covers", known)
    return tracts, counties


def main() -> None:
    want = sys.argv[1:] or ["all"]
    states = list(STATES) if want == ["all"] else [BY_POSTAL.get(s.upper(), s) for s in want]
    tracts, counties = compute(states)
    tracts.to_csv(config.INTERIM_DIR / "radon_tracts.csv", index=False)
    counties.to_csv(config.INTERIM_DIR / "radon_counties.csv", index=False)
    print(counties.describe().round(1).to_string())


if __name__ == "__main__":
    main()
