"""
SOURCE: BLS Local Area Unemployment Statistics (LAUS) — county unemployment rate.

WHAT THIS PRODUCES
    fips, unemployment_rate, unemployment_year

    The latest ANNUAL AVERAGE unemployment rate (percent, not seasonally
    adjusted — the only way BLS publishes county data). Series id per county:
    LAUCN{fips}0000000003.

HOW
    BLS public data API v2, POSTing 50 series per request with a free
    registration key (config.BLS_API_KEY; 63 requests for 3,144 counties —
    unregistered access allows only 25 requests a day). Each batch's response
    is cached in data/raw/, so re-running the ETL doesn't spend the quota.
    BLS's flat files would need a contact email in the User-Agent; the key
    route needs nothing personal on each request.

YEAR
    The newest year for which at least 90% of counties have an annual average.
    2025's annual averages are 11-month averages — BLS didn't collect October
    2025 data during the federal government shutdown (BLS footnote G).

COVERAGE
    Connecticut's 9 planning regions have series. Kalawao County, HI (pop. ~80)
    has none and stays unknown.

RUN STANDALONE
    python -m etl.sources.bls
"""

from __future__ import annotations

import hashlib
import json
from datetime import date

import pandas as pd
import requests

from .. import config
from ..util import describe_frame, get_logger, read_interim, write_interim

log = get_logger("source.bls")

MIN_YEAR_COVERAGE = 0.9


def series_id(fips: str) -> str:
    return f"LAUCN{fips}0000000003"


def _post(series: list[str], start: int, end: int) -> dict:
    body = {"seriesid": series, "startyear": str(start), "endyear": str(end),
            "annualaverage": True, "registrationkey": config.BLS_API_KEY}
    key = hashlib.sha256(json.dumps([series, start, end]).encode()).hexdigest()[:16]
    cache = config.RAW_DIR / f"bls_laus_{start}_{end}__{key}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    r = requests.post(config.BLS_API_URL, json=body, timeout=config.HTTP_TIMEOUT,
                      headers={"User-Agent": config.HTTP_USER_AGENT})
    r.raise_for_status()
    payload = r.json()
    if payload.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(f"BLS API: {payload.get('status')} {payload.get('message')}")
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(payload))
    return payload


def parse(payloads: list[dict]) -> pd.DataFrame:
    """API responses -> (fips, year, rate) for every annual average (period M13)."""
    rows = []
    for payload in payloads:
        for s in payload.get("Results", {}).get("series", []):
            sid = s.get("seriesID", "")
            if not (sid.startswith("LAUCN") and len(sid) == 20):
                continue
            fips = sid[5:10]
            for d in s.get("data", []):
                if d.get("period") != "M13":
                    continue
                try:
                    rows.append((fips, int(d["year"]), float(d["value"])))
                except (KeyError, ValueError):
                    continue  # "-" = not available
    return pd.DataFrame(rows, columns=["fips", "year", "rate"])


def latest_complete_year(annual: pd.DataFrame, n_counties: int) -> int:
    counts = annual.groupby("year")["fips"].nunique()
    good = counts[counts >= MIN_YEAR_COVERAGE * n_counties]
    if good.empty:
        raise RuntimeError(f"No year has annual averages for {MIN_YEAR_COVERAGE:.0%} of counties: "
                           f"{counts.to_dict()}")
    return int(good.index.max())


def fetch() -> pd.DataFrame:
    if not config.BLS_API_KEY:
        raise RuntimeError("BLS_API_KEY is not set (free: https://data.bls.gov/registrationEngine/). "
                           "Add it to etl/.env.")
    spine = read_interim("spine")
    fips = spine["fips"].tolist()
    ids = [series_id(f) for f in fips]
    end = date.today().year
    start = end - 2
    n = config.BLS_SERIES_PER_REQUEST
    log.info("fetching BLS LAUS annual averages %d–%d for %d counties (%d requests)",
             start, end, len(ids), -(-len(ids) // n))
    payloads = [_post(ids[i:i + n], start, end) for i in range(0, len(ids), n)]
    annual = parse(payloads)

    year = latest_complete_year(annual, len(fips))
    out = annual[annual["year"] == year].rename(columns={"rate": "unemployment_rate"})
    out = out[["fips", "unemployment_rate"]].drop_duplicates("fips")
    out["unemployment_year"] = year
    missing = sorted(set(fips) - set(out["fips"]))
    log.info("BLS LAUS %d: %d counties; %d without a value (e.g. %s)",
             year, len(out), len(missing), missing[:5])
    return out.reset_index(drop=True)


def main() -> None:
    df = fetch()
    write_interim(df, "bls")
    print(describe_frame(df, "bls"))
    print(df[df["fips"].isin(["48453", "06075", "09190", "04013"])].to_string())


if __name__ == "__main__":
    main()
