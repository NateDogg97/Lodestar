"""
Re-fetch every law from its cited source, and rewrite the table from what the
sources say.

    python -m etl.laws.refresh                   # fetch, merge, write CSV + app JSON
    python -m etl.laws.refresh --dry-run         # fetch and report, write nothing
    python -m etl.laws.refresh --only minimum_wage,sales_tax_combined
    python -m etl.laws.refresh --report out.md   # also write the change report

HOW A VALUE GETS INTO THE TABLE (LAWS.md §8)
    Only by being parsed out of a source this script fetched, with the source's
    name, URL, its own "as of" date, and the row or sentence it came from.
    Never typed in, never from model knowledge. If a source can't be fetched
    or no longer parses, that law's rows are left exactly as they were — with
    their old `as_of`, so they age visibly — and the run reports the failure.
    Where two sources are required to agree and don't, the value is blanked.

Run monthly by .github/workflows/laws-refresh.yml. Each run re-verifies every
value, so `as_of` is "the date this value was last checked against its source".

Exit codes: 0 all sources refreshed; 2 one or more sources failed (successful
ones are still written); 1 the table failed verification afterwards.
"""

from __future__ import annotations

import argparse
import csv
import sys
import traceback
from dataclasses import dataclass, field
from datetime import date
from typing import Callable

from . import publish, verify_laws
from .common import Fact, SourceError, SourceResult, STATES
from .sources import eia, guns, kff, ncsl, taxfoundation

REVIEWED_BY = "etl.laws.refresh (automated)"

COLUMNS = [
    "law_key", "jurisdiction_level", "jurisdiction_code", "value", "value_numeric",
    "status", "effective_date", "as_of", "source_name", "source_url", "source_date",
    "data_url", "source_quote", "source_hash", "confidence", "reviewed_by", "notes",
]

# Each fetcher returns one SourceResult, or a tuple of them.
FETCHERS: dict[str, Callable[[date], SourceResult | tuple[SourceResult, ...]]] = {
    "taxfoundation.income_tax": taxfoundation.income_tax,
    "taxfoundation.sales_tax": taxfoundation.sales_tax,
    "taxfoundation.groceries": taxfoundation.groceries,
    "ncsl.minimum_wage": ncsl.minimum_wage,
    "ncsl.marijuana": ncsl.marijuana,
    "kff.abortion": kff.abortion,
    "guns.permitless_carry": guns.permitless_carry,
    "eia.electricity": eia.electricity,
}
# Which law keys each fetcher produces, for --only and for failure reporting.
PRODUCES = {
    "taxfoundation.income_tax": ("income_tax_top_rate", "income_tax_structure"),
    "taxfoundation.sales_tax": ("sales_tax_combined",),
    "taxfoundation.groceries": ("grocery_tax_exempt",),
    "ncsl.minimum_wage": ("minimum_wage",),
    "ncsl.marijuana": ("marijuana_status",),
    "kff.abortion": ("abortion_access",),
    "guns.permitless_carry": ("permitless_carry",),
    "eia.electricity": ("electricity_price_cents_kwh",),
}


@dataclass
class Report:
    today: date
    refreshed: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)       # fetcher -> error
    changes: list[tuple[str, str, str, str]] = field(default_factory=list)  # law, state, old, new
    blanked: list[tuple[str, str, str]] = field(default_factory=list)       # law, state, why
    notes: list[str] = field(default_factory=list)

    def markdown(self) -> str:
        out = [f"## Law table refresh — {self.today}", ""]
        out.append(f"**Refreshed:** {', '.join(self.refreshed) or 'nothing'}")
        if self.failed:
            out += ["", "**Failed — these laws keep their previous values and dates:**"]
            out += [f"- `{k}`: {v}" for k, v in self.failed.items()]
        out += ["", f"**{len(self.changes)} value change(s)**", ""]
        if self.changes:
            out += ["| law | state | was | now |", "|---|---|---|---|"]
            out += [f"| {law} | {st} | {old or '—'} | {new or '—'} |" for law, st, old, new in self.changes]
        if self.blanked:
            out += ["", "**Left blank:**"]
            out += [f"- {law}/{st}: {why}" for law, st, why in self.blanked]
        if self.notes:
            out += ["", "**Notes:**"] + [f"- {n}" for n in self.notes]
        return "\n".join(out)


def load_values() -> list[dict]:
    with verify_laws.VALUES.open(encoding="utf-8") as f:
        return [{c: r.get(c, "") or "" for c in COLUMNS} for r in csv.DictReader(f)]


def write_values(rows: list[dict]) -> None:
    rows = sorted(rows, key=lambda r: (r["law_key"], r["jurisdiction_level"], r["jurisdiction_code"]))
    with verify_laws.VALUES.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def fact_row(law_key: str, code: str, fact: Fact, today: date) -> dict:
    return {
        "law_key": law_key, "jurisdiction_level": "state", "jurisdiction_code": code,
        "value": fact.value,
        "value_numeric": "" if fact.value_numeric is None else f"{fact.value_numeric:g}",
        "status": fact.status, "effective_date": "", "as_of": today.isoformat(),
        "source_name": fact.source_name, "source_url": fact.source_url,
        "source_date": fact.source_date.isoformat(), "data_url": fact.data_url,
        "source_quote": fact.quote, "source_hash": "", "confidence": fact.confidence,
        "reviewed_by": REVIEWED_BY, "notes": fact.notes,
    }


def blank_row(law_key: str, code: str, why: str, today: date) -> dict:
    """No value this run, and why. `as_of` records when that was decided."""
    row = {c: "" for c in COLUMNS}
    row.update(law_key=law_key, jurisdiction_level="state", jurisdiction_code=code,
               status="unknown", confidence="unverified", reviewed_by=REVIEWED_BY, notes=why,
               as_of=today.isoformat())
    return row


def same_value(a: str, b: str) -> bool:
    """'5.00' and '5' are the same value; only real changes go in the report."""
    try:
        return float(a) == float(b)
    except ValueError:
        return a == b


def merge(rows: list[dict], result: SourceResult, today: date, report: Report) -> list[dict]:
    """Replace one law's state rows with what the source said this run."""
    old = {r["jurisdiction_code"]: r for r in rows
           if r["law_key"] == result.law_key and r["jurisdiction_level"] == "state"}
    kept = [r for r in rows if not (r["law_key"] == result.law_key and r["jurisdiction_level"] == "state")]
    # Drop a '*' placeholder row once real per-state values exist.
    kept = [r for r in kept if not (r["law_key"] == result.law_key and r["jurisdiction_code"] == "*")]
    disagreements = {n.split(":", 1)[0]: n for n in result.notes if ":" in n and n[:2] in STATES}
    for code in sorted(STATES):
        before = old.get(code, {}).get("value", "")
        if code in result.facts:
            new = fact_row(result.law_key, code, result.facts[code], today)
        else:
            why = disagreements.get(code, "Not found in the source this run.")
            new = blank_row(result.law_key, code, why, today)
            report.blanked.append((result.law_key, code, why))
        if not same_value(before, new["value"]):
            report.changes.append((result.law_key, code, before, new["value"]))
        kept.append(new)
    report.notes += [f"{result.law_key}: {n}" for n in result.notes if n[:2] not in STATES]
    return kept


def run(today: date, only: set[str] | None = None) -> tuple[list[dict], Report]:
    rows = load_values()
    report = Report(today)
    for name, fetch in FETCHERS.items():
        if only and not (only & set(PRODUCES[name])):
            continue
        try:
            got = fetch(today)
        except SourceError as exc:
            report.failed[name] = str(exc)
            continue
        except Exception as exc:  # noqa: BLE001 — a parser bug must not kill the other sources
            report.failed[name] = f"{type(exc).__name__}: {exc}"
            traceback.print_exc(file=sys.stderr)
            continue
        for result in got if isinstance(got, tuple) else (got,):
            if only and result.law_key not in only:
                continue
            rows = merge(rows, result, today, report)
            report.refreshed.append(result.law_key)
    return rows, report


def main() -> int:
    ap = argparse.ArgumentParser(description="Refresh the law table from its sources")
    ap.add_argument("--dry-run", action="store_true", help="fetch and report; write nothing")
    ap.add_argument("--only", type=str, default=None, help="comma-separated law keys")
    ap.add_argument("--report", type=str, default=None, help="also write the markdown report here")
    args = ap.parse_args()

    today = date.today()
    only = set(args.only.split(",")) if args.only else None
    rows, report = run(today, only)
    text = report.markdown()
    print(text)
    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    if args.dry_run:
        return 2 if report.failed else 0

    write_values(rows)
    findings, values = verify_laws.run(today=today)
    blocking = [f for f in findings if f.severity == "BLOCK"]
    if blocking:
        print("\nVERIFICATION FAILED after refresh — not publishing:", file=sys.stderr)
        for f in blocking[:20]:
            print(f"  {f}", file=sys.stderr)
        return 1
    path = publish.publish(today)
    print(f"\nPublished {path}")
    return 2 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
