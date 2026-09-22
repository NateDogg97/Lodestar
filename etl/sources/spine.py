"""
SOURCE: Census Bureau Gazetteer — the county spine.

WHAT THIS PRODUCES
    One row per US county (and county-equivalent), with:
        fips          5-char string, the join key for the entire pipeline
        county_name   e.g. "Travis County"
        state         two-letter USPS abbreviation
        lat, lon      internal point, in decimal degrees
        land_sq_mi    land area, used later for density if we want it

WHY THE GAZETTEER AND NOT THE ACS API
    We need an authoritative list of counties to join everything else onto, and
    we need centroids for the NOAA station lookup. The Gazetteer gives both in
    a single keyless file download. Using it as the spine also means the county
    list is decided by one source rather than emerging from whichever API
    happened to respond, which makes "why is this county missing?" answerable.

WHY "INTERNAL POINT" RATHER THAN CENTROID
    Census publishes INTPTLAT/INTPTLONG, which is a point guaranteed to fall
    INSIDE the polygon. A true centroid can land outside for crescent-shaped or
    multi-part counties — think coastal counties wrapping a bay, or anything in
    the Alaskan archipelago. Since we use this point to find the nearest weather
    station, a point in the water would quietly pick the wrong station.

COVERAGE NOTES
    The national file includes all 50 states, DC, and Puerto Rico. PR is
    dropped by default (see DROP_TERRITORIES) because most of our other
    sources — notably BEA RPP and SEDA — do not cover it, so PR rows would be
    mostly-null noise. Flip the flag if that changes.

    Alaska is also dropped (see EXCLUDED_STATES): out of scope for this app
    by decision, 2026-09-22. That also retires the Alaska-specific data
    problems — remote census areas with no weather station, the 2019
    Valdez-Cordova split that SEDA has not caught up with, and the Aleutians
    crossing the antimeridian.

    Expect ~3,114 rows for the 49 remaining states + DC.

RUN STANDALONE
    python -m etl.sources.spine
"""

from __future__ import annotations

import io

import pandas as pd

from .. import config
from ..util import add_fips_column, describe_frame, get_logger, http_get_zip_member, write_interim

log = get_logger("source.spine")


# Territory state FIPS prefixes. 72 = Puerto Rico, 60 = American Samoa,
# 66 = Guam, 69 = Northern Mariana Islands, 78 = US Virgin Islands.
TERRITORY_PREFIXES = {"60", "66", "69", "72", "78"}
DROP_TERRITORIES = True

# States left out of the dataset entirely, by product decision rather than
# data availability. Dropping them at the spine removes them everywhere,
# because every other source is LEFT joined onto it.
#   02 = Alaska — not a place we are looking to move (decided 2026-09-22).
EXCLUDED_STATES = {"02"}


# The tell for mojibake: a UTF-8 multibyte sequence read as latin-1 turns
# "ñ" into "Ã±". No real US county name contains "Ã".
MOJIBAKE_MARKER = "\u00c3"


def decode_gazetteer(raw: bytes) -> tuple[str, str]:
    """
    Decode the Gazetteer bytes, trying UTF-8 first and falling back to
    latin-1. Census has shipped both across vintages.

    Reading a UTF-8 file as latin-1 does not error — it silently produces
    "DoÃ±a Ana County". So after decoding we assert the tell is absent.
    """
    try:
        text, encoding = raw.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        text, encoding = raw.decode("latin-1"), "latin-1"

    if MOJIBAKE_MARKER in text:
        sample = next((line for line in text.splitlines() if MOJIBAKE_MARKER in line), "")
        raise ValueError(
            f"Gazetteer decoded as {encoding} but contains mojibake ({MOJIBAKE_MARKER!r}). "
            f"Example line: {sample[:120]!r}. The file's encoding is not what we assumed."
        )
    return text, encoding


def fetch(year: int | None = None) -> pd.DataFrame:
    """Download and parse the national county Gazetteer file."""
    year = year or config.GAZETTEER_YEAR
    url = config.GAZETTEER_URL.format(year=year)

    log.info("fetching county gazetteer for %s", year)
    raw = http_get_zip_member(url, ".txt")

    # The Gazetteer file is tab-separated, but the header row has trailing
    # whitespace on some column names in some vintages. Strip everything.
    text, encoding = decode_gazetteer(raw)
    log.info("gazetteer decoded as %s", encoding)
    df = pd.read_csv(io.StringIO(text), sep="\t", dtype=str)
    df.columns = [c.strip() for c in df.columns]

    required = {"GEOID", "NAME", "USPS", "INTPTLAT", "INTPTLONG", "ALAND_SQMI"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(
            f"Gazetteer file is missing expected columns {missing}. "
            f"Got: {list(df.columns)}. The file format may have changed."
        )

    df = add_fips_column(df, combined_col="GEOID")

    out = pd.DataFrame({
        "fips": df["fips"],
        "county_name": df["NAME"].str.strip(),
        "state": df["USPS"].str.strip(),
        "lat": pd.to_numeric(df["INTPTLAT"], errors="coerce"),
        "lon": pd.to_numeric(df["INTPTLONG"], errors="coerce"),
        "land_sq_mi": pd.to_numeric(df["ALAND_SQMI"], errors="coerce"),
    })

    out = out.dropna(subset=["fips"])

    if DROP_TERRITORIES:
        before = len(out)
        out = out[~out["fips"].str[:2].isin(TERRITORY_PREFIXES)]
        dropped = before - len(out)
        if dropped:
            log.info("dropped %d territory rows (see DROP_TERRITORIES)", dropped)

    if EXCLUDED_STATES:
        before = len(out)
        out = out[~out["fips"].str[:2].isin(EXCLUDED_STATES)]
        log.info("dropped %d rows in excluded states %s (see EXCLUDED_STATES)",
                 before - len(out), sorted(EXCLUDED_STATES))

    # A county with no coordinates would silently get no climate data, so make
    # that loud rather than letting it slide.
    no_coords = out["lat"].isna() | out["lon"].isna()
    if no_coords.any():
        log.warning("%d counties have no centroid: %s",
                    int(no_coords.sum()), out.loc[no_coords, "fips"].tolist())

    out = out.sort_values("fips").reset_index(drop=True)

    # Belt and braces on the encoding: the tell must be absent from names too.
    bad_names = out[out["county_name"].str.contains(MOJIBAKE_MARKER, na=False)]
    if not bad_names.empty:
        raise ValueError(f"Mojibake in county names: {bad_names['county_name'].head(3).tolist()}")

    if out["fips"].duplicated().any():
        dupes = out.loc[out["fips"].duplicated(keep=False), "fips"].unique()
        raise ValueError(f"Duplicate FIPS in gazetteer: {dupes[:10]}")

    log.info("spine: %d counties across %d states",
             len(out), out["state"].nunique())
    return out


def main() -> None:
    df = fetch()
    write_interim(df, "spine")
    print(describe_frame(df, "spine"))
    print("\nSample rows:")
    print(df.head(5).to_string(index=False))
    print(f"\nStates present: {df['state'].nunique()} "
          f"(expect 50: 49 states + DC, Alaska excluded)")


if __name__ == "__main__":
    main()
