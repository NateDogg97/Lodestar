"""Offline tests for verify_laws.py. No network.

    python -m etl.laws.test_verify
"""
import sys
from datetime import date, timedelta

from etl.laws import verify_laws as V

P, F = 0, 0
def check(cond, label, detail=""):
    global P, F
    if cond: P += 1; print(f"  PASS  {label}")
    else: F += 1; print(f"  FAIL  {label}  {detail}")

DEFS = {r["law_key"]: r for r in V.load(V.DEFINITIONS)}
TODAY = date(2026, 9, 26)

def row(**kw):
    base = dict(law_key="marijuana_status", jurisdiction_level="state", jurisdiction_code="TX",
                value="", value_numeric="", status="unknown", effective_date="", as_of="",
                source_name="", source_url="", source_date="", data_url="",
                source_quote="", source_hash="", confidence="unverified",
                reviewed_by="", notes="")
    base.update(kw); return base

print("\nschema")
f = V.check_schema(DEFS, [row(value="legal_everywhere", status="in_effect")])
check(any("not in allowed set" in x.message for x in f), "rejects value outside allowed set")
f = V.check_schema(DEFS, [row(law_key="not_a_real_law", value="x")])
check(any("not declared" in x.message for x in f), "rejects undeclared law_key")
f = V.check_schema(DEFS, [row(law_key="minimum_wage", value="7.25", value_numeric="", status="in_effect")])
check(any("no value_numeric" in x.message for x in f), "numeric law requires value_numeric")
f = V.check_schema(DEFS, [row(law_key="minimum_wage", value="7.25", value_numeric="seven", status="in_effect")])
check(any("not a number" in x.message for x in f), "rejects non-numeric value_numeric")
f = V.check_schema(DEFS, [row(value="recreational", status="in_effect")])
check(not [x for x in f if x.severity=="BLOCK"], "accepts a valid row")

print("\ncoverage")
f = V.check_coverage(DEFS, [row(value="recreational")])
check(any("jurisdictions absent" in x.message for x in f), "detects missing jurisdictions")
partial = [row(jurisdiction_code=s, value="recreational" if s in ("TX","CA") else "")
           for s in sorted(V.STATES)]
f = V.check_coverage(DEFS, partial)
check(any("partially filled" in x.message for x in f), "flags partially filled law")

print("\nstaleness")
f = V.check_staleness(DEFS, [row(value="recreational", status="in_effect", as_of="")], TODAY)
check(any("no as_of" in x.message for x in f), "value without as_of blocks")
old = (TODAY - timedelta(days=200)).isoformat()
f = V.check_staleness(DEFS, [row(value="recreational", status="in_effect", as_of=old)], TODAY)
check(any(x.check=="staleness" and "past the quarterly" in x.message for x in f),
      "flags value past its cadence threshold")
ancient = (TODAY - timedelta(days=900)).isoformat()
f = V.check_staleness(DEFS, [row(value="recreational", status="in_effect", as_of=ancient)], TODAY)
check(any(x.severity=="BLOCK" and "hard expiry" in x.message for x in f), "hard expiry blocks")
fresh = (TODAY - timedelta(days=10)).isoformat()
f = V.check_staleness(DEFS, [row(value="recreational", status="in_effect", as_of=fresh)], TODAY)
check(not f, "fresh value is clean")
past = (TODAY - timedelta(days=5)).isoformat()
f = V.check_staleness(DEFS, [row(value="recreational", status="scheduled",
                                 effective_date=past, as_of=fresh)], TODAY)
check(any("has passed" in x.message for x in f), "scheduled change whose date passed blocks")

print("\nprovenance")
f = V.check_provenance(DEFS, [row(value="recreational", as_of="2026-09-01")])
check(any("no source_url" in x.message for x in f), "value without source_url blocks")
f = V.check_provenance(DEFS, [row(value="recreational", source_url="not-a-url")])
check(any("not a URL" in x.message for x in f), "rejects malformed url")
f = V.check_provenance(DEFS, [row(value="recreational", source_url="https://x.gov/a")])
check(any("no source_quote" in x.message for x in f), "warns on missing quote")
check(any(x.severity=="BLOCK" and "no source_name" in x.message for x in f),
      "value without source_name blocks")
check(any(x.severity=="BLOCK" and "no source_date" in x.message for x in f),
      "value without the source's own date blocks")
full = row(value="recreational", source_name="NCSL", source_url="https://x.org/a",
           source_date="2026-09-02", source_quote="Alaska | Measure 8 | Yes. Ballot Measure 2 (2014)")
f = V.check_provenance(DEFS, [full])
check(not f, "fully cited row is clean")

print("\nquote matching (normalization)")
body = "<html><body><p>Adult-use   cannabis is\n<b>legal</b> for persons 21 and over.</p></body></html>"
check(V.normalize_text("Adult-use cannabis is legal for persons 21 and over.") in V.normalize_text(body),
      "quote survives tags, newlines and collapsed whitespace")
check(V.normalize_text("curly ’quote’") == "curly 'quote'", "normalizes smart quotes")

print("\nonline checks (mocked fetcher)")
def fetcher_ok(url): return 200, "<p>Adult-use cannabis is legal for persons 21 and over.</p>"
def fetcher_404(url): return 404, "Not Found"
def fetcher_changed(url): return 200, "<p>This page has been reorganized.</p>"
def fetcher_boom(url): raise RuntimeError("connection reset")

r = row(value="recreational", status="in_effect", as_of="2026-09-01",
        source_url="https://example.gov/cannabis",
        source_quote="Adult-use cannabis is legal for persons 21 and over.")
f = V.check_online(DEFS, [r], fetcher=fetcher_ok)
check(not f, "clean page with matching quote produces nothing")
f = V.check_online(DEFS, [r], fetcher=fetcher_404)
check(any(x.severity=="BLOCK" and x.check=="link_rot" for x in f), "404 blocks as link rot")
f = V.check_online(DEFS, [r], fetcher=fetcher_changed)
check(any(x.check=="quote_drift" for x in f), "vanished quote flags drift")
f = V.check_online(DEFS, [r], fetcher=fetcher_boom)
check(any(x.check=="link_rot" and x.severity=="WARN" for x in f), "fetch exception warns, does not crash")

r2 = dict(r); r2["source_hash"] = "deadbeefdeadbeef"
f = V.check_online(DEFS, [r2], fetcher=fetcher_ok)
check(any(x.check=="page_changed" for x in f), "hash mismatch reported as INFO")

print("\nfetch caching")
calls = []
def counting(url):
    calls.append(url); return 200, "<p>Adult-use cannabis is legal for persons 21 and over.</p>"
rows = [dict(r, jurisdiction_code=s) for s in ("TX","CA","NY")]
V.check_online(DEFS, rows, fetcher=counting)
check(len(calls) == 1, f"same url fetched once across rows (got {len(calls)})")

print("\nedition staleness (check 7)")
r_old = row(law_key="income_tax_top_rate", jurisdiction_code="TX", value="0.00",
            value_numeric="0.00", status="in_effect", as_of="2026-09-01",
            source_url="https://taxfoundation.org/data/all/state/state-income-tax-rates-2024/")
f = V.check_edition(DEFS, [r_old], date(2026,9,26))
check(any(x.check=="edition" for x in f), "flags a source_url citing an older edition year")
r_cur = dict(r_old, source_url="https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/")
f = V.check_edition(DEFS, [r_cur], date(2026,9,26))
check(not f, "current-year edition is clean")
many = [dict(r_old, jurisdiction_code=s2) for s2 in ("TX","CA","NY")]
f = V.check_edition(DEFS, many, date(2026,9,26))
check(len(f) == 1, f"deduplicates to one finding per law+url (got {len(f)})")

print("\nsource age (check 7)")
aged = dict(full, source_date="2023-01-01")
f = V.check_edition(DEFS, [aged, dict(aged, jurisdiction_code="CA")], date(2026,9,26))
check(sum(x.check=="edition" and "two years" in x.message for x in f) == 1,
      "flags a source over two years old, once per law")

print("\nend-to-end on the real table")
findings, values = V.run(online=False, today=TODAY)
blocks = [x for x in findings if x.severity=="BLOCK"]
check(not blocks, f"real table has no BLOCKs (got {[str(b)[:80] for b in blocks[:3]]})")
filled = [r for r in values if r["value"].strip()]
check(all(r["source_name"] and r["source_date"] and r["source_quote"] for r in filled),
      "every filled value names its source, its date, and quotes it")
check(all(r["reviewed_by"].startswith("etl.laws.refresh") for r in filled),
      "every filled value was written by refresh.py, not by hand")

print(f"\n{'='*60}\n{P} passed, {F} failed\n{'='*60}")
sys.exit(1 if F else 0)
