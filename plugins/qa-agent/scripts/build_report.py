#!/usr/bin/env python3
"""build_report.py - assemble a test report from harness result files.

Reads every <results-dir>/*/result.json produced by qa-harness.mjs (UI) or
api_harness.py (API) and writes a self-contained HTML or Markdown report.

    python3 build_report.py ./qa-results \
        --title "Checkout discount codes - QA-4410" \
        --summary summary.md \
        --out qa-report.html

    python3 build_report.py ./qa-results --format md --out qa-report.md

    # a cycle mixing hand-driven cases with promoted spec files
    npx playwright test --reporter=json > qa-results/playwright.json
    python3 build_report.py ./qa-results \
        --playwright-json qa-results/playwright.json --out qa-report.html

--summary takes a markdown file whose contents are placed above the tables;
put the verdict, risk summary, scope, and open questions there.

Screenshots are embedded as data URIs so the HTML file can be attached to a
ticket or emailed with no broken links. Use --no-embed to link instead.
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import mimetypes
import re
from datetime import datetime, timezone
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
STATUS_ORDER = {"FAIL": 0, "ERROR": 1, "BLOCKED": 2, "PASS_WITH_ERRORS": 3, "PASS": 4}
STATUS_LABEL = {
    "PASS": "Pass", "FAIL": "Fail", "ERROR": "Error",
    "PASS_WITH_ERRORS": "Pass (JS errors)", "BLOCKED": "Blocked",
}


def load_results(root: Path) -> list[dict]:
    rows = []
    for f in sorted(root.glob("*/result.json")):
        try:
            data = json.loads(f.read_text())
            data["_dir"] = f.parent
            data["_kind"] = "api" if "exchanges" in data else "ui"
            rows.append(data)
        except Exception as e:  # noqa: BLE001
            print(f"skipping {f}: {e}")
    rows.sort(key=lambda r: (STATUS_ORDER.get(r.get("status", "PASS"), 9),
                             r.get("caseId", "")))
    return rows


def load_playwright_json(path: Path) -> list[dict]:
    """Ingest `npx playwright test --reporter=json` output as report rows, so a
    cycle mixing hand-driven cases and promoted specs produces one report."""
    try:
        data = json.loads(Path(path).read_text())
    except Exception as e:  # noqa: BLE001
        print(f"skipping {path}: {e}")
        return []

    rows, specs = [], []

    def walk(suite, trail):
        here = trail + [suite.get("title", "")]
        for spec in suite.get("specs", []) or []:
            specs.append((here, spec))
        for child in suite.get("suites", []) or []:
            walk(child, here)

    for suite in data.get("suites", []) or []:
        walk(suite, [])

    STATUS = {"passed": "PASS", "failed": "FAIL", "timedOut": "FAIL",
              "interrupted": "ERROR", "skipped": "BLOCKED"}

    for trail, spec in specs:
        title = spec.get("title", "")
        # "TC-07 expired code is rejected" -> caseId TC-07
        m = re.match(r"^\s*([A-Z]{2,}-\d+)\b[\s:.-]*(.*)$", title)
        case_id = m.group(1) if m else (title[:40] or "SPEC")
        clean_title = (m.group(2) or title) if m else title

        tests = spec.get("tests") or []
        res = ((tests[0].get("results") or [{}])[0]) if tests else {}
        status = STATUS.get(res.get("status", "passed"), "FAIL")
        project = tests[0].get("projectName") if tests else None

        err = res.get("error") or {}
        err_msg = ANSI.sub("", str(err.get("message", "")))[:1500] if err else ""

        shots = [a.get("path") for a in (res.get("attachments") or [])
                 if a.get("contentType", "").startswith("image/") and a.get("path")]
        trace = next((a.get("path") for a in (res.get("attachments") or [])
                      if a.get("name") == "trace"), None)
        video = next((a.get("path") for a in (res.get("attachments") or [])
                      if a.get("name") == "video"), None)

        steps = []
        for i, s in enumerate(res.get("steps") or [], start=1):
            if s.get("category") not in (None, "test.step"):
                continue
            steps.append({"n": i, "kind": "step", "label": s.get("title", ""),
                          "status": "FAIL" if s.get("error") else "PASS",
                          "error": ANSI.sub("", str((s.get("error") or {}).get("message", "")))[:500]
                                   or None})

        # Playwright writes failure artifacts into a per-test directory; prefer
        # that as the evidence location, and fall back to the spec file itself.
        attach_paths = [a.get("path") for a in (res.get("attachments") or []) if a.get("path")]
        evidence_dir = (str(Path(attach_paths[0]).parent) if attach_paths
                        else spec.get("file", ""))

        rows.append({
            "caseId": case_id,
            "title": clean_title,
            "status": status,
            "durationMs": res.get("duration", 0),
            "environment": {"browser": project, "suite": " > ".join(t for t in trail if t)},
            "steps": steps,
            "checks": [],
            "consoleErrors": [], "pageErrors": [], "failedRequests": [],
            # label left unset so the error message is what surfaces as the
            # one-line observation in the summary table
            "failure": ({"error": err_msg} if status != "PASS" and err_msg else None),
            "artifacts": {"dir": evidence_dir, "screenshots": shots,
                          "trace": trace, "video": video},
            "_dir": Path(evidence_dir or "."),
            "_kind": "spec",
        })
    return rows


def data_uri(path: Path) -> str | None:
    try:
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()
    except Exception:  # noqa: BLE001
        return None


def counts(rows: list[dict]) -> dict:
    c = {"total": len(rows), "PASS": 0, "FAIL": 0, "ERROR": 0,
         "PASS_WITH_ERRORS": 0, "BLOCKED": 0}
    for r in rows:
        c[r.get("status", "PASS")] = c.get(r.get("status", "PASS"), 0) + 1
    return c


def md_to_html(text: str) -> str:
    """Minimal markdown rendering for the summary block - headings, lists, bold,
    code, tables, paragraphs. Good enough for a report preamble."""
    out, in_ul, in_table = [], False, False
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            if in_ul:
                out.append("</ul>"); in_ul = False
            if in_table:
                out.append("</tbody></table>"); in_table = False
            continue
        esc = html.escape(line)
        esc = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", esc)
        esc = re.sub(r"`(.+?)`", r"<code>\1</code>", esc)
        if m := re.match(r"^(#{1,4})\s+(.*)", esc):
            if in_ul:
                out.append("</ul>"); in_ul = False
            out.append(f"<h{len(m.group(1))+1}>{m.group(2)}</h{len(m.group(1))+1}>")
        elif esc.lstrip().startswith(("- ", "* ")):
            if not in_ul:
                out.append("<ul>"); in_ul = True
            out.append(f"<li>{esc.lstrip()[2:]}</li>")
        elif esc.startswith("|"):
            cells = [c.strip() for c in esc.strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                continue
            if not in_table:
                out.append("<table><tbody>"); in_table = True
            out.append("<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>")
        else:
            if in_ul:
                out.append("</ul>"); in_ul = False
            out.append(f"<p>{esc}</p>")
    if in_ul:
        out.append("</ul>")
    if in_table:
        out.append("</tbody></table>")
    return "\n".join(out)


CSS = """
:root{--bg:#fbfbfa;--fg:#1c1b19;--muted:#6b6862;--line:#e3e1dc;--card:#fff;
--pass:#1a7f4b;--passbg:#e8f5ee;--fail:#b4231f;--failbg:#fdeceb;
--warn:#8a6100;--warnbg:#fdf3e0;--accent:#2c5aa0;--code:#f3f1ee;}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
--bg:#191817;--fg:#eceae6;--muted:#a19d96;--line:#33312e;--card:#211f1e;
--pass:#5fcf90;--passbg:#15301f;--fail:#ff8a80;--failbg:#3a1c1a;
--warn:#e8bc63;--warnbg:#332713;--accent:#8fb4e8;--code:#2a2826;}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:15px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:40px 24px 80px}
h1{font-size:28px;line-height:1.25;margin:0 0 4px}
h2{font-size:20px;margin:40px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line)}
h3{font-size:16px;margin:24px 0 8px}
.meta{color:var(--muted);font-size:13px;margin-bottom:28px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:20px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card .n{font-size:26px;font-weight:650;line-height:1.1}
.card .l{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-top:4px}
.card.pass .n{color:var(--pass)}.card.fail .n{color:var(--fail)}.card.warn .n{color:var(--warn)}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:none}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:12px;font-weight:600;white-space:nowrap}
.b-pass{background:var(--passbg);color:var(--pass)}
.b-fail{background:var(--failbg);color:var(--fail)}
.b-warn{background:var(--warnbg);color:var(--warn)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
code{background:var(--code);padding:1px 5px;border-radius:4px}
pre{background:var(--code);padding:12px 14px;border-radius:8px;overflow-x:auto}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;
padding:12px 16px;margin:10px 0}
details.snap{background:var(--code);padding:8px 14px}
details.snap summary{font-weight:500;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--muted)}
details.snap pre{background:transparent;padding:8px 0 0}
details[open]{padding-bottom:18px}
summary{cursor:pointer;font-weight:600}
summary .badge{margin-right:8px}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:12px}
.shot{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--card)}
.shot img{display:block;width:100%;height:auto}
.shot .cap{padding:6px 10px;font-size:12px;color:var(--muted);border-top:1px solid var(--line)}
.summary{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px 20px 16px}
.err{color:var(--fail)}
.muted{color:var(--muted)}
"""


def observation(r: dict) -> str:
    """One-line summary for the results table - never multi-line, so it cannot
    break a markdown table row."""
    f = r.get("failure") or {}
    text = str(f.get("label") or f.get("expected") or f.get("actual") or f.get("error") or "")
    if not text and r.get("status") == "PASS_WITH_ERRORS":
        text = f'{len(r.get("pageErrors", []))} JS exception(s) logged'
    return " ".join(text.split())


def badge(status: str) -> str:
    cls = {"PASS": "b-pass", "PASS_WITH_ERRORS": "b-warn", "BLOCKED": "b-warn"}.get(status, "b-fail")
    return f'<span class="badge {cls}">{html.escape(STATUS_LABEL.get(status, status))}</span>'


def render_case_html(r: dict, embed: bool) -> str:
    parts = [f'<details{" open" if r.get("status") != "PASS" else ""}>']
    parts.append(f'<summary>{badge(r.get("status","PASS"))}'
                 f'<code>{html.escape(str(r.get("caseId")))}</code> '
                 f'{html.escape(str(r.get("title","")))}</summary>')

    env = r.get("environment") or {}
    if env or r.get("baseUrl"):
        bits = [f"{k}: {v}" for k, v in env.items() if v]
        if r.get("baseUrl"):
            bits.insert(0, f"baseURL: {r['baseUrl']}")
        parts.append(f'<p class="muted">{html.escape(" · ".join(bits))} · '
                     f'{r.get("durationMs",0)}ms</p>')

    if r.get("failure"):
        f = r["failure"]
        parts.append('<p class="err"><strong>Failure:</strong> '
                     + html.escape(str(f.get("label") or f.get("expected") or ""))
                     + "</p><pre>" + html.escape(str(f.get("actual") or f.get("error") or ""))
                     + "</pre>")

    rows = (r.get("steps") or []) + (r.get("checks") or [])
    rows.sort(key=lambda s: s.get("n", 0))
    if rows:
        parts.append('<div class="tablewrap"><table><thead><tr><th>#</th><th>Type</th>'
                     '<th>Step / expected result</th><th>Status</th></tr></thead><tbody>')
        for s in rows:
            parts.append(f'<tr><td>{s.get("n","")}</td><td>{html.escape(s.get("kind",""))}</td>'
                         f'<td>{html.escape(str(s.get("label","")))}'
                         + (f'<br><span class="err">{html.escape(str(s.get("error"))[:400])}</span>'
                            if s.get("error") else "")
                         + f'</td><td>{badge(s.get("status","PASS"))}</td></tr>')
        parts.append("</tbody></table></div>")

    if r.get("_kind") == "api" and r.get("checks"):
        parts.append('<div class="tablewrap"><table><thead><tr><th>#</th><th>Expected</th>'
                     '<th>Actual</th><th>Status</th></tr></thead><tbody>')
        for c in r["checks"]:
            parts.append(f'<tr><td>{c.get("n","")}</td><td>{html.escape(str(c.get("expected","")))}</td>'
                         f'<td>{html.escape(str(c.get("actual",""))[:300])}</td>'
                         f'<td>{badge(c.get("status","PASS"))}</td></tr>')
        parts.append("</tbody></table></div>")

    for ex in r.get("exchanges", [])[:20]:
        req, res = ex.get("request", {}), ex.get("response", {})
        body = json.dumps(req.get("body"), indent=2) if req.get("body") is not None else ""
        rbody = json.dumps(res.get("body"), indent=2) if isinstance(res.get("body"), (dict, list)) \
            else str(res.get("body", ""))
        parts.append("<pre>" + html.escape(
            f'{req.get("method","")} {req.get("url","")}\n{body}\n'
            f'--> HTTP {res.get("status")} ({res.get("elapsedMs")}ms)\n{rbody[:2000]}'
        ) + "</pre>")

    for label, key in (("Console errors", "consoleErrors"), ("Page exceptions", "pageErrors")):
        items = r.get(key) or []
        if items:
            parts.append(f"<h3>{label}</h3><pre>" + html.escape(
                "\n".join(str(i.get("text") or i.get("message")) for i in items[:20])) + "</pre>")

    failed = r.get("failedRequests") or []
    if failed:
        parts.append("<h3>Failed requests</h3><pre>" + html.escape("\n".join(
            f'{i.get("method","")} {i.get("status") or i.get("failure")} {i.get("url","")}'
            for i in failed[:20])) + "</pre>")

    snaps = [Path(p) for p in (r.get("artifacts", {}).get("snapshots") or [])]
    snaps = [p for p in snaps if p.exists()]
    if snaps:
        parts.append("<h3>Page snapshots</h3>")
        parts.append('<p class="muted">The accessibility tree as it stood at each step - '
                     'what the tester actually asserted against.</p>')
        for p in snaps:
            try:
                body = p.read_text(errors="replace")
            except Exception:  # noqa: BLE001
                continue
            trimmed = body if len(body) <= 6000 else body[:6000] + "\n... (truncated)"
            parts.append(f'<details class="snap"><summary>{html.escape(p.name)}</summary>'
                         f"<pre>{html.escape(trimmed)}</pre></details>")

    shots = [Path(p) for p in (r.get("artifacts", {}).get("screenshots") or [])]
    shots = [p for p in shots if p.exists()]
    if shots:
        parts.append('<h3>Screenshots</h3><div class="shots">')
        for p in shots:
            src = data_uri(p) if embed else p.as_posix()
            if src:
                parts.append(f'<figure class="shot"><img src="{src}" alt="{html.escape(p.stem)}">'
                             f'<figcaption class="cap">{html.escape(p.name)}</figcaption></figure>')
        parts.append("</div>")

    parts.append("</details>")
    return "\n".join(parts)


def build_html(rows, title, summary_md, embed):
    c = counts(rows)
    failed = c["FAIL"] + c["ERROR"]
    cards = [
        ("total", c["total"], "Cases", ""),
        ("pass", c["PASS"] + c["PASS_WITH_ERRORS"], "Passed", "pass"),
        ("fail", failed, "Failed", "fail" if failed else ""),
        ("blocked", c["BLOCKED"], "Blocked", "warn" if c["BLOCKED"] else ""),
    ]
    head = "".join(
        f'<div class="card {cls}"><div class="n">{n}</div><div class="l">{lbl}</div></div>'
        for _, n, lbl, cls in cards)

    table = ['<div class="tablewrap"><table><thead><tr><th>Case</th><th>Title</th>'
             '<th>Type</th><th>Status</th><th>Observation</th></tr></thead><tbody>']
    for r in rows:
        obs = observation(r)
        table.append(f'<tr><td><code>{html.escape(str(r.get("caseId")))}</code></td>'
                     f'<td>{html.escape(str(r.get("title","")))}</td>'
                     f'<td>{r.get("_kind","").upper()}</td>'
                     f'<td>{badge(r.get("status","PASS"))}</td>'
                     f'<td>{html.escape(obs[:200])}</td></tr>')
    table.append("</tbody></table></div>")

    body = [f'<div class="wrap"><h1>{html.escape(title)}</h1>',
            f'<p class="meta">Generated {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")} '
            f'from {c["total"]} recorded case(s)</p>']
    if summary_md:
        body.append(f'<div class="summary">{md_to_html(summary_md)}</div>')
    body.append(f'<div class="cards">{head}</div>')
    body.append("<h2>Results</h2>")
    body.append("\n".join(table))
    body.append("<h2>Case detail and evidence</h2>")
    body.extend(render_case_html(r, embed) for r in rows)
    body.append("</div>")

    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{html.escape(title)}</title><style>{CSS}</style></head><body>'
            + "\n".join(body) + "</body></html>")


def build_md(rows, title, summary_md):
    c = counts(rows)
    out = [f"# {title}", "",
           f"_Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} "
           f"from {c['total']} recorded case(s)._", ""]
    if summary_md:
        out += [summary_md, ""]
    out += ["## Results", "",
            f"| Total | Passed | Failed | Blocked |", "| --- | --- | --- | --- |",
            f"| {c['total']} | {c['PASS'] + c['PASS_WITH_ERRORS']} | "
            f"{c['FAIL'] + c['ERROR']} | {c['BLOCKED']} |", "",
            "| Case | Title | Type | Status | Observation |",
            "| --- | --- | --- | --- | --- |"]
    for r in rows:
        obs = observation(r).replace("|", "\\|")
        out.append(f"| `{r.get('caseId')}` | {r.get('title','')} | {r.get('_kind','').upper()} | "
                   f"{STATUS_LABEL.get(r.get('status'), r.get('status'))} | {obs[:160]} |")
    out += ["", "## Case detail", ""]
    for r in rows:
        out.append(f"### {r.get('caseId')} - {r.get('title','')} "
                   f"({STATUS_LABEL.get(r.get('status'), r.get('status'))})")
        steps = sorted((r.get("steps") or []) + (r.get("checks") or []),
                       key=lambda s: s.get("n", 0))
        for s in steps:
            mark = "x" if s.get("status") == "PASS" else "!"
            out.append(f"- [{mark}] ({s.get('kind','check')}) {s.get('label') or s.get('expected')}"
                       + (f" -> {s.get('error') or s.get('actual')}"
                          if s.get("status") != "PASS" else ""))
        art = r.get("artifacts", {})
        for p in art.get("snapshots") or []:
            out.append(f"- Page snapshot: `{p}`")
        if art.get("dir"):
            out.append(f"- Evidence: `{art['dir']}`")
        out.append("")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("results_dir", help="directory containing <case>/result.json")
    ap.add_argument("--title", default="QA Test Report")
    ap.add_argument("--summary", help="markdown file placed above the tables")
    ap.add_argument("--out", default="qa-report.html")
    ap.add_argument("--format", choices=["html", "md"], default="html")
    ap.add_argument("--no-embed", action="store_true",
                    help="link screenshots instead of embedding them")
    ap.add_argument("--playwright-json",
                    help="also ingest `npx playwright test --reporter=json` output")
    a = ap.parse_args()

    root = Path(a.results_dir).resolve()
    rows = load_results(root)
    if a.playwright_json:
        rows += load_playwright_json(Path(a.playwright_json))
        rows.sort(key=lambda r: (STATUS_ORDER.get(r.get("status", "PASS"), 9),
                                 r.get("caseId", "")))
    if not rows:
        raise SystemExit(
            f"No results found under {root}"
            + (f" or in {a.playwright_json}" if a.playwright_json else ""))

    summary_md = Path(a.summary).read_text() if a.summary and Path(a.summary).exists() else ""
    content = (build_md(rows, a.title, summary_md) if a.format == "md"
               else build_html(rows, a.title, summary_md, not a.no_embed))

    out = Path(a.out)
    out.write_text(content)
    c = counts(rows)
    print(f"Wrote {out}  ({c['total']} cases: {c['PASS'] + c['PASS_WITH_ERRORS']} pass, "
          f"{c['FAIL'] + c['ERROR']} fail, {c['BLOCKED']} blocked)")


if __name__ == "__main__":
    main()
