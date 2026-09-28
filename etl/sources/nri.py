"""
SOURCE: FEMA National Risk Index (NRI), county table — natural hazard risk.

WHAT THIS PRODUCES
    fips, hazard_risk, hazard_hurricane, hazard_wildfire, hazard_inland_flood,
    hazard_coastal_flood, hazard_earthquake, hazard_tornado, nri_version

    Each hazard_* value is FEMA's NATIONAL PERCENTILE (0–100) of the county's
    EXPECTED ANNUAL LOSS RATE (`*_ALR_NPCTL`): higher = a larger share of the
    buildings, people and agriculture there is lost to that hazard in a typical
    year. `hazard_risk` is the all-hazard composite (`ALR_NPCTL`).

WHY THE LOSS RATE, NOT THE HEADLINE RISK SCORE
    `RISK_SCORE` ranks expected annual loss in DOLLARS, so it mostly measures
    how much there is to lose: Los Angeles 100, Austin 98, any big county near
    the top. The loss RATE divides by the exposure, which is what a household
    moving there faces: New Orleans 96, Los Angeles 89, Austin 21, Phoenix 39.

"NOT APPLICABLE" IS ZERO, "INSUFFICIENT DATA" IS UNKNOWN
    FEMA leaves a hazard's percentile blank when the hazard can't happen there
    (no coast -> no coastal flooding, rated "Not Applicable") — that is a real
    zero risk, stored as 0. A blank for any other reason stays null (unknown),
    per the project's never-guess rule.

SOURCE
    OpenFEMA, NRI v1.20 (December 2025):
    https://www.fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_Counties.zip
    FEMA's CDN answers the project's bot User-Agent with 403, so this one
    request uses a browser User-Agent. ~25 MB, cached in data/raw/.

RUN STANDALONE
    python -m etl.sources.nri
"""

from __future__ import annotations

import io
import zipfile

import numpy as np
import pandas as pd

from .. import config
from ..util import describe_frame, get_logger, http_get, normalize_fips, read_interim, write_interim

log = get_logger("source.nri")

# output column -> NRI hazard prefix ("" = the all-hazard composite)
HAZARDS = {
    "hazard_risk": "",
    "hazard_hurricane": "HRCN",
    "hazard_wildfire": "WFIR",
    "hazard_inland_flood": "IFLD",
    "hazard_coastal_flood": "CFLD",
    "hazard_earthquake": "ERQK",
    "hazard_tornado": "TRND",
}


def parse(table: pd.DataFrame) -> pd.DataFrame:
    """NRI county table -> one row per county with the hazard_* percentiles."""
    need = {"STCOFIPS", "ALR_NPCTL", "NRI_VER"} | {
        f"{p}_{s}" for p in HAZARDS.values() if p for s in ("ALR_NPCTL", "RISKR")
    }
    missing = need - set(table.columns)
    if missing:
        raise ValueError(f"NRI county table is missing columns {sorted(missing)} — "
                         f"FEMA may have renamed them in a new version")
    out = pd.DataFrame({"fips": table["STCOFIPS"].map(normalize_fips)})
    for col, prefix in HAZARDS.items():
        pct_col = f"{prefix}_ALR_NPCTL" if prefix else "ALR_NPCTL"
        pct = pd.to_numeric(table[pct_col], errors="coerce")
        if prefix:
            not_applicable = table[f"{prefix}_RISKR"].astype(str).str.strip().eq("Not Applicable")
            pct = pct.where(~(pct.isna() & not_applicable), 0.0)
        out[col] = pct.clip(0, 100)
    out["nri_version"] = table["NRI_VER"].astype(str)
    return out.dropna(subset=["fips"]).drop_duplicates("fips").reset_index(drop=True)


def fetch() -> pd.DataFrame:
    log.info("fetching FEMA National Risk Index county table (%s)", config.NRI_VERSION)
    body = http_get(config.NRI_COUNTIES_URL, binary=True, cache_hint="nri_counties",
                    user_agent=config.BROWSER_USER_AGENT, check=_is_zip)
    assert isinstance(body, bytes)
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        name = next(n for n in z.namelist() if n.lower() == "nri_table_counties.csv")
        table = pd.read_csv(z.open(name), dtype={"STCOFIPS": str}, low_memory=False)
    out = parse(table)

    spine = read_interim("spine")
    out = out[out["fips"].isin(spine["fips"])].reset_index(drop=True)
    missing = sorted(set(spine["fips"]) - set(out["fips"]))
    if missing:
        log.warning("NRI: %d spine counties have no row (e.g. %s)", len(missing), missing[:5])
    log.info("NRI: %d counties; composite loss-rate percentile median %.1f",
             len(out), float(np.nanmedian(out["hazard_risk"])))
    return out


def _is_zip(payload: object) -> None:
    if not (isinstance(payload, bytes) and payload[:2] == b"PK"):
        raise ValueError("NRI download is not a zip (FEMA served an HTML page?)")


def main() -> None:
    df = fetch()
    write_interim(df, "nri")
    print(describe_frame(df, "nri"))
    print(df[df["fips"].isin(["22071", "48453", "06037", "04013"])].to_string())


if __name__ == "__main__":
    main()
