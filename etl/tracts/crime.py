"""
SOURCE: FBI Crime Data Explorer — crime by police jurisdiction (plan §9 Phase 8).

WHAT THIS PRODUCES (one row per tract)
    geoid, crime_agency, violent_rate, property_rate, crime_year, crime_months,
    crime_population (residents the agency serves), crime_low_confidence (bool)

    violent_rate / property_rate   reported offenses per 100,000 residents in a
                                   year, for the POLICE AGENCY covering the tract

WHY BY JURISDICTION, NOT BY TRACT
    The FBI publishes counts per law-enforcement agency, not per neighborhood.
    So a tract gets its jurisdiction's rate: the city police department if the
    tract is inside that city (Census place, from names.py), otherwise the
    county sheriff (unincorporated areas). University, school-district,
    transit, constable and other special agencies are skipped: they don't
    cover a residential area. Coarser than the other tract data, but it still
    separates, say, Austin from Lakeway from unincorporated Travis County.

THE YEAR AND LOW CONFIDENCE
    CRIME_YEAR (newest full year); an agency that didn't report all 12 months
    falls back to CRIME_FALLBACK_YEAR if that year is more complete. Fewer than
    12 months, no data at all, or an agency serving fewer than
    CRIME_MIN_POPULATION people (tiny towns with a mall), makes the value low
    confidence. Rates are
    computed from counts and the population the agency serves (both in the
    API's response), so partial years aren't silently scaled.

SOURCE
    https://api.usa.gov/crime/fbi/cde  (api.data.gov key: DATA_GOV_API_KEY)
      /agency/byStateAbbr/{ST}                        agencies, by county
      /summarized/agency/{ORI}/{violent|property}-crime?from=MM-YYYY&to=MM-YYYY

RUN STANDALONE
    python -m etl.tracts.crime 48453
"""

from __future__ import annotations

import json
import re
import sys

import numpy as np
import pandas as pd

from .. import config
from ..util import BadResponse, get_logger, http_get, read_interim
from .geo import STATE_ABBR

log = get_logger("tracts.crime")

KEEP_TYPES = {"City", "County"}
SUFFIX = re.compile(r"\s+(Police Department|Police Dept\.?|Department of Public Safety|Public Safety Department|Police)$", re.I)


def _get(path: str, params: dict | None = None, hint: str = "cde") -> dict:
    if not config.DATA_GOV_API_KEY:
        log.warning("No DATA_GOV_API_KEY: using DEMO_KEY (30 requests/hour). See etl/.env.example.")
    q = {"API_KEY": config.DATA_GOV_API_KEY or "DEMO_KEY", **(params or {})}

    def _check(payload: object) -> None:
        if not isinstance(payload, (str, bytes)) or not payload.strip().startswith(b"{" if isinstance(payload, bytes) else "{"):
            raise BadResponse("CDE did not return JSON")

    body = http_get(f"{config.CDE_API_BASE}/{path}", params=q, cache_hint=hint, check=_check)
    return json.loads(body)


def county_agencies(county_fips: str) -> pd.DataFrame:
    """ori, agency_name, agency_type for the city and county agencies serving a county."""
    spine = read_interim("spine")
    name = spine.loc[spine["fips"] == county_fips, "county_name"].iloc[0]
    key = re.sub(r"\s+(County|Parish|Borough|Census Area|Municipality|City and Borough)$", "", name).upper()
    st = STATE_ABBR[county_fips[:2]].upper()
    data = _get(f"agency/byStateAbbr/{st}", hint=f"cde_agencies_{st}")
    rows = [a for lst in data.values() for a in lst
            if key in [c.strip().upper() for c in str(a.get("counties", "")).split(",")]
            and a.get("agency_type_name") in KEEP_TYPES]
    return pd.DataFrame([{"ori": a["ori"], "agency_name": a["agency_name"], "agency_type": a["agency_type_name"]}
                         for a in rows]).drop_duplicates("ori")


def _year(ori: str, agency: str, offense: str, year: int) -> tuple[float, float, int]:
    """(offense count, mean population served, months reported) for one year."""
    j = _get(f"summarized/agency/{ori}/{offense}", {"from": f"01-{year}", "to": f"12-{year}"},
             hint=f"cde_{ori}_{offense}_{year}")
    act = j.get("offenses", {}).get("actuals", {}).get(f"{agency} Offenses", {}) or {}
    pops = j.get("populations", {}).get("population", {}).get(agency, {}) or {}
    part = j.get("populations", {}).get("participated_population", {}).get(agency, {}) or {}
    months = sum(1 for m in act if part.get(m))
    count = float(sum(v for m, v in act.items() if part.get(m)))
    pop = float(np.mean([v for v in pops.values() if v])) if any(pops.values()) else float("nan")
    return count, pop, months


def agency_rates(agencies: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for a in agencies.itertuples():
        best = None
        for year in (config.CRIME_YEAR, config.CRIME_FALLBACK_YEAR):
            v, pop, mv = _year(a.ori, a.agency_name, "violent-crime", year)
            p, _, mp = _year(a.ori, a.agency_name, "property-crime", year)
            months = min(mv, mp)
            if best is None or months > best["crime_months"]:
                scale = 100_000 / pop if pop and pop > 0 else float("nan")
                best = {"ori": a.ori, "crime_year": year, "crime_months": months, "crime_population": pop,
                        "violent_rate": v * scale if months else float("nan"),
                        "property_rate": p * scale if months else float("nan")}
            if months == 12:
                break
        rows.append(best)
    return agencies.merge(pd.DataFrame(rows), on="ori")


def fetch(county_fips: str, names: pd.DataFrame) -> pd.DataFrame:
    """`names` needs geoid and place (from names.py)."""
    agencies = agency_rates(county_agencies(county_fips))
    cities = agencies[agencies["agency_type"] == "City"].copy()
    cities["place"] = cities["agency_name"].str.replace(SUFFIX, "", regex=True).str.strip()
    sheriff = agencies[agencies["agency_type"] == "County"]
    sheriff = sheriff.iloc[0] if len(sheriff) else None

    by_place = cities.drop_duplicates("place").set_index("place")
    out = []
    for r in names.itertuples():
        a = by_place.loc[r.place] if isinstance(r.place, str) and r.place in by_place.index else sheriff
        if a is None:
            out.append({"geoid": r.geoid})
            continue
        out.append({"geoid": r.geoid, "crime_agency": a["agency_name"], "violent_rate": a["violent_rate"],
                    "property_rate": a["property_rate"], "crime_year": a["crime_year"],
                    "crime_months": a["crime_months"], "crime_population": a["crime_population"]})
    df = pd.DataFrame(out)
    df["crime_low_confidence"] = (df.get("crime_months", pd.Series(0, index=df.index)).fillna(0) < 12) | (
        df.get("crime_population", pd.Series(np.nan, index=df.index)).fillna(0) < config.CRIME_MIN_POPULATION)
    unmatched = sorted(set(names["place"].dropna()) - set(by_place.index))
    log.info("crime %s: %d city agencies + %s; places with no police agency of their own (sheriff): %s",
             county_fips, len(cities), "sheriff" if sheriff is not None else "no sheriff", unmatched[:12])
    return df


if __name__ == "__main__":
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    ag = agency_rates(county_agencies(fips))
    print(ag.sort_values("violent_rate").round(0).to_string(index=False))
