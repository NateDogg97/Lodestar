"""
Write public/data/laws.json — the law table in the shape the app reads.

    python -m etl.laws.publish

Only values that can be shown honestly go out: a value must have a source
URL, a source date and an `as_of` (when we last checked it against the
source), and must not be past the hard expiry (LAWS.md §10). Laws with no
values at all (the Tier C judgment calls, not yet sourced) are left out.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

from . import verify_laws

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "data" / "laws.json"
COUNTIES = ROOT / "public" / "data" / "counties.json"
FORMAT = "laws-v1"

DISCLAIMER = (
    "Laws and taxes are compiled automatically from the public sources linked on each item and "
    "re-checked against them about monthly. Each shows the source's own date and when we last "
    "checked it. Laws change often; verify anything you would act on with the linked source or "
    "a professional."
)


def _acs_vintage() -> int | None:
    """ACS 5-year end year of the published county data (committed, so CI has it)."""
    try:
        d = json.loads(COUNTIES.read_text(encoding="utf-8"))
        i = d["columns"].index("acs_vintage")
        return int(d["rows"][0][i])
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return None


def county_sources() -> dict:
    """Citations for law-table entries that live in the county dataset (Tier A, per county)."""
    year = _acs_vintage()
    if year is None:
        return {}
    return {
        "property_tax_effective_rate": {
            "name": "Property tax (effective rate)",
            "sourceName": f"U.S. Census Bureau, American Community Survey {year - 4}–{year} 5-year estimates",
            "sourceUrl": f"https://api.census.gov/data/{year}/acs/acs5",
            "sourceDate": f"{year}-12-31",
            "method": "Aggregate real estate taxes paid ÷ aggregate home value, owner-occupied homes "
                      "(tables B25090 and B25082).",
        }
    }


def build(today: date) -> dict:
    defs = {r["law_key"]: r for r in verify_laws.load(verify_laws.DEFINITIONS)}
    values = verify_laws.load(verify_laws.VALUES)

    by_state: dict[str, dict] = {}
    used: set[str] = set()
    for r in values:
        if r["jurisdiction_level"] != "state":
            continue
        if not r["value"].strip():
            # Deliberately blank (sources disagree, or a source dropped the
            # state): show the reason instead of silently showing nothing.
            if r.get("reviewed_by", "").startswith("etl.laws.refresh") and r.get("notes") and r.get("as_of"):
                by_state.setdefault(r["jurisdiction_code"], {})[r["law_key"]] = {
                    "v": None, "checked": r["as_of"], "notes": r["notes"]}
            continue
        if not (r.get("source_url") and r.get("source_date") and r.get("as_of")):
            continue
        as_of = verify_laws.parse_date(r["as_of"])
        if as_of is None or (today - as_of).days > verify_laws.HARD_EXPIRY_DAYS:
            continue
        d = defs.get(r["law_key"])
        if d is None:
            continue
        fact = {
            "v": r["value"],
            "status": r["status"],
            "confidence": r["confidence"],
            "checked": r["as_of"],
            "sourceName": r["source_name"],
            "sourceUrl": r["source_url"],
            "sourceDate": r["source_date"],
        }
        if r.get("value_numeric"):
            fact["n"] = float(r["value_numeric"])
        if r.get("notes"):
            fact["notes"] = r["notes"]
        if r.get("source_quote"):
            fact["quote"] = r["source_quote"]
        by_state.setdefault(r["jurisdiction_code"], {})[r["law_key"]] = fact
        used.add(r["law_key"])

    laws = []
    for key, d in defs.items():
        if key not in used:
            continue
        laws.append({
            "key": key,
            "name": d["display_name"],
            "category": d["category"],
            "usage": d["usage"],
            "type": d["value_type"],
            "unit": d.get("unit", ""),
            "allowed": [v for v in (d.get("allowed_values") or "").split("|") if v],
            "order": [v for v in (d.get("ordinal_low_to_high") or "").split("|") if v],
            "cadence": d.get("refresh_cadence", ""),
            "rubric": d.get("rubric", ""),
        })
    return {"format": FORMAT, "generated": today.isoformat(), "disclaimer": DISCLAIMER,
            "laws": laws, "countySources": county_sources(), "states": dict(sorted(by_state.items()))}


def publish(today: date | None = None) -> Path:
    payload = build(today or date.today())
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return OUT


if __name__ == "__main__":
    path = publish()
    print(f"Published {path} ({path.stat().st_size / 1024:,.0f} KB)")
    sys.exit(0)
