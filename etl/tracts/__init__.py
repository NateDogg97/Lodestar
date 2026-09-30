"""
Phase 8 — inside the county: census tract data (plan §9 Phase 8).

One county at a time. Each module fetches one source for a county's tracts
and returns a DataFrame keyed by `geoid` (the 11-character tract GEOID:
state + county + tract, always a string). `build.py` joins them.

    python -m etl.tracts.build --county 48453          # Travis County, TX
    python -m etl.tracts.build --pilot                 # the 8a pilot counties
"""
