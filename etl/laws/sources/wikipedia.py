"""
Wikipedia, as a second source to cross-check a primary one.

Never the only source for a value: a Wikipedia table is used to confirm (or
contradict) what the primary source says. Each fetch pins the revision it
read, so the citation points at exactly the text that was compared.
"""

from __future__ import annotations

import json
from datetime import date, datetime

from ..common import SourceError, get, html_tables

API = "https://en.wikipedia.org/w/api.php"


def page(title: str) -> tuple[str, int, date]:
    """(rendered HTML, revision id, revision date) of the current revision."""
    parsed = json.loads(get(API, params={"action": "parse", "page": title, "prop": "text|revid",
                                         "format": "json", "formatversion": "2"}))
    if "parse" not in parsed:
        raise SourceError(f"Wikipedia page {title!r}: {parsed.get('error', {}).get('info', 'not found')}")
    revs = json.loads(get(API, params={"action": "query", "prop": "revisions", "titles": title,
                                       "rvprop": "timestamp|ids", "format": "json",
                                       "formatversion": "2"}))
    stamp = revs["query"]["pages"][0]["revisions"][0]["timestamp"]
    return (parsed["parse"]["text"], parsed["parse"]["revid"],
            datetime.strptime(stamp[:10], "%Y-%m-%d").date())


def revision_url(title: str, revid: int) -> str:
    return f"https://en.wikipedia.org/w/index.php?title={title}&oldid={revid}"


def table_with_header(html: str, *first_cells: str) -> list[list[str]]:
    """The first table whose header row starts with these cells (case-insensitive, prefix match)."""
    want = [c.lower() for c in first_cells]
    for table in html_tables(html):
        if table and len(table[0]) >= len(want) and all(
                cell.lower().startswith(w) for cell, w in zip(table[0], want)):
            return table
    raise SourceError(f"no Wikipedia table with header {first_cells}")


def tables_with_header(html: str, *first_cells: str) -> list[list[list[str]]]:
    """Every table whose header row starts with these cells (states and territories are often split)."""
    want = [c.lower() for c in first_cells]
    found = [t for t in html_tables(html) if t and len(t[0]) >= len(want) and all(
        cell.lower().startswith(w) for cell, w in zip(t[0], want))]
    if not found:
        raise SourceError(f"no Wikipedia table with header {first_cells}")
    return found
