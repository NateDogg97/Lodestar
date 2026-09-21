"""
SOURCE: BEA Regional Price Parities (RPP) — cost of living.

WHAT THIS PRODUCES
    fips, rpp_all, rpp_rents, rpp_utilities, rpp_goods, rpp_services,
    rpp_geo_level (metro | state), rpp_source_geo

WHAT AN RPP IS
    A price level expressed as a percentage of the national average for a
    given year. 110 means prices are 10% above the national average; 87 means
    13% below. BEA's documented use: income divided by (RPP/100) gives
    purchasing-power-adjusted income.

THE CENTRAL PROBLEM THIS MODULE SOLVES
    BEA publishes RPP for states and for metropolitan areas (CBSAs). It does
    NOT publish county-level RPP. (Verified 2026-09-20. County estimates are
    produced internally as part of BEA's methodology but withheld pending
    reliability work.)

    It ALSO does not publish a per-state non-metro portion, despite the
    interactive tables suggesting otherwise. Verified 2026-09-20 against both
    the Regional API (GetParameterValuesFiltered on GeoFips for SARPP and
    MARPP) and the bulk downloads (apps.bea.gov/regional/zip/{SARPP,MARPP}.zip):
    the only portion row anywhere is "00999 United States (Nonmetropolitan
    Portion)" — national, not per state.

    So every county inherits a value by one of two rules:
      1. County is in a METROPOLITAN CBSA -> that CBSA's RPP      (metro)
      2. Otherwise                        -> the statewide RPP    (state)

    Which rule fired is recorded per county in `rpp_geo_level`, and the
    specific source geography in `rpp_source_geo`. Do not drop these columns:
    they are how you answer "why does this rural county have the same cost of
    living as that one?" without re-deriving the whole pipeline.

    KNOWN PRECISION LOSS, TWO WAYS:
      - Every county in a metro shares one number. Travis and Williamson both
        get Austin's RPP.
      - Every non-metro county gets its state's blended RPP, which includes
        that state's metros and so runs somewhat HIGH for rural areas — most
        in states dominated by one expensive metro (CA, WA, CO, NY, MA).
        Roughly 62% of counties are on this rule.
    Both are the reason for the component split below. A true state
    non-metro value would need to be derived (statewide minus its metros,
    by BEA's expenditure weights) — deferred, see Working Master Plan.md.

    If BEA ever starts publishing per-state portions, _classify_state_rows
    still detects them by name and they take precedence over rule 2 as level
    "nonmetro". Nothing else needs to change.

WHY FIVE COLUMNS AND NOT ONE
    BEA estimates RPPs for four subcategories — goods, housing rents,
    utilities, and other services — plus the blended all-items index.
    (Utilities were folded into "other services" until BEA's December 2021
    methodology revision split them out.)

    Storing the components separately is what makes sub-county geography
    possible later. At tract level you keep the metro's goods / utilities /
    other-services values, replace the housing-rents component with actual ACS
    rent data for that tract, and recombine. That yields a neighborhood-
    accurate cost index with no commercial data vendor.

    Storing one blended number instead would mean re-architecting to add
    tracts. Five columns cost nothing now.

    NOTE: rpp_utilities is stored but gets NO weight slider in the UI — per
    product decision, utilities are not a filter criterion. It exists purely
    so the tract-level recombination has all four parts. Do not remove it
    because it looks unused.

EXPENDITURE WEIGHTS ARE NOT HARDCODED
    BEA constructs component weights from PCE and ACS housing-rents
    expenditures. They are derived, not a fixed national split, and any
    figure quoted from memory is wrong. Phase 1 does not need them — we store
    components as published and BEA's own rpp_all is the authoritative blend.
    When the tract path needs to recombine, read the weights from BEA's
    methodology release rather than inventing them.

LINE CODES AND GEOFIPS ARE DISCOVERED, NOT ASSUMED
    BEA identifies each RPP component by a numeric LineCode within the SARPP
    and MARPP tables, and identifies the non-metro portions by special GeoFips
    values. Both have changed across methodology revisions and neither is
    reliably documented in a stable place.

    Rather than hardcode values that may be wrong, this module calls BEA's
    GetParameterValues endpoint, matches line descriptions against keywords,
    and LOGS WHAT IT FOUND. If the matching fails, it raises with the full
    list so you can see exactly what BEA offered.

    >>> If you are QA-ing this pipeline, the LineCode mapping printed on the
    >>> first run is the single most important thing to eyeball. <<<

RUN STANDALONE
    python -m etl.sources.bea
"""

from __future__ import annotations

import json
import re

import pandas as pd

from .. import config
from ..util import (
    BadResponse,
    describe_frame,
    expect_json,
    get_logger,
    http_get,
    normalize_fips,
    read_interim,
    write_interim,
)

log = get_logger("source.bea")


MAX_VINTAGE_LOOKBACK = 3

# Keyword patterns used to identify each component from BEA's line
# descriptions. Ordered most-specific first, because "services" appears in
# several descriptions and we must not let "other services" swallow
# "utilities" or vice versa.
#
# Matching is case-insensitive substring/regex against the line description.
COMPONENT_PATTERNS: list[tuple[str, str]] = [
    ("rpp_all",       r"all items"),
    ("rpp_goods",     r"\bgoods\b"),
    ("rpp_rents",     r"(housing|rents)"),
    ("rpp_utilities", r"utilit"),
    ("rpp_services",  r"other\s+services|services:\s*other"),
]


def _bea_request(params: dict[str, str]) -> dict:
    """Call the BEA API and return parsed JSON, with useful errors."""
    if not config.BEA_API_KEY:
        raise RuntimeError(
            "BEA_API_KEY is not set. Register (instant, free) at "
            "https://apps.bea.gov/API/signup/ and put the key in your .env"
        )

    full = {
        "UserID": config.BEA_API_KEY,
        "ResultFormat": "json",
        **params,
    }

    # Readable cache name without the key: e.g. bea_GetData_SARPP_1_2024.
    hint = "bea_" + "_".join(
        str(params[k]) for k in ("method", "TableName", "LineCode", "Year", "TargetParameter")
        if k in params
    )

    # BEA reports errors INSIDE a 200 response (throttling, bad year, bad key).
    # Rejecting them here means they never land in the cache, so a throttled
    # run does not poison the next one.
    def _check(payload: object) -> None:
        data = expect_json(payload)
        api = data.get("BEAAPI", {}) if isinstance(data, dict) else {}
        if "Error" in api:
            raise BadResponse(f"BEA API error: {api['Error']}")
        results = api.get("Results", {})
        if isinstance(results, dict) and "Error" in results:
            raise BadResponse(f"BEA API error: {results['Error']}")
        if not isinstance(results, dict):
            # Some error shapes come back as a bare list. Reject here so it
            # is never cached, and so .get() does not blow up two frames later.
            raise BadResponse(
                f"BEA Results is a {type(results).__name__}, not an object: {str(results)[:300]}"
            )

    try:
        body = http_get(config.BEA_API_BASE, params=full, cache_hint=hint, check=_check)
    except BadResponse as exc:
        raise RuntimeError(str(exc)) from exc

    assert isinstance(body, str)
    return json.loads(body)["BEAAPI"]["Results"]


def discover_line_codes(table_name: str) -> dict[str, str]:
    """
    Ask BEA which LineCodes exist for a table and map them to our column names.

    Returns {our_column_name: line_code}. Raises if any expected component
    cannot be matched, printing everything BEA offered so the patterns can be
    corrected.
    """
    log.info("discovering LineCodes for %s", table_name)
    results = _bea_request({
        "method": "GetParameterValuesFiltered",
        "datasetname": "Regional",
        "TargetParameter": "LineCode",
        "TableName": table_name,
    })

    values = results.get("ParamValue", [])
    if not values:
        raise RuntimeError(
            f"BEA returned no LineCodes for {table_name}. Raw results: {results}"
        )

    # BEA uses "Key"/"Desc" or "KeyValue"/"Description" depending on endpoint.
    def _key(entry: dict) -> str:
        for k in ("Key", "KeyValue", "LineCode"):
            if k in entry:
                return str(entry[k])
        raise KeyError(f"No recognizable key field in {entry}")

    def _desc(entry: dict) -> str:
        for k in ("Desc", "Description", "LineDescription"):
            if k in entry:
                return str(entry[k])
        raise KeyError(f"No recognizable description field in {entry}")

    catalog = [(_key(v), _desc(v)) for v in values]

    log.info("%s offers %d line codes:", table_name, len(catalog))
    for code, desc in catalog:
        log.info("    LineCode %-4s = %s", code, desc)

    mapping: dict[str, str] = {}
    claimed: set[str] = set()

    for column, pattern in COMPONENT_PATTERNS:
        for code, desc in catalog:
            if code in claimed:
                continue
            if re.search(pattern, desc, flags=re.IGNORECASE):
                mapping[column] = code
                claimed.add(code)
                break

    missing = [col for col, _ in COMPONENT_PATTERNS if col not in mapping]
    if missing:
        raise RuntimeError(
            f"Could not match these RPP components in {table_name}: {missing}.\n"
            f"BEA offered:\n" +
            "\n".join(f"    {c} = {d}" for c, d in catalog) +
            "\nFix COMPONENT_PATTERNS at the top of sources/bea.py."
        )

    log.info("resolved component mapping for %s:", table_name)
    for column, code in mapping.items():
        desc = next(d for c, d in catalog if c == code)
        log.info("    %-16s -> LineCode %-4s (%s)", column, code, desc)

    return mapping


def _fetch_table(table_name: str, geo_fips: str, year: int,
                 line_codes: dict[str, str]) -> pd.DataFrame:
    """
    Pull every component for one table/geography, returning a wide frame
    indexed by BEA GeoFips.
    """
    frames: list[pd.DataFrame] = []

    for column, code in line_codes.items():
        results = _bea_request({
            "method": "GetData",
            "datasetname": "Regional",
            "TableName": table_name,
            "LineCode": code,
            "GeoFips": geo_fips,
            "Year": str(year),
        })
        rows = results.get("Data", [])
        if not rows:
            raise RuntimeError(
                f"No data for {table_name} LineCode {code} year {year}. "
                f"Try an earlier year."
            )

        df = pd.DataFrame(rows)
        df = df[["GeoFips", "GeoName", "DataValue"]].copy()
        df["GeoFips"] = df["GeoFips"].astype(str).str.strip()
        # BEA formats numbers with thousands separators and uses "(NA)" for
        # suppressed values.
        df[column] = pd.to_numeric(
            df["DataValue"].astype(str).str.replace(",", "", regex=False),
            errors="coerce",
        )
        frames.append(df[["GeoFips", "GeoName", column]].set_index(["GeoFips", "GeoName"]))

    wide = pd.concat(frames, axis=1).reset_index()
    log.info("%s / %s: %d geographies", table_name, geo_fips, len(wide))
    return wide


def fetch_rpp_tables(year: int | None = None) -> tuple[pd.DataFrame, pd.DataFrame, int]:
    """
    Fetch state-level (SARPP) and metro-level (MARPP) RPP.

    SARPP contains statewide values AND the metro/non-metro portion rows we
    need for rule 2. MARPP contains one row per CBSA.

    Returns (state_df, metro_df, year_used).
    """
    start_year = year or config.BEA_YEAR

    sa_codes = discover_line_codes("SARPP")
    ma_codes = discover_line_codes("MARPP")

    last_error: Exception | None = None
    for candidate in range(start_year, start_year - MAX_VINTAGE_LOOKBACK - 1, -1):
        try:
            log.info("trying BEA RPP year %s", candidate)
            state_df = _fetch_table("SARPP", "STATE", candidate, sa_codes)
            metro_df = _fetch_table("MARPP", "MSA", candidate, ma_codes)
            log.info("using BEA RPP year %s", candidate)
            return state_df, metro_df, candidate
        except RuntimeError as exc:
            log.warning("BEA year %s unavailable: %s", candidate, exc)
            last_error = exc

    raise RuntimeError(
        f"No BEA RPP year responded between {start_year} and "
        f"{start_year - MAX_VINTAGE_LOOKBACK}."
    ) from last_error


def load_cbsa_crosswalk(year: int | None = None) -> pd.DataFrame:
    """
    County -> CBSA mapping from the Census/OMB delineation file.

    Returns columns: fips, cbsa, cbsa_name, metro_type

    FALLBACK IF THIS BREAKS
        The delineation URL changes with each OMB revision and the .xlsx has a
        variable number of preamble rows. If this function fails:
          1. Visit https://www.census.gov/geographies/reference-files.html
             and find the current "Core based statistical areas (CBSAs)...
             County membership" file.
          2. Save it as data/raw/cbsa_crosswalk_manual.csv with at minimum the
             columns: cbsa_code, cbsa_title, fips_state_code, fips_county_code
          3. This function picks that file up automatically if present.
    """
    manual = config.RAW_DIR / "cbsa_crosswalk_manual.csv"
    if manual.exists():
        log.info("using manual CBSA crosswalk at %s", manual)
        df = pd.read_csv(manual, dtype=str)
        cols = {c.lower().strip().replace(" ", "_"): c for c in df.columns}
        df["fips"] = (
            df[cols["fips_state_code"]].map(lambda v: normalize_fips(v, 2)).fillna("")
            + df[cols["fips_county_code"]].map(lambda v: normalize_fips(v, 3)).fillna("")
        ).map(normalize_fips)
        out = pd.DataFrame({
            "fips": df["fips"],
            "cbsa": df[cols["cbsa_code"]].astype(str).str.strip(),
            "cbsa_name": df[cols["cbsa_title"]].astype(str).str.strip(),
            "metro_type": df[cols.get("metropolitan/micropolitan_statistical_area",
                                      cols.get("cbsa_title"))].astype(str),
        })
        return out.dropna(subset=["fips"])

    year = year or config.CBSA_DELINEATION_YEAR
    url = config.CBSA_DELINEATION_URL.format(year=year)
    log.info("fetching CBSA delineation file for %s", year)

    blob = http_get(url, binary=True)
    assert isinstance(blob, bytes)

    import io as _io

    # The file has 2-3 title rows above the real header, and a few footnote
    # rows at the bottom. Find the header by looking for the row containing
    # "CBSA Code".
    probe = pd.read_excel(_io.BytesIO(blob), header=None, nrows=12, dtype=str)
    header_row = None
    for i in range(len(probe)):
        row_text = " ".join(str(v) for v in probe.iloc[i].tolist())
        if "CBSA Code" in row_text:
            header_row = i
            break
    if header_row is None:
        raise ValueError(
            "Could not locate the header row in the CBSA delineation file. "
            "See the FALLBACK note in load_cbsa_crosswalk()."
        )

    df = pd.read_excel(_io.BytesIO(blob), header=header_row, dtype=str)
    df.columns = [str(c).strip() for c in df.columns]

    def _col(*candidates: str) -> str:
        for cand in candidates:
            for c in df.columns:
                if c.lower().strip() == cand.lower():
                    return c
        raise KeyError(
            f"None of {candidates} found in delineation file. Columns: {list(df.columns)}"
        )

    c_cbsa = _col("CBSA Code")
    c_title = _col("CBSA Title")
    c_state_fips = _col("FIPS State Code")
    c_county_fips = _col("FIPS County Code")
    c_type = _col("Metropolitan/Micropolitan Statistical Area")

    df = df.dropna(subset=[c_cbsa, c_state_fips, c_county_fips])

    out = pd.DataFrame({
        "fips": (
            df[c_state_fips].map(lambda v: normalize_fips(v, 2)).fillna("")
            + df[c_county_fips].map(lambda v: normalize_fips(v, 3)).fillna("")
        ).map(normalize_fips),
        "cbsa": df[c_cbsa].astype(str).str.strip().str.replace(".0", "", regex=False),
        "cbsa_name": df[c_title].astype(str).str.strip(),
        "metro_type": df[c_type].astype(str).str.strip(),
    }).dropna(subset=["fips"])

    out = out.drop_duplicates(subset=["fips"])

    n_metro = int((out["metro_type"].str.contains("Metropolitan", case=False, na=False)).sum())
    log.info("CBSA crosswalk: %d counties mapped (%d metropolitan, %d micropolitan)",
             len(out), n_metro, len(out) - n_metro)
    return out


def _classify_state_rows(state_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Split SARPP rows into statewide values and (if any) non-metro-portion values.

    As of the 2026-02 release BEA publishes NO per-state portions through the
    API or the bulk files, so `nonmetro` comes back empty and every non-metro
    county takes the statewide value. The detection is kept, by GeoName, so
    that if BEA ever adds "Alabama (Nonmetropolitan Portion)" rows they are
    picked up automatically and logged.
    """
    name = state_df["GeoName"].astype(str)

    is_nonmetro = name.str.contains("nonmetropolitan", case=False, na=False)
    is_metro_portion = name.str.contains("metropolitan portion", case=False, na=False) & ~is_nonmetro

    statewide = state_df[~is_nonmetro & ~is_metro_portion].copy()
    nonmetro = state_df[is_nonmetro].copy()

    # Derive a 2-char state FIPS. BEA state GeoFips are 5 chars like "01000".
    statewide["state_fips"] = statewide["GeoFips"].str[:2]
    nonmetro["state_fips"] = nonmetro["GeoFips"].str[:2]

    log.info("SARPP: %d statewide rows, %d non-metro portion rows, %d metro portion rows",
             len(statewide), len(nonmetro), int(is_metro_portion.sum()))

    if nonmetro.empty:
        log.info(
            "No per-state non-metro portion rows in SARPP (expected: BEA does not "
            "publish them). Non-metro counties take the statewide RPP, level 'state'."
        )
    else:
        log.warning(
            "BEA now publishes per-state non-metro portions (%d rows). They will "
            "be used as level 'nonmetro'. Re-check validate.py thresholds.",
            len(nonmetro),
        )

    return statewide, nonmetro


def fetch(year: int | None = None) -> pd.DataFrame:
    """Build per-county RPP by inheriting from metro / non-metro / state."""
    spine = read_interim("spine")
    state_df, metro_df, year_used = fetch_rpp_tables(year)
    crosswalk = load_cbsa_crosswalk()

    statewide, nonmetro = _classify_state_rows(state_df)

    component_cols = [col for col, _ in COMPONENT_PATTERNS]

    # --- Rule 1: counties in a CBSA inherit that CBSA's RPP -----------------
    metro_lookup = metro_df.copy()
    metro_lookup["cbsa"] = metro_lookup["GeoFips"].astype(str).str.strip()
    metro_lookup = metro_lookup.set_index("cbsa")

    df = spine[["fips", "state"]].copy()
    df["state_fips"] = df["fips"].str[:2]
    df = df.merge(crosswalk[["fips", "cbsa", "cbsa_name", "metro_type"]],
                  on="fips", how="left")

    # Only METROPOLITAN CBSAs have BEA RPP. Micropolitan areas are in the
    # delineation file but BEA does not publish RPP for them, so they must
    # fall through to the non-metro portion rule.
    is_micro = df["metro_type"].str.contains("Micropolitan", case=False, na=False)
    df.loc[is_micro, "cbsa"] = pd.NA

    joined = df.join(metro_lookup[component_cols], on="cbsa")
    joined["rpp_geo_level"] = pd.NA
    joined["rpp_source_geo"] = pd.NA

    has_metro = joined[component_cols].notna().any(axis=1)
    joined.loc[has_metro, "rpp_geo_level"] = "metro"
    joined.loc[has_metro, "rpp_source_geo"] = joined.loc[has_metro, "cbsa_name"]

    # A county the crosswalk calls METROPOLITAN but whose CBSA code is absent
    # from MARPP will fall through to the non-metro rule below and get tagged
    # "nonmetro". That is usually a delineation-vintage mismatch (OMB renamed
    # or renumbered the CBSA). Report it loudly so it is not mistaken for a
    # genuinely rural county.
    in_metro_cbsa = joined["cbsa"].notna() & ~is_micro
    unmatched = in_metro_cbsa & ~has_metro
    n_unmatched = int(unmatched.sum())
    if n_unmatched:
        sample = (
            joined.loc[unmatched, ["cbsa", "cbsa_name"]]
            .drop_duplicates()
            .head(8)
            .apply(lambda r: f"{r['cbsa']} {r['cbsa_name']}", axis=1)
            .tolist()
        )
        log.warning(
            "%d counties are in a METROPOLITAN CBSA per the crosswalk but that "
            "CBSA has no MARPP row; they will take the non-metro value. "
            "Likely a delineation-vintage mismatch. Examples: %s",
            n_unmatched, sample,
        )
    else:
        log.info("every crosswalk-metropolitan county matched a MARPP row")

    # --- Rule 2a (only if BEA ever publishes them): state non-metro portion --
    nonmetro_lookup = nonmetro.set_index("state_fips")
    need = ~has_metro
    if not nonmetro_lookup.empty:
        fill = joined.loc[need, "state_fips"].map(
            lambda s: nonmetro_lookup[component_cols].to_dict("index").get(s)
        )
        for col in component_cols:
            joined.loc[need, col] = fill.map(
                lambda d, c=col: d.get(c) if isinstance(d, dict) else None
            )
        filled = need & joined[component_cols].notna().any(axis=1)
        joined.loc[filled, "rpp_geo_level"] = "nonmetro"
        joined.loc[filled, "rpp_source_geo"] = (
            joined.loc[filled, "state"] + " (nonmetro portion)"
        )

    # --- Rule 2: everything else takes the statewide RPP --------------------
    # This is the designed path for ~62% of counties, not an error fallback.
    statewide_lookup = statewide.set_index("state_fips")
    still_need = joined[component_cols].isna().all(axis=1)
    if still_need.any() and not statewide_lookup.empty:
        fill = joined.loc[still_need, "state_fips"].map(
            lambda s: statewide_lookup[component_cols].to_dict("index").get(s)
        )
        for col in component_cols:
            joined.loc[still_need, col] = fill.map(
                lambda d, c=col: d.get(c) if isinstance(d, dict) else None
            )
        filled = still_need & joined[component_cols].notna().any(axis=1)
        joined.loc[filled, "rpp_geo_level"] = "state"
        joined.loc[filled, "rpp_source_geo"] = joined.loc[filled, "state"]

    out = joined[["fips", "rpp_geo_level", "rpp_source_geo"] + component_cols].copy()
    out["rpp_vintage"] = year_used

    counts = out["rpp_geo_level"].value_counts(dropna=False)
    log.info("RPP assignment: %s", counts.to_dict())

    unresolved = int(out[component_cols].isna().all(axis=1).sum())
    if unresolved:
        log.warning("%d counties got no RPP at all", unresolved)

    return out.sort_values("fips").reset_index(drop=True)


def main() -> None:
    df = fetch()
    write_interim(df, "bea")
    print(describe_frame(df, "bea"))
    print("\nAssignment breakdown:")
    print(df["rpp_geo_level"].value_counts(dropna=False).to_string())
    print("\nSpot checks:")
    for fips, label in config.SPOT_CHECK_FIPS.items():
        row = df[df["fips"] == fips]
        if row.empty:
            print(f"  {fips}  MISSING  — {label}")
        else:
            r = row.iloc[0]
            print(f"  {fips}  all={r['rpp_all']!s:>6}  rents={r['rpp_rents']!s:>6}  "
                  f"[{r['rpp_geo_level']}: {r['rpp_source_geo']}]  — {label}")


if __name__ == "__main__":
    main()
