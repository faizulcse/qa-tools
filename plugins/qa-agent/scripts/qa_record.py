#!/usr/bin/env python3
"""qa_record.py - record a test case as you execute it with playwright-cli.

playwright-cli drives the browser; this records what happened in the shape the
rest of the plugin consumes (build_report.py, and the evidence section of a bug
report). One case at a time, appended step by step, so a run that is abandoned
half way still leaves usable evidence on disk.

    # start the case
    qa_record.py start TC-07 --title "Expired discount code is rejected" \
        --base-url https://staging.example.com --browser chromium

    # ... playwright-cli open, snapshot --filename=..., click, fill ...
    # then record what you observed, attaching the saved page snapshot
    qa_record.py step  TC-07 "Open the checkout page" \
        --screenshot $OUT/01.png --snapshot $OUT/01.snapshot.md
    qa_record.py step  TC-07 "Enter OLD2019 and click Apply" \
        --screenshot $OUT/02.png --snapshot $OUT/02.snapshot.md
    qa_record.py check TC-07 'Inline error reads "This code has expired"' \
        --fail --actual 'Green "Discount applied" shown; total changed to $96.00' \
        --screenshot $OUT/02.png --snapshot $OUT/02.snapshot.md

    # fold in whatever playwright-cli captured
    qa_record.py evidence TC-07 --console console.txt --requests requests.txt \
        --trace trace.zip

    qa_record.py finish TC-07

Anything not passed is inferred: a case with a failed check finishes FAIL, a
clean case finishes PASS, and a case with page errors finishes PASS_WITH_ERRORS.

Environment: QA_OUT_DIR (default ./qa-results) sets where cases are written.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slug(s: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(s).lower()))[:60]


def case_dir(case_id: str, out_dir: str | None) -> Path:
    root = Path(out_dir or os.environ.get("QA_OUT_DIR", "./qa-results")).resolve()
    d = root / slug(case_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def load(case_id: str, out_dir: str | None) -> tuple[Path, dict]:
    d = case_dir(case_id, out_dir)
    f = d / "result.json"
    if not f.exists():
        sys.exit(f"ERROR: no case started for {case_id}. Run: qa_record.py start {case_id} --title ...")
    return f, json.loads(f.read_text())


def save(f: Path, r: dict) -> None:
    f.write_text(json.dumps(r, indent=2, default=str))


def next_n(r: dict) -> int:
    return max([s.get("n", 0) for s in r["steps"] + r["checks"]] + [0]) + 1


def add_artifact(r: dict, bucket: str, path: str | None) -> str | None:
    """Register an artifact path once, and warn if it is not on disk - a missing
    screenshot or snapshot in the evidence list is worse than none."""
    if not path:
        return None
    r["artifacts"].setdefault(bucket, [])
    p = str(Path(path).resolve())
    if not Path(path).exists():
        print(f"  warning: {bucket[:-1]} not found on disk: {path}")
    if p not in r["artifacts"][bucket]:
        r["artifacts"][bucket].append(p)
    return p


def add_screenshot(r: dict, path: str | None) -> str | None:
    return add_artifact(r, "screenshots", path)


def add_snapshot(r: dict, path: str | None) -> str | None:
    return add_artifact(r, "snapshots", path)


# --------------------------------------------------------------------------- #


def cmd_start(a):
    d = case_dir(a.case_id, a.out)
    result = {
        "caseId": a.case_id,
        "title": a.title,
        "status": "PASS",
        "startedAt": now(),
        "finishedAt": None,
        "durationMs": 0,
        "environment": {
            "baseURL": a.base_url,
            "browser": a.browser,
            "viewport": a.viewport,
            "headless": not a.headed,
        },
        "priority": a.priority,
        "covers": [c.strip() for c in (a.covers or "").split(",") if c.strip()],
        "steps": [],
        "checks": [],
        "consoleErrors": [],
        "pageErrors": [],
        "failedRequests": [],
        "failure": None,
        "artifacts": {"dir": str(d), "screenshots": [], "snapshots": [],
                      "trace": None, "video": None},
    }
    save(d / "result.json", result)
    print(f"started {a.case_id} -> {d}")


def record(a, kind: str):
    f, r = load(a.case_id, a.out)
    failed = bool(a.fail) or (a.status == "fail")
    n = next_n(r)
    entry = {
        "n": n,
        "kind": kind,
        "label": a.label,
        "expected": a.label if kind == "check" else None,
        "status": "FAIL" if failed else "PASS",
        "at": now(),
        "durationMs": a.ms or 0,
        "url": a.url,
        "error": a.actual if failed else None,
        "screenshot": add_screenshot(r, a.screenshot),
        "snapshot": add_snapshot(r, a.snapshot),
    }
    (r["checks"] if kind == "check" else r["steps"]).append(entry)
    if failed:
        r["status"] = "FAIL"
        if r["failure"] is None:
            r["failure"] = {"atStep": n, "label": a.label,
                            "expected": entry["expected"], "actual": a.actual,
                            "error": a.actual}
    save(f, r)
    print(f"[{entry['status']}] {kind} {n}: {a.label}")


def cmd_step(a):
    record(a, "step")


def cmd_check(a):
    record(a, "check")


# playwright-cli decorates its output with a box-drawn update banner and result
# headers; neither is evidence.
NOISE = re.compile(r"^\s*(?:[─-╿]|###\s|Total messages:|Note:\s|Update available|Run `npm)")


def read_lines(path: str | None, limit: int = 200) -> list[str]:
    if not path:
        return []
    p = Path(path)
    if not p.exists():
        print(f"  warning: not found: {p}")
        return []
    out = []
    for line in p.read_text(errors="replace").splitlines():
        line = line.rstrip()
        if not line.strip() or NOISE.match(line):
            continue
        out.append(line)
    return out[:limit]


def cmd_evidence(a):
    f, r = load(a.case_id, a.out)

    for line in read_lines(a.console):
        bucket = "pageErrors" if re.search(r"\b(uncaught|unhandled|TypeError|ReferenceError)\b",
                                           line, re.I) else "consoleErrors"
        key = "message" if bucket == "pageErrors" else "text"
        r[bucket].append({"at": now(), key: line})

    for line in read_lines(a.requests):
        m = re.search(r"\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b\s+(\S+)", line)
        st = re.search(r"\b([45]\d\d)\b", line)
        if m and (st or re.search(r"fail|abort|refused|timeout", line, re.I)):
            r["failedRequests"].append({
                "at": now(), "method": m.group(1), "url": m.group(2),
                "status": int(st.group(1)) if st else None,
                "failure": None if st else line[:200],
            })

    for path in a.screenshot or []:
        add_screenshot(r, path)
    for path in a.snapshot or []:
        add_snapshot(r, path)
    if a.trace:
        r["artifacts"]["trace"] = str(Path(a.trace).resolve())
    if a.video:
        r["artifacts"]["video"] = str(Path(a.video).resolve())
    for kv in a.note or []:
        k, _, v = kv.partition("=")
        r.setdefault("notes", {})[k] = v
    save(f, r)
    print(f"evidence added to {a.case_id}: "
          f"{len(r['consoleErrors'])} console, {len(r['pageErrors'])} page errors, "
          f"{len(r['failedRequests'])} failed requests, "
          f"{len(r['artifacts']['screenshots'])} screenshots, "
          f"{len(r['artifacts'].get('snapshots', []))} snapshots")


def cmd_finish(a):
    f, r = load(a.case_id, a.out)
    if a.status:
        r["status"] = a.status.upper()
    elif r["status"] == "PASS" and r["pageErrors"]:
        r["status"] = "PASS_WITH_ERRORS"
    if a.blocked:
        r["status"] = "BLOCKED"
        r["failure"] = r["failure"] or {"label": "Blocked", "actual": a.blocked,
                                        "error": a.blocked}
    r["finishedAt"] = now()
    try:
        t0 = datetime.fromisoformat(r["startedAt"])
        r["durationMs"] = int((datetime.fromisoformat(r["finishedAt"]) - t0).total_seconds() * 1000)
    except Exception:  # noqa: BLE001
        pass
    save(f, r)
    print(f"[{r['status']}] {r['caseId']} - {r['title']}")
    for s in sorted(r["steps"] + r["checks"], key=lambda x: x.get("n", 0)):
        mark = "  ok  " if s["status"] == "PASS" else "  FAIL"
        print(f"{mark} {s['kind']}: {s['label']}")
        if s["status"] == "FAIL" and s.get("error"):
            print(f"        actual: {s['error']}")
    art = r["artifacts"]
    print(f"   evidence: {art['dir']}  "
          f"({len(art.get('screenshots', []))} screenshots, "
          f"{len(art.get('snapshots', []))} page snapshots)")
    if not art.get("snapshots"):
        print("   note: no page snapshot saved - run `playwright-cli snapshot "
              "--filename=<case-dir>/NN-<label>.snapshot.md` alongside each step")


def cmd_show(a):
    _, r = load(a.case_id, a.out)
    print(json.dumps(r, indent=2))


# --------------------------------------------------------------------------- #


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", help="results directory (default $QA_OUT_DIR or ./qa-results)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    st = sub.add_parser("start", help="begin recording a case")
    st.add_argument("case_id")
    st.add_argument("--title", required=True)
    st.add_argument("--base-url")
    st.add_argument("--browser", default="chromium")
    st.add_argument("--viewport", default="1440x900")
    st.add_argument("--headed", action="store_true")
    st.add_argument("--priority")
    st.add_argument("--covers", help="comma-separated requirement IDs, e.g. AC-4,IMP-2")
    st.set_defaults(fn=cmd_start)

    for name, fn, helptext in (("step", cmd_step, "record an action you performed"),
                               ("check", cmd_check, "record an assertion (label = expected result)")):
        p = sub.add_parser(name, help=helptext)
        p.add_argument("case_id")
        p.add_argument("label")
        p.add_argument("--fail", action="store_true")
        p.add_argument("--status", choices=["pass", "fail"])
        p.add_argument("--actual", help="what actually happened (required when failing)")
        p.add_argument("--screenshot")
        p.add_argument("--snapshot",
                       help="page snapshot saved with `playwright-cli snapshot --filename=...`")
        p.add_argument("--url")
        p.add_argument("--ms", type=int)
        p.set_defaults(fn=fn)

    ev = sub.add_parser("evidence", help="attach console/network/trace/video artifacts")
    ev.add_argument("case_id")
    ev.add_argument("--console", help="file of `playwright-cli console` output")
    ev.add_argument("--requests", help="file of `playwright-cli requests` output")
    ev.add_argument("--screenshot", action="append")
    ev.add_argument("--snapshot", action="append",
                    help="saved page snapshot file, repeatable")
    ev.add_argument("--trace")
    ev.add_argument("--video")
    ev.add_argument("--note", action="append", help="key=value, repeatable")
    ev.set_defaults(fn=cmd_evidence)

    fi = sub.add_parser("finish", help="close the case and print the summary")
    fi.add_argument("case_id")
    fi.add_argument("--status", choices=["pass", "fail", "blocked", "error",
                                         "pass_with_errors"])
    fi.add_argument("--blocked", help="reason the case could not be executed")
    fi.set_defaults(fn=cmd_finish)

    sh = sub.add_parser("show", help="print the recorded result.json")
    sh.add_argument("case_id")
    sh.set_defaults(fn=cmd_show)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
