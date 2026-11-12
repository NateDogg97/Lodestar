"""
SOURCE: schools — the tract's school district, and the scored schools near it.

WHAT THIS PRODUCES
    tracts(county) -> one row per tract:
        geoid, district_id, district_name,
        district_score        SEDA achievement, grade levels vs the US average
        district_pctl         national percentile among all US districts (0–100)
        district_rank, district_count   rank among the districts serving the county
        nearby_schools        ";"-joined school ids: up to 3 elementary and 2 middle
                              scored schools nearest to where people live, INSIDE THE
                              AREA'S DISTRICT BOUNDARY (see IN THE DISTRICT)
        nearby_school_pctl    the area's schools, as a national percentile among school
                              districts: its district's (`district_pctl`); or, in a
                              district with BIG_DISTRICT_SCHOOLS+ scored schools (or one
                              SEDA has no score for), the mean score of those nearest
                              schools placed among the districts. That is what
                              separates neighborhoods inside a one-district city
                              (Chicago Public Schools is one district: every Chicago
                              tract has the same district score).
        school_basis          "district" or "nearby": which of the two it is
        nearby_high_schools   ";"-joined ids of the 2 nearest high schools inside the
                              area's (secondary or unified) district
        nearby_hs_pctl        their mean national percentile for college-prep access
    schools(county) -> one row per scored school located in the county:
        school_id, name, level (elementary / middle / high), city, lat, lon,
        score, pctl (national, among schools of the same level),
        county_rank, county_count (among the county's scored schools of that level)
        + for high schools: ap_courses, ap_share, dual_share, satact_share, ib,
          enrollment. Their `score` is college-prep access (see HIGH SCHOOLS).

HIGH SCHOOLS (added 2026-10-01): CRDC 2023–24
    SEDA covers grades 3–8, so high schools come from the Civil Rights Data
    Collection 2023–24 public-use file (civilrightsdata.ed.gov; ~100 MB zip,
    downloaded once): AP courses offered and students enrolled in AP, dual
    enrollment, SAT/ACT takers, IB, enrollment. National and comparable across
    states — unlike state test scores. Ranked by COLLEGE-PREP ACCESS: the mean
    of the school's national percentiles for AP participation (students in AP
    / enrollment) and AP courses offered. Participation alone put charters
    that enroll everyone in AP (KIPP: 98%, 17 courses) above LASA (75%, 30)
    and Westlake (62%, 33); breadth balances that. A high school offers grade
    12, has 100+ students, and isn't a juvenile-justice, alternative or
    virtual school. Negative CRDC values are reserve codes (-9 not
    applicable, -5 action plan, ...): unknown, never numbers — except that
    CRDC 2023-24 has no "No" for the AP question: a high school without AP
    carries -9 there (checked 2026-10-01: La Pryor HS, TX; 32% of high
    schools, in line with the share without AP), so -9 on SCH_APENR_IND means
    no AP: 0 courses, 0%. Shares use total enrollment (CRDC has no enrollment
    by grade), so a 6–12 school reads a little low.

    Both comparisons the owner asked for (plan §9 Phase 8): nationally and
    within the county.

SOURCES
    SEDA 6.0 (manual downloads in data/raw/, like the county file; stored in the
    private R2 bucket — `python -m etl.inputs pull`):
      seda_geodist_pool_cs_6.0.csv  GEOGRAPHIC school districts: every school
                                    inside a district's boundary (charters
                                    included), which is what a tract can sit in.
      seda_school_pool_cs_6.0.csv   individual schools.
    Measure: `cs_mn_avg_eb`, all subjects, all students, empirical Bayes — the
    same as the county data (etl/sources/seda.py). Grades 3–8 only, so HIGH
    SCHOOLS HAVE NO SCORE; the app must say so.
    District boundaries: Census TIGER 2019 elementary + unified school
    districts — the boundaries SEDA's geographic districts are built on. A
    tract in an elementary district (Illinois, etc.) takes that district.
    School locations: NCES EDGE public school geocodes, 2023–24 (current
    schools; ones that closed since SEDA's years simply have no location).

IN THE DISTRICT (2026-11-11)
    Schools used to be the nearest within 15 miles whatever their district, and
    the area's score their average. Measured on 400 published counties: 67% of
    areas averaged in a school from another district, moving the score 10+
    points for a third of them (Chelsea, MI: shown 64th; its own schools 88th,
    its district 90th — the rest were a charter and a district in two other
    counties). Now a school counts for an area only if it stands inside the
    boundary the area's people live in: the elementary or unified district for
    elementary and middle schools, the secondary or unified one for high
    schools. Charters inside the boundary count, as in SEDA's geographic
    districts. An area whose district has no scored school of a level lists
    none: unknown, not a neighbor's.

NOT ATTENDANCE ZONES
    Inside a district, "nearest" is distance from where the tract's people live,
    not which school a street is zoned for. No national zone data exists after
    2015-16 (plan §9).

RUN STANDALONE
    python -m etl.tracts.schools 48453
"""

from __future__ import annotations

import functools
import io
import re
import sys
import zipfile

import numpy as np
import pandas as pd

from .. import config
from ..util import get_logger, haversine_miles, http_get
from . import geo
from .geo import STATE_ABBR

log = get_logger("tracts.schools")

SEDA_DISTRICT_FILE = config.RAW_DIR / "seda_geodist_pool_cs_6.0.csv"
SEDA_SCHOOL_FILE = config.RAW_DIR / "seda_school_pool_cs_6.0.csv"
SCHOOL_LOCATIONS_URL = "https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_2324.zip"
DISTRICT_URL = "https://www2.census.gov/geo/tiger/TIGER2019/{kind}/tl_2019_{state}_{kind_lower}.zip"
SCORE_COLUMNS = ("cs_mn_avg_eb", "cs_mn_avg_ol")  # preferred first, as in sources/seda.py
NEARBY_COUNT = {"elementary": 3, "middle": 2}
NEARBY_HIGH = 2
# A district with this many scored elementary and middle schools is ranked by the nearest
# of them, not by its one district score (Chicago, Clark County NV, a Florida county).
BIG_DISTRICT_SCHOOLS = 20
CRDC_URL = "https://civilrightsdata.ed.gov/assets/ocr/docs/2023-24-crdc-data.zip"
CRDC_CACHE = config.INTERIM_DIR / "crdc_high_schools.csv"
MIN_HS_ENROLLMENT = 100


def _seda(path, id_col: str, width: int, extra: list[str]) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"{path.name} not found in data/raw/ — download it from "
                                f"{config.SEDA_DOWNLOAD_PAGE} (see etl/README.md, SEDA).")
    head = pd.read_csv(path, nrows=0).columns
    score_col = next(c for c in SCORE_COLUMNS if c in head)
    df = pd.read_csv(path, usecols=[id_col, "subgroup", "gap", score_col] + extra,
                     dtype={id_col: str, "subgroup": str}, low_memory=False)
    df = df[(df["subgroup"] == "all") & (pd.to_numeric(df["gap"], errors="coerce") == 0)]
    df = df.assign(id=df[id_col].str.zfill(width), score=pd.to_numeric(df[score_col], errors="coerce"))
    return df.dropna(subset=["score"]).drop_duplicates("id")


@functools.lru_cache(maxsize=1)
def district_scores() -> pd.DataFrame:
    """id (7-digit NCES district id), score, pctl — every SEDA geographic district."""
    d = _seda(SEDA_DISTRICT_FILE, "sedalea", 7, ["sedaleaname", "stateabb"])
    d["pctl"] = d["score"].rank(pct=True) * 100
    return d[["id", "sedaleaname", "stateabb", "score", "pctl"]].rename(columns={"sedaleaname": "seda_name"})


@functools.lru_cache(maxsize=1)
def school_scores() -> pd.DataFrame:
    """id (12-digit NCES school id), level, score, pctl (within level) — every SEDA school."""
    s = _seda(SEDA_SCHOOL_FILE, "sedasch", 12, ["gradecenter", "sedaschname"])
    # SEDA tests grades 3–8; the tested-grade center tells elementary from middle.
    s["level"] = np.where(pd.to_numeric(s["gradecenter"], errors="coerce") < 6, "elementary", "middle")
    s["pctl"] = s.groupby("level")["score"].rank(pct=True) * 100
    return s[["id", "sedaschname", "level", "score", "pctl"]]


def _name_key(name: object) -> str:
    n = re.sub(r"[^a-z0-9 ]", " ", str(name).lower())
    n = re.sub(r"\b(school|sch|elementary|elem|el|middle|mid|ms|es|district|school district|sd|union|unified|"
               r"supervisory|the|of)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def _rekey_by_name(scored: pd.DataFrame, locs: pd.DataFrame) -> pd.DataFrame:
    """SEDA schools whose (older) NCES id isn't in the 2023–24 locations: matched by state
    and name when exactly one current school has it. Vermont merged most districts in
    2015–19 (Act 46) and a school's id embeds its district's, so half its schools had
    moved ids (8c)."""
    missing = ~scored["id"].isin(locs["id"])
    if not missing.any():
        return scored
    loc_key = locs["id"].str[:2] + "|" + locs["name"].map(_name_key)
    unique = loc_key[~loc_key.duplicated(keep=False)]
    by_key = dict(zip(unique, locs.loc[unique.index, "id"]))
    key = scored["id"].str[:2] + "|" + scored["sedaschname"].map(_name_key)
    new = key.map(by_key)
    fix = missing & new.notna() & ~new.isin(scored["id"])
    return scored.assign(id=scored["id"].where(~fix, new))


def _crdc_total(df: pd.DataFrame, stem: str) -> pd.Series:
    """M + F + X counts, ignoring negative reserve codes; unknown if none is a count."""
    parts = df[[f"{stem}_M", f"{stem}_F", f"{stem}_X"]].apply(pd.to_numeric, errors="coerce")
    parts = parts.where(parts >= 0)
    return parts.sum(axis=1, min_count=1)


@functools.lru_cache(maxsize=1)
def high_school_scores() -> pd.DataFrame:
    """id, level='high', score (AP share), pctl, ap_courses, ap_share, dual_share,
    satact_share, ib, enrollment — every US high school in CRDC 2023–24 (cached)."""
    if CRDC_CACHE.exists():
        return pd.read_csv(CRDC_CACHE, dtype={"id": str})
    body = http_get(CRDC_URL, binary=True, cache_hint="crdc_2023_24", user_agent=config.BROWSER_USER_AGENT)
    assert isinstance(body, bytes)
    z = zipfile.ZipFile(io.BytesIO(body))

    def read(name: str, cols: list[str]) -> pd.DataFrame:
        return pd.read_csv(z.open(f"SCH/{name}.csv"), encoding="latin-1", dtype=str,
                           usecols=["COMBOKEY"] + cols).drop_duplicates("COMBOKEY")

    tri = lambda stem: [f"{stem}_M", f"{stem}_F", f"{stem}_X"]  # noqa: E731
    chars = read("School Characteristics", ["SCH_GRADE_G12", "SCH_JUST_IND", "SCH_STATUS_ALT", "SCH_VIRT_IND"])
    enr = read("Enrollment", tri("TOT_ENR"))
    ap = read("Advanced Placement", ["SCH_APENR_IND", "SCH_APCOURSES"] + tri("TOT_APENR"))
    dual = read("Dual Enrollment", tri("TOT_DUALENR"))
    sat = read("SAT and ACT", tri("TOT_SATACT"))
    ib = read("International Baccalaureate", ["SCH_IBENR_IND"])
    df = chars.merge(enr, on="COMBOKEY", how="left")
    for part in (ap, dual, sat, ib):
        df = df.merge(part, on="COMBOKEY", how="left")

    yes = lambda c: df[c].astype(str).str.strip().str.lower().eq("yes")  # noqa: E731
    df["enrollment"] = _crdc_total(df, "TOT_ENR")
    df = df[yes("SCH_GRADE_G12") & ~yes("SCH_JUST_IND") & ~yes("SCH_STATUS_ALT")
            & ~df["SCH_VIRT_IND"].astype(str).str.strip().str.lower().isin(["yes", "full"])
            & (df["enrollment"] >= MIN_HS_ENROLLMENT)].copy()
    courses = pd.to_numeric(df["SCH_APCOURSES"], errors="coerce")
    # No "No" in 2023-24: a high school without AP has -9 here (see docstring).
    no_ap = df["SCH_APENR_IND"].astype(str).str.strip().str.lower().isin(["no", "-9"])
    # A reported course count wins over the AP question's code (35 schools answer
    # -9 yet list courses); only a missing count becomes 0 for a school without AP.
    known = courses.where(courses >= 0)
    df["ap_courses"] = known.mask(no_ap & known.isna(), 0)
    ap_enr = _crdc_total(df, "TOT_APENR").mask(no_ap, 0)
    df["ap_share"] = (100 * ap_enr / df["enrollment"]).clip(upper=100)
    df["dual_share"] = (100 * _crdc_total(df, "TOT_DUALENR") / df["enrollment"]).clip(upper=100)
    df["satact_share"] = (100 * _crdc_total(df, "TOT_SATACT") / df["enrollment"]).clip(upper=100)
    df["ib"] = yes("SCH_IBENR_IND")
    out = pd.DataFrame({
        "id": df["COMBOKEY"].str.zfill(12), "level": "high",
        "ap_courses": df["ap_courses"], "ap_share": df["ap_share"], "dual_share": df["dual_share"],
        "satact_share": df["satact_share"], "ib": df["ib"], "enrollment": df["enrollment"],
    }).dropna(subset=["ap_share", "ap_courses"])
    # College-prep access: mean of the two national percentiles, then ranked again.
    out["score"] = (out["ap_share"].rank(pct=True) + out["ap_courses"].rank(pct=True)) * 50
    out["pctl"] = out["score"].rank(pct=True) * 100
    out.to_csv(CRDC_CACHE, index=False)
    log.info("CRDC 2023-24: %d high schools (cached); median AP participation %.1f%%; %d without AP",
             len(out), float(out["ap_share"].median()), int((out["ap_courses"] == 0).sum()))
    return out


@functools.lru_cache(maxsize=1)
def school_locations() -> pd.DataFrame:
    body = http_get(SCHOOL_LOCATIONS_URL, binary=True, cache_hint="edge_geocode_publicsch_2324",
                    user_agent=config.BROWSER_USER_AGENT)
    assert isinstance(body, bytes)
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        name = next(n for n in z.namelist() if n.upper().endswith(".TXT"))
        # Headerless, "|"-separated (NCES EDGE layout): id, district, name, ..., city(5),
        # ..., county fips(9), ..., lat(12), lon(13).
        raw = pd.read_csv(z.open(name), sep="|", header=None, dtype=str, encoding="latin-1")
    return pd.DataFrame({
        "id": raw[0].str.zfill(12), "name": raw[2], "city": raw[5], "county_fips": raw[9],
        "county_name": raw[10],
        "lat": pd.to_numeric(raw[12], errors="coerce"), "lon": pd.to_numeric(raw[13], errors="coerce"),
    })


@functools.lru_cache(maxsize=8)
def _district_polygons(state: str, first: str = "ELSD") -> list:
    """Elementary + unified districts (where grades 3–8 go), or with `first="SCSD"` the
    secondary + unified ones (where high schoolers go). `first` wins where both cover a point."""
    polys = []
    for kind in (first, "UNSD"):
        url = DISTRICT_URL.format(kind=kind, state=state, kind_lower=kind.lower())
        try:
            found = geo.load_polygons(url, f"tl_2019_{state}_{kind.lower()}", ["GEOID", "NAME"])
        except Exception as exc:  # a state may have no elementary districts
            if "404" in str(exc):
                continue
            raise
        polys += [({**p, "kind": kind}, g) for p, g in found]
    return polys


# Districts reorganized after the 2019 boundaries: the old boundary's ID -> the
# successor SEDA scores (same territory). Found state by state (8c).
SUCCESSOR_DISTRICTS = {
    "2612000": "2601103",  # Detroit City SD -> Detroit Public Schools Community District (2016)
}


def _boundary(hit: dict | None) -> str | None:
    return hit["GEOID"] if hit else None


def district_percentile(score: float, curve: np.ndarray) -> float:
    """Where a score stands among the districts' (`curve`: their scores, sorted), 0–100."""
    if not np.isfinite(score) or not len(curve):
        return np.nan
    return 100.0 * np.searchsorted(curve, score, side="right") / len(curve)


def area_schools(tracts: pd.DataFrame, sch: pd.DataFrame, curve: np.ndarray) -> pd.DataFrame:
    """Each tract's schools, inside its district only (see IN THE DISTRICT). Pure.

    `tracts`: pop_lat, pop_lon, boundary, hs_boundary (district GEOIDs where its people
    live), district_pctl. `sch`: key, level, lat, lon, score, pctl, boundary, hs_boundary
    (where the school stands) — every scored school that could be in those districts.
    `curve`: all districts' scores, sorted.
    Returns nearby_schools, nearby_school_pctl, school_basis, nearby_high_schools,
    nearby_hs_pctl, in the tracts' order.
    """
    # Schools sharing a building (New York City) are equally near: by id, so a rebuild and a
    # backfill pick the same ones.
    sch = sch.sort_values("key", kind="stable")
    lower = sch[sch["level"].isin(NEARBY_COUNT)]
    by_district = {k: g for k, g in lower.groupby("boundary")}
    by_hs_district = {k: g for k, g in sch[sch["level"] == "high"].groupby("hs_boundary")}

    def nearest(g: pd.DataFrame, la: float, lo: float, n: int) -> pd.DataFrame:
        d = haversine_miles(la, lo, g["lat"].to_numpy(float), g["lon"].to_numpy(float))
        return g.iloc[np.argsort(d, kind="stable")[:n]]

    rows = []
    for la, lo, bd, hbd, dp in zip(tracts["pop_lat"], tracts["pop_lon"], tracts["boundary"],
                                   tracts["hs_boundary"], tracts["district_pctl"]):
        own = by_district.get(bd)
        picks = pd.concat([nearest(own[own["level"] == level], la, lo, n) for level, n in NEARBY_COUNT.items()]
                          ) if own is not None else None
        value, basis = np.nan, None
        if picks is not None and len(picks) and (len(own) >= BIG_DISTRICT_SCHOOLS or pd.isna(dp)):
            value, basis = district_percentile(float(picks["score"].mean()), curve), "nearby"
        elif pd.notna(dp):
            value, basis = float(dp), "district"
        hs_own = by_hs_district.get(hbd)
        hs = nearest(hs_own, la, lo, NEARBY_HIGH) if hs_own is not None else None
        rows.append({
            "nearby_schools": ";".join(picks["key"]) if picks is not None else "",
            "nearby_school_pctl": value,
            "school_basis": basis,
            "nearby_high_schools": ";".join(hs["key"]) if hs is not None else "",
            "nearby_hs_pctl": float(hs["pctl"].mean()) if hs is not None and len(hs) else np.nan,
        })
    return pd.DataFrame(rows, index=tracts.index)


@functools.lru_cache(maxsize=4)
def _state_schools(state: str) -> pd.DataFrame:
    """Every scored school standing in a state, with the district boundaries it stands in
    (`boundary`: elementary or unified; `hs_boundary`: secondary or unified)."""
    locs = school_locations()
    scored = pd.concat([_rekey_by_name(school_scores(), locs), high_school_scores()], ignore_index=True)
    sch = locs[locs["county_fips"].astype(str).str[:2] == state].merge(scored, on="id", how="inner")
    sch = sch.dropna(subset=["lat", "lon"]).reset_index(drop=True)
    # One key per school AND level: a small district's K-12 campus is both a
    # SEDA elementary/middle school and a CRDC high school under one NCES id
    # (Dawson County, TX); sharing a key let one overwrite the other.
    sch["key"] = np.where(sch["level"] == "high", sch["id"] + "-hs", sch["id"])
    la, lo = sch["lat"].to_numpy(float), sch["lon"].to_numpy(float)
    sch["boundary"] = [_boundary(h) for h in geo.locate(la, lo, _district_polygons(state))]
    sch["hs_boundary"] = [_boundary(h) for h in geo.locate(la, lo, _district_polygons(state, "SCSD"))]
    return sch


def build(county_fips: str, tracts: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """`tracts` needs geoid, pop_lat, pop_lon. Returns (per-tract columns, county schools)."""
    state = county_fips[:2]
    lat, lon = tracts["pop_lat"].to_numpy(float), tracts["pop_lon"].to_numpy(float)

    # Elementary districts first: locate() keeps the first containing polygon.
    hit = geo.locate(lat, lon, _district_polygons(state))
    out = pd.DataFrame({
        "geoid": tracts["geoid"],
        "district_id": [SUCCESSOR_DISTRICTS.get(h["GEOID"], h["GEOID"]) if h else None for h in hit],
        "district_name": [h["NAME"] if h else None for h in hit],
    })
    scores = district_scores()
    # A 2019 boundary with no score whose name matches a scored district in the state
    # (Vermont's merged unified districts): use that one.
    unscored = out["district_id"].notna() & ~out["district_id"].isin(scores["id"])
    if unscored.any():
        st = STATE_ABBR[state].upper()
        here = scores[scores["stateabb"] == st]
        by_name = dict(zip(here["seda_name"].map(_name_key), here["id"]))
        alias = out.loc[unscored, "district_name"].map(_name_key).map(by_name)
        out.loc[unscored, "district_id"] = alias.fillna(out.loc[unscored, "district_id"])
    out = out.merge(scores[["id", "score", "pctl"]].rename(columns={
        "id": "district_id", "score": "district_score", "pctl": "district_pctl"}), on="district_id", how="left")
    served = out.dropna(subset=["district_score"]).drop_duplicates("district_id")
    rank = served.set_index("district_id")["district_score"].rank(ascending=False, method="min")
    out["district_rank"] = out["district_id"].map(rank)
    out["district_count"] = len(served)

    # A district's schools may stand in the next county (Leander's high schools are in
    # Williamson County): every scored school in the state is a candidate, by boundary.
    # County ranks are among the county's own schools only.
    sch = _state_schools(state).copy()
    sch["in_county"] = sch["county_fips"] == county_fips
    own = sch[sch["in_county"]]
    sch["county_rank"] = own.groupby("level")["score"].rank(ascending=False, method="min")
    sch["county_count"] = sch["level"].map(own.groupby("level").size())
    sch.loc[~sch["in_county"], "county_count"] = np.nan

    where = pd.DataFrame({
        "pop_lat": lat, "pop_lon": lon,
        # The boundary itself, not `district_id`: that may be a successor's or an alias.
        "boundary": [_boundary(h) for h in hit],
        "hs_boundary": [_boundary(h) for h in geo.locate(lat, lon, _district_polygons(state, "SCSD"))],
        "district_pctl": out["district_pctl"].to_numpy(),
    }, index=out.index)
    curve = np.sort(scores["score"].to_numpy(float))
    out = pd.concat([out, area_schools(where, sch, curve)], axis=1)

    # Publish the county's own schools plus any outside one that some tract lists.
    used = {i for col in ("nearby_schools", "nearby_high_schools") for picks in out[col] for i in picks.split(";") if i}
    sch = sch[sch["in_county"] | sch["key"].isin(used)]
    no_district = out["district_id"].isna().sum()
    log.info("schools %s: %d districts serve the county (%d scored); %d scored schools in the county, "
             "%d of its districts' outside it; %d tracts outside any district; %d ranked by their nearest schools",
             county_fips, out["district_id"].nunique(), len(served), int(sch["in_county"].sum()),
             int((~sch["in_county"]).sum()), no_district, int((out["school_basis"] == "nearby").sum()))
    cols = ["id", "name", "level", "city", "county_name", "in_county", "lat", "lon", "score", "pctl",
            "county_rank", "county_count",
            "ap_courses", "ap_share", "dual_share", "satact_share", "ib", "enrollment"]
    cols = ["key" if c == "id" else c for c in cols]
    return out, sch[cols].rename(columns={"key": "school_id"}).sort_values(["level", "county_rank"])


if __name__ == "__main__":
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    t = geo.table(fips, geo.shapes(fips))
    tr, sc = build(fips, t)
    print(tr.drop_duplicates("district_id")[["district_id", "district_name", "district_score", "district_pctl",
                                              "district_rank", "district_count"]].sort_values("district_rank").to_string(index=False))
    print(sc.groupby("level").head(3).to_string(index=False))
