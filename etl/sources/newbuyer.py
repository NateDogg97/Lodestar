"""
SOURCE: Census ACS microdata (PUMS) — what a new buyer pays in property tax.

WHAT THIS PRODUCES
    fips, new_buyer_ratio, new_buyer_sample

    `new_buyer_ratio`: property tax ÷ home value for owners who moved in 1–4 years ago,
    over the same for all owners, in the county's PUMAs. The Taxes estimate multiplies
    the county's ACS effective rate by it (src/lib/scoring/taxes.ts).

WHY (plan §9 Phase 10 follow-up, 2026-10-13; owner chose option B)
    The ACS effective rate (aggregate taxes ÷ aggregate value) averages every owner. Where
    assessments are capped until a sale — Michigan's Proposal A, California's Prop 13,
    Florida's Save Our Homes, Texas's homestead cap — a buyer pays more than the owners
    who've stayed. Measured rather than modelled, so it covers every state's rules and
    shows no gap where there is no cap. 2019–2023 PUMS, by state: CA 1.18×, TX 1.07×,
    FL 1.07×, MI 1.04×; OH, IL, MA 1.00× — the control.

    It under-reads the reset: a buyer's first bill can still be the seller's (Michigan
    uncaps the year after a sale), taxes and values are self-reported, and samples are
    small. Michigan's statute implies more (Ann Arbor: 52.67 mills on half the price ≈
    2.6% vs the 1.49% average). Treat it as a floor on the gap, not the gap.

METHOD
    Householder records of owners (TEN 1–2) with a value and taxes below the PUMS top
    codes. "Recent" = moved in 13 months to 4 years ago (MV 2–3): long enough for a
    reassessment, short enough to be new. Per PUMA, the log of the ratio of weighted
    aggregate rates; its sampling variance by bootstrap over households; each PUMA's log
    ratio shrunk toward its state's by Fay–Herriot weights (as etl/tracts/shrink.py does
    for tract medians); a county averages its PUMAs by how many of its tracts each holds
    (tracts are drawn at ~4,000 people). Clipped to [0.9, 2.0].

SOURCES
    https://api.census.gov/data/2023/acs/acs5/pums (CENSUS_API_KEY), one call per state.
    https://www2.census.gov/geo/docs/maps-data/data/rel2020/2020_Census_Tract_to_2020_PUMA.txt

RUN STANDALONE
    python -m etl.sources.newbuyer
"""

from __future__ import annotations

import io
import json

import numpy as np
import pandas as pd

from .. import config
from ..util import describe_frame, get_logger, http_get, read_interim, write_interim

log = get_logger("source.newbuyer")

PUMS_URL = "https://api.census.gov/data/2023/acs/acs5/pums"
CROSSWALK_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/2020_Census_Tract_to_2020_PUMA.txt"
TAX_TOPCODE = 57_500
VALUE_TOPCODE = 9_000_000
RECENT_MV = (2, 3)            # 13–23 months, 2–4 years
BOOTSTRAPS = 200
TAU2_FLOOR = 0.0004           # sd 2% between PUMAs at the least
CLIP = (0.9, 2.0)
STATES = [f"{s:02d}" for s in (1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
                                26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 44, 45, 46,
                                47, 48, 49, 50, 51, 53, 54, 55, 56)]


def _state_records(state: str) -> pd.DataFrame:
    params = {"get": "TAXAMT,VALP,MV,WGTP,TEN,PUMA", "for": f"state:{state}", "SPORDER": "1"}
    if config.CENSUS_API_KEY:
        params["key"] = config.CENSUS_API_KEY
    body = http_get(PUMS_URL, params=params, cache_hint=f"pums_2023_owners_{state}")
    rows = json.loads(body)
    d = pd.DataFrame(rows[1:], columns=rows[0])
    for c in ("TAXAMT", "VALP", "MV", "WGTP", "TEN"):
        d[c] = pd.to_numeric(d[c], errors="coerce")
    return d[d["TEN"].isin([1, 2]) & (d["VALP"] > 0) & (d["VALP"] < VALUE_TOPCODE)
             & (d["TAXAMT"] >= 0) & (d["TAXAMT"] < TAX_TOPCODE)]


def _log_ratio(tax: np.ndarray, val: np.ndarray, w: np.ndarray, recent: np.ndarray) -> float:
    all_rate = (tax * w).sum() / (val * w).sum()
    r = recent
    if r.sum() == 0 or all_rate <= 0:
        return np.nan
    new_rate = (tax[r] * w[r]).sum() / (val[r] * w[r]).sum()
    return float(np.log(new_rate / all_rate)) if new_rate > 0 else np.nan


def puma_estimates(d: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """Per PUMA of one state: log ratio, its bootstrap variance, recent-buyer sample; then
    each shrunk toward the state's (Fay–Herriot, method-of-moments tau²)."""
    recent_all = d["MV"].isin(RECENT_MV).to_numpy()
    state_l = _log_ratio(d["TAXAMT"].to_numpy(float), d["VALP"].to_numpy(float), d["WGTP"].to_numpy(float), recent_all)
    out = []
    for puma, g in d.groupby("PUMA"):
        tax, val, w = g["TAXAMT"].to_numpy(float), g["VALP"].to_numpy(float), g["WGTP"].to_numpy(float)
        rec = g["MV"].isin(RECENT_MV).to_numpy()
        est = _log_ratio(tax, val, w, rec)
        if np.isnan(est) or rec.sum() < 10:
            out.append((puma, np.nan, np.nan, int(rec.sum())))
            continue
        n = len(g)
        boots = []
        for _ in range(BOOTSTRAPS):
            k = rng.integers(0, n, n)
            boots.append(_log_ratio(tax[k], val[k], w[k], rec[k]))
        out.append((puma, est, float(np.nanvar(boots)), int(rec.sum())))
    p = pd.DataFrame(out, columns=["puma", "l", "se2", "n_recent"])
    ok = p["l"].notna()
    tau2 = max(TAU2_FLOOR, float(np.mean((p.loc[ok, "l"] - state_l) ** 2) - np.mean(p.loc[ok, "se2"]))) if ok.any() else TAU2_FLOOR
    b = p["se2"] / (p["se2"] + tau2)
    p["l_hat"] = np.where(ok, (1 - b) * p["l"] + b * state_l, state_l)
    p["state_l"] = state_l
    return p


def fetch() -> pd.DataFrame:
    rng = np.random.default_rng(20261013)
    # The file starts with a UTF-8 byte-order mark: read the bytes as utf-8-sig.
    raw = http_get(CROSSWALK_URL, binary=True, cache_hint="tract_to_puma_2020_bin")
    assert isinstance(raw, bytes)
    crosswalk = pd.read_csv(io.BytesIO(raw), dtype=str, encoding="utf-8-sig")
    crosswalk["fips"] = crosswalk["STATEFP"] + crosswalk["COUNTYFP"]
    crosswalk["puma"] = crosswalk["PUMA5CE"]
    rows = []
    for state in STATES:
        d = _state_records(state)
        p = puma_estimates(d, rng)
        p["state"] = state
        rows.append(p)
        log.info("state %s: %d owners, ratio %.3f, %d PUMAs", state, len(d), float(np.exp(p["state_l"].iloc[0])), len(p))
    pumas = pd.concat(rows, ignore_index=True)
    tracts = crosswalk[crosswalk["STATEFP"].isin(STATES)].merge(
        pumas, left_on=["STATEFP", "puma"], right_on=["state", "puma"], how="left")
    county = tracts.groupby("fips").agg(l=("l_hat", "mean"))
    # Recent buyers sampled in the county's PUMAs (each PUMA once).
    county["n"] = tracts.drop_duplicates(["fips", "STATEFP", "puma"]).groupby("fips")["n_recent"].sum()
    ratio = np.exp(county["l"]).clip(*CLIP)
    out = pd.DataFrame({"fips": county.index, "new_buyer_ratio": ratio.round(3).to_numpy(),
                        "new_buyer_sample": county["n"].astype(float).to_numpy()})
    # Counties the 2020 crosswalk doesn't know (Connecticut's 2022 planning regions replaced
    # its counties) take their state's ratio.
    try:
        spine = read_interim("spine")["fips"].astype(str).str.zfill(5)
    except FileNotFoundError:
        spine = pd.Series(dtype=str)
    state_ratio = pumas.groupby("state")["state_l"].first().map(np.exp).clip(*CLIP).round(3)
    extra = [f for f in spine if f not in set(out["fips"]) and f[:2] in state_ratio.index]
    if extra:
        out = pd.concat([out, pd.DataFrame({"fips": extra, "new_buyer_ratio": [state_ratio[f[:2]] for f in extra],
                                            "new_buyer_sample": [np.nan] * len(extra)})],
                        ignore_index=True)
        log.info("%d counties outside the 2020 crosswalk take their state's ratio (e.g. %s)", len(extra), extra[:3])
    log.info("new_buyer_ratio: median %.3f, p10 %.3f, p90 %.3f over %d counties",
             out["new_buyer_ratio"].median(), out["new_buyer_ratio"].quantile(0.1),
             out["new_buyer_ratio"].quantile(0.9), len(out))
    return out.dropna(subset=["new_buyer_ratio"]).reset_index(drop=True)


def main() -> None:
    df = fetch()
    write_interim(df, "newbuyer")
    print(describe_frame(df, "newbuyer"))


if __name__ == "__main__":
    main()
