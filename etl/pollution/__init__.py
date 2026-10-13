"""
Pollution (plan §9 Phase 11): exposure where people live, from blocks up.

    grid.py      a regular lat/lon grid (a NetCDF surface such as ACAG's PM2.5), sampled
                 at points: the cell containing each point, never interpolated (rule 1)
    blocks.py    every 2020 Census block with people: population and internal point
                 (PL 94-171 redistricting files)
    exposure.py  block values -> tract and county: population-weighted mean, share of
                 residents above a benchmark, coverage — one national table (rules 3, 6)

The rules these obey are in the plan, §9 Phase 11 "Rules".
"""
