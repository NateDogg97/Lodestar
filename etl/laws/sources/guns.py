"""
Permitless (constitutional) carry — two independent sources must agree.

    Giffords Law Center — "States That Do Not Require CCW Permit", each with a
        statute citation. A gun-safety advocacy group.
    Wikipedia — "Constitutional carry", the table of states where a permit is
        not required to carry concealed, each citing statute or news.

The two come from opposite sides of the issue, so agreement is strong
evidence for a yes/no fact. A state where they disagree is left blank with a
note rather than picking one. (USCCA, the previous source, blocks automated
requests and could not be re-verified.)
"""

from __future__ import annotations

import re
from datetime import date, datetime

from ..common import Fact, SourceError, SourceResult, STATES, clean, get, leading_state, state_code
from . import wikipedia

GIFFORDS_URL = "https://giffords.org/lawcenter/gun-laws/policy-areas/guns-in-public/concealed-carry/"
WIKI_TITLE = "Constitutional_carry"


def giffords_states(page: str) -> tuple[dict[str, str], date]:
    """State -> list item text, and the page's modified date."""
    i = page.find("States That Do Not Require CCW Permit")
    if i < 0:
        raise SourceError("Giffords page no longer has the 'States That Do Not Require CCW Permit' list")
    j = page.find("</ul>", i)
    items = re.findall(r"<li[^>]*>(.*?)</li>", page[i:j], re.S)
    out = {}
    for item in items:
        text = clean(re.sub(r"<sup.*?</sup>", "", item, flags=re.S))
        code = leading_state(text)
        if code:
            out[code] = text
    m = re.search(r'"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})', page)
    if not m:
        raise SourceError("Giffords page has no dateModified")
    return out, datetime.strptime(m.group(1), "%Y-%m-%d").date()


def wikipedia_states(html: str) -> dict[str, list[str]]:
    table = wikipedia.table_with_header(html, "State", "Open", "Concealed")
    return {code: row for row in table[1:] if (code := state_code(row[0]))}


def combine(giffords: dict[str, str], gdate: date, wiki: dict[str, list[str]],
            wdate: date, revid: int) -> SourceResult:
    if len(giffords) < 20 or len(wiki) < 20:
        raise SourceError(f"implausibly short lists: Giffords {len(giffords)}, Wikipedia {len(wiki)}")
    wiki_url = wikipedia.revision_url(WIKI_TITLE, revid)
    res = SourceResult("permitless_carry")
    for code in sorted(STATES):
        g, w = code in giffords, code in wiki
        if g != w:
            res.notes.append(f"{code}: Giffords says {'no permit' if g else 'permit'} required, "
                             f"Wikipedia says {'no permit' if w else 'permit'} — left blank")
            continue
        quote = (f"Giffords, 'States That Do Not Require CCW Permit': {giffords[code]}" if g
                 else f"{code} is not in Giffords' list of states that do not require a CCW permit")
        res.facts[code] = Fact(
            value="true" if g else "false", source_name="Giffords Law Center",
            source_url=GIFFORDS_URL, source_date=gdate, quote=quote, confidence="high",
            notes=(f"Confirmed by Wikipedia's constitutional carry table (revision of "
                   f"{wdate:%b %-d, %Y}: {wiki_url}).")
                  + (f" Minimum age per Wikipedia: open carry {wiki[code][1]}, concealed "
                     f"{wiki[code][2]}." if w and len(wiki[code]) > 2 else ""),
        )
    return res


def permitless_carry(today: date) -> SourceResult:
    giffords, gdate = giffords_states(get(GIFFORDS_URL))
    html, revid, wdate = wikipedia.page(WIKI_TITLE)
    return combine(giffords, gdate, wikipedia_states(html), wdate, revid)
