"""
Central configuration for the Relocation Finder ETL.

Everything that a future run might need to change — data vintages, API keys,
file locations — lives here rather than being scattered through the source
modules. If you are updating the pipeline for a new data year, this file plus
the vintage notes in README.md should be the only places you need to look.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    # python-dotenv is optional. If it is missing we just read the real env.
    pass


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
# data/raw      untouched API responses and downloaded files, cached by URL hash.
#               Never edited by hand. Safe to delete — it just forces a re-fetch.
# data/interim  one tidy parquet/csv per source, after parsing but before joining.
#               This is where you look when a single source seems wrong.
# data/out      the final joined artifacts that the app consumes.

ETL_DIR = Path(__file__).resolve().parent
DATA_DIR = ETL_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
OUT_DIR = DATA_DIR / "out"

for _d in (RAW_DIR, INTERIM_DIR, OUT_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# Where the Next.js app reads the finished dataset from. build.py copies
# data/out/counties.json here ONLY after validation passes, so the committed
# file is always a build that was green. data/out/ stays the canonical output
# (it is what validate.py reads and what gets diffed between runs); this is a
# published copy, nothing more.
PUBLISH_PATH = ETL_DIR.parent / "public" / "data" / "counties.json"
BOUNDARY_PUBLISH_PATH = ETL_DIR.parent / "public" / "data" / "counties.topo.json"


# ---------------------------------------------------------------------------
# API keys
# ---------------------------------------------------------------------------
# Census:  https://api.census.gov/data/key_signup.html   (instant, free)
# BEA:     https://apps.bea.gov/API/signup/              (instant, free)
# NOAA and SEDA need no key — they are plain file downloads.
#
# The Census API technically works without a key for low volumes, but it is
# rate-limited and will start refusing you. Get one; it takes a minute.

CENSUS_API_KEY = os.environ.get("CENSUS_API_KEY", "").strip()
BEA_API_KEY = os.environ.get("BEA_API_KEY", "").strip()
# Free: https://data.bls.gov/registrationEngine/ . Without it BLS allows only
# 25 requests/day, not enough for 3,144 counties (sources/bls.py).
BLS_API_KEY = os.environ.get("BLS_API_KEY", "").strip()


# ---------------------------------------------------------------------------
# Data vintages
# ---------------------------------------------------------------------------
# ACS_YEAR is the END year of a 5-year estimate window. 2023 means the
# 2019-2023 ACS 5-year release.
#
# WHY 5-YEAR AND NOT 1-YEAR: the ACS 1-year release only covers geographies
# above 65,000 population, which would drop roughly two-thirds of US counties.
# The 5-year release covers every county. This is not a close call.
#
# If a vintage is not yet published the Census API returns a 404. The ACS
# module handles this by walking backwards from ACS_YEAR until it finds a
# release that exists, and logging which one it used. So this value is a
# starting hint, not a hard requirement.
ACS_YEAR = 2023

# BEA RPP data year. As of 2026-09, the most recent release was 2026-02-19
# covering 2024; the next is scheduled for 2026-12-10 (which will add 2025).
# Like ACS, the BEA module walks backwards if this year is unavailable.
BEA_YEAR = 2024

# Census Gazetteer vintage, used only for county centroids (lat/lon).
# Centroids barely move between vintages; any recent year is fine.
GAZETTEER_YEAR = 2024

# Census CBSA (metro area) delineation vintage. Used to map counties to the
# metro areas BEA publishes RPP for. OMB revises these periodically.
CBSA_DELINEATION_YEAR = 2023


# ---------------------------------------------------------------------------
# Source URLs
# ---------------------------------------------------------------------------
# Collected here so a broken link is one edit, not a scavenger hunt.
# Each is annotated with what it gives us and how stable it has been.

CENSUS_API_BASE = "https://api.census.gov/data"

# County centroids. Fixed-width-ish TSV inside a zip. Stable URL pattern.
GAZETTEER_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "{year}_Gazetteer/{year}_Gaz_counties_national.zip"
)

# BEA's JSON API. Docs: https://apps.bea.gov/api/_pdf/bea_web_service_api_user_guide.pdf
BEA_API_BASE = "https://apps.bea.gov/api/data"

# OMB/Census metro area delineation. Ships as .xlsx with a few header rows.
# NOTE: this URL changes with each delineation release. If it 404s, search
# "census.gov delineation files" and grab the current "County membership" file.
CBSA_DELINEATION_URL = (
    "https://www2.census.gov/programs-surveys/metro-micro/geographies/"
    "reference-files/{year}/delineation-files/list1_{year}.xlsx"
)

# 2020 county population-weighted centers. Plain CSV, stable decennial path.
# Used to measure climate (and later distances) where people live rather
# than at the county's geographic middle. See sources/popcenter.py.
POPCENTER_URL = (
    "https://www2.census.gov/geo/docs/reference/cenpop2020/county/CenPop2020_Mean_CO.txt"
)

# County shapes for the map: Census cartographic boundaries (shoreline-clipped).
# 2024 vintage uses Connecticut's planning regions, matching the spine. The
# 500k file is the most detailed; mapshaper simplifies it (sources/boundaries.py).
BOUNDARY_URL = (
    "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip"
)
BOUNDARY_SIMPLIFY = "5%"      # of vertices kept; ~810 KB TopoJSON with state outlines
MAPSHAPER_VERSION = "0.7.68"  # pinned: build output should not drift between runs

# --- Phase 5 sources ---------------------------------------------------------

# FEMA National Risk Index, county table (sources/nri.py). The version is in
# the path; a new release means a new URL (check the OpenFEMA NRI page).
NRI_VERSION = "v1.20 (December 2025)"
NRI_COUNTIES_URL = (
    "https://www.fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_Counties.zip"
)
# FEMA's CDN rejects bot User-Agents; this is used for that request only.
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

# BLS Local Area Unemployment Statistics via the public API v2 (sources/bls.py).
BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
BLS_SERIES_PER_REQUEST = 50   # the registered-key limit

# Distances (sources/distances.py)
OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
COASTLINE_URL = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_coastline.zip"
METRO_MIN_POPULATION = 500_000

# NOAA 1991-2020 monthly normals, one CSV per station (~15,600 of them).
# Station inventory lives alongside the data files.
#
# 2026-09-20: the earlier "..._by-station_inventory.csv" path 404s. The
# inventory is now a headerless FIXED-WIDTH file in the GHCN station-list
# layout (id, lat, lon, elev, state, name ...). sources/noaa.py parses
# either. If this 404s again, list the directory:
#   https://www.ncei.noaa.gov/data/normals-monthly/1991-2020/doc/
NOAA_NORMALS_BASE = "https://www.ncei.noaa.gov/data/normals-monthly/1991-2020/access"
NOAA_STATION_INVENTORY = (
    "https://www.ncei.noaa.gov/data/normals-monthly/1991-2020/doc/inventory_30yr.txt"
)

# SEDA. The download page is https://edopportunity.org/opportunity/data/downloads/
# Direct file URLs change between versions, so SEDA is handled as a
# MANUAL DOWNLOAD step — see sources/seda.py and README.md section "SEDA".
SEDA_DOWNLOAD_PAGE = "https://edopportunity.org/opportunity/data/downloads/"
SEDA_EXPECTED_FILENAME = "seda_county_pool_cs_6.0.csv"


# ---------------------------------------------------------------------------
# ACS variable map
# ---------------------------------------------------------------------------
# Census variable IDs are opaque, so keep the mapping in one readable place.
# Verify any of these at https://api.census.gov/data/2023/acs/acs5/variables.html
#
# The trailing "E" means "Estimate". The matching "M" variables are margins of
# error — not pulled in Phase 1, but worth adding if we ever want to gray out
# unreliable small-county values. (See README "Known gaps".)

ACS_VARIABLES = {
    "B01003_001E": "population",
    "B25077_001E": "median_home_value",       # owner-occupied, dollars
    "B19013_001E": "median_household_income",  # dollars
    "B25064_001E": "median_gross_rent",        # monthly dollars, incl. utilities
    # Property tax (LAWS.md, Tier A). AGGREGATES, not medians: the median
    # real-estate-tax variable (B25103) is top-coded at "$10,000+", which
    # flattens exactly the high-tax counties the metric exists to separate.
    # Aggregate taxes / aggregate value is also Tax Foundation's method.
    "B25090_001E": "aggregate_real_estate_taxes",  # owner-occupied, dollars
    "B25082_001E": "aggregate_home_value",         # owner-occupied, dollars
}

# The Census API encodes "no data" as large negative sentinels rather than
# nulls. These are the documented jam values. Any value at or below the
# threshold is treated as missing.
#
# THIS IS A CLASSIC SILENT-CORRUPTION BUG: forget this step and you get
# counties with a median income of negative 666 million, which will sail
# through a naive percentile rank and land at the bottom of every ranking.
CENSUS_NULL_SENTINEL_THRESHOLD = -666666


# ---------------------------------------------------------------------------
# Sanity-check expectations
# ---------------------------------------------------------------------------
# Used by validate.py. These are deliberately wide — they are meant to catch
# structural breakage (wrong column, unit error, failed join), not to assert
# anything clever about the data.

EXPECTED_COUNTY_COUNT_MIN = 3100
EXPECTED_COUNTY_COUNT_MAX = 3250

# Counties we spot-check by hand after every run, chosen to span the range.
SPOT_CHECK_FIPS = {
    "48453": "Travis County, TX (Austin — expensive metro, TX)",
    "06075": "San Francisco County, CA (extreme high cost)",
    "39035": "Cuyahoga County, OH (rust belt, low cost)",
    "48507": "Zavala County, TX (small, poor, rural)",
    "22071": "Orleans Parish, LA (tests LA parish handling)",
    "02020": "Anchorage Municipality, AK (Alaska is back in the data; toggle in the app)",
    # Connecticut replaced its 8 legacy counties with 9 planning regions;
    # Census products from 2022 on (Gazetteer, ACS) use the new codes and the
    # legacy "09001" Fairfield no longer exists in them. 09190 Western
    # Connecticut covers most of old Fairfield. Sources that still key on the
    # legacy counties (SEDA) will leave CT null — see README "Known gaps".
    "09190": "Western Connecticut Planning Region, CT (tests CT reorganization handling)",
}

# validate.py: a source whose interim file exists but joins fewer than this
# share of counties has a broken key, not sparse data. FAIL, even if the
# source is optional — the SEDA state-vs-county FIPS mix-up produced exactly
# this and sailed through as a WARN.
SOURCE_JOIN_FAIL_BELOW = 0.05

# validate.py: share of counties allowed to carry rpp_geo_level == "state".
#
# DERIVED, NOT GUESSED. Counties outside a METROPOLITAN CBSA take the
# statewide RPP by design (BEA publishes no per-state non-metro portion —
# see sources/bea.py). Per the 2023 OMB delineations that is 3,144 - 1,252
# = 1,892 counties, ~60%; the actual first-run figure was 1,958 (62%), the
# difference being metro counties whose CBSA lacks a MARPP row. If the
# share climbs past this bound, the CBSA crosswalk and MARPP have stopped
# lining up and metro counties are silently being treated as rural. FAIL.
RPP_STATE_LEVEL_MAX_SHARE = 0.66

# Plausible ranges per metric. A value outside these does not fail the build,
# but it is reported loudly. Tuned to be generous.
PLAUSIBLE_RANGES = {
    "population": (0, 11_000_000),
    "median_home_value": (10_000, 3_000_000),
    "median_household_income": (5_000, 300_000),
    "median_gross_rent": (150, 5_000),
    "unemployment_rate": (0.5, 30),
    "hazard_risk": (0, 100), "hazard_hurricane": (0, 100), "hazard_wildfire": (0, 100),
    "hazard_inland_flood": (0, 100), "hazard_coastal_flood": (0, 100),
    "hazard_earthquake": (0, 100), "hazard_tornado": (0, 100),
    "dist_airport_mi": (0, 1_000),   # remote Alaska: the Aleutians are ~830 mi out
    "dist_coast_mi": (0, 1_300),     # northwest Minnesota is ~1,160 mi from tidal water
    "dist_metro_mi": (0, 2_200),     # Alaska has no 500k+ metro: Seattle is 1,400–2,000 mi
    "property_tax_effective_rate": (0.0, 4.0),  # unorganized Alaska boroughs levy ~none
    "rpp_all": (70, 140),
    "rpp_rents": (30, 220),
    "rpp_utilities": (50, 220),
    "rpp_goods": (80, 130),
    "rpp_services": (60, 160),
    "school_achievement": (-4.0, 4.0),
    "summer_high_f": (40, 120),
    "winter_low_f": (-40, 80),
    "annual_precip_in": (0, 250),
    "annual_snow_in": (0, 400),
    "hottest_month_high_f": (50, 125),
    "coldest_month_low_f": (-30, 75),
    "days_above_90f": (0, 366),
    "nights_below_32f": (0, 366),
    "rainy_days": (0, 366),
    "snow_days": (0, 366),
}


# ---------------------------------------------------------------------------
# HTTP behaviour
# ---------------------------------------------------------------------------
HTTP_TIMEOUT = 60          # seconds per request
HTTP_MAX_RETRIES = 4
HTTP_BACKOFF_SECONDS = 2.0  # doubles each retry
HTTP_USER_AGENT = (
    "relocation-finder-etl/0.1 (personal research project; contact via repo)"
)

# NOAA is ~10,000 individual station files. Be polite.
NOAA_REQUEST_DELAY = 0.05  # seconds between station fetches
