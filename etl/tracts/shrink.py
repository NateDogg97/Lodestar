"""
Noise at the extremes: empirical-Bayes estimates for ranking (plan §9 Phase 10e, 2026-10-12).

A ranking rewards extremes, and small samples produce them. Areas with fewer than
1,500 people are 3.7% of areas but 10–18% of the most extreme 1% of home values,
incomes, rents and violent-crime rates, and most of those extremes carry a
low-confidence flag. So each noisy value is pulled toward what's typical nearby, by
as much as its own uncertainty says — the standard small-area estimate:

ACS MEDIANS (home value, rent, household income) — Fay–Herriot, on the log scale
    y   = log(estimate), se = MOE / 1.645 / estimate (delta method)
    mu  = the median y of the county's residential areas (the state's, for a county
          with fewer than MIN_COUNTY_AREAS)
    tau2 = the state's spread of y around those centers, less the mean sampling
          variance (method of moments), at least TAU2_FLOOR
    B   = se² / (se² + tau2);  y_eb = y + B (mu − y)
    A top-coded value (a floor, no MOE by design) or a mobile-home "value" is left as
    is; an estimate whose MOE couldn't be computed is treated as very uncertain.

CRIME RATES (per agency) — Poisson–gamma (Clayton & Kaldor 1987)
    E   = agency population × months reported / 12 / 100,000 (exposure)
    y   = rate × E (the crimes counted)
    The state's agencies give a gamma prior by the method of moments (Marshall 1991):
    m = Σy / ΣE;  v = weighted variance of y/E − m / mean(E), floored;
    alpha = m² / v, beta = m / v;  rate_eb = (y + alpha) / (E + beta).

These are scoring columns only (`*_eb` in areas.json). What people see, and what a
must-have limit tests, is the published estimate.
"""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

# A county with fewer residential areas than this centers on its state instead.
MIN_COUNTY_AREAS = 3
# Smallest between-area spread allowed on the log scale (sd ≈ 0.14, i.e. ±14%).
TAU2_FLOOR = 0.02
# An ACS estimate whose MOE couldn't be computed: treated as a ±50% guess.
UNKNOWN_SE = 0.5


def shrink_log_medians(est: list[float | None], moe: list[float | None], county: list[str],
                       state: list[str], residential: list[bool], keep: list[bool]) -> list[float | None]:
    """Fay–Herriot estimates, same units as `est`; `keep` marks values left as published."""
    n = len(est)
    y = np.full(n, np.nan)
    se2 = np.full(n, np.nan)
    for i in range(n):
        e = est[i]
        if e is None or e <= 0 or keep[i]:
            continue
        y[i] = math.log(e)
        m = moe[i]
        se = (m / 1.645 / e) if (m is not None and m >= 0) else UNKNOWN_SE
        se2[i] = se * se

    usable = ~np.isnan(y) & np.array(residential)
    by_county: dict[str, list[int]] = defaultdict(list)
    by_state: dict[str, list[int]] = defaultdict(list)
    for i in np.flatnonzero(usable):
        by_county[county[i]].append(i)
        by_state[state[i]].append(i)
    state_mu = {s: float(np.median(y[ix])) for s, ix in by_state.items()}
    county_mu = {c: float(np.median(y[ix])) for c, ix in by_county.items() if len(ix) >= MIN_COUNTY_AREAS}
    mu = np.array([county_mu.get(county[i], state_mu.get(state[i], np.nan)) for i in range(n)])

    tau2 = {}
    for s, ix in by_state.items():
        ix = np.array(ix)
        dev = y[ix] - mu[ix]
        tau2[s] = max(TAU2_FLOOR, float(np.mean(dev**2) - np.mean(se2[ix])))

    out: list[float | None] = list(est)
    for i in range(n):
        if np.isnan(y[i]) or np.isnan(mu[i]) or state[i] not in tau2:
            continue
        b = se2[i] / (se2[i] + tau2[state[i]])
        out[i] = math.exp(y[i] + b * (mu[i] - y[i]))
    return out


def shrink_rates(rate: list[float | None], population: list[float | None], months: list[float | None],
                 agency: list[str | None], state: list[str]) -> list[float | None]:
    """Poisson–gamma estimates of per-100k rates, one prior per state over its agencies."""
    n = len(rate)
    exposure = [None] * n
    for i in range(n):
        p, mo = population[i], months[i]
        if rate[i] is not None and p and mo and p > 0 and mo > 0:
            exposure[i] = p * mo / 12 / 100_000

    agencies: dict[str, dict[str, tuple[float, float]]] = defaultdict(dict)
    for i in range(n):
        if exposure[i] is not None and agency[i]:
            agencies[state[i]][agency[i]] = (rate[i] * exposure[i], exposure[i])

    prior: dict[str, tuple[float, float]] = {}
    for s, ag in agencies.items():
        counts = np.array([c for c, _ in ag.values()])
        exp_ = np.array([e for _, e in ag.values()])
        if len(ag) < 3 or exp_.sum() <= 0:
            continue
        m = counts.sum() / exp_.sum()
        if m <= 0:
            continue
        r = counts / exp_
        s2 = float(np.sum(exp_ * (r - m) ** 2) / exp_.sum())
        v = max(s2 - m / exp_.mean(), (0.1 * m) ** 2)
        prior[s] = (m * m / v, m / v)

    out: list[float | None] = list(rate)
    for i in range(n):
        if exposure[i] is None or state[i] not in prior:
            continue
        alpha, beta = prior[state[i]]
        out[i] = (rate[i] * exposure[i] + alpha) / (exposure[i] + beta)
    return out
