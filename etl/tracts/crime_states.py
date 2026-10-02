"""
State crime programs: agencies the FBI's files miss (plan §9 Phase 8c).

Some states' agencies report to their state program but not (yet) to the FBI
— Florida's switch to FIBRS left the Lake, Manatee and Volusia sheriffs and
others absent from both FBI sources (crime.py) for 2024 and 2025. Where a
state publishes per-agency counts, they fill those gaps: crime.py uses the FBI
first and a state source only for an agency the FBI lacks.

Each source returns one row per agency, in crime.py's shape:
    agency_name   the jurisdiction ("Clermont", "Lake" for a sheriff)
    agency_type   City | County
    county_key    crime._key of the county it's in
    population, months, violent, property

FLORIDA — FDLE FIBRS Offense Detail (https://www.fdle.state.fl.us/CJAB/FIBRS)
    One workbook, a sheet per year: county, agency, population, and monthly
    counts per offense type. Violent = murder, forcible sex offenses, robbery,
    aggravated assault; property = burglary, larceny (all kinds), motor vehicle
    theft. Two differences from the FBI's counting, so FDLE rates run a little
    high: "forcible sex offenses" includes fondling (the FBI's violent total
    doesn't), and offenses are counted per offense, not per victim. Months = the
    months with any offense reported. The file's address changes as FDLE
    updates it, so it's found on the page. Not in it: the Broward Sheriff's
    Office (not on FIBRS yet), so Broward's sheriff-patrolled cities stay a gap.
"""

from __future__ import annotations

import functools
import io
import re

import pandas as pd

from .. import config
from ..util import get_logger, http_get

log = get_logger("tracts.crime_states")

FDLE_PAGE = "https://www.fdle.state.fl.us/CJAB/FIBRS"
FDLE_VIOLENT = ("Murder and Non-Negligent Manslaughter", "Forcible Sex Offenses", "Robbery", "Aggravated Assault")
FDLE_PROPERTY = ("Burglary", "Larceny", "Motor Vehicle Theft")  # "Larceny - …": every kind


@functools.lru_cache(maxsize=1)
def _fdle_workbook() -> pd.ExcelFile | None:
    page = http_get(FDLE_PAGE, use_cache=False, user_agent=config.BROWSER_USER_AGENT)
    m = re.search(r'href="([^"]*FIBRS_Offense_Detail[^"]*\.xlsx[^"]*)"', str(page))
    if not m:
        log.warning("FDLE: no offense workbook linked on %s", FDLE_PAGE)
        return None
    url = m.group(1).replace("&amp;", "&")
    url = url if url.startswith("http") else "https://www.fdle.state.fl.us" + url
    body = http_get(url, binary=True, cache_hint="fdle_fibrs_offense", user_agent=config.BROWSER_USER_AGENT)
    assert isinstance(body, bytes)
    return pd.ExcelFile(io.BytesIO(body))


def _jurisdiction(agency: str) -> tuple[str, str] | None:
    """FDLE agency name -> (jurisdiction, City|County); None for state, tribal and special agencies."""
    a = agency.strip()
    if m := re.match(r"^(.*?) County Sheriff'?s Office$", a, re.I):
        return m.group(1), "County"
    if m := re.match(r"^(?:City|Town|Village) of (.+)$", a, re.I):
        return m.group(1), "City"
    if m := re.match(r"^(.*?) Police Department$", a, re.I):
        return m.group(1), "City"
    return None


def fdle(year: int) -> pd.DataFrame:
    from .crime import _key

    cols = ["agency_name", "agency_type", "county_key", "population", "months", "violent", "property"]
    wb = _fdle_workbook()
    sheet = f"FIBRS Offense {year}"
    if wb is None or sheet not in wb.sheet_names:
        return pd.DataFrame(columns=cols)
    raw = pd.read_excel(wb, sheet, header=None)
    cats = raw.iloc[1].ffill().astype(str).str.strip()
    body = raw.iloc[3:].reset_index(drop=True)
    body = body[body[0].notna() & body[1].notna()]
    month_cols = [c for c in raw.columns if re.match(rf"^{year} \w{{3}}$", str(raw.iloc[2, c]).strip())]

    def total(prefixes: tuple[str, ...]) -> pd.DataFrame:
        cs = [c for c in month_cols if cats[c].startswith(prefixes)]
        return body[cs].apply(pd.to_numeric, errors="coerce").fillna(0)

    violent, prop = total(FDLE_VIOLENT), total(FDLE_PROPERTY)
    all_months = body[month_cols].apply(pd.to_numeric, errors="coerce").fillna(0)
    # Months with anything reported, across every offense type (columns repeat Jan–Dec per type).
    by_month = all_months.T.groupby([str(raw.iloc[2, c]).strip() for c in month_cols]).sum().T
    rows = []
    for i, r in body.iterrows():
        j = _jurisdiction(str(r[1]))
        pop = pd.to_numeric(r[2], errors="coerce")
        if j is None or not pop or pd.isna(pop):
            continue
        rows.append({"agency_name": j[0], "agency_type": j[1], "county_key": _key(str(r[0])),
                     "population": float(pop), "months": int((by_month.loc[i] > 0).sum()),
                     "violent": float(violent.loc[i].sum()), "property": float(prop.loc[i].sum())})
    out = pd.DataFrame(rows, columns=cols)
    log.info("FDLE %d: %d city and county agencies", year, len(out))
    return out


SOURCES = {"FL": fdle}


@functools.lru_cache(maxsize=16)
def agencies(st: str, year: int) -> pd.DataFrame:
    """A state's own per-agency counts for a year (empty where no state source)."""
    source = SOURCES.get(st.upper())
    return source(year) if source else pd.DataFrame(
        columns=["agency_name", "agency_type", "county_key", "population", "months", "violent", "property"])
