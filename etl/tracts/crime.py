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

SOURCE: THE BULK NIBRS FILES, NOT THE API (8c)
    CDE publishes each state's full year of incident data as one zip
    (Documents & Downloads, "Crime Incident-Based Data by State"; Texas 2025
    is 116 MB). The CDE API needed 2–4 calls per agency against a 1,000/hour
    quota and answered 503s under load — days for the country. The zip has no
    quota and holds everything needed:
      agencies.csv         ORI, name, type (City/County/…), counties, population
      NIBRS_month.csv      which months each agency reported
      NIBRS_incident.csv   incident -> agency
      NIBRS_OFFENSE.csv    offense code per incident
      NIBRS_VICTIM_OFFENSE.csv  victims per offense
    Counted the way the FBI's summary counts are (and the API's were — checked
    on 64 Texas agencies, median ratio 1.00 for both): violent crime is murder,
    rape (11A–C), robbery and aggravated assault, one per VICTIM except robbery
    (one per offense); property crime is burglary, larceny-theft (23A–H) and
    motor vehicle theft, one per offense (arson is separate in FBI totals).
    Each state-year is reduced to one row per agency, cached in
    data/interim/crime/ (the zip is deleted after).

THE YEAR AND LOW CONFIDENCE
    The newest year CDE has published for the state (found by asking for this
    year's file, then last year's…; config.CRIME_YEAR pins it), so a monthly
    rebuild picks up a new year by itself. An agency that didn't report all 12
    months falls back to the year before if that year is more complete. Fewer than
    12 months, no data at all, or an agency serving fewer than
    CRIME_MIN_POPULATION people (tiny towns with a mall), makes the value low
    confidence. Partial years aren't scaled up. Agencies that report only the
    older summary format (not NIBRS) aren't in these files: their tracts get
    no rate, flagged low confidence.

RUN STANDALONE
    python -m etl.tracts.crime 48453              # one county's agencies
    python -m etl.tracts.crime --state TX         # fetch and reduce a state's files
"""

from __future__ import annotations

import functools
import re
from datetime import date
import sys
import zipfile

import numpy as np
import pandas as pd
import requests

from .. import config
from ..util import get_logger, read_interim
from . import geo
from .geo import STATE_ABBR

log = get_logger("tracts.crime")

KEEP_TYPES = {"City", "County"}
SIGNED_URL = "https://cde.ucr.cjis.gov/LATEST/s3/signedurl"
CACHE_DIR = config.INTERIM_DIR / "crime"

VIOLENT = {"09A", "11A", "11B", "11C", "120", "13A"}
PROPERTY = {"220", "23A", "23B", "23C", "23D", "23E", "23F", "23G", "23H", "240"}
PER_OFFENSE = {"120"}  # robbery counts once per offense; the other violent crimes once per victim


def _key(name: str) -> str:
    """County names compared without case, spaces or punctuation ("DE WITT" = "DeWitt")."""
    name = re.sub(r"\s+(County|Parish|Borough|Census Area|Municipality|City and Borough)$", "", name.strip(), flags=re.I)
    return re.sub(r"[^A-Z]", "", name.upper())


def _signed_url(st: str, year: int) -> str | None:
    k = f"nibrs/incident/{year}/{st}-{year}.zip"
    r = requests.get(SIGNED_URL, params={"key": k}, timeout=config.HTTP_TIMEOUT,
                     headers={"User-Agent": config.HTTP_USER_AGENT})
    r.raise_for_status()
    return r.json().get(k)


@functools.lru_cache(maxsize=64)
def crime_years(st: str) -> tuple[int, int]:
    """(year, fallback year) for a state: the newest published, or config.CRIME_YEAR."""
    if config.CRIME_YEAR:
        return config.CRIME_YEAR, config.CRIME_YEAR - 1
    this = date.today().year
    for year in range(this, this - 4, -1):
        if (CACHE_DIR / f"nibrs_{st}_{year}.csv").exists() or _signed_url(st, year):
            return year, year - 1
    raise RuntimeError(f"no NIBRS file for {st} in {this - 3}–{this}")


def _download(st: str, year: int) -> zipfile.ZipFile | None:
    """The state's NIBRS zip for a year, or None if CDE hasn't published it."""
    path = config.RAW_DIR / f"nibrs_{st}-{year}.zip"
    if not path.exists():
        url = _signed_url(st, year)
        if not url:
            log.warning("CDE has no NIBRS file for %s %d", st, year)
            return None
        log.info("downloading NIBRS %s %d…", st, year)
        tmp = path.with_suffix(".part")
        with requests.get(url, stream=True, timeout=config.HTTP_TIMEOUT) as resp:
            resp.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8 << 20):
                    f.write(chunk)
        tmp.rename(path)
    return zipfile.ZipFile(path)


def _member(zf: zipfile.ZipFile, name: str) -> str:
    """Member names vary in case across years ("NIBRS_incident.csv", "nibrs_incident.csv")."""
    return next(n for n in zf.namelist() if n.split("/")[-1].lower() == name.lower())


def _reduce(zf: zipfile.ZipFile) -> pd.DataFrame:
    """One row per agency: ori, agency_name, agency_type, counties, population, months, violent, property."""
    def read(name: str, cols: list[str]) -> pd.DataFrame:
        return pd.read_csv(zf.open(_member(zf, name)), usecols=cols, dtype=str)

    ag = read("agencies.csv", ["agency_id", "ori", "pub_agency_name", "agency_type_name", "county_name", "population"])
    months = read("NIBRS_month.csv", ["agency_id", "month_num"]).groupby("agency_id")["month_num"].nunique()
    off = read("NIBRS_OFFENSE.csv", ["offense_id", "incident_id", "offense_code"])
    off = off[off["offense_code"].isin(VIOLENT | PROPERTY)]
    off = off.merge(read("NIBRS_incident.csv", ["incident_id", "agency_id"]), on="incident_id")
    victims = read("NIBRS_VICTIM_OFFENSE.csv", ["offense_id"]).value_counts("offense_id").rename("victims")
    off = off.merge(victims, left_on="offense_id", right_index=True, how="left")
    per_victim = off["offense_code"].isin(VIOLENT - PER_OFFENSE)
    off["violent"] = np.where(per_victim, off["victims"].fillna(1), off["offense_code"].isin(PER_OFFENSE))
    off["property"] = off["offense_code"].isin(PROPERTY)
    counts = off.groupby("agency_id")[["violent", "property"]].sum()
    out = ag.set_index("agency_id").join(months.rename("months")).join(counts).reset_index(drop=True)
    out = out.rename(columns={"pub_agency_name": "agency_name", "agency_type_name": "agency_type", "county_name": "counties"})
    out["population"] = pd.to_numeric(out["population"], errors="coerce")
    out["months"] = out["months"].fillna(0).astype(int)
    out[["violent", "property"]] = out[["violent", "property"]].fillna(0)
    return out


@functools.lru_cache(maxsize=8)
def state_agencies(st: str, year: int) -> pd.DataFrame:
    """Every agency in a state for one year (empty if CDE has no file). Cached per state-year."""
    st = st.upper()
    path = CACHE_DIR / f"nibrs_{st}_{year}.csv"
    if path.exists():
        return pd.read_csv(path, dtype={"ori": str, "counties": str})
    zf = _download(st, year)
    if zf is None:
        return pd.DataFrame(columns=["ori", "agency_name", "agency_type", "counties", "population", "months",
                                     "violent", "property"])
    with zf:
        df = _reduce(zf)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    (config.RAW_DIR / f"nibrs_{st}-{year}.zip").unlink()  # 100+ MB a state-year; the reduction is the cache
    log.info("NIBRS %s %d: %d agencies, %d with 12 months (cached)", st, year, len(df), (df["months"] == 12).sum())
    return df


def county_agencies(county_fips: str) -> pd.DataFrame:
    """City and county agencies serving a county, each from its most complete year, with rates."""
    spine = read_interim("spine")
    key = _key(spine.loc[spine["fips"] == county_fips, "county_name"].iloc[0])
    st = STATE_ABBR[county_fips[:2]].upper()

    def pick(year: int) -> pd.DataFrame:
        df = state_agencies(st, year)
        serves = df["counties"].fillna("").map(lambda s: key in {_key(c) for c in s.split(",")})
        return df[serves & df["agency_type"].isin(KEEP_TYPES)].assign(crime_year=year)

    main, fallback = (pick(y) for y in crime_years(st))
    both = pd.concat([main, fallback]).sort_values(["months", "crime_year"], ascending=False)
    df = both.drop_duplicates("ori").copy()
    scale = 100_000 / df["population"].where(df["population"] > 0)
    has = df["months"] > 0
    df["violent_rate"] = (df["violent"] * scale).where(has)
    df["property_rate"] = (df["property"] * scale).where(has)
    return df.rename(columns={"months": "crime_months", "population": "crime_population"})


def _display(a: pd.Series) -> str:
    return f"{a['agency_name']} Police" if a["agency_type"] == "City" else f"{a['agency_name']} County Sheriff"


# Town governments with their own police that Census doesn't count as places
# (New England towns, New Jersey/Pennsylvania townships, Midwest townships) are
# county subdivisions: a tract outside a policed place is matched to its town.
COUSUB_URL = "https://www2.census.gov/geo/tiger/TIGER2024/COUSUB/tl_2024_{state}_cousub.zip"
_SUFFIX = re.compile(r"\b(city|town|township|borough|village|charter township|plantation)$")


def _norm(name: str) -> str:
    """Agency and place names compared without case, punctuation or a civil-division suffix."""
    n = re.sub(r"[^a-z ]", "", str(name).lower()).strip()
    return _SUFFIX.sub("", n).strip()


def _towns(county_fips: str, tracts: pd.DataFrame) -> list[str | None]:
    """Each tract's county subdivision (by its population center), if it's a government.

    Only FUNCSTAT "A" (an active government, like a New England town or a
    township): elsewhere subdivisions are statistical (Texas's "Austin CCD")
    and would hand unincorporated tracts to a city's police.
    """
    polys = geo.load_polygons(COUSUB_URL.format(state=county_fips[:2]), f"tl_2024_{county_fips[:2]}_cousub",
                              ["NAME", "COUNTYFP", "FUNCSTAT"])
    polys = [(p, g) for p, g in polys if p.get("COUNTYFP") == county_fips[2:] and p.get("FUNCSTAT") == "A"]
    found = geo.locate(tracts["pop_lat"].to_numpy(float), tracts["pop_lon"].to_numpy(float), polys)
    return [f["NAME"] if f else None for f in found]


def fetch(county_fips: str, names: pd.DataFrame, tracts: pd.DataFrame) -> pd.DataFrame:
    """`names` needs geoid and place (names.py); `tracts` geoid, pop_lat, pop_lon (geo.py)."""
    agencies = county_agencies(county_fips)
    cities = agencies[agencies["agency_type"] == "City"].copy()
    cities["key"] = cities["agency_name"].map(_norm)
    by_name = cities.drop_duplicates("key").set_index("key")
    sheriff = agencies[agencies["agency_type"] == "County"]
    sheriff = sheriff.iloc[0] if len(sheriff) else None

    towns = dict(zip(tracts["geoid"], _towns(county_fips, tracts))) if len(cities) else {}
    out, via_town = [], 0
    for r in names.itertuples():
        a = None
        if isinstance(r.place, str) and _norm(r.place) in by_name.index:
            a = by_name.loc[_norm(r.place)]
        elif isinstance(towns.get(r.geoid), str) and _norm(towns[r.geoid]) in by_name.index:
            a, via_town = by_name.loc[_norm(towns[r.geoid])], via_town + 1
        else:
            a = sheriff
        if a is None:
            out.append({"geoid": r.geoid})
            continue
        out.append({"geoid": r.geoid, "crime_agency": _display(a), "violent_rate": a["violent_rate"],
                    "property_rate": a["property_rate"], "crime_year": a["crime_year"],
                    "crime_months": a["crime_months"], "crime_population": a["crime_population"]})
    # Same columns whether or not any agency reports (a few rural counties have none).
    df = pd.DataFrame(out).reindex(columns=["geoid", "crime_agency", "violent_rate", "property_rate", "crime_year",
                                            "crime_months", "crime_population"])
    df["crime_low_confidence"] = (df["crime_months"].fillna(0) < 12) | (
        df["crime_population"].fillna(0) < config.CRIME_MIN_POPULATION)
    unmatched = sorted({p for p in names["place"].dropna() if _norm(p) not in by_name.index})
    log.info("crime %s: %d city/town agencies (%d tracts matched by town) + %s; places without their own: %s",
             county_fips, len(cities), via_town, "sheriff" if sheriff is not None else "no sheriff", unmatched[:12])
    return df


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--state":
        st = sys.argv[2].upper()
        for y in crime_years(st):
            state_agencies(st, y)
    else:
        fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
        ag = county_agencies(fips)
        cols = ["ori", "agency_name", "agency_type", "crime_year", "crime_months", "crime_population",
                "violent_rate", "property_rate"]
        print(ag[cols].sort_values("violent_rate").round(0).to_string(index=False))
