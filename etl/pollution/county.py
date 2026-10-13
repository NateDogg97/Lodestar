"""
Pollution by county, for counties.json (plan §9 Phase 11e).

    python -m etl.patch pollution      # refresh these columns in the published file

From the national block runs (`etl.pollution.pm25 all`, `.smoke all`, `.radon all` —
rule 3: a county is its own blocks, never a county source) and the county ACS (older
housing, `etl.pollution.lead`). What the county page shows beside its areas:

    pm25                population-weighted PM2.5, µg/m³ (2022–2024)
    pm25_above          % of residents above EPA's 9.0 µg/m³
    pm25_worst          its worst area's PM2.5
    pm25_doubt          % of residents near a monitor reading well above the model
    smoke_days_thick    days a year with Medium/Heavy smoke overhead (2015–2024)
    smoke_days          days a year with any smoke overhead
    pre1960_share       % of homes built before 1960 (lead-paint risk)
    radon_above4        % of homes expected above 4 pCi/L
    radon_above4_worst  its worst area's share

Nine columns: counties.json has room for about ten under the service worker's 2 MB cap.
Pollution is ranked by area, not by county (one level per filter, plan §9 Phase 8f).
"""

from __future__ import annotations

import pandas as pd

from .. import config

COLUMNS = {
    "pm25": ("pm25", ["pm25", "pm25_above", "pm25_worst", "pm25_doubt"]),
    "smoke": ("smoke", ["smoke_days_thick", "smoke_days"]),
    "radon": ("radon", ["radon_above4", "radon_above4_worst"]),
}


def fetch() -> pd.DataFrame:
    out = None
    for name, (stem, cols) in COLUMNS.items():
        path = config.INTERIM_DIR / f"{stem}_counties.csv"
        if not path.exists():
            raise FileNotFoundError(f"{path.name}: run `python -m etl.pollution.{name} all` first")
        t = pd.read_csv(path, dtype={"county": str})[["county", *cols]].rename(columns={"county": "fips"})
        out = t if out is None else out.merge(t, on="fips", how="outer")
    from .lead import OUT as LEAD
    from .lead import fetch as fetch_lead

    lead = pd.read_csv(LEAD, dtype={"fips": str}) if LEAD.exists() else fetch_lead()
    assert out is not None
    out = out.merge(lead[["fips", "pre1960_share"]], on="fips", how="outer")
    for c in ("pm25", "pm25_worst", "smoke_days_thick", "smoke_days"):
        out[c] = out[c].round(1)
    for c in ("pm25_above", "pm25_doubt", "pre1960_share", "radon_above4", "radon_above4_worst"):
        out[c] = out[c].round(0)
    return out
