#!/usr/bin/env python3
"""qa_ledger.py - record every test-data change, then prove it was restored.

    add --key KEY --env dev --what "Session length" --before "6 min" --to "5 min"
        --restore "Settings → Impersonation Session → Custom 6 → Save"
        [--check "shell command that prints the current value"]
    restore ID [--value "6 min"] [--note ...]   # put back (value defaults to --before)
    (check marks a value someone else changed as 'external': not QA's to restore)
    keep ID --note "why it stays changed"       # e.g. needs another approver
    list [--key KEY] [--all]
    check [--key KEY]       # runs each --check command: restored / still changed / changed by someone else
    report --key KEY        # the "Test data" lines for a report or Jira comment

The ledger lives in .qa-loop/ledger.json in the project (git-ignored).
Values are plain text; never put passwords, codes or tokens in them.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

STATE_DIR = Path(os.environ.get("QA_LOOP_STATE_DIR", ".qa-loop"))
LEDGER = STATE_DIR / "ledger.json"


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def load() -> list[dict]:
    return json.loads(LEDGER.read_text()) if LEDGER.exists() else []


def save(rows: list[dict]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")


def get(rows, rid: int) -> dict:
    for r in rows:
        if r["id"] == rid:
            return r
    print(f"ERROR: no ledger entry #{rid}", file=sys.stderr)
    sys.exit(1)


def cmd_add(a) -> int:
    rows = load()
    rid = max([r["id"] for r in rows], default=0) + 1
    rows.append({"id": rid, "key": a.key, "env": a.env, "what": a.what, "before": a.before,
                 "changed_to": a.to, "restore": a.restore, "check": a.check,
                 "status": "open", "created": now(), "notes": []})
    save(rows)
    print(f"ledger #{rid}: {a.what} ({a.env}) {a.before} → {a.to} [open]")
    return 0


def cmd_restore(a) -> int:
    rows = load()
    r = get(rows, a.id)
    r.update(status="restored", restored_value=a.value or r["before"], restored_at=now())
    if a.note:
        r["notes"].append(a.note)
    save(rows)
    print(f"ledger #{a.id}: {r['what']} restored to {r['restored_value']}")
    return 0


def cmd_keep(a) -> int:
    rows = load()
    r = get(rows, a.id)
    r.update(status="kept", kept_at=now())
    r["notes"].append(a.note)
    save(rows)
    print(f"ledger #{a.id}: {r['what']} left changed – {a.note}")
    return 0


def cmd_list(a) -> int:
    rows = [r for r in load() if (a.all or r["status"] not in ("restored", "external")) and (not a.key or r["key"] == a.key)]
    if not rows:
        print("ledger: nothing " + ("recorded" if a.all else "open"))
        return 0
    print("| # | Ticket | Env | What | Before | Changed to | Status | Restore |\n|---|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['id']} | {r['key'] or '-'} | {r['env'] or '-'} | {r['what']} | {r['before'] or '-'} | "
              f"{r['changed_to'] or '-'} | {r['status']} | {r['restore'] or '-'} |")
    return 0


def run_check(cmd: str) -> str | None:
    try:
        out = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip().strip('"')


def cmd_check(a) -> int:
    rows = [r for r in load() if not a.key or r["key"] == a.key]
    bad = 0
    for r in rows:
        label = f"#{r['id']} {r['what']} ({r['env'] or '-'})"
        if not r.get("check"):
            state = {"open": "NOT RESTORED (no check command)", "kept": "kept on purpose",
                     "external": f"changed by someone else (last seen {r.get('current')})"}.get(r["status"], "restored (not verified)")
            if r["status"] == "open":
                bad += 1
            print(f"{label}: {state}")
            continue
        cur = run_check(r["check"])
        if cur is None:
            print(f"{label}: check command failed – verify by hand")
            bad += 1
            continue
        if cur == (r.get("restored_value") or r["before"]):
            print(f"{label}: restored ✓ (now {cur})")
            if r["status"] == "open":
                r.update(status="restored", restored_value=cur, restored_at=now())
        elif cur == r["changed_to"]:
            print(f"{label}: STILL CHANGED (now {cur}) – restore: {r['restore'] or '-'}")
            bad += r["status"] != "kept"
        else:
            print(f"{label}: CHANGED BY SOMEONE ELSE (now {cur}; was {r['before']}, QA set {r['changed_to']}) – leave it and mention it")
            r["notes"].append(f"{now()}: found {cur}, changed outside QA")
            r.update(status="external", current=cur, checked_at=now())
    save(load_merge(rows))
    return 1 if bad else 0


def load_merge(updated: list[dict]) -> list[dict]:
    by_id = {r["id"]: r for r in updated}
    return [by_id.get(r["id"], r) for r in load()]


def cmd_report(a) -> int:
    rows = [r for r in load() if r["key"] == a.key]
    if not rows:
        print("_Test data: nothing was changed._")
        return 0
    print("Test data:")
    for r in rows:
        if r["status"] == "restored":
            print(f"- {r['what']} ({r['env'] or '-'}): {r['before']} → {r['changed_to']} → **restored** ({r.get('restored_value')}).")
        elif r["status"] == "external":
            print(f"- {r['what']} ({r['env'] or '-'}): set to {r['changed_to']} for the test (was {r['before']}); "
                  f"now {r.get('current')}, changed by someone else afterwards – left as is.")
        elif r["status"] == "kept":
            print(f"- {r['what']} ({r['env'] or '-'}): left at {r['changed_to']} – {r['notes'][-1] if r['notes'] else 'kept'}.")
        else:
            print(f"- {r['what']} ({r['env'] or '-'}): **still {r['changed_to']}** (was {r['before']}) – not restored yet.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    ad = sub.add_parser("add")
    ad.add_argument("--key")
    ad.add_argument("--env")
    ad.add_argument("--what", required=True)
    ad.add_argument("--before", required=True)
    ad.add_argument("--to", required=True)
    ad.add_argument("--restore", help="how to put it back")
    ad.add_argument("--check", help="shell command printing the current value")
    ad.set_defaults(fn=cmd_add)
    rs = sub.add_parser("restore")
    rs.add_argument("id", type=int)
    rs.add_argument("--value")
    rs.add_argument("--note")
    rs.set_defaults(fn=cmd_restore)
    kp = sub.add_parser("keep")
    kp.add_argument("id", type=int)
    kp.add_argument("--note", required=True)
    kp.set_defaults(fn=cmd_keep)
    ls = sub.add_parser("list")
    ls.add_argument("--key")
    ls.add_argument("--all", action="store_true")
    ls.set_defaults(fn=cmd_list)
    ck = sub.add_parser("check")
    ck.add_argument("--key")
    ck.set_defaults(fn=cmd_check)
    rp = sub.add_parser("report")
    rp.add_argument("--key", required=True)
    rp.set_defaults(fn=cmd_report)
    a = ap.parse_args()
    return a.fn(a) or 0


if __name__ == "__main__":
    sys.exit(main())
