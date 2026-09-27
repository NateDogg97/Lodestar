"""
KFF — abortion access.

Source: the "Status of Abortion Bans in the United States" map on KFF's
Abortion in the U.S. Dashboard, which KFF describes as "KFF analysis of state
policies and court decisions" — so it reflects injunctions and rulings, not
just statute text. The map is a Datawrapper chart; its dataset (State,
Status, Notes) is published as CSV beside it, and that is what we parse.

The chart's aria text is sometimes older than its data (seen 2026-09-27: text
"as of March 9", data and title "as of August 10"), so only the dataset and the
chart's source line are used.

Rubric mapping (law_definitions.csv):
    "Abortion banned"                            -> banned
    "Gestational limit between X and Y weeks"    -> restricted if Y <= 12, else limited
    "at or near viability" / "No gestational"    -> protected
Anything else raises SourceError rather than guessing.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date

from ..common import Fact, SourceError, SourceResult, STATES, clean, get, parse_long_date, state_code

NAME = "KFF"
PAGE_URL = "https://www.kff.org/womens-health-policy/abortion-in-the-u-s-dashboard/"
CHART_ID = "Q43DW"
CHART_URL = f"https://datawrapper.dwcdn.net/{CHART_ID}/"


def classify(status: str) -> str:
    s = status.lower()
    if "banned" in s:
        return "banned"
    if "viability" in s or "no gestational" in s:
        return "protected"
    m = re.search(r"between\s+(\d+)\s+and\s+(\d+)\s+weeks", s)
    if m:
        return "restricted" if int(m.group(2)) <= 12 else "limited"
    m = re.search(r"(\d+)\s+weeks", s)
    if m:
        return "restricted" if int(m.group(1)) <= 12 else "limited"
    raise SourceError(f"unrecognized KFF status {status!r}")


def parse_dataset(text: str, chart_page: str, data_url: str) -> SourceResult:
    m = re.search(r"as of ([A-Z][a-z]+ \d{1,2}, 20\d\d)", _source_line(chart_page))
    as_of = parse_long_date(m.group(1)) if m else None
    if as_of is None:
        raise SourceError("KFF chart has no 'as of <date>' source line")
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    if not reader.fieldnames or "State" not in reader.fieldnames:
        raise SourceError(f"KFF dataset columns changed: {reader.fieldnames}")
    status_col = next((c for c in reader.fieldnames if "status" in c.lower()), None)
    notes_col = next((c for c in reader.fieldnames if "note" in c.lower()), None)
    if status_col is None:
        raise SourceError(f"KFF dataset has no status column: {reader.fieldnames}")

    res = SourceResult("abortion_access")
    for row in reader:
        code = state_code(row["State"])
        if code not in STATES:
            continue
        status = clean(row[status_col])
        notes = clean(row.get(notes_col) or "") if notes_col else ""
        res.facts[code] = Fact(
            value=classify(status), source_name=NAME, source_url=PAGE_URL, data_url=data_url,
            source_date=as_of, quote=f"{row['State']}: {status}",
            notes=f"{status}. {notes}"[:900],
        )
    if set(res.facts) != STATES:
        raise SourceError(f"KFF dataset: expected 51 jurisdictions, got {len(res.facts)} "
                          f"(missing {sorted(STATES - set(res.facts))})")
    return res


def _source_line(chart_page: str) -> str:
    m = re.search(r'"source-name"\s*:\s*"([^"]*)"', chart_page)
    if m:
        return m.group(1)
    m = re.search(r'class="source"[^>]*>(.*?)</span>', chart_page, re.S)
    return clean(m.group(1)) if m else clean(chart_page)[:2000]


def abortion(today: date) -> SourceResult:
    # The chart's base URL points at its latest published version.
    landing = get(CHART_URL)
    versions = [int(v) for v in re.findall(rf"{CHART_ID}/(\d+)/", landing)]
    if not versions:
        raise SourceError("could not find the KFF chart's current version")
    base = f"{CHART_URL}{max(versions)}/"
    chart_page = get(base)
    data_url = f"{base}dataset.csv"
    return parse_dataset(get(data_url), chart_page, data_url)
