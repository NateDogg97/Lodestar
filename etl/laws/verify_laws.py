"""
Verification harness for the state/county law table.

    python -m etl.laws.verify_laws              # offline checks only
    python -m etl.laws.verify_laws --online     # also check link rot and quote presence
    python -m etl.laws.verify_laws --report md  # markdown report for a PR comment

    Reads etl/data/law_definitions.csv and etl/data/law_values.csv. Values are
    written by etl/laws/refresh.py, which re-fetches every source monthly; this
    harness checks what it wrote.

WHAT THIS IS FOR
    The law table holds a few hundred hand-maintained facts that change on
    legislative-session timescales. There is no single API. So instead of
    pretending the data is fresh, this harness makes staleness VISIBLE and
    catches the specific ways a fact goes quietly wrong.

    It never edits a value. It only reports. Values come only from
    refresh.py parsing a cited source — see "The automation line" in LAWS.md.

THE SEVEN CHECKS

  1. SCHEMA      Values conform to the allowed_values declared in the
                 definitions file. Catches typos and drifted vocabularies.

  2. COVERAGE    Every state-level law has all 51 jurisdictions. Catches a
                 half-finished research pass that looks complete.

  3. STALENESS   as_of is older than the law's refresh_cadence allows.
                 This is the check that does the most work — it is the
                 mechanism by which "we stopped maintaining this" becomes
                 visible instead of invisible.

  4. PROVENANCE  Anything with a value has a source name, URL and the
                 source's own date (BLOCK if missing), and a quote (WARN).
                 A fact with no citation cannot be re-verified by anyone,
                 including future you.

  5. LINK ROT    (online) The source_url still resolves. This is the single
                 most common silent failure — state sites reorganize
                 constantly and a 404 means the fact is now unfalsifiable.

  6. QUOTE DRIFT (online) The stored source_quote still appears verbatim on
                 the page. If the quote vanished, the page changed in a way
                 that may have changed the fact. This is cheap, needs no AI,
                 and catches most real changes.

  7. EDITION     For B1 (periodically published) sources, whether the cited
                 edition year is behind the current year — i.e. a newer table
                 probably exists. Also warns when the source's own date is
                 more than two years old.

EXIT CODES
    0  no blocking problems
    1  blocking problems found (schema, coverage, or expired review)
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from .common import STATES

HERE = Path(__file__).resolve().parent
# The law table lives with the ETL's other hand-maintained inputs.
DATA = HERE.parent / "data"
DEFINITIONS = DATA / "law_definitions.csv"
VALUES = DATA / "law_values.csv"


# How long a value may go unreviewed before it is considered stale, by the
# cadence declared on the law. Generous — these are "nobody has looked at this
# in a suspiciously long time" thresholds, not accuracy guarantees.
CADENCE_DAYS = {
    "monthly": 45,
    "quarterly": 120,
    "session": 210,   # most legislatures meet Jan-May; check after adjournment
    "annual": 400,
    "computed": 10_000,  # Tier A is refreshed by the ETL, not by review
}

# Past this, a value is not merely stale — it should not be shown as fact.
HARD_EXPIRY_DAYS = 730

# A source whose own date is older than this is probably no longer maintained.
SOURCE_MAX_AGE_DAYS = 730

VALID_STATUS = {"in_effect", "enjoined", "scheduled", "unknown", "computed"}
VALID_CONFIDENCE = {"high", "medium", "low", "unverified", "computed", "example"}


class Finding:
    __slots__ = ("severity", "check", "law_key", "jurisdiction", "message")

    def __init__(self, severity, check, law_key, jurisdiction, message):
        self.severity = severity      # BLOCK | WARN | INFO
        self.check = check
        self.law_key = law_key
        self.jurisdiction = jurisdiction
        self.message = message

    def __str__(self):
        loc = f"{self.law_key}/{self.jurisdiction}" if self.jurisdiction else self.law_key
        return f"[{self.severity}] {self.check}: {loc} — {self.message}"


def load(path: Path) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"missing {path}")
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def parse_date(text: str) -> date | None:
    text = (text or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# Offline checks
# ---------------------------------------------------------------------------


def check_schema(defs: dict[str, dict], values: list[dict]) -> list[Finding]:
    out: list[Finding] = []

    for row in values:
        key = row["law_key"]
        juris = row["jurisdiction_code"]
        definition = defs.get(key)

        if definition is None:
            out.append(Finding("BLOCK", "schema", key, juris,
                               "law_key is not declared in law_definitions.csv"))
            continue

        status = (row.get("status") or "").strip()
        if status and status not in VALID_STATUS:
            out.append(Finding("BLOCK", "schema", key, juris,
                               f"status {status!r} not in {sorted(VALID_STATUS)}"))

        conf = (row.get("confidence") or "").strip()
        if conf and conf not in VALID_CONFIDENCE:
            out.append(Finding("BLOCK", "schema", key, juris,
                               f"confidence {conf!r} not in {sorted(VALID_CONFIDENCE)}"))

        value = (row.get("value") or "").strip()
        if not value:
            continue  # unfilled rows are handled by the coverage check

        allowed = [v for v in (definition.get("allowed_values") or "").split("|") if v]
        vtype = definition["value_type"]

        if vtype in {"nominal", "ordinal", "boolean"} and allowed and value not in allowed:
            out.append(Finding("BLOCK", "schema", key, juris,
                               f"value {value!r} not in allowed set {allowed}"))

        if vtype == "numeric":
            raw = (row.get("value_numeric") or "").strip()
            if not raw:
                out.append(Finding("BLOCK", "schema", key, juris,
                                   "numeric law has no value_numeric"))
            else:
                try:
                    float(raw)
                except ValueError:
                    out.append(Finding("BLOCK", "schema", key, juris,
                                       f"value_numeric {raw!r} is not a number"))

        # An ordinal whose order is undeclared cannot be ranked by the
        # lower/average/higher preference control.
        if vtype == "ordinal" and not (definition.get("ordinal_low_to_high") or "").strip():
            out.append(Finding("BLOCK", "schema", key, "",
                               "ordinal law has no ordinal_low_to_high ordering declared"))

    return out


def check_coverage(defs: dict[str, dict], values: list[dict]) -> list[Finding]:
    out: list[Finding] = []
    seen: dict[str, set[str]] = defaultdict(set)
    filled: dict[str, int] = defaultdict(int)

    for row in values:
        seen[row["law_key"]].add(row["jurisdiction_code"])
        if (row.get("value") or "").strip():
            filled[row["law_key"]] += 1

    for key, definition in defs.items():
        if definition["verify_tier"].startswith("A"):
            continue  # computed by the ETL

        missing = STATES - seen.get(key, set())
        if missing:
            out.append(Finding("BLOCK", "coverage", key, "",
                               f"{len(missing)} jurisdictions absent: "
                               f"{sorted(missing)[:8]}{'...' if len(missing) > 8 else ''}"))

        n_filled = filled.get(key, 0)
        if n_filled == 0:
            out.append(Finding("WARN", "coverage", key, "",
                               "no values filled in yet"))
        elif n_filled < len(STATES):
            out.append(Finding("WARN", "coverage", key, "",
                               f"partially filled: {n_filled}/{len(STATES)}. The blank rows' "
                               f"notes say why (a source missing the state, or two sources "
                               f"disagreeing); the app shows those states as unknown."))

    return out


def check_staleness(defs: dict[str, dict], values: list[dict],
                    today: date) -> list[Finding]:
    out: list[Finding] = []

    for row in values:
        key = row["law_key"]
        juris = row["jurisdiction_code"]
        definition = defs.get(key)
        if definition is None or not (row.get("value") or "").strip():
            continue

        as_of = parse_date(row.get("as_of", ""))
        if as_of is None:
            out.append(Finding("BLOCK", "staleness", key, juris,
                               "has a value but no as_of date — cannot be aged"))
            continue

        age = (today - as_of).days
        cadence = definition.get("refresh_cadence", "annual")
        limit = CADENCE_DAYS.get(cadence, 400)

        if age > HARD_EXPIRY_DAYS:
            out.append(Finding("BLOCK", "staleness", key, juris,
                               f"unreviewed for {age} days (over the {HARD_EXPIRY_DAYS}-day "
                               f"hard expiry). Do not display as fact."))
        elif age > limit:
            out.append(Finding("WARN", "staleness", key, juris,
                               f"unreviewed for {age} days, past the {cadence} "
                               f"threshold of {limit}"))

        # A scheduled change whose effective date has arrived is now the
        # current law and the row needs promoting.
        if row.get("status") == "scheduled":
            eff = parse_date(row.get("effective_date", ""))
            if eff and eff <= today:
                out.append(Finding("BLOCK", "staleness", key, juris,
                                   f"status is 'scheduled' but effective_date {eff} has "
                                   f"passed — promote to in_effect or correct the value"))

    return out


def check_provenance(defs: dict[str, dict], values: list[dict]) -> list[Finding]:
    out: list[Finding] = []

    for row in values:
        key = row["law_key"]
        juris = row["jurisdiction_code"]
        definition = defs.get(key)
        if definition is None or not (row.get("value") or "").strip():
            continue

        url = (row.get("source_url") or "").strip()
        quote = (row.get("source_quote") or "").strip()

        # The app shows who said it and as of when; a value without both
        # cannot be displayed honestly.
        if not (row.get("source_name") or "").strip():
            out.append(Finding("BLOCK", "provenance", key, juris,
                               "has a value but no source_name"))
        if parse_date(row.get("source_date", "")) is None:
            out.append(Finding("BLOCK", "provenance", key, juris,
                               "has a value but no source_date (the source's own as-of date)"))

        if not url:
            out.append(Finding("BLOCK", "provenance", key, juris,
                               "has a value but no source_url"))
        elif not url.lower().startswith(("http://", "https://")):
            out.append(Finding("BLOCK", "provenance", key, juris,
                               f"source_url is not a URL: {url[:60]!r}"))

        # B1 = periodic publication (annual/midyear tables). A verbatim quote from a
        # rate table is a weak signal: the table is reissued each edition, so the real
        # check is check 7 (edition staleness), not quote drift. B2 = living statute
        # page, where the quote is the whole point.
        if not quote:
            out.append(Finding("WARN", "provenance", key, juris,
                               "no source_quote — the value cannot be traced to a specific "
                               "row or sentence of its source"))
        elif quote and len(quote) < 20:
            out.append(Finding("WARN", "provenance", key, juris,
                               f"source_quote is only {len(quote)} chars — too short to "
                               f"be a reliable drift signal"))

        if (row.get("status") == "enjoined"
                and "enjoin" not in (row.get("notes") or "").lower()
                and "court" not in (row.get("notes") or "").lower()):
            out.append(Finding("WARN", "provenance", key, juris,
                               "status is 'enjoined' but notes do not reference the court "
                               "action. Record which case and what it blocks."))

    return out


def check_edition(defs: dict[str, dict], values: list[dict],
                  today: date) -> list[Finding]:
    """
    Check 7 — edition staleness, for B1 (periodically published) sources.

    WHY THIS EXISTS
        Tax Foundation reissues its rate tables annually at a predictable URL
        (.../state-income-tax-rates-2026/ becomes -2027). DOL updates its
        minimum wage page each January and July. For these, a verbatim quote is
        a weak drift signal — the page is *supposed* to change wholesale.

        What actually goes wrong is that a newer edition exists and nobody
        noticed, so you are citing last year's table. That is detectable from
        the URL alone: if it carries a year behind the current one, there is
        probably a newer edition.

        Surfaced by the first real research pass, which produced 204 useless
        "no source_quote" warnings against annual tables.
    """
    out: list[Finding] = []
    flagged: set[tuple[str, str]] = set()

    for row in values:
        key = row["law_key"]
        src = parse_date(row.get("source_date", ""))
        if src and (today - src).days > SOURCE_MAX_AGE_DAYS and (key, "age") not in flagged:
            flagged.add((key, "age"))
            out.append(Finding("WARN", "edition", key, "",
                               f"the source itself is dated {src} — over two years old. "
                               f"Look for a newer source: {row.get('source_url', '')}"))

    for row in values:
        key = row["law_key"]
        definition = defs.get(key)
        if definition is None or not definition.get("verify_tier", "").startswith("B1"):
            continue
        if not (row.get("value") or "").strip():
            continue

        url = (row.get("source_url") or "").strip()
        years = [int(y) for y in re.findall(r"20\d{2}", url)]
        if not years:
            continue
        newest = max(years)
        if newest < today.year and (key, url) not in flagged:
            flagged.add((key, url))
            out.append(Finding("WARN", "edition", key, "",
                               f"source_url cites the {newest} edition but it is "
                               f"{today.year}. Check whether a newer edition has been "
                               f"published and re-read it: {url}"))

    return out


# ---------------------------------------------------------------------------
# Online checks
# ---------------------------------------------------------------------------


def normalize_text(text: str) -> str:
    """Collapse whitespace and strip tags so quote matching survives reformatting."""
    text = re.sub(r"<script.*?</script>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    text = text.replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", text).strip().lower()


def page_hash(text: str) -> str:
    return hashlib.sha256(normalize_text(text).encode()).hexdigest()[:16]


def check_online(defs: dict[str, dict], values: list[dict],
                 fetcher=None) -> list[Finding]:
    """
    Link rot and quote drift.

    `fetcher` is injected so this is testable without network: it takes a URL
    and returns (status_code, body_text).
    """
    if fetcher is None:
        import requests

        from .common import BROWSER_UA

        def fetcher(url):  # noqa: E306
            # Tax Foundation and KFF answer a bot user agent with 403, which
            # would report working sources as dead links.
            r = requests.get(url, timeout=30, headers={"User-Agent": BROWSER_UA})
            return r.status_code, r.text

    out: list[Finding] = []
    cache: dict[str, tuple[int, str]] = {}

    def fetch(url: str) -> tuple[int, str]:
        if url not in cache:
            try:
                cache[url] = fetcher(url)
            except Exception as exc:  # noqa: BLE001
                cache[url] = (0, f"__ERROR__ {exc}")
        return cache[url]

    for row in values:
        key = row["law_key"]
        juris = row["jurisdiction_code"]
        definition = defs.get(key)
        if definition is None or not (row.get("value") or "").strip():
            continue

        # Both the page we cite and the file we parsed must still resolve.
        broken = False
        for field in ("source_url", "data_url"):
            url = (row.get(field) or "").strip()
            if not url.lower().startswith(("http://", "https://")):
                continue
            status, body = fetch(url)
            if status == 0:
                out.append(Finding("WARN", "link_rot", key, juris,
                                   f"could not fetch {url} — {body[:80]}"))
                broken = True
            elif status >= 400:
                out.append(Finding("BLOCK", "link_rot", key, juris,
                                   f"{field} returns HTTP {status}. The fact is now "
                                   f"uncitable: {url}"))
                broken = True
        if broken:
            continue

        # Values written by refresh.py are re-derived from the source every
        # run, which is a stronger check than quote matching — and their
        # quotes are built from spreadsheet rows, so they never appear
        # verbatim on the cited page. Quote drift is for anything else.
        if (row.get("reviewed_by") or "").startswith("etl.laws.refresh"):
            continue

        url = (row.get("source_url") or "").strip()
        if not url.lower().startswith(("http://", "https://")):
            continue
        status, body = fetch(url)
        quote = (row.get("source_quote") or "").strip()
        if quote and normalize_text(quote) not in normalize_text(body):
            out.append(Finding("WARN", "quote_drift", key, juris,
                               "source_quote no longer appears on the page. The page "
                               "changed — re-read it and confirm the value still holds."))

        stored_hash = (row.get("source_hash") or "").strip()
        if stored_hash:
            current = page_hash(body)
            if current != stored_hash:
                out.append(Finding("INFO", "page_changed", key, juris,
                                   f"page content hash changed ({stored_hash} -> {current}). "
                                   f"Not necessarily a fact change."))

    return out


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def report_text(findings: list[Finding], values: list[dict], today: date) -> str:
    lines = ["=" * 76, "LAW TABLE VERIFICATION", f"run date: {today}", "=" * 76]

    by_sev = defaultdict(list)
    for f in findings:
        by_sev[f.severity].append(f)

    total = len(values)
    filled = sum(1 for r in values if (r.get("value") or "").strip())
    lines.append(f"\n{filled}/{total} rows have a value ({100*filled/max(total,1):.0f}%)")

    for severity in ("BLOCK", "WARN", "INFO"):
        group = by_sev.get(severity, [])
        if not group:
            continue
        lines.append(f"\n{severity} ({len(group)})")
        lines.append("-" * 76)
        by_check = defaultdict(list)
        for f in group:
            by_check[f.check].append(f)
        for check, items in sorted(by_check.items()):
            lines.append(f"  {check} ({len(items)})")
            for f in items[:12]:
                loc = f"{f.law_key}/{f.jurisdiction}" if f.jurisdiction else f.law_key
                lines.append(f"      {loc}: {f.message}")
            if len(items) > 12:
                lines.append(f"      ... and {len(items) - 12} more")

    lines.append("\n" + "=" * 76)
    lines.append("PASS" if not by_sev.get("BLOCK") else "FAIL — blocking problems above")
    return "\n".join(lines)


def report_markdown(findings: list[Finding], values: list[dict], today: date) -> str:
    by_sev = defaultdict(list)
    for f in findings:
        by_sev[f.severity].append(f)

    filled = sum(1 for r in values if (r.get("value") or "").strip())
    out = [f"## Law table verification — {today}", "",
           f"**{filled}/{len(values)}** rows have a value.", ""]

    if not by_sev.get("BLOCK"):
        out.append("No blocking problems.")
    else:
        out.append(f"**{len(by_sev['BLOCK'])} blocking problems.**")
    out.append("")
    out.append("| severity | check | law | jurisdiction | detail |")
    out.append("|---|---|---|---|---|")
    for severity in ("BLOCK", "WARN", "INFO"):
        for f in by_sev.get(severity, [])[:40]:
            msg = f.message.replace("|", "\\|")
            out.append(f"| {severity} | {f.check} | {f.law_key} | "
                       f"{f.jurisdiction or '—'} | {msg} |")
    return "\n".join(out)


def run(online: bool = False, today: date | None = None,
        fetcher=None) -> tuple[list[Finding], list[dict]]:
    today = today or date.today()
    defs = {r["law_key"]: r for r in load(DEFINITIONS)}
    values = load(VALUES)

    findings: list[Finding] = []
    findings += check_schema(defs, values)
    findings += check_coverage(defs, values)
    findings += check_staleness(defs, values, today)
    findings += check_provenance(defs, values)
    findings += check_edition(defs, values, today)
    if online:
        findings += check_online(defs, values, fetcher=fetcher)

    return findings, values


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the law table")
    parser.add_argument("--online", action="store_true",
                        help="Also check link rot and quote drift (makes network requests)")
    parser.add_argument("--report", choices=["text", "md"], default="text")
    args = parser.parse_args()

    today = date.today()
    findings, values = run(online=args.online, today=today)

    if args.report == "md":
        print(report_markdown(findings, values, today))
    else:
        print(report_text(findings, values, today))

    return 1 if any(f.severity == "BLOCK" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
