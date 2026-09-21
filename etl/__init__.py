"""
Relocation Finder ETL — Phase 1.

Builds one CSV, one row per US county, joining Census ACS, BEA Regional Price
Parities, Stanford SEDA, and NOAA climate normals onto a Census Gazetteer
spine, keyed on county FIPS.

See README.md for the full description, and Working Master Plan.md at the repo root for the
project context this fits into.
"""

__version__ = "0.1.0"
