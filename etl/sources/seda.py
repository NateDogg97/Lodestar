"""
SOURCE: Stanford Education Data Archive (SEDA) — school quality.

WHAT THIS PRODUCES
    fips, school_achievement

WHAT THE NUMBER MEANS
    SEDA's cohort-standardized (CS) scale expresses average test performance
    in GRADE LEVELS relative to the national average. A value of 0.42 means
    students in that county test about four-tenths of a grade level ahead of
    the national average; -0.38 means about a third of a grade behind. Typical
    range is roughly -2 to +2.

    This is a genuinely intuitive unit, which is why SEDA beats a 1-10 rating
    for our purposes — the scoring engine can rank it and a human can read it.

WHY SEDA AND NOT GREATSCHOOLS
    GreatSchools' 1-10 ratings and assigned-school data are not available in
    their public NearbySchools API; they require an enterprise Data Licensing
    agreement with no published pricing. The API tier exposes only three coarse
    bands. SEDA is free, nationally comparable, academically rigorous, and we
    can rank it however we like.

THE COUNTY APPROXIMATION
    School districts do not nest inside counties — they cross county lines
    constantly. SEDA publishes county-level rollups (aggregating the districts
    within each county), which is what we use. This is an approximation and
    the UI should eventually say so. It is adequate for "which counties have
    strong schools", inadequate for "which specific district should I target".

DATA LAG
    SEDA's main public releases cover roughly the 2008-09 through 2018-19
    school years, with a special 2023 release produced with Harvard's CEPR.
    That lag is acceptable for RELATIVE ranking — district quality is sticky
    over a decade — but it is not current-year data. Surface the vintage in
    the UI.

WHY THIS IS A MANUAL DOWNLOAD
    SEDA gates its files behind a download page and the direct file URLs
    change between versions (4.1, 5.0, 6.0...). Rather than scrape a URL that
    will rot, this module expects the file to already be on disk and tells you
    exactly how to get it. One download every few years is not worth
    automating badly.

HOW TO GET THE FILE
    1. Go to https://edopportunity.org/opportunity/data/downloads/
    2. Choose the most recent version's COUNTY-level, POOLED,
       COHORT-STANDARDIZED (CS) file. It will be named something close to
       seda_county_pool_cs_6.0.csv
    3. Save it to:  etl/data/raw/
    4. Re-run this module. It auto-detects any file matching seda*county*.csv

COLUMN DETECTION
    SEDA renames columns between versions (cs_mn_all, mn_all_cs, etc.).
    This module searches for a plausible match and logs what it picked.
    Verify that log line on first run.

RUN STANDALONE
    python -m etl.sources.seda
"""

from __future__ import annotations

import re

import pandas as pd

from .. import config
from ..util import add_fips_column, describe_frame, get_logger, write_interim

log = get_logger("source.seda")


# Candidate column names for the pooled, all-students, cohort-standardized
# mean achievement value, most-preferred first. Matched case-insensitively.
#
# SEDA 6.0 (verified 2026-09-20): `cs_mn_avg_eb` and `cs_mn_avg_ol`. "avg" is
# the achievement level pooled across grades, years and subjects (lrn = learning
# rate, tav = trend, mth = math-minus-reading — NOT what we want). "eb" is the
# empirical-Bayes estimate, shrunk toward the mean in proportion to its
# uncertainty; "ol" is the unshrunk OLS estimate. Product decision 2026-09-20:
# use EB. This layer's job is narrowing counties, and a small county sitting at
# the top of the list on one noisy cohort wastes attention. For large counties
# the two agree to two decimals. Switching is a one-line change and a re-join.
ACHIEVEMENT_COLUMN_CANDIDATES = [
    "cs_mn_avg_eb",   # v6.0 pooled, all subjects, empirical Bayes
    "cs_mn_avg_ol",   # v6.0 pooled, all subjects, OLS
    "cs_mn_all",      # v4.x / v5.x pooled cohort-standardized mean, all students
    "mn_all_cs",
    "cs_mn_avg_all",
    "gcs_mn_all",     # grade-cohort-standardized variant
    "mn_all",
]

# SEDA 6.0 pooled files are LONG ON SUBGROUP: ~16 rows per county (all, mal,
# fem, wht, blk, hsp, ecd, ...) plus between-group GAP rows (gap == 1). We want
# the all-students level only. These filters run before anything else; the
# generic "long axis" detection below would not catch `subgroup` and would
# have averaged every county across all subgroups and gap rows — a plausible
# number that means nothing.
SUBGROUP_COLUMN = "subgroup"
SUBGROUP_ALL_VALUE = "all"
GAP_COLUMN = "gap"
GAP_LEVEL_VALUE = "0"

# Candidate column names for the county identifier, most-preferred first.
#
# ORDER MATTERS, AND IT BIT US: in SEDA's county files `sedacounty` is the
# 5-digit county code and `fips` is the 2-digit STATE code. With `fips`
# listed first every row normalized to "000XX", ~3,000 counties collapsed to
# ~51, and — because SEDA is optional — the build exited 0 with a WARN and no
# school data at all. `sedacounty` now leads, AND _looks_like_county_fips()
# rejects any candidate whose values are not county-shaped, so the next
# rename does not reintroduce the bug.
FIPS_COLUMN_CANDIDATES = [
    "sedacounty", "countyid", "county_id", "countyfips", "county_fips", "fips",
]

# A county FIPS column should be 5 digits — or 4 when a leading zero has been
# eaten by a spreadsheet (AL..GA). A state code column is 1-2 digits. Require
# this share of non-null values to be 4 or 5 digits wide before accepting.
COUNTY_FIPS_MIN_WIDTH_SHARE = 0.90


def _find_seda_file() -> "object":
    """Locate a SEDA county file in data/raw/, or raise with instructions."""
    # Newest by modification time, not alphabetically: "5.0" sorts before
    # "6.0" but "10.0" would not, and mtime is what "the one you just
    # downloaded" actually means.
    candidates = sorted(config.RAW_DIR.glob("seda*county*.csv"),
                        key=lambda p: p.stat().st_mtime)
    if not candidates:
        raise FileNotFoundError(
            "No SEDA county file found in data/raw/.\n"
            "\n"
            "  1. Go to " + config.SEDA_DOWNLOAD_PAGE + "\n"
            "  2. Download the most recent COUNTY-level POOLED\n"
            "     COHORT-STANDARDIZED (CS) file, e.g.\n"
            "     " + config.SEDA_EXPECTED_FILENAME + "\n"
            "  3. Save it into " + str(config.RAW_DIR) + "\n"
            "  4. Re-run: python -m etl.sources.seda\n"
        )
    if len(candidates) > 1:
        log.warning("multiple SEDA files found, using newest: %s",
                    [c.name for c in candidates])
    chosen = candidates[-1]
    log.info("using SEDA file: %s", chosen.name)
    return chosen


def _looks_like_county_fips(series: pd.Series) -> tuple[bool, str]:
    """
    Width guard for the county-id column. Returns (ok, reason).

    Digits-only length of each non-null value must be 4 or 5 for at least
    COUNTY_FIPS_MIN_WIDTH_SHARE of rows. A state-FIPS column (1-2 digits) or
    a district id (7 digits) fails this regardless of what it is named.
    """
    values = series.dropna().astype(str).str.strip()
    values = values[values != ""]
    if values.empty:
        return False, "column is empty"
    digits = values.str.replace(r"\.0$", "", regex=True).str.replace(r"\D", "", regex=True)
    widths = digits.str.len()
    share = float(widths.isin([4, 5]).mean())
    dist = widths.value_counts().sort_index().to_dict()
    if share < COUNTY_FIPS_MIN_WIDTH_SHARE:
        return False, f"only {share:.0%} of values are 4-5 digits wide (widths: {dist})"
    return True, f"{share:.0%} of values are 4-5 digits wide (widths: {dist})"


def _pick_column(
    df: pd.DataFrame,
    candidates: list[str],
    what: str,
    accept: "callable | None" = None,
) -> str:
    """
    Find the first candidate present, case-insensitively. Raise with context.

    `accept(series) -> (ok, reason)` lets a caller reject a name match whose
    contents are wrong — the SEDA county file has a column literally named
    `fips` that holds state codes.
    """
    lower = {c.lower(): c for c in df.columns}
    rejected: list[str] = []
    for cand in candidates:
        if cand.lower() in lower:
            chosen = lower[cand.lower()]
            if accept is not None:
                ok, reason = accept(df[chosen])
                if not ok:
                    log.warning("%s candidate %r rejected: %s", what, chosen, reason)
                    rejected.append(f"{chosen} ({reason})")
                    continue
                log.info("%s column resolved to %r — %s", what, chosen, reason)
            else:
                log.info("%s column resolved to %r", what, chosen)
            return chosen

    if rejected:
        raise ValueError(
            f"Every {what} candidate present in the SEDA file was rejected by the "
            f"content check: {rejected}. Columns: {list(df.columns)}"
        )

    # Nothing matched. Offer a fuzzy hint before giving up.
    hint = [c for c in df.columns if re.search(r"(mn|mean|cs|achiev|county|fips)", c, re.I)]
    raise ValueError(
        f"Could not find a {what} column in the SEDA file.\n"
        f"Tried: {candidates}\n"
        f"Plausible columns present: {hint}\n"
        f"All columns: {list(df.columns)}\n"
        f"Add the right name to the *_CANDIDATES list at the top of sources/seda.py."
    )


def _select_all_students_levels(df: pd.DataFrame) -> pd.DataFrame:
    """
    Keep only all-students LEVEL rows: subgroup == "all" and gap == 0, where
    those columns exist. Logs the reduction; raises if a filter empties the
    frame (the value vocabulary changed and we must not guess).
    """
    lower = {c.lower(): c for c in df.columns}

    for col_name, keep_value, what in (
        (SUBGROUP_COLUMN, SUBGROUP_ALL_VALUE, "all-students subgroup"),
        (GAP_COLUMN, GAP_LEVEL_VALUE, "level (non-gap)"),
    ):
        col = lower.get(col_name)
        if col is None:
            continue
        before = len(df)
        values = df[col].astype(str).str.strip().str.lower()
        df = df[values == keep_value]
        log.info("kept %s rows: %d -> %d (%s == %r)", what, before, len(df), col, keep_value)
        if df.empty:
            raise ValueError(
                f"Filtering {col} == {keep_value!r} left no rows. Values present: "
                f"{sorted(values.unique())[:20]}. The SEDA vocabulary has changed; "
                f"fix {col_name.upper()}_* constants at the top of sources/seda.py."
            )
    return df


def fetch() -> pd.DataFrame:
    """Read the SEDA county file and reduce it to fips + school_achievement."""
    path = _find_seda_file()

    # dtype=str on read, then coerce numerics explicitly. Reading the county
    # id as anything but a string loses leading zeros (see util.normalize_fips).
    df = pd.read_csv(path, dtype=str, low_memory=False)
    log.info("SEDA raw: %d rows x %d cols", len(df), len(df.columns))

    fips_col = _pick_column(df, FIPS_COLUMN_CANDIDATES, "county id",
                            accept=_looks_like_county_fips)
    ach_col = _pick_column(df, ACHIEVEMENT_COLUMN_CANDIDATES, "achievement")

    df = _select_all_students_levels(df)

    # Some SEDA files are long (one row per grade/year/subject/subgroup)
    # rather than pooled. If we detect such columns with multiple values
    # AFTER the filters above, average across them and say so loudly — a
    # silent mean over the wrong axis would be a subtle, serious error.
    long_axes = [c for c in df.columns
                 if c.lower() in {"grade", "year", "subject", SUBGROUP_COLUMN}]
    multi = [c for c in long_axes if df[c].nunique(dropna=True) > 1]

    df = add_fips_column(df, combined_col=fips_col)
    df["_ach"] = pd.to_numeric(df[ach_col], errors="coerce")
    df = df.dropna(subset=["fips"])

    if multi:
        log.warning(
            "This looks like a LONG SEDA file (varying %s). Averaging across "
            "those axes to get one value per county. If you wanted a specific "
            "grade/subject, download the POOLED file instead.",
            multi,
        )
        out = (
            df.groupby("fips", as_index=False)["_ach"]
            .mean()
            .rename(columns={"_ach": "school_achievement"})
        )
    else:
        out = df[["fips", "_ach"]].rename(columns={"_ach": "school_achievement"})
        # Even a pooled file can have stray duplicate county rows.
        if out["fips"].duplicated().any():
            n = int(out["fips"].duplicated().sum())
            log.warning("%d duplicate county rows in pooled file; averaging", n)
            out = out.groupby("fips", as_index=False)["school_achievement"].mean()

    out = out.sort_values("fips").reset_index(drop=True)

    # Sanity: SEDA CS values should cluster near zero with a spread of ~1.
    # If we see values in the hundreds we grabbed a raw test score column.
    finite = out["school_achievement"].dropna()
    if not finite.empty:
        if finite.abs().median() > 5:
            log.warning(
                "Median |school_achievement| is %.2f, which is far from the "
                "expected ~0.5 for a cohort-standardized scale. You may have "
                "picked a raw score column rather than the CS column. "
                "Check the resolved column name above.",
                finite.abs().median(),
            )
        log.info("achievement range: %.2f to %.2f (median %.2f)",
                 finite.min(), finite.max(), finite.median())

    log.info("SEDA: %d counties", len(out))
    return out


def main() -> None:
    df = fetch()
    write_interim(df, "seda")
    print(describe_frame(df, "seda"))
    print("\nTop 10 counties by achievement:")
    print(df.nlargest(10, "school_achievement").to_string(index=False))
    print("\nBottom 5:")
    print(df.nsmallest(5, "school_achievement").to_string(index=False))


if __name__ == "__main__":
    main()
