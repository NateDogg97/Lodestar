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
import time
import zipfile

import numpy as np
import pandas as pd
import requests

from .. import config
from ..util import get_logger, read_interim
from . import geo
from .geo import STATE_ABBR

log = get_logger("tracts.crime")

# "State Police": the patrol for towns without their own police in states that
# report it per county with a population (Pennsylvania). It plays the sheriff's part.
KEEP_TYPES = {"City", "County", "State Police"}
COUNTY_LEVEL = {"County", "State Police", "County+State Police"}
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
    """A download link for the state-year's file, or None if CDE hasn't published it.
    Retried: the CDE site times out now and then (2026-10-02)."""
    k = f"nibrs/incident/{year}/{st}-{year}.zip"
    for attempt in range(3):
        try:
            r = requests.get(SIGNED_URL, params={"key": k}, timeout=config.HTTP_TIMEOUT,
                             headers={"User-Agent": config.HTTP_USER_AGENT})
            r.raise_for_status()
            return r.json().get(k)
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(10 * (attempt + 1))
    return None


@functools.lru_cache(maxsize=64)
def crime_years(st: str) -> tuple[int, int]:
    """(year, fallback year) for a state: the newest published, or config.CRIME_YEAR."""
    if config.CRIME_YEAR:
        return config.CRIME_YEAR, config.CRIME_YEAR - 1
    this = date.today().year
    try:
        for year in range(this, this - 4, -1):
            if (CACHE_DIR / f"nibrs_{st}_{year}.csv").exists() or _signed_url(st, year):
                return year, year - 1
    except requests.RequestException as exc:
        # CDE unreachable: a year already downloaded beats failing every county.
        cached = sorted(int(p.stem.rsplit("_", 1)[1]) for p in CACHE_DIR.glob(f"nibrs_{st}_*.csv"))
        if not cached:
            raise
        log.warning("CDE unreachable (%s): using %s %d, already downloaded", type(exc).__name__, st, cached[-1])
        return cached[-1], cached[-1] - 1
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
    # "State Police: State Police" names nothing; name it after the county it covers here.
    county_label = re.sub(r"\s+(County|Parish|Borough|Census Area|Municipality|City and Borough)$", "",
                          spine.loc[spine["fips"] == county_fips, "county_name"].iloc[0])
    main, fallback = (d.assign(agency_name=d["agency_name"].where(d["agency_type"] != "State Police", county_label))
                      for d in (main, fallback))
    both = pd.concat([main, fallback]).sort_values(["months", "crime_year"], ascending=False)
    df = both.drop_duplicates("ori").copy()

    # The state's own program (crime_states.py) for agencies the FBI lacks or has nothing for.
    from . import crime_states

    have = {(_norm(n), t) for n, t, m in zip(df["agency_name"], df["agency_type"], df["months"]) if m > 0}
    extra = []
    for year in crime_years(st):
        s_ = crime_states.agencies(st, year)
        s_ = s_[s_["county_key"] == key].assign(crime_year=year, ori=None, counties=key)
        extra.append(s_[[(_norm(n), t) not in have for n, t in zip(s_["agency_name"], s_["agency_type"])]])
    if extra and any(len(e) for e in extra):
        state = pd.concat(extra).sort_values(["months", "crime_year"], ascending=False)
        state = state.drop_duplicates(["agency_name", "agency_type"]).drop(columns="county_key")
        df = pd.concat([df, state.assign(source="state")], ignore_index=True)
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
    # "CIUS_Table_8_…" since 2024; "Table_8_…" in 2023 (beside zipped per-state cuts).
    name = next(n for n in zf.namelist() if re.search(rf"(^|/)(CIUS_)?Table_{number}_.*\.xlsx$", n))
    raw = pd.read_excel(zf.open(name), header=None, dtype=str)
    head = raw.index[raw[0].astype(str).str.strip() == "State"][0]
    df = raw.iloc[head + 1:].copy()
    df.columns = [re.sub(r"\s+", " ", str(c)).strip().lower() for c in raw.iloc[head]]
    df["state"] = (df["state"].ffill().str.replace(r"\s*-\s*(Metropolitan|Nonmetropolitan).*$", "", regex=True)  # 2023
                   .str.replace(r"[\d,]+$", "", regex=True).str.strip())
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
    # Several rows for one county (a sheriff and a county police): the one with the most
    # offenses is the one that patrols.
    sheriffs = pd.DataFrame({"st": t10["st"], "county_key": county.map(_key), "violent": t10["violent"],
                             "property": t10["property"]})
    sheriffs = sheriffs.assign(total=sheriffs["violent"] + sheriffs["property"]).sort_values(
        "total", ascending=False).drop_duplicates(["st", "county_key"]).drop(columns="total")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cities.to_csv(cpath, index=False)
    sheriffs.to_csv(spath, index=False)
    log.info("CIUS %d: %d cities, %d sheriffs (cached)", year, len(cities), len(sheriffs))
    return cities, sheriffs


def county_label_of(county_name: str) -> str:
    return re.sub(r"\s+(County|Parish|Borough|Census Area|Municipality|City and Borough)$", "", county_name)


def _display(a: pd.Series) -> str:
    """The jurisdiction, not the department: contract cities (Santa Clarita, CA) are
    policed by the sheriff but reported under their own name."""
    # A county-level agency may be the sheriff or a county police department (Nassau, NY):
    # the FBI's type doesn't say which.
    if a["agency_type"] == "City":
        return str(a["agency_name"])
    if a["agency_type"] == "County+State Police":
        return f"{a['agency_name']} County (sheriff and State Police)"
    if a["agency_type"] == "State Police":
        return f"State Police in {a['agency_name']} County"
    # Some files give the full name ("Fairfax County Police Department"): say which it is.
    if m := re.match(r"^(.*?)\s+County\s+(Police|Sheriff)", str(a["agency_name"]), re.I):
        return f"{m.group(1)} County {'Police' if m.group(2).lower() == 'police' else 'Sheriff'}"
    return f"{a['agency_name']} County (sheriff or county police)"


# Town governments with their own police that Census doesn't count as places
# (New England towns, New Jersey/Pennsylvania townships, Midwest townships) are
# county subdivisions: a tract outside a policed place is matched to its town.
COUSUB_URL = "https://www2.census.gov/geo/tiger/TIGER2024/COUSUB/tl_2024_{state}_cousub.zip"
_SUFFIX = re.compile(r"\b(charter township|township|city|town|borough|village|plantation)$")

# Plausibility (8c, found on New York). New York's State Police handle most
# rural crime and aren't in these files, so a New York sheriff's count covers a
# sliver of the county (Suffolk: 45 violent crimes "for" 1.26M people — its
# county police department doesn't report). No real jurisdiction this big is
# this safe: below the floor, show nothing rather than a wrong number. A
# county agency merely low is shown but flagged.
IMPLAUSIBLE_RATE, IMPLAUSIBLE_POP = 20.0, 50_000
# Property crime is common everywhere (US ~1,800/100k; the safest real towns a
# few hundred): under 100 for 10,000+ people means partial reporting — an agency
# mid-switch to a new system (Deltona, FL: 14 in a year for 98,792 people).
IMPLAUSIBLE_PROPERTY, IMPLAUSIBLE_PROPERTY_POP = 100.0, 10_000
LOW_COUNTY_RATE = 50.0
# A suffix-less agency name may be a town's police (New England: "Bristol"), or a
# village's that happens to share its township's name (Illinois: the Village of
# Thornton, 2,400 people, vs Thornton Township, 170,000 — townships there don't
# police). Matched by town, an agency serving over this many times its own
# population isn't that town's police.
TOWN_MATCH_MAX_RATIO = 2.0


def _norm(name: str) -> str:
    """Agency and place names compared without case, punctuation or a civil-division suffix."""
    n = re.sub(r"[^a-z ]", "", str(name).lower()).strip()
    return _SUFFIX.sub("", n).strip()


def _kind(name: str) -> str | None:
    """The civil-division word an agency name ends with ("Hempstead Village" -> village), if any."""
    m = _SUFFIX.search(re.sub(r"[^a-z ]", "", str(name).lower()).strip())
    return None if m is None else "township" if "township" in m.group(1) else m.group(1)


def _area_kind(name: str, namelsad: str) -> str:
    """A Census area's kind from its legal name: "Hempstead village" -> village, "Brentwood CDP" -> cdp."""
    rest = str(namelsad)[len(str(name)):].strip().lower()
    return "township" if "township" in rest else rest


def _compatible(agency_kind: str | None, area_kind: str) -> bool:
    """A village's police serve the village, a town's the town (New York has both, same name:
    Mamaroneck Town and Mamaroneck Village); an agency named without a suffix serves either."""
    return agency_kind is None or agency_kind == area_kind


def _areas(url: str, hint: str, tracts: pd.DataFrame, keep, extra: tuple[str, ...] = ()
           ) -> list[tuple[str, str, bool] | None]:
    """Each tract's area (by population center): (name, kind, is a government)."""
    polys = geo.load_polygons(url, hint, ["NAME", "NAMELSAD", "FUNCSTAT", *extra])
    polys = [(p, g) for p, g in polys if keep(p)]
    found = geo.locate(tracts["pop_lat"].to_numpy(float), tracts["pop_lon"].to_numpy(float), polys)
    return [None if f is None else (f["NAME"], _area_kind(f["NAME"], f["NAMELSAD"]), f.get("FUNCSTAT") == "A")
            for f in found]


def _places(county_fips: str, tracts: pd.DataFrame) -> list[tuple[str, str, bool] | None]:
    """Census places, incorporated or not. Only incorporated ones (FUNCSTAT "A") may use the
    statewide yearly tables: a census-designated place (no government, no police) can share
    a name with a city elsewhere in the state — Riverside County's El Cerrito vs the Bay Area's."""
    from .names import PLACE_URL

    st = county_fips[:2]
    return _areas(PLACE_URL.format(state=st), f"tl_2024_{st}_place", tracts, lambda p: True)


def _towns(county_fips: str, tracts: pd.DataFrame) -> list[tuple[str, str, bool] | None]:
    """County subdivisions that are governments (FUNCSTAT "A": a New England town, a
    township). Elsewhere subdivisions are statistical (Texas's "Austin CCD") and would hand
    unincorporated tracts to a city's police."""
    st = county_fips[:2]
    return _areas(COUSUB_URL.format(state=st), f"tl_2024_{st}_cousub", tracts,
                  lambda p: p.get("COUNTYFP") == county_fips[2:] and p.get("FUNCSTAT") == "A", ("COUNTYFP",))


# New England town names are unique statewide; elsewhere townships repeat across
# counties (Pennsylvania has many Butler Townships), and the yearly tables name
# a city only by state.
UNIQUE_TOWN_STATES = {"CT", "MA", "ME", "NH", "RI", "VT"}


def _from_tables(st: str, years: tuple[int, int], key: str, kind: str | None = None,
                 county_key: str | None = None, full_name: bool = False) -> pd.Series | None:
    """A city (name key, area kind) or, with county_key, a county agency from the yearly tables:
    the newest year that has it."""
    for year in years:
        cities, sheriffs = cius(year)
        if county_key is None:
            m = cities[(cities["st"] == st) & (cities["key"] == key)]
            m = m.loc[m["agency_name"].map(lambda n: _kind(n) == kind if full_name else _compatible(_kind(n), kind or ""))
                      .astype(bool)]
            exact = m[m["agency_name"].map(_kind) == kind]
            m = exact if len(exact) else m
            if len(m) == 1:  # two same-named, same-kind cities in a state: can't tell which, skip
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


def _plausible(a: pd.Series | None) -> bool:
    if a is None:
        return False
    pop, rate, prop = a.get("crime_population"), a.get("violent_rate"), a.get("property_rate")
    if pd.isna(pop):
        return True
    too_safe = pop >= IMPLAUSIBLE_POP and pd.notna(rate) and rate < IMPLAUSIBLE_RATE
    too_quiet = pop >= IMPLAUSIBLE_PROPERTY_POP and pd.notna(prop) and prop < IMPLAUSIBLE_PROPERTY
    nothing = pop >= 5_000 and prop == 0  # a year without one theft: not reporting (Reading Twp, PA)
    return not (too_safe or too_quiet or nothing)


def fetch(county_fips: str, names: pd.DataFrame, tracts: pd.DataFrame, population: pd.DataFrame) -> pd.DataFrame:
    """`names`: geoid (names.py); `tracts`: geoid, pop_lat, pop_lon (geo.py); `population`: geoid, population."""
    st = STATE_ABBR[county_fips[:2]].upper()
    years = crime_years(st)
    # The yearly tables reach one year further back, for agencies silent since (New
    # Orleans PD isn't in the FBI's 2024 or 2025 files): shown with its year, flagged.
    table_years = (*years, years[1] - 1)
    agencies = county_agencies(county_fips)
    reported = agencies[agencies["crime_months"] > 0]
    cities = reported[reported["agency_type"] == "City"].copy()
    by_name: dict[str, list[pd.Series]] = {}
    for _, r in cities.iterrows():
        by_name.setdefault(_norm(r["agency_name"]), []).append(r)
    spine = read_interim("spine")
    county_name = spine.loc[spine["fips"] == county_fips, "county_name"].iloc[0]
    # With both a sheriff and a county police department, the one that polices people
    # is the one the FBI gives a population (then: the most offenses).
    # Population 0: not a patrol agency (Allegheny County Police: parks, the airport).
    county_agencies_ = reported[reported["agency_type"].isin(COUNTY_LEVEL)
                                & (reported["crime_population"].fillna(0) > 0)].sort_values(
        ["crime_population", "violent"], ascending=False)
    # The yearly tables' county row (population inferred from the tracts left over) only
    # where the FBI's file has no county-level agency at all — California's absent
    # sheriffs. One listed with population 0 means no county patrol (Allegheny, PA:
    # every town has its own police or the State Police), so leftovers stay blank.
    # (Listed but never reporting — months 0 — is just absent: LA's sheriff.)
    listed = (reported["agency_type"].isin(COUNTY_LEVEL) & (reported["crime_population"].fillna(0) == 0)).any()
    sheriff = county_agencies_.iloc[0] if len(county_agencies_) else None if listed else _from_tables(
        st, table_years, re.sub(r"\s+(County|Parish|Borough|Census Area|Municipality|City and Borough)$", "", county_name),
        county_key=_key(county_name))
    # Sheriff and State Police splitting a county's patrol (Carroll, MD): the FBI gives
    # nearly all the population to one, so each alone looks absurd (19/100k; a sheriff
    # "serving" 2,793). Together they're the county's patrol: one figure.
    if len(county_agencies_) > 1 and county_agencies_["agency_type"].nunique() > 1:
        g = county_agencies_
        sheriff = _with_rates(pd.Series({
            "agency_name": county_label_of(county_name), "agency_type": "County+State Police",
            "crime_year": g["crime_year"].max(), "crime_months": g["crime_months"].min(),
            "crime_population": g["crime_population"].sum(),
            "violent": g["violent"].sum(), "property": g["property"].sum()}))
    from_tables: set[str] = set()

    def lookup(area: tuple[str, str, bool] | None, town: bool = False) -> pd.Series | None:
        """The police for an area: NIBRS agency of a compatible kind, or (a government) the yearly tables'.
        A town matches the statewide tables only by its full name ("Butler Township"), outside New England."""
        if area is None:
            return None
        name, kind, governed = area
        k = _norm(name)
        found = sorted((a for a in by_name.get(k, []) if _compatible(_kind(a["agency_name"]), kind)),
                       key=lambda a: _kind(a["agency_name"]) != kind)
        if found:
            return found[0]
        if not governed:
            return None
        extra = _from_tables(st, table_years, k, kind, full_name=town and st not in UNIQUE_TOWN_STATES)
        if extra is None:
            return None
        extra = _with_rates(extra)
        by_name.setdefault(k, []).append(extra)
        from_tables.add(extra["agency_name"])
        return extra

    places = _places(county_fips, tracts)
    towns = _towns(county_fips, tracts)
    pops = dict(zip(population["geoid"], population["population"]))
    chosen, by_town, dropped = [], [], set()
    for place, town in zip(places, towns):
        a = lookup(place)
        town_match = a is None and (a := lookup(town, town=True)) is not None
        if a is not None and not _plausible(a):
            # The city polices itself but its numbers are partial: no rate. The
            # county's would describe somewhere else (Long Beach, NY isn't Nassau's).
            dropped.add(a["agency_name"])
            chosen.append(None)
            by_town.append(False)
            continue
        chosen.append(a if a is not None else "sheriff")
        by_town.append(town_match)

    # Undo town matches that would have an agency serve far more people than it does.
    served: dict[str, float] = {}
    for g, c in zip(tracts["geoid"], chosen):
        if c is not None and not isinstance(c, str):
            served[c["agency_name"]] = served.get(c["agency_name"], 0) + (pops.get(g, 0) or 0)
    too_big = {name for name, n in served.items()
               if any(c is not None and not isinstance(c, str) and c["agency_name"] == name and pd.notna(c["crime_population"])
                      and n > TOWN_MATCH_MAX_RATIO * c["crime_population"] for c in chosen)}
    undone: set[str] = set()
    for i, c in enumerate(chosen):
        if by_town[i] and c is not None and not isinstance(c, str) and c["agency_name"] in too_big:
            undone.add(c["agency_name"])
            chosen[i], by_town[i] = "sheriff", False
    via_town = sum(by_town)

    # A sheriff from the yearly tables has no population: use the tracts it serves.
    if sheriff is not None and pd.isna(sheriff["crime_population"]):
        served = sum(pops.get(g, 0) or 0 for g, c in zip(tracts["geoid"], chosen) if isinstance(c, str))
        sheriff = sheriff.copy()
        sheriff["crime_population"] = served
        sheriff = _with_rates(sheriff)
        from_tables.add(f"{sheriff['agency_name']} sheriff")
    if sheriff is not None and not _plausible(sheriff):
        dropped.add(f"{sheriff['agency_name']} County")
        sheriff = None
    out = []
    for g, c in zip(tracts["geoid"], chosen):
        a = sheriff if isinstance(c, str) else c  # None: a city whose own numbers were dropped
        if a is None:
            out.append({"geoid": g})
            continue
        out.append({"geoid": g, "crime_agency": _display(a), "violent_rate": a["violent_rate"],
                    "property_rate": a["property_rate"], "crime_year": a["crime_year"],
                    "crime_months": a["crime_months"], "crime_population": a["crime_population"],
                    "crime_county_low": a["agency_type"] in COUNTY_LEVEL and a["violent_rate"] < LOW_COUNTY_RATE})
    # Same columns whether or not any agency reports (a few rural counties have none).
    df = pd.DataFrame(out).reindex(columns=["geoid", "crime_agency", "violent_rate", "property_rate", "crime_year",
                                            "crime_months", "crime_population", "crime_county_low"])
    # A number older than the two newest years (an agency silent since) is flagged.
    df["crime_low_confidence"] = (df["crime_year"].fillna(0) < years[1]) | (df["crime_months"].fillna(0) < 12) | (
        df["crime_population"].fillna(0) < config.CRIME_MIN_POPULATION) | df["crime_county_low"].fillna(False).astype(bool)
    df = df.drop(columns=["crime_county_low"])
    log.info("crime %s: %d NIBRS city/town agencies, %d tracts matched by town, %s; from the yearly tables: %s%s%s",
             county_fips, len(cities), via_town, "sheriff" if sheriff is not None else "no sheriff",
             sorted(from_tables)[:10], f"; implausibly low, dropped: {sorted(dropped)}" if dropped else "",
             f"; not their town's police: {sorted(undone)}" if undone else "")
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
