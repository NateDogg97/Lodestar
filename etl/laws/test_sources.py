"""Offline tests for the law source parsers and the refresh merge. No network.

    python -m etl.laws.test_sources

Each parser is fed a small synthetic page in the publisher's real layout (as
seen 2026-09-27), including the quirks that broke earlier attempts.
"""
import sys
from datetime import date

from etl.laws import refresh
from etl.laws.common import Fact, SourceError, SourceResult, STATES, STATE_NAMES, html_tables, leading_state, parse_long_date, state_code
from etl.laws.sources import eia, guns, kff, ncsl, taxfoundation as tf

P, F = 0, 0


def check(cond, label, detail=""):
    global P, F
    if cond:
        P += 1
        print(f"  PASS  {label}")
    else:
        F += 1
        print(f"  FAIL  {label}  {detail}")


def raises(fn, *a, **kw):
    try:
        fn(*a, **kw)
    except SourceError:
        return True
    return False


TODAY = date(2026, 9, 27)

print("\ncommon")
check(state_code("Calif. (a)") == "CA", "AP abbreviation with footnote")
check(state_code("Arkansas[115]") == "AR", "Wikipedia footnote marker")
check(state_code("Kansas*") == "KS", "trailing asterisk")
check(state_code("District of Columbia") == "DC" and state_code("D.C. (b)") == "DC", "DC spellings")
check(state_code("Guam") is None and state_code("New York City") is None, "non-states are None")
check(leading_state("West Virginia (2017)") == "WV", "longest name wins (not Virginia)")
check(leading_state("Colorado Medical program info -Non medical") == "CO", "state name followed by words")
check(parse_long_date("Updated July 01, 2026 A Brief") == date(2026, 7, 1), "parses 'July 01, 2026'")
nested = ("<table><tr><th>State</th><th>Wage</th></tr><tr><td>New York</td><td>$16.00/17.00"
          "<table><tr><td>NYC</td><td>$17.00</td></tr></table></td></tr>"
          "<tr><td>Ohio</td><td>$10.70</td></tr></table>")
tables = html_tables(nested)
outer = max(tables, key=len)
check([r[0] for r in outer] == ["State", "New York", "Ohio"], "nested table doesn't end the outer one",
      str(outer))
check("NYC $17.00" in outer[1][1], "nested table text is kept in its cell")

print("\nTax Foundation: income tax")
rows = [
    ("State", "Rates", "Brackets"),
    ("Ala. (a, b)", 0.02, ">", 0), (None, 0.04, ">", 500), (None, 0.05, ">", 3000),
    ("Alaska", "none", "none"),
    ("Ill.", 0.0495, ">", 0),
    ("Wash. (h, k)", 0.07, ">", 0), (None, 0.09, ">", 1000000),
    ("(h) Top rates exclude non-UI payroll taxes in CA (1.3%), MA (0.46%), and WA (0.58%), and more.",),
    ("(k) In Wash., tax rates apply only to high earners' capital gains income.",),
]
blocks = tf.parse_income_blocks(rows)
check(blocks["AL"]["rates"] == [0.02, 0.04, 0.05], "collects every bracket row of a state")
check(blocks["AK"]["none"], "'none' means no wage income tax")
check(blocks["WA"]["capital_gains_only"], "a state citing a capital-gains-only footnote is flagged")
check(not blocks["IL"]["capital_gains_only"], "a footnote only applies to states that cite it")
facts = tf._income_facts(blocks, page="https://x", data_url="https://x.xlsx", as_of=TODAY, table="T")
check(facts["AL"][0].value == "5" and facts["AL"][1].value == "graduated", "AL: top 5%, graduated")
check(facts["IL"][1].value == "flat", "one rate is flat")
check(facts["WA"][0].value == "0" and facts["WA"][1].value == "none", "WA: 0 on wages, structure none")
check("capital gains" in facts["WA"][0].notes, "WA's capital gains rates kept in notes")

print("\nTax Foundation: sales tax and groceries")
sheet = [("State & Local Sales Tax Rates as of July 1, 2026",),
         ("State", "State Tax Rate", "State Tax Rank", "Average Local Tax Rate", "Max Local Rate",
          "Combined Tax Rate", "Combined Rank"),
         ("Texas", 0.0625, 13, 0.01951, 0.02, 0.08201, 14),
         ("Oregon", None, None, None, None, None, 47)]
parsed, title = tf.parse_sales_sheet(sheet)
check(abs(parsed["TX"][2] - 0.08201) < 1e-9, "reads the combined rate by header name")
check(parsed["OR"] == (0.0, 0.0, 0.0), "blank cells (no sales tax) read as 0")
check("July 1, 2026" in title, "keeps the title for the as-of date")
check(tf.classify_grocery(0.04, 0.02)[0] == "reduced", "a lower grocery rate is reduced")
check(tf.classify_grocery(0.07, "Exempt")[0] == "exempt", "Exempt")
check(tf.classify_grocery(0.04, "Included in Base")[0] == "taxed", "Included in Base is taxed")
check(tf.classify_grocery("--", "--")[0] == "exempt", "no sales tax counts as exempt (rubric)")
check(raises(tf.classify_grocery, 0.05, "Partially"), "an unknown treatment raises rather than guessing")

print("\nNCSL: minimum wage")


def wage_page(overrides=None, updated="July 01, 2026"):
    overrides = overrides or {}
    body = "".join(f"<tr><td>{name}</td><td>{overrides.get(code, ('$7.25', '', ''))[0]}</td>"
                   f"<td>{overrides.get(code, ('', '', ''))[1]}</td><td>{overrides.get(code, ('', '', ''))[2]}</td></tr>"
                   for code, name in STATE_NAMES.items())
    return (f"<p>Updated {updated}</p><table><tr><th>State</th><th>Minimum Wage</th>"
            f"<th>Future Enacted Increases</th><th>Additional Notes</th></tr>{body}"
            f"<tr><td>Guam</td><td>$9.25</td><td></td><td></td></tr></table>")


page = wage_page({"NY": ("$16.00/17.00", "", "Varies by region."),
                  "GA": ("$5.15", "", "State rate is $5.15."),
                  "FL": ("$14.00", "$15 eff. 9-30-26", "Indexed increases resume Sept. 30, 2028. (2004)"),
                  "MI": ("$13.73", "$13.29 eff. 2-21-2026 $14.16 eff. 2-21-2027", ""),
                  "DC": ("$18.40", "$17.95", "")})
w = ncsl.minimum_wage_from_page(page, TODAY)
check(set(w.facts) == STATES, "all 51, territories ignored")
check(w.facts["NY"].value == "16.00", "regional rates use the statewide floor")
check(w.facts["GA"].value == "7.25" and "federal" in w.facts["GA"].notes, "below-federal rate floors at $7.25")
check(w.facts["FL"].value == "14.00" and "Sep 30, 2026" in w.facts["FL"].notes, "a future increase is noted")
check("Sept. 30, 2028." in w.facts["FL"].notes, "first-sentence note isn't cut at 'Sept.'")
check("13.29" not in w.facts["MI"].notes and "14.16" in w.facts["MI"].notes, "past steps dropped, future kept")
check("17.95" not in w.facts["DC"].notes, "an undated figure below the current rate is dropped")
later = ncsl.minimum_wage_from_page(page, date(2026, 10, 2))
check(later.facts["FL"].value == "15.00" and "since taken effect" in later.facts["FL"].notes,
      "a scheduled increase applies once its date passes")
check(later.facts["MI"].value == "13.73", "steps dated before the page update never apply")
check("NCSL State Minimum Wages" in w.facts["TX"].quote, "quote names the table")
check(raises(ncsl.minimum_wage_from_page, wage_page().replace("<td>Texas</td>", "<td>Tejas</td>"), TODAY),
      "a missing state raises")
check(raises(ncsl.minimum_wage_from_page, wage_page().replace("Updated", "Posted"), TODAY),
      "no 'Updated' date raises")

wiki = {c: 7.25 for c in STATES if c != "DC"}
wiki["RI"] = 16.0
res = ncsl.minimum_wage_from_page(wage_page({"RI": ("$15.00", "", "")}), TODAY)
res = ncsl.cross_check(res, wiki, "https://w", TODAY)
check("RI" not in res.facts and any(n.startswith("RI:") for n in res.notes), "disagreement blanks the state")
check(res.facts["TX"].confidence == "high", "agreement raises confidence")
check(res.facts["DC"].confidence == "medium" and "NCSL only" in res.facts["DC"].notes,
      "second source silent: primary alone, medium")

print("\nNCSL: marijuana")
cannabis = ("<p>Updated September 02, 2026</p>"
            "<table><tr><th>State</th><th>Statutory Language (year)</th>"
            "<th>State Allows for Retail Sales/Non-Medical Use by Adults</th></tr>"
            + "".join(f"<tr><td>{n}</td><td>Law</td><td>Yes. Measure</td></tr>" for n in
                      ["Alaska", "Arizona", "California", "Colorado", "Connecticut", "Delaware",
                       "District of Columbia", "Illinois", "Maine", "Maryland", "Michigan"])
            + "<tr><td>Washington</td><td>Law</td><td>Initiative 502 (2012)</td></tr>"
            + "".join(f"<tr><td>{n}</td><td>Law</td><td>{a}</td></tr>" for n, a in
                      [("Texas", "No."), ("Florida", ""), ("Utah", ""), ("Ohio", ""), ("Hawaii", "")])
            + "<tr><td>Guam</td><td>Law</td><td>Yes.</td></tr></table>"
            "<table><tr><th>State</th><th>Program</th><th>Definition of Products Allowed</th></tr>"
            "<tr><td>Kansas* (Not marked on map above)</td><td>SB 28</td><td>CBD</td></tr></table>")
m = ncsl.marijuana_from_page(cannabis)
check(m.facts["WA"].value == "recreational", "a bare measure name counts as adult use (Washington)")
check(m.facts["TX"].value == "medical" and m.facts["FL"].value == "medical", "'No.' or blank is medical")
check(m.facts["KS"].value == "cbd_only", "low-THC table only is cbd_only")
check(m.facts["ID"].value == "illegal", "in neither table is illegal")
check(raises(ncsl.marijuana_from_page, cannabis.replace("Yes. Measure", "")), "an implausible split raises")
res = ncsl.cannabis_cross_check(ncsl.marijuana_from_page(cannabis),
                                {"WA": "recreational", "TX": "cbd_only", "FL": None}, "https://w", TODAY)
check(res.facts["WA"].confidence == "high", "agreement confirms")
check("TX" not in res.facts, "disagreement blanks")
check("FL" in res.facts and "NCSL only" in res.facts["FL"].notes, "unclear Wikipedia cell neither confirms nor blanks")

print("\nKFF: abortion")
check(kff.classify("Abortion banned") == "banned", "banned")
check(kff.classify("Gestational limit between 6 and 12 weeks LMP") == "restricted", "<=12 weeks restricted")
check(kff.classify("Gestational limit between 18 and 22 weeks LMP") == "limited", ">12 weeks limited")
check(kff.classify("Gestational limit at or near viability") == "protected", "viability protected")
check(kff.classify("No gestational limits") == "protected", "no limit protected")
check(raises(kff.classify, "Under review"), "unknown category raises")
dataset = "State\tStatus of Abortion\tNotes\n" + "".join(
    f"{n}\tNo gestational limits\t\"Line one.<br><br>Line two.\"\n" for n in STATE_NAMES.values())
chart = '{"source-name":"KFF analysis of state policies and court decisions, as of August 10, 2026."}'
k = kff.parse_dataset(dataset, chart, "https://d/dataset.csv")
check(len(k.facts) == 51 and k.facts["TX"].source_date == date(2026, 8, 10), "reads the chart's as-of date")
check("<br>" not in k.facts["TX"].notes, "HTML stripped from notes")
check(raises(kff.parse_dataset, dataset, '{"source-name":"KFF"}', "x"), "no as-of date raises")

print("\nPermitless carry")
g = {c: "x" for c in sorted(STATES)[:25]}  # includes AL, AK, AR; not WA
wk = {c: ["", "18", "21"] for c in g if c != "AR"}
res = guns.combine(g, TODAY, wk, TODAY, 123)
check("AR" not in res.facts and any(n.startswith("AR:") for n in res.notes), "disagreement blanks")
check(res.facts["AL"].value == "true" and res.facts["AL"].confidence == "high", "both say yes -> true")
check(res.facts["WA"].value == "false", "both silent -> false")
check("oldid=123" in res.facts["AL"].notes, "pins the Wikipedia revision")
check(raises(guns.combine, {"AL": "x"}, TODAY, {"AL": []}, TODAY, 1), "implausibly short lists raise")

print("\nEIA: electricity")
payload = {"response": {"data": [{"stateid": c, "period": "2025", "price": "15.1"} for c in STATES]
                        + [{"stateid": "US", "period": "2025", "price": "17"}]
                        + [{"stateid": "TX", "period": "2026", "price": "16"}]}}
e = eia.parse_response(payload, "https://api")
check(len(e.facts) == 51 and e.facts["TX"].source_date == date(2025, 12, 31),
      "uses the latest year with all 51 (not a partial one)")
bad = {"response": {"data": [{"stateid": c, "period": "2025", "price": "900"} for c in STATES]}}
check(raises(eia.parse_response, bad, "x"), "implausible price raises")

print("\nrefresh.merge")
rows = [dict({c: "" for c in refresh.COLUMNS}, law_key="minimum_wage", jurisdiction_level="state",
             jurisdiction_code=c, value="7.25") for c in STATES]
rows.append(dict({c: "" for c in refresh.COLUMNS}, law_key="income_tax_top_rate",
                 jurisdiction_level="state", jurisdiction_code="TX", value="0"))
result = SourceResult("minimum_wage", notes=["RI: sources disagree"])
for c in STATES - {"RI"}:
    result.facts[c] = Fact(value="7.250" if c != "WA" else "17.13", value_numeric=7.25,
                           source_name="NCSL", source_url="https://n", source_date=TODAY, quote="q")
report = refresh.Report(TODAY)
merged = refresh.merge(rows, result, TODAY, report)
by = {(r["law_key"], r["jurisdiction_code"]): r for r in merged}
check(len(merged) == 52, "same number of rows")
check(by[("minimum_wage", "WA")]["value"] == "17.13" and by[("minimum_wage", "WA")]["as_of"] == "2026-09-27",
      "fresh value written with today's check date")
check(by[("minimum_wage", "RI")]["value"] == "" and "disagree" in by[("minimum_wage", "RI")]["notes"],
      "missing state blanked with the reason")
check([c for c in report.changes if c[1] != "RI"] == [("minimum_wage", "WA", "7.25", "17.13")],
      "'7.25' vs '7.250' is not a change; 17.13 is", str(report.changes))
check(by[("income_tax_top_rate", "TX")]["value"] == "0", "other laws untouched")


def boom(today):
    raise SourceError("HTTP 403")


saved = dict(refresh.FETCHERS)
refresh.FETCHERS.clear()
refresh.FETCHERS["ncsl.minimum_wage"] = boom
orig_load = refresh.load_values
refresh.load_values = lambda: [dict(r) for r in rows]
try:
    out, rep = refresh.run(TODAY)
finally:
    refresh.FETCHERS.clear()
    refresh.FETCHERS.update(saved)
    refresh.load_values = orig_load
check(rep.failed == {"ncsl.minimum_wage": "HTTP 403"}, "a failed source is reported")
check(out == rows, "a failed source leaves its rows exactly as they were")

print(f"\n{'=' * 60}\n{P} passed, {F} failed\n{'=' * 60}")
sys.exit(1 if F else 0)
