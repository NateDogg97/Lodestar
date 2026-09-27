"""
Offline test suite. No network, no API keys, no real data required.

    python -m etl.test_offline

WHAT THIS COVERS
    Everything in the pipeline that is pure logic: FIPS normalization,
    distance math, sentinel cleaning, the join, the derived formulas, and the
    validator itself.

WHAT THIS DOES NOT COVER
    Anything that touches a network API. The source modules' fetch()
    functions are only exercised against live endpoints, which means their
    parsing code is the least-tested part of the pipeline. Run each source
    standalone (python -m etl.sources.<name>) and read its probe output
    before trusting a build.

WHY THE FAILURE-INJECTION CASES MATTER
    Cases 2 and 3 deliberately corrupt the input the way a real mistake
    would, and assert the validator catches it. The FIPS case found a genuine
    hole during development: the original validator checked the spine's FIPS
    integrity but never checked whether each SOURCE joined, so a 19% null
    rate from the missing low-FIPS states passed as ordinary sparse data.
    Keep these tests. They are the reason that check exists.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from . import config, join, util, validate
from .sources import seda, spine
from .util import (
    BadResponse,
    add_fips_column,
    clean_census_nulls,
    haversine_miles,
    nearest_points,
    normalize_fips,
)


PASS = 0
FAIL = 0


def check(condition: bool, label: str, detail: str = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}  {detail}")


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------


def test_normalize_fips() -> None:
    print("\nnormalize_fips")
    cases = [
        ("6075", "06075"),      # bare string missing its leading zero
        (6075, "06075"),        # int, the classic bug
        (6075.0, "06075"),      # float round-trip through Excel
        ("06075", "06075"),     # already correct
        ("48453", "48453"),
        ("06075123456", "06075"),  # tract GEOID truncated to county
        ("  48453  ", "48453"),
        (None, None),
        ("", None),
        ("nan", None),
        (float("nan"), None),
    ]
    for raw, want in cases:
        got = normalize_fips(raw)
        check(got == want, f"normalize_fips({raw!r}) -> {got!r}", f"wanted {want!r}")


def test_haversine() -> None:
    print("\nhaversine_miles")
    d = float(haversine_miles(37.7749, -122.4194, 40.7128, -74.0060))
    check(2550 < d < 2600, f"SF to NYC = {d:.0f} mi (expect ~2570)")
    z = float(haversine_miles(30.0, -97.0, 30.0, -97.0))
    check(abs(z) < 1e-9, f"zero distance = {z}")


def test_nearest_points() -> None:
    print("\nnearest_points")
    tlat = np.array([30.0, 40.0])
    tlon = np.array([-97.0, -75.0])
    slat = np.array([30.1, 45.0, 39.9])
    slon = np.array([-97.1, -100.0, -75.1])
    idx, dist = nearest_points(tlat, tlon, slat, slon, k=2)
    check(idx[0, 0] == 0, "target 0 nearest is source 0")
    check(idx[1, 0] == 2, "target 1 nearest is source 2")
    check(dist[0, 0] < dist[0, 1], "distances sorted ascending")


def test_census_sentinels() -> None:
    print("\nclean_census_nulls")
    s = pd.Series([50000, -666666666, -999999999, 75000, None])
    c = clean_census_nulls(s)
    check(int(c.isna().sum()) == 3, f"3 nulls produced, got {int(c.isna().sum())}")
    check(c.max() == 75000, f"max survives, got {c.max()}")


def test_add_fips_column() -> None:
    print("\nadd_fips_column")
    df = pd.DataFrame({"state": ["6", "48"], "county": ["75", "453"]})
    out = add_fips_column(df, state_col="state", county_col="county")
    check(out["fips"].tolist() == ["06075", "48453"],
          f"state+county -> {out['fips'].tolist()}")


def test_safe_divide() -> None:
    print("\n_safe_divide")
    r = join._safe_divide(
        pd.Series([100.0, 100.0, 100.0, 100.0]),
        pd.Series([4.0, 0.0, -5.0, None]),
    )
    check(r[0] == 25.0, f"normal division = {r[0]}")
    check(bool(r[1:].isna().all()), "zero/negative/null denominators -> NaN")


def test_cache_path_hides_query_string() -> None:
    print("\n_cache_path never puts query params (API keys) in the filename")
    fake_key = "FAKEKEY-0000-1111-2222-333344445555"
    url = f"https://apps.bea.gov/api/data?UserID={fake_key}&ResultFormat=json&method=GetData"
    name = util._cache_path(url, ".txt").name
    check(fake_key not in name and "UserID" not in name,
          f"BEA-style URL -> {name}")
    url2 = f"https://api.census.gov/data/2023/acs/acs5?get=NAME&for=county:*&key={fake_key}"
    name2 = util._cache_path(url2, ".txt").name
    check(fake_key not in name2 and "key=" not in name2,
          f"Census-style URL -> {name2}")
    check(util._cache_path(url, ".txt") != util._cache_path(url2, ".txt"),
          "different URLs still get different cache files")
    hinted = util._cache_path(url, ".txt", hint="bea_GetData_SARPP_1_2024").name
    check(hinted.startswith("bea_GetData_SARPP_1_2024__"), f"caller hint is used: {hinted}")

    msg = util.redact_query(
        f"HTTPSConnectionPool: Max retries exceeded with url: /api/data?UserID={fake_key}&x=1 (err)"
    )
    check(fake_key not in msg and "<query redacted>" in msg, f"redact_query strips keys: {msg}")


class _FakeResponse:
    def __init__(self, status: int, text: str):
        self.status_code = status
        self.text = text
        self.content = text.encode()

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(f"{self.status_code}", response=self)


def test_http_get_never_caches_rejected_bodies() -> None:
    """
    Stub requests.get and drive http_get through the poisoning scenarios:
    a 200 whose body fails `check`, a 204, and an empty body. None of them
    may land in data/raw/, and a poisoned file already on disk must be
    evicted and re-fetched.
    """
    print("\nhttp_get: rejected responses are never cached")
    import requests

    url = "https://example.invalid/etl-test-endpoint"
    cache_file = util._cache_path(url, ".txt")
    cache_file.unlink(missing_ok=True)

    calls: list[str] = []
    queue: list[_FakeResponse] = []

    def fake_get(u, params=None, timeout=None, headers=None):
        calls.append(u)
        return queue.pop(0)

    real_get, real_sleep = requests.get, util.time.sleep
    requests.get = fake_get                # type: ignore[assignment]
    util.time.sleep = lambda *_: None      # type: ignore[assignment]
    try:
        def must_be_ok(payload: object) -> None:
            if "ok" not in str(payload):
                raise BadResponse("body says error")

        # 1. A 200 wrapping an error: rejected, NOT cached, not retried.
        queue[:] = [_FakeResponse(200, '{"Error":"throttled"}')]
        raised = False
        try:
            util.http_get(url, check=must_be_ok)
        except BadResponse:
            raised = True
        check(raised, "200-with-error raises BadResponse")
        check(not cache_file.exists(), "…and is not written to the cache")
        check(len(calls) == 1, "…and is not retried")

        # 2. A 204 / empty body: same treatment.
        queue[:] = [_FakeResponse(204, "")]
        raised = False
        try:
            util.http_get(url)
        except BadResponse:
            raised = True
        check(raised and not cache_file.exists(), "204 raises and is not cached")

        # 3. A good body IS cached, and served from cache afterwards.
        queue[:] = [_FakeResponse(200, "ok-body")]
        calls.clear()
        got = util.http_get(url, check=must_be_ok)
        got2 = util.http_get(url, check=must_be_ok)
        check(got == got2 == "ok-body" and cache_file.exists() and len(calls) == 1,
              "good body cached and replayed without a second request")

        # 4. A poisoned file already on disk is evicted and re-fetched.
        cache_file.write_text('{"Error":"stale poison"}', encoding="utf-8")
        queue[:] = [_FakeResponse(200, "ok-fresh")]
        calls.clear()
        got = util.http_get(url, check=must_be_ok)
        check(got == "ok-fresh" and len(calls) == 1,
              "poisoned cache entry evicted and re-fetched")
    finally:
        requests.get = real_get            # type: ignore[assignment]
        util.time.sleep = real_sleep       # type: ignore[assignment]
        cache_file.unlink(missing_ok=True)


def test_seda_county_fips_width_guard() -> None:
    print("\nSEDA: county-id column guard rejects the state-FIPS column")
    # A frame shaped like a real SEDA county file: `fips` is the STATE code.
    df = pd.DataFrame({
        "sedacounty": ["1001", "1003", "6075", "48453", "48507"],
        "fips": ["1", "1", "6", "48", "48"],
        "cs_mn_all": ["0.1", "0.2", "0.3", "0.4", "0.5"],
    })
    chosen = seda._pick_column(df, seda.FIPS_COLUMN_CANDIDATES, "county id",
                               accept=seda._looks_like_county_fips)
    check(chosen == "sedacounty", f"prefers sedacounty over fips -> {chosen!r}")

    # Now hide sedacounty so the only name match is the wrong-shaped `fips`.
    only_state = df.drop(columns=["sedacounty"])
    raised = False
    try:
        seda._pick_column(only_state, seda.FIPS_COLUMN_CANDIDATES, "county id",
                          accept=seda._looks_like_county_fips)
    except ValueError as exc:
        raised = "rejected" in str(exc)
    check(raised, "a state-width `fips` column is rejected rather than used")

    ok, _ = seda._looks_like_county_fips(pd.Series(["01001", "06075", "48453"]))
    check(ok, "zero-padded 5-digit values accepted")
    ok, _ = seda._looks_like_county_fips(pd.Series(["1001", "6075", "48453"]))
    check(ok, "4/5-digit (leading zero eaten) values accepted")
    ok, _ = seda._looks_like_county_fips(pd.Series(["0100001", "0600002"]))
    check(not ok, "7-digit district ids rejected")


def test_seda_subgroup_and_gap_filter() -> None:
    print("\nSEDA: 6.0 long-on-subgroup file reduces to one all-students level row per county")
    rows = []
    for county in ("01001", "48453"):
        for subgroup in ("all", "wht", "blk", "ecd"):
            rows.append({"sedacounty": county, "subgroup": subgroup, "gap": "0",
                         "cs_mn_avg_eb": "0.5" if subgroup == "all" else "9.9"})
        rows.append({"sedacounty": county, "subgroup": "wbg", "gap": "1", "cs_mn_avg_eb": "9.9"})
    df = pd.DataFrame(rows)
    out = seda._select_all_students_levels(df)
    check(len(out) == 2, f"10 rows -> {len(out)} (one per county)")
    check((out["cs_mn_avg_eb"] == "0.5").all(), "only the all-students level values survive")

    raised = False
    try:
        seda._select_all_students_levels(df.assign(subgroup="everyone"))
    except ValueError:
        raised = True
    check(raised, "unknown subgroup vocabulary raises instead of guessing")

    # A file with no subgroup/gap columns (older layout) passes through untouched.
    plain = pd.DataFrame({"sedacounty": ["01001"], "cs_mn_all": ["0.1"]})
    check(len(seda._select_all_students_levels(plain)) == 1, "older layout passes through")


def test_noaa_inventory_parser() -> None:
    print("\nNOAA: station inventory parses in both fixed-width and CSV layouts")
    from .sources import noaa
    fixed = (
        "AQC00914000 -14.3167 -170.7667  408.4 AS AASUFOU                                     \n"
        "USW00013904  30.1831  -97.6800  146.3 TX AUSTIN BERGSTROM AP                    74745\n"
        "USW00013958  30.3208  -97.7603  204.2 TX AUSTIN-CAMP MABRY                      72254\n"
    )
    out = noaa.parse_station_inventory(fixed)
    check(len(out) == 3 and out.loc[1, "station"] == "USW00013904"
          and abs(out.loc[1, "lat"] - 30.1831) < 1e-6 and abs(out.loc[1, "lon"] + 97.68) < 1e-6,
          "fixed-width GHCN layout -> id/lat/lon (name with spaces ignored)")

    csv = "STATION,LATITUDE,LONGITUDE,NAME\nUSW00013904,30.1831,-97.68,AUSTIN BERGSTROM AP\n"
    out = noaa.parse_station_inventory(csv)
    check(len(out) == 1 and out.loc[0, "station"] == "USW00013904", "legacy CSV layout still parses")

    raised = False
    try:
        noaa.parse_station_inventory("<html>moved</html>\n")
    except ValueError:
        raised = True
    check(raised, "an HTML page instead of an inventory raises")

    check(noaa.EXCLUDED_NETWORK_PREFIXES == ("US1",),
          "CoCoRaHS (US1) precipitation-only network is excluded from candidates")


def test_gazetteer_encoding_guard() -> None:
    print("\nspine: gazetteer decoding")
    utf8 = "GEOID\tNAME\n35013\tDoña Ana County\n".encode("utf-8")
    text, enc = spine.decode_gazetteer(utf8)
    check(enc == "utf-8" and "Doña Ana County" in text, "UTF-8 file decodes cleanly")

    latin = "GEOID\tNAME\n35013\tDoña Ana County\n".encode("latin-1")
    text, enc = spine.decode_gazetteer(latin)
    check(enc == "latin-1" and "Doña Ana County" in text, "latin-1 file falls back cleanly")

    # Pre-mangled text (UTF-8 bytes that were already mis-decoded upstream).
    mojibake = "GEOID\tNAME\n35013\tDoÃ±a Ana County\n".encode("utf-8")
    raised = False
    try:
        spine.decode_gazetteer(mojibake)
    except ValueError:
        raised = True
    check(raised, "mojibake marker raises instead of passing through")


# ---------------------------------------------------------------------------
# Synthetic fixtures
# ---------------------------------------------------------------------------


def _make_synthetic() -> dict[str, pd.DataFrame]:
    """A structurally realistic fake dataset: 51 states, correct FIPS shape."""
    rng = np.random.default_rng(42)
    state_fips = [f"{i:02d}" for i in range(1, 57) if i not in (3, 7, 14, 43, 52)]

    rows = []
    per = 3144 // len(state_fips)
    for si, sf in enumerate(state_fips):
        for c in range(per):
            rows.append({
                "fips": sf + f"{(c * 2 + 1):03d}",
                "county_name": f"County {c}",
                "state": f"S{si:02d}",
                "lat": 25 + rng.random() * 25,
                "lon": -125 + rng.random() * 55,
                "land_sq_mi": rng.random() * 2000,
            })
    spine = pd.DataFrame(rows)

    for f in config.SPOT_CHECK_FIPS:
        if f not in set(spine["fips"]):
            spine.loc[len(spine)] = {
                "fips": f, "county_name": "Spot", "state": "XX",
                "lat": 35.0, "lon": -95.0, "land_sq_mi": 500.0,
            }

    spine = spine.sort_values("fips").reset_index(drop=True)
    n = len(spine)

    agg_value = rng.integers(10_000_000, 900_000_000, n).astype(float)
    return {
        "spine": spine,
        "acs": pd.DataFrame({
            "fips": spine["fips"],
            "population": rng.integers(500, 900_000, n).astype(float),
            "median_home_value": rng.integers(60_000, 900_000, n).astype(float),
            "median_household_income": rng.integers(25_000, 150_000, n).astype(float),
            "median_gross_rent": rng.integers(500, 2600, n).astype(float),
            "aggregate_home_value": agg_value,
            "aggregate_real_estate_taxes": agg_value * (0.003 + rng.random(n) * 0.022),
            "acs_vintage": 2023,
        }),
        "bea": pd.DataFrame({
            "fips": spine["fips"],
            # Real-world mix: ~38% metro, ~62% statewide (no per-state
            # non-metro portion exists — see sources/bea.py).
            "rpp_geo_level": rng.choice(["metro", "state"], n, p=[.38, .62]),
            "rpp_source_geo": "synthetic",
            "rpp_all": 85 + rng.random(n) * 30,
            "rpp_rents": 55 + rng.random(n) * 100,
            "rpp_utilities": 75 + rng.random(n) * 60,
            "rpp_goods": 92 + rng.random(n) * 16,
            "rpp_services": 75 + rng.random(n) * 50,
            "rpp_vintage": 2024,
        }),
        "seda": pd.DataFrame({
            "fips": spine["fips"],
            "school_achievement": rng.normal(0, 0.7, n),
        }),
        "noaa": pd.DataFrame({
            "fips": spine["fips"],
            "summer_high_f": 75 + rng.random(n) * 25,
            "winter_low_f": 10 + rng.random(n) * 45,
            "spring_mean_f": 50 + rng.random(n) * 20,
            "fall_mean_f": 52 + rng.random(n) * 20,
            "annual_precip_in": rng.random(n) * 70,
            "annual_snow_in": rng.random(n) * 60,
            "climate_station_id": "USW00000000",
            "climate_station_dist_mi": rng.random(n) * 45,
            "climate_station_count": 3,
        }),
    }


def _write(fixtures: dict[str, pd.DataFrame]) -> None:
    for name, df in fixtures.items():
        df.to_csv(config.INTERIM_DIR / f"{name}.csv", index=False)


def _cleanup(fixtures: dict[str, pd.DataFrame]) -> None:
    """Remove synthetic files so they are never mistaken for a real build."""
    for name in list(fixtures) + ["noaa_monthly"]:
        path = config.INTERIM_DIR / f"{name}.csv"
        if path.exists():
            path.unlink()


class _IsolatedDataDirs:
    """
    Point config.INTERIM_DIR and config.RAW_DIR at throwaway directories for
    the duration of the suite.

    WHY: the integration tests write synthetic spine/acs/bea/... files and
    delete them afterwards. Before this existed they wrote to the REAL
    data/interim/, which silently destroyed a completed live fetch the first
    time the suite was run after one. Every module reads these paths from
    config at call time, so swapping the attributes is sufficient.
    """

    def __enter__(self) -> "_IsolatedDataDirs":
        self.saved = (config.INTERIM_DIR, config.RAW_DIR)
        self.tmp = Path(tempfile.mkdtemp(prefix="etl-offline-test-"))
        config.INTERIM_DIR = self.tmp / "interim"
        config.RAW_DIR = self.tmp / "raw"
        config.INTERIM_DIR.mkdir()
        config.RAW_DIR.mkdir()
        return self

    def __exit__(self, *exc: object) -> None:
        config.INTERIM_DIR, config.RAW_DIR = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# Integration tests
# ---------------------------------------------------------------------------


def test_healthy_build(fixtures: dict[str, pd.DataFrame]) -> None:
    print("\nintegration: healthy build")
    _write(fixtures)
    out = join.build()

    check(len(out) == len(fixtures["spine"]),
          f"row count preserved: {len(out)}")
    for col in ("home_value_to_income", "rent_to_income", "price_to_rent", "real_income",
                "property_tax_effective_rate"):
        check(col in out.columns, f"derived column {col} present")

    r = out.iloc[100]
    check(abs(r["price_to_rent"]
              - r["median_home_value"] / (r["median_gross_rent"] * 12)) < 1e-9,
          "price_to_rent matches definition")
    check(abs(r["real_income"]
              - r["median_household_income"] / (r["rpp_all"] / 100)) < 1e-9,
          "real_income matches definition")
    check(abs(r["home_value_to_income"]
              - r["median_home_value"] / r["median_household_income"]) < 1e-9,
          "home_value_to_income matches definition")
    check(abs(r["property_tax_effective_rate"]
              - 100 * r["aggregate_real_estate_taxes"] / r["aggregate_home_value"]) < 1e-9,
          "property_tax_effective_rate matches definition (aggregate taxes / aggregate value)")

    _, passed = validate.validate(out)
    check(passed, "validation passes on clean data")


def test_fips_bug_is_caught(fixtures: dict[str, pd.DataFrame]) -> None:
    print("\nintegration: FIPS leading-zero bug is caught")
    _write(fixtures)
    bad = fixtures["acs"].copy()
    bad["fips"] = bad["fips"].astype(int)   # the mistake
    bad.to_csv(config.INTERIM_DIR / "acs.csv", index=False)

    out = join.build()
    findings, passed = validate.validate(out)
    fips_findings = [f for f in findings
                     if f.severity == "FAIL" and "leading-zero" in f.message]
    check(not passed, "build is marked failed")
    check(bool(fips_findings), "a FAIL specifically names the leading-zero bug")


def test_sentinel_is_caught(fixtures: dict[str, pd.DataFrame]) -> None:
    print("\nintegration: unhandled Census sentinel is caught")
    _write(fixtures)
    bad = fixtures["acs"].copy()
    bad.loc[5, "median_household_income"] = -666666666
    bad.to_csv(config.INTERIM_DIR / "acs.csv", index=False)

    out = join.build()
    findings, passed = validate.validate(out)
    sentinel = [f for f in findings if f.severity == "FAIL" and "jam value" in f.message]
    check(not passed, "build is marked failed")
    check(bool(sentinel), "a FAIL names the jam value")


def test_zero_join_is_fail_even_for_optional_source(fixtures: dict[str, pd.DataFrame]) -> None:
    """
    The SEDA bug in its original form: the interim file exists, its FIPS are
    all wrong, nothing matches. Before, this was a WARN and BUILD OK.
    """
    print("\nintegration: an optional source that joins ~0% is a FAIL")
    _write(fixtures)
    bad = fixtures["seda"].copy()
    bad["fips"] = "000" + bad["fips"].str[:2]     # state code padded to 5 — the bug
    bad = bad.groupby("fips", as_index=False)["school_achievement"].mean()
    bad.to_csv(config.INTERIM_DIR / "seda.csv", index=False)

    out = join.build()
    findings, passed = validate.validate(out)
    hits = [f for f in findings if f.severity == "FAIL" and "broken join key" in f.message]
    check("school_achievement" in out.columns, "the column IS present (source ran)")
    check(not passed, "build is marked failed")
    check(bool(hits), "a FAIL names the broken join key")


def test_rpp_state_share_is_bounded(fixtures: dict[str, pd.DataFrame]) -> None:
    """
    Simulate the CBSA crosswalk and MARPP no longer lining up: metro counties
    silently take the statewide value. The "state" share balloons past the
    geography-derived bound and the metro share collapses — both must FAIL.
    """
    print("\nintegration: metro counties silently treated as rural is a FAIL")
    _write(fixtures)
    bad = fixtures["bea"].copy()
    bad.loc[bad["rpp_geo_level"] == "metro", "rpp_geo_level"] = "state"
    bad.to_csv(config.INTERIM_DIR / "bea.csv", index=False)

    out = join.build()
    findings, passed = validate.validate(out)
    state_hits = [f for f in findings if f.severity == "FAIL" and "'state'" in f.message]
    metro_hits = [f for f in findings if f.severity == "FAIL" and "metro RPP" in f.message]
    check(not passed, "build is marked failed")
    check(bool(state_hits), "a FAIL names the 'state' share bound")
    check(bool(metro_hits), "a FAIL names the collapsed metro share")

    # A modest overshoot (a few dozen metro counties without a MARPP row, as
    # happens with delineation-vintage drift) must NOT trip it.
    _write(fixtures)
    drift = fixtures["bea"].copy()
    metro_idx = drift.index[drift["rpp_geo_level"] == "metro"][:60]
    drift.loc[metro_idx, "rpp_geo_level"] = "state"
    drift.to_csv(config.INTERIM_DIR / "bea.csv", index=False)
    out = join.build()
    _, passed = validate.validate(out)
    check(passed, "60 drifted metro counties (≈64% state) still passes")

    # And the healthy 38/62 mix passes.
    _write(fixtures)
    out = join.build()
    _, passed = validate.validate(out)
    check(passed, "healthy metro/state mix passes")


def test_missing_source_degrades(fixtures: dict[str, pd.DataFrame]) -> None:
    print("\nintegration: a missing optional source degrades gracefully")
    _write(fixtures)
    (config.INTERIM_DIR / "seda.csv").unlink()

    out = join.build()
    check(len(out) == len(fixtures["spine"]),
          "row count unchanged when a source is absent")
    check("school_achievement" not in out.columns,
          "the absent source's column is simply missing, not null-filled")


def test_noaa_per_variable_station_selection() -> None:
    print("\nNOAA: stations are selected per variable group, not per county")
    from .sources import noaa
    csv_hdr = "STATION,DATE,MLY-TMAX-NORMAL,MLY-TMIN-NORMAL,MLY-PRCP-NORMAL,MLY-SNOW-NORMAL\n"
    rain_only = csv_hdr + "".join(f"X,{m:02d},,,3.1,\n" for m in range(1, 13))
    parsed = noaa._parse_station_csv(rain_only, "RAIN")
    check(parsed is not None and parsed["prcp"].notna().all(),
          "a precipitation-only station is kept, not discarded")

    # The nearest station has temperature but no snow; a farther one has snow.
    normals = pd.DataFrame({
        "station": ["TEMP"] * 12 + ["SNOW"] * 12,
        "month": list(range(1, 13)) * 2,
        "tmax": [80.0] * 12 + [np.nan] * 12,
        "tmin": [40.0] * 12 + [np.nan] * 12,
        "tavg": [60.0] * 12 + [np.nan] * 12,
        "prcp": [np.nan] * 24,
        "snow": [np.nan] * 12 + [2.0] * 12,
    })
    candidates = pd.DataFrame({"fips": ["01001", "01001"], "station": ["TEMP", "SNOW"],
                               "dist_mi": [1.0, 20.0]})
    temp = noaa._nearest_with(candidates, noaa._stations_with(normals, ("tmax", "tmin", "tavg")))
    snow = noaa._nearest_with(candidates, noaa._stations_with(normals, ("snow",)))
    check(temp["station"].tolist() == ["TEMP"], "temperature uses the station with temperature")
    check(snow["station"].tolist() == ["SNOW"],
          "snowfall comes from a farther station when the nearest has none")


def test_app_payload_is_compact_and_lossless_where_it_matters() -> None:
    print("\nbuild: published app payload is columnar, rounded, null-safe")
    import json
    from . import build
    df = pd.DataFrame({
        "fips": ["06075", "01001"],
        "population": [836321.0, 59285.0],
        "school_achievement": [np.nan, 0.0824653642],
        "summer_high_f": [70.98755437, 95.3203326],
    })
    payload = build.to_app_payload(df)
    check(payload["columns"] == list(df.columns), "columns listed once, in order")
    check(payload["rows"][0][0] == "06075", "fips stays a string with its leading zero")
    check(payload["rows"][0][1] == 836321 and isinstance(payload["rows"][0][1], int),
          "whole-number column published as int")
    check(payload["rows"][0][2] is None, "NaN published as null, not 0 or NaN")
    check(payload["rows"][1][2] == 0.082 and payload["rows"][1][3] == 95.32,
          "floats rounded per column")
    text = json.dumps(payload, allow_nan=False)
    check("NaN" not in text, "payload is strict JSON")


def test_population_center_search_points() -> None:
    print("\npopcenter: parse the Census file and prefer it over the internal point")
    from .sources import noaa, popcenter
    text = ("\ufeffSTATEFP,COUNTYFP,COUNAME,STNAME,POPULATION,LATITUDE,LONGITUDE\n"
            "06,073,San Diego,California,3298634,+32.884418,-117.112348\n")
    out = popcenter.parse(text)
    check(out["fips"].tolist() == ["06073"], "byte-order mark stripped; FIPS built as a string")
    check(abs(out.loc[0, "pop_lon"] + 117.112348) < 1e-9, "signed coordinates parse")

    spine = pd.DataFrame({"fips": ["06073", "09190"], "lat": [33.0, 41.3], "lon": [-116.7, -73.4]})
    pts = noaa.search_points(spine, out)
    check(pts["climate_point"].tolist() == ["population", "internal"],
          "population center used where known; internal point is the fallback")
    check(abs(pts.loc[0, "lon"] + 117.112348) < 1e-9 and pts.loc[1, "lon"] == -73.4,
          "search coordinates come from the chosen point")
    check(noaa.search_points(spine, None)["climate_point"].eq("internal").all(),
          "no popcenter file at all -> every county uses its internal point")


def test_boundaries_must_match_data() -> None:
    print("\nboundaries: shapes and data must cover the same counties")
    import json
    from . import validate
    from .sources import boundaries
    df = pd.DataFrame({"fips": ["01001", "06075"]})
    path = boundaries.output_path()
    check(config.INTERIM_DIR in path.parents, "boundary path follows the (isolated) interim dir")
    sev = [f.severity for f in validate._check_boundaries(df)]
    check(sev == ["WARN"], "no boundary file -> WARN, not a crash")

    def write(ids: list[str]) -> None:
        geoms = [{"type": "Polygon", "arcs": [], "properties": {"GEOID": i}} for i in ids]
        path.write_text(json.dumps({"type": "Topology", "objects": {"counties": {"geometries": geoms}}}))
    write(["01001", "06075"])
    check([f.severity for f in validate._check_boundaries(df)] == ["INFO"], "exact match passes")
    write(["01001"])
    check([f.severity for f in validate._check_boundaries(df)] == ["FAIL"], "a county with no shape FAILs")
    write(["01001", "06075", "99999"])
    check([f.severity for f in validate._check_boundaries(df)] == ["FAIL"], "a shape with no data FAILs")
    path.unlink()


def main() -> int:
    print("=" * 70)
    print("OFFLINE TEST SUITE — no network required")
    print("=" * 70)

    real_interim = config.INTERIM_DIR
    with _IsolatedDataDirs() as iso:
        assert config.INTERIM_DIR != real_interim, "isolation failed; refusing to run"
        print(f"(isolated data dirs under {iso.tmp}; real data/ is untouched)")

        test_normalize_fips()
        test_haversine()
        test_nearest_points()
        test_census_sentinels()
        test_add_fips_column()
        test_safe_divide()
        test_cache_path_hides_query_string()
        test_http_get_never_caches_rejected_bodies()
        test_seda_county_fips_width_guard()
        test_seda_subgroup_and_gap_filter()
        test_noaa_inventory_parser()
        test_noaa_per_variable_station_selection()
        test_population_center_search_points()
        test_boundaries_must_match_data()
        test_gazetteer_encoding_guard()
        test_app_payload_is_compact_and_lossless_where_it_matters()

        fixtures = _make_synthetic()
        try:
            test_healthy_build(fixtures)
            test_fips_bug_is_caught(fixtures)
            test_sentinel_is_caught(fixtures)
            test_zero_join_is_fail_even_for_optional_source(fixtures)
            test_rpp_state_share_is_bounded(fixtures)
            test_missing_source_degrades(fixtures)
        finally:
            _cleanup(fixtures)
            print("\n(synthetic interim files removed)")

    print("\n" + "=" * 70)
    print(f"{PASS} passed, {FAIL} failed")
    print("=" * 70)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
