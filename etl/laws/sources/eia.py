"""
EIA (U.S. Energy Information Administration) — residential electricity price.

Average residential retail price by state for the latest complete calendar
year, from the EIA Open Data API v2 (electricity/retail-sales). A federal
statistical agency, so Tier A: fetched, never hand-entered.

Set EIA_API_KEY (free: https://www.eia.gov/opendata/register.php) in
etl/.env for local runs, or as a repository secret for the monthly workflow.
Without it the public DEMO_KEY is used, which is rate-limited but fine for
one monthly request. The key is only sent to EIA; the data link written to
the table always uses DEMO_KEY.
"""

from __future__ import annotations

import json
import os
from datetime import date

from ..common import Fact, SourceError, SourceResult, STATES, get

try:  # local runs keep the key in etl/.env; CI sets it as a secret instead
    from pathlib import Path

    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except ImportError:
    pass

NAME = "U.S. Energy Information Administration"
API = "https://api.eia.gov/v2/electricity/retail-sales/data/"
PAGE_URL = "https://www.eia.gov/electricity/data/browser/#/topic/7?agg=0,1&geo=vvvvvvvvvvvvo&endsec=2&freq=A"


def parse_response(payload: dict, request_url: str) -> SourceResult:
    rows = payload.get("response", {}).get("data", [])
    by_year: dict[str, dict[str, float]] = {}
    for r in rows:
        code, period, price = r.get("stateid"), r.get("period"), r.get("price")
        if code in STATES and price not in (None, ""):
            by_year.setdefault(str(period), {})[code] = float(price)
    complete = sorted((y for y, v in by_year.items() if set(v) == STATES), reverse=True)
    if not complete:
        raise SourceError(f"EIA returned no year with all 51 jurisdictions (years: {sorted(by_year)})")
    year = complete[0]
    res = SourceResult("electricity_price_cents_kwh")
    for code, price in by_year[year].items():
        if not 3 <= price <= 80:
            raise SourceError(f"EIA {code} {year} price {price} ¢/kWh is implausible")
        res.facts[code] = Fact(
            value=f"{price:.2f}", value_numeric=round(price, 2), source_name=NAME,
            source_url=PAGE_URL, data_url=request_url, source_date=date(int(year), 12, 31),
            quote=f"EIA retail sales, residential sector, {code}, {year}: average price {price:.2f} cents/kWh",
            status="in_effect", confidence="high",
            notes=f"Average residential price for calendar year {year}.",
        )
    return res


def electricity(today: date) -> SourceResult:
    params = {
        "api_key": os.environ.get("EIA_API_KEY") or "DEMO_KEY",
        "frequency": "annual",
        "data[0]": "price",
        "facets[sectorid][]": "RES",
        "start": str(today.year - 3),
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "length": "500",
    }
    text = get(API, params=params)
    payload = json.loads(text)
    if "error" in payload:
        raise SourceError(f"EIA API error: {payload['error']}")
    # The cited data link uses EIA's public DEMO_KEY so anyone can open it;
    # a private EIA_API_KEY (CI secret) is never written into the table.
    public = (API + "?api_key=DEMO_KEY&frequency=annual&data[0]=price&facets[sectorid][]=RES"
              f"&start={today.year - 3}&sort[0][column]=period&sort[0][direction]=desc&length=500")
    return parse_response(payload, public)
