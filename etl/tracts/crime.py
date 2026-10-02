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
    confidence. Partial years aren't scaled up.

AGENCIES NOT IN NIBRS: THE YEARLY TABLES (8c, found on California)
    Agencies still reporting the older summary format aren't in the incident
    files — in California that's San Francisco PD and the Los Angeles, Riverside
    and San Bernardino sheriffs. The FBI's yearly "Offenses Known to Law
    Enforcement" tables (cius/{year}/offenses-known-to-le-{year}.zip) list every
    agency that reported a full year, either format:
      Table 8   cities: state, city, population, violent and property crime
      Table 10  sheriffs and county police: state, county, counts (no population)
    They fill in only where the incident files have nothing (an agency absent,
    or present with 0 months). Tables carry no months: they publish full years,
    so 12. A sheriff's population, absent from Table 10, is the population of
    the tracts it serves here (those outside a policed city) — what the FBI's
    own sheriff populations mean: the unincorporated area.

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
        # Mostly UTF-8, but some state-years are Windows-1252 (California 2024: a
        # non-breaking space in an agency name).
        try:
            return pd.read_csv(zf.open(_member(zf, name)), usecols=cols, dtype=str)
        except UnicodeDecodeError:
            return pd.read_csv(zf.open(_member(zf, name)), usecols=cols, dtype=str, encoding="cp1252")

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


CIUS_KEY = "cius/{year}/offenses-known-to-le-{year}.zip"
STATE_NAMES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA",
    "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT",
    "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
    "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}


def _table(zf: zipfile.ZipFile, number: int) -> pd.DataFrame:
    """A CIUS table with its real header row; state filled down; footnote digits stripped."""
    name = next(n for n in zf.namelist() if re.search(rf"(^|/)CIUS_Table_{number}_", n))
    raw = pd.read_excel(zf.open(name), header=None, dtype=str)
    head = raw.index[raw[0].astype(str).str.strip() == "State"][0]
    df = raw.iloc[head + 1:].copy()
    df.columns = [re.sub(r"\s+", " ", str(c)).strip().lower() for c in raw.iloc[head]]
    df["state"] = df["state"].ffill().str.replace(r"[\d,]+$", "", regex=True).str.strip()
    df["st"] = df["state"].str.upper().map({k.upper(): v for k, v in STATE_NAMES.items()})  # 2024: "ALABAMA"
    num = lambda c: pd.to_numeric(df[c].astype(str).str.replace(",", ""), errors="coerce")
    df["violent"], df["property"] = num("violent crime"), num("property crime")
    if "population" in df:
        df["population"] = num("population")
    return df.dropna(subset=["st", "violent"])


@functools.lru_cache(maxsize=4)
def cius(year: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(cities: st, key, agency_name, population, violent, property; sheriffs: st, county_key, violent, property)."""
    cpath, spath = CACHE_DIR / f"cius_{year}_cities.csv", CACHE_DIR / f"cius_{year}_sheriffs.csv"
    if cpath.exists() and spath.exists():
        return pd.read_csv(cpath, dtype=str).astype({"population": float, "violent": float, "property": float}), \
            pd.read_csv(spath, dtype=str).astype({"violent": float, "property": float})
    k = CIUS_KEY.format(year=year)
    r = requests.get(SIGNED_URL, params={"key": k}, timeout=config.HTTP_TIMEOUT,
                     headers={"User-Agent": config.HTTP_USER_AGENT})
    r.raise_for_status()
    url = r.json().get(k)
    empty = (pd.DataFrame(columns=["st", "key", "agency_name", "population", "violent", "property"]),
             pd.DataFrame(columns=["st", "county_key", "violent", "property"]))
    if not url:
        log.warning("CDE has no yearly tables for %d", year)
        return empty
    import io

    body = requests.get(url, timeout=config.HTTP_TIMEOUT).content
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        t8, t10 = _table(zf, 8), _table(zf, 10)
    cities = pd.DataFrame({"st": t8["st"], "agency_name": t8["city"].str.replace(r"[\d,]+$", "", regex=True).str.strip(),
                           "population": t8["population"], "violent": t8["violent"], "property": t8["property"]})
    cities["key"] = cities["agency_name"].map(_norm)
    county = t10["county"].str.replace(r"[\d,]+$", "", regex=True).str.replace(
        r"\s+(Police Department|Sheriff'?s? Office|County Police)$", "", regex=True, flags=re.I)
    sheriffs = pd.DataFrame({"st": t10["st"], "county_key": county.map(_key), "violent": t10["violent"],
                             "property": t10["property"]}).drop_duplicates(["st", "county_key"])
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cities.to_csv(cpath, index=False)
    sheriffs.to_csv(spath, index=False)
    log.info("CIUS %d: %d cities, %d sheriffs (cached)", year, len(cities), len(sheriffs))
    return cities, sheriffs


def _display(a: pd.Series) -> str:
    """The jurisdiction, not the department: contract cities (Santa Clarita, CA) are
    policed by the sheriff but reported under their own name."""
    return str(a["agency_name"]) if a["agency_type"] == "City" else f"{a['agency_name']} County Sheriff"


# Town governments with their own police that Census doesn't count as places
# (New England towns, New Jersey/Pennsylvania townships, Midwest townships) are
# county subdivisions: a tract outside a policed place is matched to its town.
COUSUB_URL = "https://www2.census.gov/geo/tiger/TIGER2024/COUSUB/tl_2024_{state}_cousub.zip"
_SUFFIX = re.compile(r"\b(city|town|township|borough|village|charter township|plantation)$")


def _norm(name: str) -> str:
    """Agency and place names compared without case, punctuation or a civil-division suffix."""
    n = re.sub(r"[^a-z ]", "", str(name).lower()).strip()
    return _SUFFIX.sub("", n).strip()


def _incorporated(county_fips: str, tracts: pd.DataFrame) -> list[str | None]:
    """Each tract's place if it's an incorporated city (FUNCSTAT "A"), else None.

    The yearly tables list cities by name only, statewide; a census-designated
    place (no government, no police) can share a name with a city elsewhere in
    the state — Riverside County's El Cerrito vs the Bay Area's.
    """
    from .names import PLACE_URL

    polys = geo.load_polygons(PLACE_URL.format(state=county_fips[:2]), f"tl_2024_{county_fips[:2]}_place",
                              ["NAME", "FUNCSTAT"])
    polys = [(p, g) for p, g in polys if p.get("FUNCSTAT") == "A"]
    found = geo.locate(tracts["pop_lat"].to_numpy(float), tracts["pop_lon"].to_numpy(float), polys)
    return [f["NAME"] if f else None for f in found]


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


def _from_tables(st: str, years: tuple[int, int], key: str, county_key: str | None = None) -> pd.Series | None:
    """A city (by name key) or, with county_key, a sheriff from the yearly tables: the newest year that has it."""
    for year in years:
        cities, sheriffs = cius(year)
        if county_key is None:
            m = cities[(cities["st"] == st) & (cities["key"] == key)]
            if len(m) == 1:  # two same-named cities in a state: can't tell which, skip
                a = m.iloc[0]
                return pd.Series({"agency_name": a["agency_name"], "agency_type": "City", "crime_year": year,
                                  "crime_months": 12, "crime_population": a["population"],
                                  "violent": a["violent"], "property": a["property"]})
        else:
            m = sheriffs[(sheriffs["st"] == st) & (sheriffs["county_key"] == county_key)]
            if len(m):
                a = m.iloc[0]
                return pd.Series({"agency_name": key, "agency_type": "County", "crime_year": year,
                                  "crime_months": 12, "crime_population": np.nan,
                                  "violent": a["violent"], "property": a["property"]})
    return None


def _with_rates(a: pd.Series) -> pd.Series:
    a = a.copy()
    pop = a["crime_population"]
    scale = 100_000 / pop if pd.notna(pop) and pop > 0 else np.nan
    a["violent_rate"], a["property_rate"] = a["violent"] * scale, a["property"] * scale
    return a


def fetch(county_fips: str, names: pd.DataFrame, tracts: pd.DataFrame, population: pd.DataFrame) -> pd.DataFrame:
    """`names`: geoid, place (names.py); `tracts`: geoid, pop_lat, pop_lon (geo.py); `population`: geoid, population."""
    st = STATE_ABBR[county_fips[:2]].upper()
    years = crime_years(st)
    agencies = county_agencies(county_fips)
    reported = agencies[agencies["crime_months"] > 0]
    cities = reported[reported["agency_type"] == "City"].copy()
    cities["key"] = cities["agency_name"].map(_norm)
    by_name: dict[str, pd.Series] = {k: r for k, r in cities.drop_duplicates("key").set_index("key").iterrows()}
    spine = read_interim("spine")
    county_name = spine.loc[spine["fips"] == county_fips, "county_name"].iloc[0]
    sheriffs = reported[reported["agency_type"] == "County"]
    sheriff = sheriffs.iloc[0] if len(sheriffs) else _from_tables(st, years, re.sub(
        r"\s+(County|Parish|Borough|Census Area|Municipality|City and Borough)$", "", county_name), _key(county_name))
    from_tables: set[str] = set()

    def city(name: object, governed: bool) -> pd.Series | None:
        """The NIBRS agency by that name, or (`governed`: a real city or town) the yearly tables'."""
        if not isinstance(name, str):
            return None
        k = _norm(name)
        if k not in by_name:
            if not governed:
                return None
            extra = _from_tables(st, years, k)
            if extra is None:
                return None
            by_name[k] = _with_rates(extra)
            from_tables.add(extra["agency_name"])
        return by_name[k]

    towns = dict(zip(tracts["geoid"], _towns(county_fips, tracts)))
    incorporated = dict(zip(tracts["geoid"], _incorporated(county_fips, tracts)))
    chosen, via_town = [], 0
    for r in names.itertuples():
        a = city(r.place, governed=incorporated.get(r.geoid) == r.place)
        if a is None and (a := city(towns.get(r.geoid), governed=True)) is not None:
            via_town += 1
        chosen.append(a if a is not None else "sheriff")

    # A sheriff from the yearly tables has no population: use the tracts it serves.
    if sheriff is not None and pd.isna(sheriff["crime_population"]):
        pops = dict(zip(population["geoid"], population["population"]))
        served = sum(pops.get(g, 0) or 0 for g, c in zip(names["geoid"], chosen) if isinstance(c, str))
        sheriff = sheriff.copy()
        sheriff["crime_population"] = served
        sheriff = _with_rates(sheriff)
        from_tables.add(f"{sheriff['agency_name']} sheriff")
    out = []
    for g, c in zip(names["geoid"], chosen):
        a = sheriff if isinstance(c, str) else c
        if a is None:
            out.append({"geoid": g})
            continue
        out.append({"geoid": g, "crime_agency": _display(a), "violent_rate": a["violent_rate"],
                    "property_rate": a["property_rate"], "crime_year": a["crime_year"],
                    "crime_months": a["crime_months"], "crime_population": a["crime_population"]})
    # Same columns whether or not any agency reports (a few rural counties have none).
    df = pd.DataFrame(out).reindex(columns=["geoid", "crime_agency", "violent_rate", "property_rate", "crime_year",
                                            "crime_months", "crime_population"])
    df["crime_low_confidence"] = (df["crime_months"].fillna(0) < 12) | (
        df["crime_population"].fillna(0) < config.CRIME_MIN_POPULATION)
    log.info("crime %s: %d NIBRS city/town agencies, %d tracts matched by town, %s; from the yearly tables: %s",
             county_fips, len(cities), via_town, "sheriff" if sheriff is not None else "no sheriff",
             sorted(from_tables)[:10])
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
