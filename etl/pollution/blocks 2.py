"""
Every 2020 Census block with people: where they live, for sampling pollution (Phase 11, rule 1).

    python -m etl.pollution.blocks MI          # one state -> data/interim/blocks/26.csv.gz
    python -m etl.pollution.blocks all

WHAT THIS PRODUCES (per state)
    block (15-digit GEOID), tract (11, today's codes), county (5), pop, lat, lon

    Only blocks with people: a block of 0 people weighs nothing in a population-weighted mean.
    `lat` / `lon` are the block's internal point; `pop` its 2020 count (POP100).

SOURCE
    The 2020 redistricting files (PL 94-171), one zip per state:
    https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/
        <State_Name>/<st>2020.pl.zip  ->  <st>geo2020.pl
    The geo header lists every geography (summary level 750 = block) with POP100 and
    INTPTLAT/INTPTLON, pipe-delimited in the Census's documented order (FIELDS). Checked
    2026-10-13: Michigan's 254,730 blocks sum to its 10,077,331 people, Washtenaw's to 372,258.
    MI's zip is 40 MB, CA's 80 MB; 2020 blocks never change, so each is fetched once.

CONNECTICUT
    Blocks keep their 2020 county codes (09001…); tracts are mapped to today's planning
    regions (09110…) the way the area pipeline does (tracts.geo.current_geoids).
"""

from __future__ import annotations

import io
import sys
import zipfile

import pandas as pd

from .. import config
from ..util import get_logger, http_get

log = get_logger("pollution.blocks")

BASE = "https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171"
CACHE_DIR = config.INTERIM_DIR / "blocks"

# The geo header's 97 fields, in order (2020 PL 94-171 technical documentation).
FIELDS = (
    "FILEID STUSAB SUMLEV GEOVAR GEOCOMP CHARITER CIFSN LOGRECNO GEOID GEOCODE REGION DIVISION STATE "
    "STATENS COUNTY COUNTYCC COUNTYNS COUSUB COUSUBCC COUSUBNS SUBMCD SUBMCDCC SUBMCDNS ESTATE ESTATECC "
    "ESTATENS CONCIT CONCITCC CONCITNS PLACE PLACECC PLACENS TRACT BLKGRP BLOCK AIANHH AIHHTLI AIANHHFP "
    "AIANHHCC AIANHHNS AITS AITSFP AITSCC AITSNS TTRACT TBLKGRP ANRC ANRCCC ANRCNS CBSA MEMI CSA METDIV "
    "NECTA NMEMI CNECTA NECTADIV CBSAPCI NECTAPCI UA UATYPE UR CD116 CD118 CD119 CD120 CD121 SLDU18 SLDU22 "
    "SLDU24 SLDU26 SLDU28 SLDL18 SLDL22 SLDL24 SLDL26 SLDL28 VTD VTDI ZCTA SDELM SDSEC SDUNI PUMA AREALAND "
    "AREAWATR BASENAME NAME FUNCSTAT GCUNI POP100 HU100 INTPTLAT INTPTLON LSADC PARTFLAG UGA"
).split()
AT = {name: k for k, name in enumerate(FIELDS)}

# State FIPS -> (folder name on the Census server, postal code).
STATES = {
    "01": ("Alabama", "al"), "02": ("Alaska", "ak"), "04": ("Arizona", "az"), "05": ("Arkansas", "ar"),
    "06": ("California", "ca"), "08": ("Colorado", "co"), "09": ("Connecticut", "ct"), "10": ("Delaware", "de"),
    "11": ("District_of_Columbia", "dc"), "12": ("Florida", "fl"), "13": ("Georgia", "ga"), "15": ("Hawaii", "hi"),
    "16": ("Idaho", "id"), "17": ("Illinois", "il"), "18": ("Indiana", "in"), "19": ("Iowa", "ia"),
    "20": ("Kansas", "ks"), "21": ("Kentucky", "ky"), "22": ("Louisiana", "la"), "23": ("Maine", "me"),
    "24": ("Maryland", "md"), "25": ("Massachusetts", "ma"), "26": ("Michigan", "mi"), "27": ("Minnesota", "mn"),
    "28": ("Mississippi", "ms"), "29": ("Missouri", "mo"), "30": ("Montana", "mt"), "31": ("Nebraska", "ne"),
    "32": ("Nevada", "nv"), "33": ("New_Hampshire", "nh"), "34": ("New_Jersey", "nj"), "35": ("New_Mexico", "nm"),
    "36": ("New_York", "ny"), "37": ("North_Carolina", "nc"), "38": ("North_Dakota", "nd"), "39": ("Ohio", "oh"),
    "40": ("Oklahoma", "ok"), "41": ("Oregon", "or"), "42": ("Pennsylvania", "pa"), "44": ("Rhode_Island", "ri"),
    "45": ("South_Carolina", "sc"), "46": ("South_Dakota", "sd"), "47": ("Tennessee", "tn"), "48": ("Texas", "tx"),
    "49": ("Utah", "ut"), "50": ("Vermont", "vt"), "51": ("Virginia", "va"), "53": ("Washington", "wa"),
    "54": ("West_Virginia", "wv"), "55": ("Wisconsin", "wi"), "56": ("Wyoming", "wy"),
}
BY_POSTAL = {postal.upper(): fips for fips, (_, postal) in STATES.items()}


def parse_geo(lines) -> pd.DataFrame:
    """Blocks with people from a geo header's lines: block, pop, lat, lon."""
    rows = []
    for line in lines:
        f = line.rstrip("\r\n").split("|")
        if len(f) < 3 or f[AT["SUMLEV"]] != "750":
            continue
        if len(f) != len(FIELDS):
            raise ValueError(f"PL geo header: {len(f)} fields, expected {len(FIELDS)} — the layout changed")
        pop = int(f[AT["POP100"]] or 0)
        if pop > 0:
            rows.append((f[AT["GEOCODE"]], pop, float(f[AT["INTPTLAT"]]), float(f[AT["INTPTLON"]])))
    return pd.DataFrame(rows, columns=["block", "pop", "lat", "lon"])


def state_blocks(state: str) -> pd.DataFrame:
    """One state's populated blocks (cached under data/interim/blocks/), with tract and county."""
    from ..tracts.geo import current_geoids

    path = CACHE_DIR / f"{state}.csv.gz"
    if path.exists():
        return pd.read_csv(path, dtype={"block": str, "tract": str, "county": str})
    name, postal = STATES[state]
    body = http_get(f"{BASE}/{name}/{postal}2020.pl.zip", binary=True, cache_hint=f"pl94171_{postal}")
    assert isinstance(body, bytes)
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        member = f"{postal}geo2020.pl"
        with z.open(member) as fh:
            df = parse_geo(io.TextIOWrapper(fh, encoding="latin-1"))
    df["tract"] = current_geoids(df["block"].str[:11]).to_numpy()
    df["county"] = df["tract"].str[:5]
    df = df[["block", "tract", "county", "pop", "lat", "lon"]]
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, compression="gzip")
    log.info("blocks %s: %d with people, %d people", state, len(df), int(df["pop"].sum()))
    return df


def main() -> None:
    want = sys.argv[1:] or ["all"]
    states = list(STATES) if want == ["all"] else [BY_POSTAL.get(s.upper(), s) for s in want]
    for st in states:
        df = state_blocks(st)
        print(f"{st}: {len(df):,} populated blocks, {int(df['pop'].sum()):,} people")


if __name__ == "__main__":
    main()
