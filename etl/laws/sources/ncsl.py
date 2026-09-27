"""
NCSL (National Conference of State Legislatures) — minimum wage and marijuana.

NCSL is the nonpartisan organization of the state legislatures themselves.
Both pages are server-rendered HTML tables with an "Updated <date>" line.
The US Department of Labor's minimum wage page would be the more official
source, but it blocks automated requests (HTTP 403), so it cannot be
re-verified monthly; NCSL can.

Both are cross-checked against Wikipedia (see cross_check / cannabis_cross_check).
Minimum wage is cross-checked against Wikipedia's state table, because NCSL
has been seen to lag (2026-09: Rhode Island listed at $15.00 though the state
raised it to $16.00 on Jan 1, 2026). Agree -> high confidence; Wikipedia
silent on a state -> NCSL alone, medium; disagree -> blank, with both figures
in the note.

    minimum_wage      https://www.ncsl.org/labor-and-employment/state-minimum-wages
    marijuana_status  https://www.ncsl.org/health/state-medical-cannabis-laws
"""

from __future__ import annotations

import re
from datetime import date

from ..common import Fact, SourceError, SourceResult, STATES, clean, get, html_tables, leading_state, parse_long_date, state_code
from . import wikipedia

NAME = "NCSL"
MIN_WAGE_URL = "https://www.ncsl.org/labor-and-employment/state-minimum-wages"
CANNABIS_URL = "https://www.ncsl.org/health/state-medical-cannabis-laws"
FEDERAL_MINIMUM = 7.25


def _updated(page: str) -> date:
    m = re.search(r"Updated\s+([A-Z][a-z]+ \d{1,2}, 20\d\d)", clean(page))
    d = parse_long_date(m.group(1)) if m else None
    if d is None:
        raise SourceError("page has no 'Updated <date>' line — layout changed?")
    return d


def _table_with(tables: list[list[list[str]]], *headers: str) -> list[list[str]]:
    for t in tables:
        if t and all(any(h.lower() in c.lower() for c in t[0]) for h in headers):
            return t
    raise SourceError(f"no table with columns {headers}")


# ---------------------------------------------------------------------------
# Minimum wage
# ---------------------------------------------------------------------------


def parse_wage(text: str) -> list[float]:
    """'$16.00/17.00' -> [16.0, 17.0]; '$7.25' -> [7.25]; 'Varies' -> []."""
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text.replace(",", ""))]


def scheduled(future: str, current: float, updated: date, today: date) -> tuple[float | None, str | None, list[str]]:
    """Read NCSL's "Future Enacted Increases" cell.

    Returns (amount that has since taken effect, its label, increases still
    ahead). An increase dated after the page was last updated but on or before
    today has taken effect since NCSL wrote the page, so it becomes the value —
    e.g. Florida's "$15 eff. 9-30-26" from October 2026 on. Dates before the
    page's update are history (Michigan lists past steps) and are ignored; an
    undated figure is kept only if it is above the current rate (DC lists an
    old, lower one).
    """
    took_effect: tuple[date, float] | None = None
    ahead = []
    for m in re.finditer(r"\$(\d+(?:\.\d+)?)(?:\s*eff\.?\s*(\d{1,2})-(\d{1,2})-(\d{2,4}))?", future):
        amount = float(m.group(1))
        if m.group(2):
            y = int(m.group(4))
            when = date(y + 2000 if y < 100 else y, int(m.group(2)), int(m.group(3)))
            if when > today:
                ahead.append(f"${amount:.2f} on {when:%b %-d, %Y}")
            elif when > updated and (took_effect is None or when > took_effect[0]):
                took_effect = (when, amount)
        elif amount > current:
            ahead.append(f"${amount:.2f} (date not given)")
    if took_effect:
        return took_effect[1], f"${took_effect[1]:.2f} from {took_effect[0]:%b %-d, %Y}", ahead
    return None, None, ahead


_ABBREV = {"jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov",
           "dec", "eff", "no", "st", "u.s", "d.c"}


def _first_sentence(text: str) -> str:
    """First sentence, not fooled by 'Sept. 30' or 'eff. 1-1-26'."""
    parts = re.split(r"(?<=[.)])\s+", text.strip())
    out = ""
    for part in parts:
        out = f"{out} {part}".strip()
        last = re.findall(r"([A-Za-z.]+)\.$", part)
        if not (last and last[-1].lower() in _ABBREV):
            break
    return out[:240]


def minimum_wage_from_page(page: str, today: date) -> SourceResult:
    updated = _updated(page)
    table = _table_with(html_tables(page), "State", "Minimum Wage")
    res = SourceResult("minimum_wage")
    for row in table[1:]:
        code = state_code(row[0]) if row else None
        if not code or code in res.facts:
            continue
        rates = parse_wage(row[1] if len(row) > 1 else "")
        if not rates:
            raise SourceError(f"{row[0]}: no wage in {row[1:2]}")
        # Where a state lists regional rates (New York), the statewide floor is
        # the lowest of them. The effective floor is never below the federal
        # minimum, which FLSA-covered employers must pay (rubric).
        statutory = min(rates)
        effective = max(statutory, FEDERAL_MINIMUM)
        future = row[2] if len(row) > 2 else ""
        extra = row[3] if len(row) > 3 else ""
        notes = []
        newer, newer_label, ahead = scheduled(future, effective, updated, today)
        if newer is not None and newer > effective:
            notes.append(f"NCSL lists {row[1]} as current and a scheduled increase to "
                         f"{newer_label}, which has since taken effect.")
            effective = newer
        if statutory < FEDERAL_MINIMUM:
            notes.append(f"State rate ${statutory:.2f}; the federal ${FEDERAL_MINIMUM:.2f} applies to most jobs.")
        if len(rates) > 1:
            notes.append(f"Varies by region (${min(rates):.2f}–${max(rates):.2f}).")
        if ahead:
            notes.append("Scheduled: " + "; ".join(ahead) + ".")
        if extra:
            notes.append(_first_sentence(extra))
        quote = (f"NCSL State Minimum Wages (updated {updated:%B %-d, %Y}): {row[0]} | {row[1]}"
                 + (f" | future: {future}" if future else "") + (f" | {extra[:200]}" if extra else ""))
        res.facts[code] = Fact(value=f"{effective:.2f}", value_numeric=effective, source_name=NAME,
                               source_url=MIN_WAGE_URL, source_date=updated, quote=quote,
                               notes=" ".join(notes))
    if set(res.facts) != STATES:
        raise SourceError(f"minimum wage table: expected 51 jurisdictions, got {len(res.facts)} "
                          f"(missing {sorted(STATES - set(res.facts))})")
    return res


WIKI_TITLE = "Minimum_wage_in_the_United_States"


def wikipedia_wages(html: str) -> dict[str, float]:
    """State -> the standard (first-listed) rate in Wikipedia's state table.

    'None' / no state law -> the federal minimum, matching the rubric.
    """
    table = wikipedia.table_with_header(html, "State", "Min. wage")
    out = {}
    for row in table[1:]:
        code = state_code(row[0]) if row else None
        if not code:
            continue
        text = re.sub(r"\[.*?\]", "", row[1] if len(row) > 1 else "")
        nums = [float(x) for x in re.findall(r"\d+\.\d+", text)]
        out[code] = max(nums[0], FEDERAL_MINIMUM) if nums else FEDERAL_MINIMUM
    if len(out) < 45:
        raise SourceError(f"Wikipedia minimum wage table has only {len(out)} states")
    return out


def cross_check(res: SourceResult, wiki: dict[str, float], wiki_url: str, wiki_date: date) -> SourceResult:
    for code in sorted(res.facts):
        fact = res.facts[code]
        if code not in wiki:
            fact.notes = (fact.notes + " " if fact.notes else "") + "Not in Wikipedia's state table; NCSL only."
            continue
        if abs(wiki[code] - float(fact.value)) > 0.005:
            res.notes.append(f"{code}: NCSL lists ${float(fact.value):.2f}, Wikipedia "
                             f"(revision of {wiki_date:%b %-d, %Y}) lists ${wiki[code]:.2f} — sources "
                             f"disagree, left blank. {wiki_url}")
            del res.facts[code]
            continue
        fact.confidence = "high"
        fact.notes = (fact.notes + " " if fact.notes else "") + (
            f"Confirmed by Wikipedia (revision of {wiki_date:%b %-d, %Y}).")
    return res


def minimum_wage(today: date) -> SourceResult:
    res = minimum_wage_from_page(get(MIN_WAGE_URL), today)
    html, revid, rev_date = wikipedia.page(WIKI_TITLE)
    return cross_check(res, wikipedia_wages(html), wikipedia.revision_url(WIKI_TITLE, revid), rev_date)


# ---------------------------------------------------------------------------
# Marijuana
# ---------------------------------------------------------------------------


def marijuana_from_page(page: str) -> SourceResult:
    """recreational | medical | cbd_only | illegal, per the rubric.

    - In the comprehensive medical program table with adult use allowed ->
      recreational; without -> medical.
    - Only in the low-THC / CBD program table -> cbd_only.
    - In neither -> illegal (NCSL lists every state with a program).
    """
    updated = _updated(page)
    tables = html_tables(page)
    medical = _table_with(tables, "State", "Non-Medical")
    low_thc = _table_with(tables, "State", "Products Allowed")
    res = SourceResult("marijuana_status")

    for row in medical[1:]:
        code = leading_state(row[0]) if row else None
        if code not in STATES or code in res.facts:
            continue
        adult = (row[2] if len(row) > 2 else "").strip()
        # NCSL writes "Yes. <measure>", a bare measure name (Vermont,
        # Washington), "No.", or leaves it blank.
        is_adult = bool(adult) and not re.match(r"no\b", adult, re.I)
        value = "recreational" if is_adult else "medical"
        res.facts[code] = Fact(
            value=value, source_name=NAME, source_url=CANNABIS_URL, source_date=updated,
            quote=f"{clean(row[0])[:60]} | {row[1][:120]} | adult use: {adult[:120] or '(blank)'}",
            notes=(f"Adult use: {adult[:160]}" if is_adult else f"Medical program: {row[1][:160]}"),
        )
    for row in low_thc[1:]:
        code = leading_state(row[0]) if row else None
        if code not in STATES or code in res.facts:
            continue
        res.facts[code] = Fact(
            value="cbd_only", source_name=NAME, source_url=CANNABIS_URL, source_date=updated,
            quote=f"{clean(row[0])[:60]} | {row[1][:120]} | {row[2][:160] if len(row) > 2 else ''}",
            notes=f"Low-THC/CBD program only: {row[2][:160] if len(row) > 2 else row[1][:160]}",
        )
    for code in STATES - set(res.facts):
        res.facts[code] = Fact(
            value="illegal", source_name=NAME, source_url=CANNABIS_URL, source_date=updated,
            quote=f"{code} is not listed in NCSL's medical cannabis or low-THC/CBD program tables",
            notes="No medical or low-THC cannabis program listed by NCSL.",
        )
    # A layout change that empties the tables would otherwise turn every
    # state 'illegal'. The real split is roughly 24 / 15 / 8 / 4.
    counts = {v: sum(f.value == v for f in res.facts.values()) for v in ("recreational", "medical")}
    if counts["recreational"] < 10 or counts["medical"] < 5:
        raise SourceError(f"implausible marijuana split {counts} — table parsing likely broke")
    return res


CANNABIS_WIKI_TITLE = "Legality_of_cannabis_by_U.S._jurisdiction"


def wikipedia_cannabis(html: str) -> dict[str, str | None]:
    """State -> recreational | medical | cbd_only | illegal, or None where the
    cell is prose we can't classify confidently (then it neither confirms nor
    contradicts). Reads the Recreational and Medical columns."""
    out: dict[str, str | None] = {}
    for table in wikipedia.tables_with_header(html, "State", "", "Recreational", "Medical"):
        for row in table[1:]:
            code = state_code(row[0]) if row else None
            if not code or code in out or len(row) < 4:
                continue
            rec = re.sub(r"\[.*?\]", "", row[2]).strip().lower()
            med = re.sub(r"\[.*?\]", "", row[3]).strip().lower()
            if rec.startswith("legal"):
                out[code] = "recreational"
            elif re.match(r"(cbd|cannabis oil|low[- ]thc|hemp)", med):
                out[code] = "cbd_only"
            elif med.startswith(("legal", "yes")):
                out[code] = "medical"
            elif med.startswith(("illegal", "no")):
                out[code] = "illegal"
            else:
                out[code] = None
    if len(out) < 45:
        raise SourceError(f"Wikipedia cannabis table has only {len(out)} states")
    return out


def cannabis_cross_check(res: SourceResult, wiki: dict[str, str | None], wiki_url: str,
                         wiki_date: date) -> SourceResult:
    for code in sorted(res.facts):
        fact = res.facts[code]
        other = wiki.get(code)
        if other is None:
            fact.notes += " Wikipedia's entry doesn't state this clearly; NCSL only."
        elif other != fact.value:
            res.notes.append(f"{code}: NCSL says {fact.value}, Wikipedia (revision of "
                             f"{wiki_date:%b %-d, %Y}) says {other} — sources disagree, left blank. {wiki_url}")
            del res.facts[code]
        else:
            fact.confidence = "high"
            fact.notes += f" Confirmed by Wikipedia (revision of {wiki_date:%b %-d, %Y})."
    return res


def marijuana(today: date) -> SourceResult:
    res = marijuana_from_page(get(CANNABIS_URL))
    html, revid, rev_date = wikipedia.page(CANNABIS_WIKI_TITLE)
    return cannabis_cross_check(res, wikipedia_cannabis(html),
                                wikipedia.revision_url(CANNABIS_WIKI_TITLE, revid), rev_date)
