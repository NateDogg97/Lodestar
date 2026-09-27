"""
Shared plumbing for the law sources: HTTP, HTML tables, state names, and the
`Fact` every source returns.

Nothing here knows about any particular law. Each module in `sources/` turns
one publisher's page into Facts; `refresh.py` validates and merges them.
"""

from __future__ import annotations

import html
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from html.parser import HTMLParser

import requests

# Tax Foundation, KFF and NCSL reject the default python-requests agent and
# serve the page to a browser-like one.
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
TIMEOUT = 60
RETRIES = 3


class SourceError(RuntimeError):
    """A source could not be fetched or no longer has the expected shape.

    Raising this leaves that law's existing rows untouched (and un-refreshed,
    so they age visibly) rather than writing anything half-parsed.
    """


def get(url: str, *, params: dict | None = None, binary: bool = False) -> str | bytes:
    """GET with retries. Raises SourceError on a final failure or HTTP >= 400."""
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(url, params=params, timeout=TIMEOUT,
                             headers={"User-Agent": BROWSER_UA,
                                      "Accept-Language": "en-US,en;q=0.9"})
            if r.status_code >= 400:
                raise SourceError(f"HTTP {r.status_code} from {url}")
            return r.content if binary else r.text
        except (requests.RequestException, SourceError) as exc:
            last = exc
            if attempt < RETRIES - 1:
                time.sleep(2 * (attempt + 1))
    raise SourceError(f"could not fetch {url}: {last}")


# ---------------------------------------------------------------------------
# Facts
# ---------------------------------------------------------------------------


@dataclass
class Fact:
    """One value for one law in one jurisdiction, with where it came from."""

    value: str
    source_name: str
    source_url: str       # the page a person can open to check it
    source_date: date     # the publisher's own "as of" / "updated" date
    quote: str            # the source's own words or table row for this value
    value_numeric: float | None = None
    status: str = "in_effect"
    confidence: str = "medium"
    data_url: str = ""    # the file actually parsed, if different from source_url
    notes: str = ""


@dataclass
class SourceResult:
    law_key: str
    facts: dict[str, Fact] = field(default_factory=dict)   # postal code -> Fact
    notes: list[str] = field(default_factory=list)          # run notes for the report


# ---------------------------------------------------------------------------
# Text and dates
# ---------------------------------------------------------------------------


def clean(text: str) -> str:
    """Unescape, strip tags, and collapse whitespace."""
    text = re.sub(r"<br\s*/?>", " ", text or "", flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


_MONTHS = ("January February March April May June July August September "
           "October November December").split()


def parse_long_date(text: str) -> date | None:
    """First 'Month D, YYYY' (or 'Month DD, YYYY') in text."""
    m = re.search(r"(%s)\s+(\d{1,2}),\s+(20\d\d)" % "|".join(_MONTHS), text)
    if not m:
        return None
    return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y").date()


# ---------------------------------------------------------------------------
# HTML tables (stdlib only — no lxml/bs4 dependency for CI)
# ---------------------------------------------------------------------------


class _TableParser(HTMLParser):
    """Collects every <table> as rows of cell text.

    A table nested inside a cell is also collected on its own, and its text
    is appended to the enclosing cell — NCSL nests New York's regional wage
    table inside the New York row.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._stack: list[dict] = []   # open tables: {"rows", "row", "cell"}

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._stack.append({"rows": [], "row": None, "cell": None})
        elif not self._stack:
            return
        elif tag == "tr":
            self._stack[-1]["row"] = []
        elif tag in ("td", "th"):
            self._stack[-1]["cell"] = []
        elif tag == "br":
            self._text(" ")

    def handle_endtag(self, tag):
        if not self._stack:
            return
        t = self._stack[-1]
        if tag in ("td", "th") and t["cell"] is not None and t["row"] is not None:
            t["row"].append(re.sub(r"\s+", " ", "".join(t["cell"])).strip())
            t["cell"] = None
        elif tag == "tr" and t["row"] is not None:
            if t["cell"] is not None:  # unclosed cell
                t["row"].append(re.sub(r"\s+", " ", "".join(t["cell"])).strip())
                t["cell"] = None
            t["rows"].append(t["row"])
            t["row"] = None
        elif tag == "table":
            done = self._stack.pop()
            self.tables.append(done["rows"])
            if self._stack:
                flat = " ".join(" ".join(r) for r in done["rows"])
                self._text(" " + flat + " ")

    def handle_data(self, data):
        self._text(data)

    def _text(self, s: str) -> None:
        if self._stack and self._stack[-1]["cell"] is not None:
            self._stack[-1]["cell"].append(s.replace("\xa0", " "))


def html_tables(page: str) -> list[list[list[str]]]:
    """Every table on the page, outermost last, as rows of cell text."""
    p = _TableParser()
    p.feed(page)
    return p.tables


# ---------------------------------------------------------------------------
# States (50 + DC, the jurisdictions the county dataset covers)
# ---------------------------------------------------------------------------

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}
STATES = frozenset(STATE_NAMES)

# Tax Foundation's AP-style abbreviations.
_AP = {
    "Ala.": "AL", "Alaska": "AK", "Ariz.": "AZ", "Ark.": "AR", "Calif.": "CA",
    "Colo.": "CO", "Conn.": "CT", "Del.": "DE", "D.C.": "DC", "Fla.": "FL",
    "Ga.": "GA", "Hawaii": "HI", "Idaho": "ID", "Ill.": "IL", "Ind.": "IN",
    "Iowa": "IA", "Kans.": "KS", "Kan.": "KS", "Ky.": "KY", "La.": "LA",
    "Maine": "ME", "Md.": "MD", "Mass.": "MA", "Mich.": "MI", "Minn.": "MN",
    "Miss.": "MS", "Mo.": "MO", "Mont.": "MT", "Nebr.": "NE", "Neb.": "NE",
    "Nev.": "NV", "N.H.": "NH", "N.J.": "NJ", "N.M.": "NM", "N.Y.": "NY",
    "N.C.": "NC", "N.D.": "ND", "Ohio": "OH", "Okla.": "OK", "Ore.": "OR",
    "Oreg.": "OR", "Pa.": "PA", "R.I.": "RI", "S.C.": "SC", "S.D.": "SD",
    "Tenn.": "TN", "Tex.": "TX", "Utah": "UT", "Vt.": "VT", "Va.": "VA",
    "Wash.": "WA", "W.Va.": "WV", "W. Va.": "WV", "Wis.": "WI", "Wyo.": "WY",
}
_BY_NAME = {name.lower(): code for code, name in STATE_NAMES.items()}
_BY_NAME["washington, d.c."] = "DC"
_BY_NAME["washington dc"] = "DC"
_BY_NAME["d.c."] = "DC"
_BY_NAME["dc"] = "DC"


def state_code(label: str | None) -> str | None:
    """Postal code for a full name or AP abbreviation, ignoring footnote marks.

    'Calif. (a)' -> 'CA', 'Utah (a)' -> 'UT', 'Kansas*' -> 'KS',
    'Colorado Medical program info' -> None (must be the whole label).
    """
    if not label:
        return None
    s = re.sub(r"\(.*?\)|\[.*?\]", "", str(label))   # (a, b) and [115] footnotes
    s = re.sub(r"[*†‡\d]+$", "", s.strip())  # trailing marks / footnote numbers
    s = re.sub(r"\s+", " ", s).strip()
    if s in _AP:
        return _AP[s]
    return _BY_NAME.get(s.lower())


def leading_state(label: str | None) -> str | None:
    """Like state_code, but also accepts extra words after the name.

    'Colorado Medical program info -Non medical...' -> 'CO'. Longest name
    wins, so 'West Virginia' never matches as 'Virginia'.
    """
    exact = state_code(label)
    if exact or not label:
        return exact
    s = re.sub(r"\s+", " ", str(label)).strip().lower()
    for name in sorted(_BY_NAME, key=len, reverse=True):
        if s.startswith(name) and (len(s) == len(name) or not s[len(name)].isalpha()):
            return _BY_NAME[name]
    return None
