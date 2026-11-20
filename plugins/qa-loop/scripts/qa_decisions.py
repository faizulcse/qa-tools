#!/usr/bin/env python3
"""qa_decisions.py - remember what the user, BA or team decided about a ticket.

    add KEY --type TYPE --text "..." [--match REGEX] [--source "BA, 20 Nov"]
    add --global --type TYPE --text "..." [--match REGEX]      # applies to every ticket
    list [KEY]
    remove KEY ID | remove --global ID

TYPE is one of:
    expected     the behaviour is intended; don't report it as an issue
    ignore       the user said to leave it out of reports and comments
    out_of_scope fixed or tracked elsewhere (e.g. "fix this in another ticket")
    ac_wording   the AC text is wrong; test against the stated intent
    ba           a BA / product decision to quote when relevant
    note         anything else worth remembering

--match is a case-insensitive regex. qa_results.py check flags any reported
issue or failing AC whose text matches an expected / ignore / out_of_scope
decision, and qa_results.py render lists the decisions it applied.

Stored in docs/KEY/decisions.json and docs/decisions.json (global).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

DOCS_DIR = Path(os.environ.get("QA_LOOP_DOCS_DIR") or os.environ.get("JIRA_SPRINT_DOCS_DIR") or "docs")
TYPES = ["expected", "ignore", "out_of_scope", "ac_wording", "ba", "note"]
SUPPRESSING = {"expected", "ignore", "out_of_scope"}
LABEL = {"expected": "Expected (not an issue)", "ignore": "Left out on request", "out_of_scope": "Out of scope",
         "ac_wording": "AC wording", "ba": "BA decision", "note": "Note"}


def path_for(key: str | None) -> Path:
    return DOCS_DIR / "decisions.json" if not key else DOCS_DIR / key / "decisions.json"


def load(key: str | None) -> list[dict]:
    p = path_for(key)
    return json.loads(p.read_text()) if p.exists() else []


def save(key: str | None, rows: list[dict]) -> None:
    p = path_for(key)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")


def for_ticket(key: str) -> list[dict]:
    """Ticket decisions first, then global ones (marked)."""
    return load(key) + [dict(d, scope="global") for d in load(None)]


def matches(decision: dict, text: str) -> bool:
    pat = decision.get("match")
    return bool(pat) and re.search(pat, text or "", re.I) is not None


def cmd_add(a) -> int:
    key = None if a.glob else a.key
    if not key and not a.glob:
        sys.exit("ERROR: give a ticket KEY or --global")
    if a.match:
        re.compile(a.match)
    rows = load(key)
    rid = max([r["id"] for r in rows], default=0) + 1
    rows.append({"id": rid, "type": a.type, "text": a.text, "match": a.match, "source": a.source,
                 "date": dt.date.today().isoformat()})
    save(key, rows)
    print(f"decision #{rid} ({'global' if key is None else key}): {LABEL[a.type]} – {a.text}")
    return 0


def cmd_list(a) -> int:
    rows = for_ticket(a.key) if a.key else load(None)
    if not rows:
        print("no decisions recorded")
        return 0
    print("| # | Scope | Type | Decision | Match | Source |\n|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['id']} | {r.get('scope', a.key or 'global')} | {LABEL[r['type']]} | {r['text']} | "
              f"{r.get('match') or '-'} | {r.get('source') or '-'} ({r['date']}) |")
    return 0


def cmd_remove(a) -> int:
    key = None if a.glob else a.key
    rows = load(key)
    left = [r for r in rows if r["id"] != a.id]
    if len(left) == len(rows):
        sys.exit(f"ERROR: no decision #{a.id}")
    save(key, left)
    print(f"removed decision #{a.id}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    ad = sub.add_parser("add")
    ad.add_argument("key", nargs="?")
    ad.add_argument("--global", dest="glob", action="store_true")
    ad.add_argument("--type", choices=TYPES, required=True)
    ad.add_argument("--text", required=True)
    ad.add_argument("--match")
    ad.add_argument("--source")
    ad.set_defaults(fn=cmd_add)
    ls = sub.add_parser("list")
    ls.add_argument("key", nargs="?")
    ls.set_defaults(fn=cmd_list)
    rm = sub.add_parser("remove")
    rm.add_argument("key", nargs="?")
    rm.add_argument("id", type=int)
    rm.add_argument("--global", dest="glob", action="store_true")
    rm.set_defaults(fn=cmd_remove)
    a = ap.parse_args()
    return a.fn(a) or 0


if __name__ == "__main__":
    sys.exit(main())
