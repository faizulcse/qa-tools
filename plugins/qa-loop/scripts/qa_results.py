#!/usr/bin/env python3
"""qa_results.py - one results file per test run; the report and the Jira
draft are both rendered from it, so they can't disagree.

    init KEY [--kind test|retest] [--env "dev (Admin console)"] [--accounts "Super Admin"]
        -> docs/KEY/results-<date>.json with the ticket title, tester and date
    check FILE                    guardrails (exit 1 on errors):
        - every failing / partial AC and every issue cites evidence that exists
        - every issue has steps, what happens now and what should happen
        - a "regression" must be re-checked before it is reported
        - nothing contradicts a recorded decision (expected / ignore / out of scope)
        - no <<placeholders>> left
    render FILE --as report|comment [--out FILE]
        report  -> full Markdown report (results, issues with steps, evidence, decisions, test data)
        comment -> Jira draft: retest table if there are retest items, else issues-only
                   with steps if there are issues, else a pass summary

Results file (JSON):
{
  "key": "PROJ-12", "title": "...", "date": "2026-11-20", "tester": "...",
  "env": "dev (Admin console)", "accounts": "Super Admin", "kind": "test|retest",
  "items": [
    {"id": "AC1", "type": "ac", "title": "AC text", "status": "pass|partial|fail|not_tested|blocked",
     "outcome": "what was seen", "evidence": ["qa-results/PROJ-12/01.png"]},
    {"id": "I1", "type": "issue", "severity": "S3", "title": "one line", "ac": "AC2",
     "steps": ["...", "..."], "now": "actual", "expected": "expected",
     "rows": [["Where/Input", "Now", "Expected"], ...],      # optional table instead of now/expected
     "evidence": ["..."], "regression": false, "rechecked": false},
    {"id": "R1", "type": "retest", "title": "issue as reported", "reported": "20 Nov",
     "status": "resolved|not_fixed|partly", "outcome": "what happens now", "evidence": ["..."]}
  ],
  "no_regression": "related behaviour that still works",
  "observations": ["minor notes, not issues"],
  "not_tested": ["what couldn't be tested and why"],
  "test_data": "free text; if empty, qa_ledger.py report --key KEY is used"
}
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import qa_decisions as decisions  # noqa: E402

DOCS_DIR = decisions.DOCS_DIR
ICON = {"pass": "✅ Pass", "partial": "⚠️ Partial", "fail": "❌ Fail", "not_tested": "⏸️ Not tested",
        "blocked": "⛔ Blocked", "expected": "✅ As expected", "resolved": "✅ Resolved",
        "not_fixed": "❌ Not fixed", "partly": "⚠️ Partly fixed"}
BAD_AC = {"partial", "fail"}
PH_RE = re.compile(r"<<[^>]*>>")


def load(path: str) -> dict:
    return json.loads(Path(path).read_text())


def items(r, t):
    return [i for i in r.get("items", []) if i.get("type") == t]


def sev_icon(sev: str) -> str:
    return f"{sev} ❌" if sev in ("S1", "S2") else f"{sev} ⚠️"


# --------------------------------------------------------------------------- #
# init


def cmd_init(a) -> int:
    title, tester = a.title, os.environ.get("QA_TESTER_NAME")
    if not title or not tester:
        try:
            from _qa_agent import jira  # noqa: WPS433
            jc = jira()
            if not title:
                s, i = jc.api("GET", f"/rest/api/2/issue/{a.key}", params={"fields": "summary"})
                title = (i.get("fields") or {}).get("summary") if s < 400 else None
            if not tester:
                s, me = jc.api("GET", "/rest/api/2/myself")
                tester = me.get("displayName") if s < 400 else None
        except SystemExit:
            pass
    today = dt.date.today().isoformat()
    out = Path(a.out) if a.out else DOCS_DIR / a.key / f"results-{today}.json"
    if out.exists() and not a.force:
        sys.exit(f"ERROR: {out} exists (use --force or --out)")
    data = {"key": a.key, "title": title or "<<title>>", "date": today, "tester": tester or "<<tester>>",
            "env": a.env or "<<environment>>", "accounts": a.accounts or "", "kind": a.kind, "items": [],
            "no_regression": "", "observations": [], "not_tested": [], "test_data": ""}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"results: {out}")
    return 0


# --------------------------------------------------------------------------- #
# check (guardrails)


def check(r: dict, base: Path) -> tuple[list[str], list[str]]:
    errs, warns = [], []
    decs = decisions.for_ticket(r["key"])
    for it in r.get("items", []):
        tag = f"{it.get('id', '?')} ({it.get('type')})"
        bad = (it.get("type") == "issue") or (it.get("type") == "ac" and it.get("status") in BAD_AC) \
            or (it.get("type") == "retest" and it.get("status") in ("not_fixed", "partly"))
        ev = it.get("evidence") or []
        if bad:
            if not ev:
                errs.append(f"{tag}: no evidence – cite a screenshot, snapshot or API result for every ❌/⚠️")
            for e in ev:
                if not (base / e).exists() and not Path(e).exists():
                    errs.append(f"{tag}: evidence not found: {e}")
        if it.get("type") == "issue":
            if not it.get("steps"):
                errs.append(f"{tag}: issue has no steps")
            if not it.get("rows") and not (it.get("now") and it.get("expected")):
                errs.append(f"{tag}: issue needs 'now' and 'expected' (or a 'rows' table)")
            if not it.get("severity"):
                errs.append(f"{tag}: issue has no severity (S1–S4)")
        text = " ".join(str(it.get(k, "")) for k in ("title", "outcome", "now", "expected"))
        if (it.get("regression") or re.search(r"\bregress", text, re.I)) and not it.get("rechecked"):
            errs.append(f"{tag}: called a regression but not re-checked – run it again (and rule out "
                        f"changed test data) before reporting, then set \"rechecked\": true")
        if bad:
            for d in decs:
                if d["type"] in decisions.SUPPRESSING and decisions.matches(d, text):
                    errs.append(f"{tag}: contradicts decision #{d['id']} ({decisions.LABEL[d['type']]}: "
                                f"{d['text']}) – drop it or mark it as expected")
        for k, v in it.items():
            if isinstance(v, str) and PH_RE.search(v):
                errs.append(f"{tag}: placeholder left in '{k}'")
        if it.get("type") == "ac" and it.get("status") == "pass" and not it.get("outcome"):
            warns.append(f"{tag}: pass without an outcome – say what was seen")
    for k in ("title", "tester", "env"):
        if PH_RE.search(str(r.get(k, ""))):
            errs.append(f"header: placeholder left in '{k}'")
    if not r.get("items"):
        errs.append("no items")
    return errs, warns


def cmd_check(a) -> int:
    r = load(a.file)
    errs, warns = check(r, Path.cwd())
    for e in errs:
        print(f"ERROR {e}")
    for w in warns:
        print(f"warn  {w}")
    print(f"check: {len(errs)} error(s), {len(warns)} warning(s)")
    return 1 if errs else 0


# --------------------------------------------------------------------------- #
# render


def verdict(r: dict) -> str:
    rt = items(r, "retest")
    if rt:
        done = sum(1 for i in rt if i.get("status") == "resolved")
        return f"✅ Resolved ({done} of {len(rt)})" if done == len(rt) else f"⚠️ {done} of {len(rt)} resolved"
    iss = items(r, "issue")
    acs = items(r, "ac")
    if any(i.get("severity") in ("S1", "S2") for i in iss) or any(a.get("status") == "fail" for a in acs):
        return f"❌ Fail ({len(iss)} issue{'s' if len(iss) != 1 else ''})" if iss else "❌ Fail"
    if iss or any(a.get("status") == "partial" for a in acs):
        return f"⚠️ Pass with conditions ({len(iss)} issue{'s' if len(iss) != 1 else ''})"
    return "✅ Pass"


def test_data_text(r: dict) -> str:
    if r.get("test_data"):
        return r["test_data"]
    try:
        out = subprocess.run([sys.executable, str(HERE / "qa_ledger.py"), "report", "--key", r["key"]],
                             capture_output=True, text=True, timeout=30).stdout.strip()
    except Exception:  # noqa: BLE001
        out = ""
    if not out or out.startswith("_Test data: nothing"):
        return "nothing was changed"
    return "; ".join(l.lstrip("- ").rstrip(".") for l in out.splitlines()[1:]).replace("**", "")


def header(r, heading, evidence_line=False) -> list[str]:
    out = [f"## {heading}: {r['title']}", "", f"**{'Result' if r.get('kind') == 'retest' else 'Verdict'}:** {verdict(r)}",
           f"**Tested by:** {r['tester']} (QA) · **Date:** {r['date']} · **Environment:** {r['env']}"]
    if r.get("accounts"):
        out.append(f"**Accounts:** {r['accounts']}")
    return out + [""]


def issue_block(n: int, it: dict, with_evidence=False) -> list[str]:
    out = [f"### Issue {n} ({it['severity']}): {it['title']}", "", "**Steps**"]
    out += [f"{k}. {s}" for k, s in enumerate(it.get("steps") or [], 1)]
    out.append("")
    if it.get("rows"):
        head, *body = it["rows"]
        out.append("| " + " | ".join(head) + " |")
        out.append("|" + "---|" * len(head))
        out += ["| " + " | ".join(row) + " |" for row in body]
    else:
        out += ["| What happens now ❌ | What should happen ✅ |", "|---|---|", f"| {it['now']} | {it['expected']} |"]
    if with_evidence and it.get("evidence"):
        out += ["", "Evidence: " + ", ".join(f"`{e}`" for e in it["evidence"])]
    return out + ["", "---", ""]


def render_comment(r: dict) -> str:
    rt, iss, acs = items(r, "retest"), items(r, "issue"), items(r, "ac")
    decs = decisions.for_ticket(r["key"])
    out: list[str] = []
    if rt:
        out += header(r, "Retest")
        out += ["| Status | Issue | Retest result |", "|---|---|---|"]
        out += [f"| {ICON[i['status']]} | {i['title']}{' (' + i['reported'] + ')' if i.get('reported') else ''} | {i.get('outcome', '')} |" for i in rt]
        out.append("")
        if r.get("no_regression"):
            out += [f"**No regression:** {r['no_regression']}", ""]
        if iss:
            out += ["---", ""]
            for n, it in enumerate(iss, 1):
                out += issue_block(n, it)
    elif iss:
        out += header(r, "QA Issues")
        out += ["| # | Severity | Issue | AC |", "|---|---|---|---|"]
        out += [f"| {n} | {sev_icon(i['severity'])} | {i['title']} | {i.get('ac', '-')} |" for n, i in enumerate(iss, 1)]
        out += ["", "---", ""]
        for n, it in enumerate(iss, 1):
            out += issue_block(n, it)
        passed = [a for a in acs if a.get("status") in ("pass", "expected")]
        if passed:
            out += ["### What passed"] + [f"- ✅ **{a['id']}:** {a.get('outcome') or a['title']}" for a in passed] + [""]
    else:
        out += header(r, "Testing Summary")
        out += ["| Status | AC | Outcome |", "|---|---|---|"]
        out += [f"| {ICON[a['status']]} | {a['id']}: {a['title']} | {a.get('outcome', '')} |" for a in acs]
        out.append("")
    nt = r.get("not_tested") or [f"{a['id']}: {a.get('outcome') or a['title']}" for a in acs if a.get("status") == "not_tested"]
    if nt:
        out += ["**Not tested:** " + "; ".join(nt), ""]
    oos = [d for d in decs if d["type"] == "out_of_scope"]
    if oos:
        out += ["**Out of scope:** " + "; ".join(d["text"] for d in oos), ""]
    for d in decs:
        if d["type"] == "ac_wording":
            out += [f"**AC wording:** {d['text']}", ""]
    out.append(f"_Test data: {test_data_text(r)}._")
    return "\n".join(out).rstrip() + "\n"


def render_report(r: dict) -> str:
    rt, iss, acs = items(r, "retest"), items(r, "issue"), items(r, "ac")
    decs = decisions.for_ticket(r["key"])
    title = "Retest" if rt else "QA Report"
    out = [f"# {title}: {r['key']} · {r['title']} ({r['date']})", "",
           f"- **Environment:** {r['env']}", f"- **Tester:** {r['tester']}"]
    if r.get("accounts"):
        out.append(f"- **Accounts:** {r['accounts']}")
    out += [f"- **Evidence:** see each row", f"- **Verdict:** {verdict(r)}", ""]
    if rt:
        out += ["## Previous feedback", "| Status | Issue | Retest result | Evidence |", "|---|---|---|---|"]
        out += [f"| {ICON[i['status']]} | {i['title']} | {i.get('outcome', '')} | {', '.join(i.get('evidence') or []) or '-'} |" for i in rt]
        out.append("")
    if acs:
        out += ["## Results", "| Status | AC | Outcome | Evidence |", "|---|---|---|---|"]
        out += [f"| {ICON[a['status']]} | {a['id']}: {a['title']} | {a.get('outcome', '')} | {', '.join(a.get('evidence') or []) or '-'} |" for a in acs]
        out.append("")
    if iss:
        out += ["## Issues", "| # | Severity | Issue | AC |", "|---|---|---|---|"]
        out += [f"| {n} | {sev_icon(i['severity'])} | {i['title']} | {i.get('ac', '-')} |" for n, i in enumerate(iss, 1)]
        out.append("")
        for n, it in enumerate(iss, 1):
            out += issue_block(n, it, with_evidence=True)
    if r.get("no_regression"):
        out += [f"**No regression:** {r['no_regression']}", ""]
    if r.get("observations"):
        out += ["## Observations"] + [f"- ℹ️ {o}" for o in r["observations"]] + [""]
    if r.get("not_tested"):
        out += ["## Not tested"] + [f"- {o}" for o in r["not_tested"]] + [""]
    if decs:
        out += ["## Decisions on record", "| Type | Decision | Source |", "|---|---|---|"]
        out += [f"| {decisions.LABEL[d['type']]} | {d['text']} | {d.get('source') or '-'} ({d['date']}) |" for d in decs]
        out.append("")
    out += ["## Test data", test_data_text(r).rstrip(".") + "."]
    return "\n".join(out).rstrip() + "\n"


def cmd_render(a) -> int:
    r = load(a.file)
    errs, _ = check(r, Path.cwd())
    if errs and not a.force:
        for e in errs:
            print(f"ERROR {e}", file=sys.stderr)
        sys.exit("render stopped: fix the check errors first (or --force for a work-in-progress view)")
    text = render_report(r) if a.as_ == "report" else render_comment(r)
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(text)
        print(f"wrote {a.out}")
    else:
        print(text)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init")
    i.add_argument("key")
    i.add_argument("--kind", choices=["test", "retest"], default="test")
    i.add_argument("--env")
    i.add_argument("--accounts")
    i.add_argument("--title")
    i.add_argument("--out")
    i.add_argument("--force", action="store_true")
    i.set_defaults(fn=cmd_init)
    c = sub.add_parser("check")
    c.add_argument("file")
    c.set_defaults(fn=cmd_check)
    r = sub.add_parser("render")
    r.add_argument("file")
    r.add_argument("--as", dest="as_", choices=["report", "comment"], required=True)
    r.add_argument("--out")
    r.add_argument("--force", action="store_true")
    r.set_defaults(fn=cmd_render)
    a = ap.parse_args()
    return a.fn(a) or 0


if __name__ == "__main__":
    sys.exit(main())
