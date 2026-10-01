"""
SOURCE: schools — the tract's school district, and the scored schools near it.

WHAT THIS PRODUCES
    tracts(county) -> one row per tract:
        geoid, district_id, district_name,
        district_score        SEDA achievement, grade levels vs the US average
        district_pctl         national percentile among all US districts (0–100)
        district_rank, district_count   rank among the districts serving the county
        nearby_schools        ";"-joined school ids: up to 3 elementary and 2 middle
                              scored schools within NEARBY_MI of where people live
        nearby_school_pctl    the mean national percentile of those schools. This is
                              what separates neighborhoods inside a one-district city
                              (Chicago Public Schools is one district: every Chicago
                              tract has the same district score).
    schools(county) -> one row per scored school located in the county:
        school_id, name, level (elementary / middle), city, lat, lon,
        score, pctl (national, among schools of the same level),
        county_rank, county_count (among the county's scored schools of that level)

    Both comparisons the owner asked for (plan §9 Phase 8): nationally and
    within the county.

SOURCES
    SEDA 6.0 (manual downloads in data/raw/, like the county file):
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

NOT ATTENDANCE ZONES
    "Nearby" is distance from where the tract's people live, not which school
    a street is zoned for. No national zone data exists after 2015-16 (plan §9).

RUN STANDALONE
    python -m etl.tracts.schools 48453
"""

from __future__ import annotations

import io
import sys
import zipfile

import numpy as np
import pandas as pd

from .. import config
from ..util import get_logger, haversine_miles, http_get
from . import geo

log = get_logger("tracts.schools")

SEDA_DISTRICT_FILE = config.RAW_DIR / "seda_geodist_pool_cs_6.0.csv"
SEDA_SCHOOL_FILE = config.RAW_DIR / "seda_school_pool_cs_6.0.csv"
SCHOOL_LOCATIONS_URL = "https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_2324.zip"
DISTRICT_URL = "https://www2.census.gov/geo/tiger/TIGER2019/{kind}/tl_2019_{state}_{kind_lower}.zip"
SCORE_COLUMNS = ("cs_mn_avg_eb", "cs_mn_avg_ol")  # preferred first, as in sources/seda.py
NEARBY_MI = 5.0
NEARBY_COUNT = {"elementary": 3, "middle": 2}


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


def district_scores() -> pd.DataFrame:
    """id (7-digit NCES district id), score, pctl — every SEDA geographic district."""
    d = _seda(SEDA_DISTRICT_FILE, "sedalea", 7, ["sedaleaname"])
    d["pctl"] = d["score"].rank(pct=True) * 100
    return d[["id", "sedaleaname", "score", "pctl"]].rename(columns={"sedaleaname": "seda_name"})


def school_scores() -> pd.DataFrame:
    """id (12-digit NCES school id), level, score, pctl (within level) — every SEDA school."""
    s = _seda(SEDA_SCHOOL_FILE, "sedasch", 12, ["gradecenter"])
    # SEDA tests grades 3–8; the tested-grade center tells elementary from middle.
    s["level"] = np.where(pd.to_numeric(s["gradecenter"], errors="coerce") < 6, "elementary", "middle")
    s["pctl"] = s.groupby("level")["score"].rank(pct=True) * 100
    return s[["id", "level", "score", "pctl"]]


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
        "lat": pd.to_numeric(raw[12], errors="coerce"), "lon": pd.to_numeric(raw[13], errors="coerce"),
    })


def _district_polygons(state: str) -> list:
    polys = []
    for kind in ("ELSD", "UNSD"):  # elementary first: it wins where both exist
        url = DISTRICT_URL.format(kind=kind, state=state, kind_lower=kind.lower())
        try:
            found = geo.load_polygons(url, f"tl_2019_{state}_{kind.lower()}", ["GEOID", "NAME"])
        except Exception as exc:  # a state may have no elementary districts
            if "404" in str(exc):
                continue
            raise
        polys += [({**p, "kind": kind}, g) for p, g in found]
    return polys


def build(county_fips: str, tracts: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """`tracts` needs geoid, pop_lat, pop_lon. Returns (per-tract columns, county schools)."""
    lat, lon = tracts["pop_lat"].to_numpy(float), tracts["pop_lon"].to_numpy(float)

    polys = _district_polygons(county_fips[:2])
    # Elementary districts first: locate() keeps the first containing polygon.
    polys.sort(key=lambda pg: 0 if pg[0]["kind"] == "ELSD" else 1)
    hit = geo.locate(lat, lon, polys)
    out = pd.DataFrame({
        "geoid": tracts["geoid"],
        "district_id": [h["GEOID"] if h else None for h in hit],
        "district_name": [h["NAME"] if h else None for h in hit],
    })
    scores = district_scores()
    out = out.merge(scores[["id", "score", "pctl"]].rename(columns={
        "id": "district_id", "score": "district_score", "pctl": "district_pctl"}), on="district_id", how="left")
    served = out.dropna(subset=["district_score"]).drop_duplicates("district_id")
    rank = served.set_index("district_id")["district_score"].rank(ascending=False, method="min")
    out["district_rank"] = out["district_id"].map(rank)
    out["district_count"] = len(served)

    locs = school_locations()
    sch = locs[locs["county_fips"] == county_fips].merge(school_scores(), on="id", how="inner")
    sch["county_rank"] = sch.groupby("level")["score"].rank(ascending=False, method="min")
    sch["county_count"] = sch.groupby("level")["score"].transform("size")

    near, near_pctl = [], []
    pctl_by_id = dict(zip(sch["id"], sch["pctl"]))
    for la, lo in zip(lat, lon):
        d = haversine_miles(la, lo, sch["lat"].to_numpy(float), sch["lon"].to_numpy(float))
        picks = []
        for level, n in NEARBY_COUNT.items():
            mask = (sch["level"].to_numpy() == level) & (d <= NEARBY_MI)
            idx = np.flatnonzero(mask)
            picks += list(sch["id"].to_numpy()[idx[np.argsort(d[idx])][:n]])
        near.append(";".join(picks))
        near_pctl.append(float(np.mean([pctl_by_id[i] for i in picks])) if picks else np.nan)
    out["nearby_schools"] = near
    out["nearby_school_pctl"] = near_pctl

    no_district = out["district_id"].isna().sum()
    log.info("schools %s: %d districts serve the county (%d scored); %d scored schools; %d tracts "
             "outside any district", county_fips, out["district_id"].nunique(), len(served), len(sch), no_district)
    cols = ["id", "name", "level", "city", "lat", "lon", "score", "pctl", "county_rank", "county_count"]
    return out, sch[cols].rename(columns={"id": "school_id"}).sort_values(["level", "county_rank"])


if __name__ == "__main__":
    fips = sys.argv[1] if len(sys.argv) > 1 else "48453"
    t = geo.table(fips, geo.shapes(fips))
    tr, sc = build(fips, t)
    print(tr.drop_duplicates("district_id")[["district_id", "district_name", "district_score", "district_pctl",
                                              "district_rank", "district_count"]].sort_values("district_rank").to_string(index=False))
    print(sc.groupby("level").head(3).to_string(index=False))
