#!/usr/bin/env python3
"""qa_changes.py - is a ticket ready to retest, and what is still open?

    since-mine KEY [--since ISO] [--json]
        Everything on KEY after my last comment: other people's comments,
        status / assignee changes and edits to the description, summary or
        acceptance criteria (with a line diff). Ends with a one-line hint:
        a developer said it is ready, the ACs changed, or nothing new.

    open-items [--key KEY] [--no-jira]
        Per ticket folder under docs/: comment drafts that were never posted
        (or changed after posting) and test-data changes in the ledger that
        are not restored yet. A draft counts as posted when qa-loop posted it,
        a matching "-posted" copy exists, or one of my Jira comments on the
        ticket has (nearly) the same text. Shows each ticket's status.

Read-only. Credentials come from .env through qa-agent's jira_client.py.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _qa_agent import jira  # noqa: E402

DOCS_DIR = Path(os.environ.get("QA_LOOP_DOCS_DIR") or os.environ.get("JIRA_SPRINT_DOCS_DIR") or "docs")
STATE_DIR = Path(os.environ.get("QA_LOOP_STATE_DIR", ".qa-loop"))
READY_RE = re.compile(r"(?i)\b(ready for (re)?test(ing)?|deployed|fixed|resolved|please (re)?check|done)\b")
WATCH_FIELDS = {"status", "assignee", "description", "summary", "labels", "Sprint", "resolution"}


def me():
    s, r = jira().api("GET", "/rest/api/2/myself")
    jira().expect_ok(s, r, "Reading /myself")
    return r


def short(text: str, n=500) -> str:
    text = re.sub(r"\[~accountid:[^\]]+\]", "@someone", text or "")
    text = re.sub(r"\s*\n+\s*", " · ", text).strip(" ·")
    return text if len(text) <= n else text[:n] + " …"


def cmd_since_mine(a) -> int:
    jc = jira()
    ac_field = os.environ.get("JIRA_AC_FIELD")
    fields = "summary,status,assignee,description,comment" + (f",{ac_field}" if ac_field else "")
    s, issue = jc.api("GET", f"/rest/api/2/issue/{a.key}", params={"fields": fields, "expand": "changelog"})
    jc.expect_ok(s, issue, f"Reading {a.key}")
    f = issue["fields"]
    myself = me()
    my_id = myself.get("accountId") or myself.get("name")

    comments = (f.get("comment") or {}).get("comments") or []
    mine = [c for c in comments if (c.get("author") or {}).get("accountId", (c.get("author") or {}).get("name")) == my_id]
    since = a.since or (mine[-1]["created"] if mine else None)

    def after(ts):
        return since is None or ts > since

    others = [c for c in comments if after(c["created"]) and c not in mine]
    changes = []
    for h in (issue.get("changelog") or {}).get("histories") or []:
        if not after(h["created"]):
            continue
        who = (h.get("author") or {}).get("displayName", "?")
        for it in h.get("items") or []:
            name = it.get("field")
            if name in WATCH_FIELDS or (ac_field and it.get("fieldId") == ac_field):
                changes.append({"at": h["created"], "who": who, "field": name,
                                "from": it.get("fromString") or "", "to": it.get("toString") or ""})

    changes.sort(key=lambda c: c["at"])
    if a.json:
        print(json.dumps({"key": a.key, "since": since, "status": f["status"]["name"],
                          "comments": [{"at": c["created"], "who": c["author"]["displayName"],
                                        "text": short(jc.jira_to_text(c.get("body")) if hasattr(jc, "jira_to_text") else c.get("body"), 2000)}
                                       for c in others],
                          "changes": changes}, indent=2))
        return 0

    print(f"# {a.key} – {f.get('summary')}")
    print(f"Status: **{f['status']['name']}** · Assignee: {(f.get('assignee') or {}).get('displayName', '-')}")
    print(f"Since: {since or 'the start (no comment from me yet)'}\n")

    print(f"## Comments from others ({len(others)})")
    for c in others:
        body = jc.jira_to_text(c.get("body")) if hasattr(jc, "jira_to_text") else c.get("body")
        print(f"- **{c['author']['displayName']}** at {c['created'][:16].replace('T', ' ')}: {short(body, 400)}")
    if not others:
        print("- none")

    print(f"\n## Field changes ({len(changes)})")
    for ch in changes:
        stamp = f"{ch['at'][:16].replace('T', ' ')} · {ch['who']}"
        if ch["field"] in ("description", "summary") or (ac_field and ch["field"] not in WATCH_FIELDS):
            print(f"- {stamp} changed **{ch['field']}**:")
            diff = difflib.unified_diff(ch["from"].splitlines(), ch["to"].splitlines(), lineterm="", n=0)
            lines = [d for d in diff if not d.startswith(("---", "+++", "@@"))]
            for d in lines[:40]:
                print(f"    {d}")
        else:
            print(f"- {stamp}: **{ch['field']}** {ch['from'] or '-'} → {ch['to'] or '-'}")
    if not changes:
        print("- none")

    ready = [c for c in others if READY_RE.search(jc.jira_to_text(c.get("body")) if hasattr(jc, "jira_to_text") else (c.get("body") or ""))]
    ac_changed = any(c["field"] in ("description",) or (ac_field and c["field"] not in WATCH_FIELDS) for c in changes)
    print("\n## Hint")
    if ready:
        print(f"- A comment says it's ready ({ready[-1]['author']['displayName']}, {ready[-1]['created'][:16].replace('T', ' ')}) → retest.")
    if ac_changed:
        print("- The description / acceptance criteria changed → re-read the ACs before testing.")
    if not ready and not ac_changed:
        print("- Nothing says it's ready for retest yet.")
    return 0


# --------------------------------------------------------------------------- #
# open items


def norm(name: str) -> str:
    n = name.replace("draft", "posted")
    n = re.sub(r"-\d{4}-\d{2}-\d{2}[a-z]?", "", n)
    n = re.sub(r"-\d+(?=\.md$)", "", n)
    return n


def posted_log() -> dict:
    f = STATE_DIR / "comments.jsonl"
    out = {}
    if f.exists():
        for line in f.read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                out[str(Path(r["draft"]))] = r
    return out


def open_drafts(folder: Path, log: dict):
    files = [p for p in folder.glob("*.md")]
    posted = [p for p in files if "posted" in p.name]
    rows = []
    for d in sorted(p for p in files if "draft" in p.name):
        rec = log.get(str(d))
        match = rec and Path(rec["posted_copy"])
        if not match:
            cands = [p for p in posted if norm(p.name) == norm(d.name)]
            match = max(cands, key=lambda p: p.stat().st_mtime) if cands else None
        if not match:
            rows.append((d, "not posted"))
        elif match.exists() and d.read_text().strip() != match.read_text().strip() and d.stat().st_mtime > match.stat().st_mtime:
            rows.append((d, f"changed after posting ({match.name})"))
    return rows


def ledger_open():
    f = STATE_DIR / "ledger.json"
    if not f.exists():
        return []
    return [e for e in json.loads(f.read_text()) if e.get("status") == "open"]


def _flat(text: str) -> str:
    text = re.sub(r"(?m)^h[1-6]\.\s*", "", text or "")
    text = re.sub(r"[*_|{}#\[\]`]", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def my_comment_texts(key: str, my_id: str) -> list[str]:
    jc = jira()
    s, r = jc.api("GET", f"/rest/api/2/issue/{key}/comment", params={"maxResults": 200})
    if s >= 400:
        return []
    out = []
    for c in r.get("comments") or []:
        a = c.get("author") or {}
        if (a.get("accountId") or a.get("name")) == my_id:
            body = c.get("body")
            out.append(_flat(jc.jira_to_text(body) if hasattr(jc, "jira_to_text") and not isinstance(body, str) else body))
    return out


def posted_on_jira(draft: Path, key: str, mine: list[str]) -> bool:
    jc = jira()
    md = draft.read_text()
    if hasattr(jc, "strip_own_key"):
        md, _ = jc.strip_own_key(md, key)
    d = _flat(jc.md_to_jira(md))
    for c in mine:
        if difflib.SequenceMatcher(None, d, c).quick_ratio() >= 0.9 and difflib.SequenceMatcher(None, d, c).ratio() >= 0.85:
            return True
    return False


def cmd_open_items(a) -> int:
    log = posted_log()
    by_key: dict[str, list[str]] = {}
    check_jira = not a.no_jira
    my_id = None
    if check_jira:
        m = me()
        my_id = m.get("accountId") or m.get("name")
    statuses = {}
    if DOCS_DIR.exists():
        for folder in sorted(p for p in DOCS_DIR.iterdir() if p.is_dir()):
            if a.key and folder.name != a.key:
                continue
            rows = open_drafts(folder, log)
            is_key = re.match(r"^[A-Z][A-Z0-9]+-\d+$", folder.name)
            if rows and check_jira and is_key:
                mine = my_comment_texts(folder.name, my_id)
                rows = [(d, why) for d, why in rows if why != "not posted" or not posted_on_jira(d, folder.name, mine)]
            for d, why in rows:
                by_key.setdefault(folder.name, []).append(f"draft `{d}` – {why}")
    for e in ledger_open():
        if a.key and e.get("key") != a.key:
            continue
        by_key.setdefault(e.get("key") or "(no ticket)", []).append(
            f"test data #{e['id']} not restored – {e['what']} ({e.get('env', '?')}): "
            f"was {e.get('before') or '?'}, now {e.get('changed_to') or '?'}; restore: {e.get('restore') or '-'}")
    if not by_key:
        print("Nothing open: every draft is posted and all test data is restored.")
        return 0
    if check_jira:
        for k in [k for k in by_key if re.match(r"^[A-Z][A-Z0-9]+-\d+$", k)]:
            s, r = jira().api("GET", f"/rest/api/2/issue/{k}", params={"fields": "status"})
            statuses[k] = r["fields"]["status"]["name"] if s < 400 else "?"
    for k in sorted(by_key):
        print(f"## {k}" + (f" ({statuses[k]})" if k in statuses else ""))
        for line in by_key[k]:
            print(f"- {line}")
        print()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("since-mine", help="what changed on a ticket since my last comment")
    s.add_argument("key")
    s.add_argument("--since", help="ISO time to use instead of my last comment")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_since_mine)
    o = sub.add_parser("open-items", help="unposted drafts and unrestored test data")
    o.add_argument("--key")
    o.add_argument("--no-jira", action="store_true",
                   help="files and ledger only: don't compare drafts with my Jira comments or show statuses")
    o.set_defaults(fn=cmd_open_items)
    a = ap.parse_args()
    return a.fn(a) or 0


if __name__ == "__main__":
    sys.exit(main())
