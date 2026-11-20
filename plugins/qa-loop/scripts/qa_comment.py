#!/usr/bin/env python3
"""qa_comment.py - Jira QA comments: draft from a template, lint, post, edit.

    new   KEY --template issues|retest|pass [--env dev] [--out FILE]
    lint  FILE [--key KEY] [--fix] [--allow-keys] [--allow-links]
    post  KEY FILE [--yes]          # without --yes: lint + preview only
    edit  KEY COMMENT_ID FILE [--yes]
    log   [--key KEY]               # comments posted through qa-loop

Posting and editing always lint first and stop on errors. They never run
without --yes, which the skill passes only after the user's explicit OK.
Credentials come from .env through qa-agent's jira_client.py.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _qa_agent import PLUGIN_ROOT, jira  # noqa: E402

STATE_DIR = Path(os.environ.get("QA_LOOP_STATE_DIR", ".qa-loop"))
DOCS_DIR = Path(os.environ.get("QA_LOOP_DOCS_DIR") or os.environ.get("JIRA_SPRINT_DOCS_DIR") or "docs")
TEMPLATES = {"issues": "comment-issues.md", "retest": "comment-retest.md", "pass": "comment-pass.md"}

KEY_RE = re.compile(r"\b[A-Z][A-Z0-9]{1,9}-\d+\b")
URL_RE = re.compile(r"https?://[^\s)>\]|]+")
MD_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)]+)\)")
EMAIL_RE = re.compile(r"(?<![\w•.])[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
SECRET_RE = re.compile(r"(?i)\b(api[_-]?key|token|secret|password|passwd|pwd)\b\s*[:=]\s*\S{4,}")
LONG_ID_RE = re.compile(r"\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24,})\b", re.I)
PLACEHOLDER_RE = re.compile(r"<<[^>]*>>|\b(TODO|TBD|FIXME|WIP|asdf)\b")


def today() -> str:
    return dt.date.today().isoformat()


def die(msg: str, code: int = 1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


# --------------------------------------------------------------------------- #
# lint


def lint_text(md: str, key: str | None = None, allow_keys=False, allow_links=False):
    """Return (errors, warnings) as lists of (line_no, message)."""
    errors, warns = [], []
    allow_keys = allow_keys or os.environ.get("QA_LOOP_ALLOW_KEYS") == "1"
    allow_links = allow_links or os.environ.get("QA_LOOP_ALLOW_LINKS") == "1"
    for n, line in enumerate(md.splitlines(), 1):
        if not allow_links:
            for m in URL_RE.finditer(line):
                errors.append((n, f"link: {m.group(0)[:60]}"))
        if not allow_keys:
            for m in KEY_RE.finditer(line):
                if key and m.group(0) == key and line.lstrip().startswith("#"):
                    continue  # qa-agent removes the ticket's own key from headings
                errors.append((n, f"ticket key: {m.group(0)}"))
        for m in PLACEHOLDER_RE.finditer(line):
            errors.append((n, f"placeholder left: {m.group(0)}"))
        for m in EMAIL_RE.finditer(line):
            warns.append((n, f"unmasked email: {m.group(0)} (mask it, e.g. s•••••@domain)"))
        for m in SECRET_RE.finditer(line):
            warns.append((n, f"possible secret: {m.group(0)[:40]}"))
        for m in LONG_ID_RE.finditer(line):
            warns.append((n, f"full ID: {m.group(0)[:12]}… (keep IDs out of comments)"))
        if "`" in line:
            warns.append((n, "inline code renders as a monospace {{…}} block in Jira"))
    # checks on the converted Jira text
    jc = jira()
    body = md
    if key and hasattr(jc, "strip_own_key"):
        body, _ = jc.strip_own_key(body, key)
    wiki = jc.md_to_jira(body)
    for n, line in enumerate(wiki.splitlines(), 1):
        if "**" in line:
            errors.append((n, f"bold didn't convert (leftover **) in Jira text: {line.strip()[:60]}"))
        stripped = re.sub(r"\{\{.*?\}\}", "", line)
        if "{" in stripped or "}" in stripped:
            errors.append((n, f"curly brace in Jira text (Jira reads it as a macro): {line.strip()[:60]}"))
    return errors, warns


def fix_text(md: str) -> str:
    md = MD_LINK_RE.sub(r"\1", md)
    md = URL_RE.sub("", md)
    return md


def print_lint(path, errors, warns) -> None:
    for n, msg in errors:
        print(f"{path}:{n}: ERROR {msg}")
    for n, msg in warns:
        print(f"{path}:{n}: warn  {msg}")
    print(f"lint: {len(errors)} error(s), {len(warns)} warning(s)")


def cmd_lint(a) -> int:
    p = Path(a.file)
    md = p.read_text()
    if a.fix:
        fixed = fix_text(md)
        if fixed != md:
            p.write_text(fixed)
            print(f"fixed: removed links in {p}")
            md = fixed
    errors, warns = lint_text(md, a.key, a.allow_keys, a.allow_links)
    print_lint(p, errors, warns)
    return 1 if errors else 0


# --------------------------------------------------------------------------- #
# new from template


def tester_name() -> str:
    name = os.environ.get("QA_TESTER_NAME")
    if name:
        return name
    try:
        s, me = jira().api("GET", "/rest/api/2/myself")
        if s < 400:
            return me.get("displayName") or "QA"
    except SystemExit:
        pass
    return "QA"


def cmd_new(a) -> int:
    tpl = PLUGIN_ROOT / "templates" / TEMPLATES[a.template]
    text = tpl.read_text()
    title = a.title
    if not title:
        s, issue = jira().api("GET", f"/rest/api/2/issue/{a.key}", params={"fields": "summary"})
        title = (issue.get("fields") or {}).get("summary", "") if s < 400 else ""
    text = (text.replace("<<title>>", title or "<<title>>")
                .replace("<<tester>>", tester_name())
                .replace("<<date>>", today())
                .replace("<<environment>>", a.env or "<<environment>>"))
    out = Path(a.out) if a.out else DOCS_DIR / a.key / f"jira-comment-{a.template}-draft-{today()}.md"
    if out.exists() and not a.force:
        die(f"{out} exists; pass --force to overwrite or --out to choose another file")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(f"draft: {out}")
    left = sorted(set(re.findall(r"<<[^>]*>>", text)))
    if left:
        print("fill in: " + ", ".join(left))
    return 0


# --------------------------------------------------------------------------- #
# post / edit


def posted_path(draft: Path) -> Path:
    stem = draft.stem
    stem = stem.replace("draft", "posted") if "draft" in stem else stem + "-posted"
    if not re.search(r"\d{4}-\d{2}-\d{2}", stem):
        stem += f"-{today()}"
    out = draft.with_name(stem + draft.suffix)
    i = 2
    while out.exists():
        out = draft.with_name(f"{stem}-{i}{draft.suffix}")
        i += 1
    return out


def log_comment(entry: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with (STATE_DIR / "comments.jsonl").open("a") as f:
        f.write(json.dumps(entry) + "\n")


def prepare(key: str, path: Path, allow_keys=False, allow_links=False):
    md = path.read_text()
    errors, warns = lint_text(md, key, allow_keys, allow_links)
    print_lint(path, errors, warns)
    if errors:
        die("lint errors - fix the draft first (or pass --allow-keys/--allow-links if intended)")
    jc = jira()
    body = md
    if hasattr(jc, "strip_own_key"):
        body, notes = jc.strip_own_key(body, key)
        for note in notes:
            print(f"NOTE: {note}", file=sys.stderr)
    return md, jc.md_to_jira(body)


def cmd_post(a) -> int:
    path = Path(a.file)
    md, wiki = prepare(a.key, path, a.allow_keys, a.allow_links)
    if not a.yes:
        print("\n--- preview (Jira text) ---\n" + wiki)
        print("\nNOT POSTED. Re-run with --yes after the user says to post.")
        return 0
    jc = jira()
    status, res = jc.api("POST", f"/rest/api/2/issue/{a.key}/comment", body={"body": wiki})
    jc.expect_ok(status, res, f"Commenting on {a.key}")
    cid = res.get("id")
    out = posted_path(path)
    out.write_text(md)
    log_comment({"key": a.key, "id": cid, "action": "post", "draft": str(path),
                 "posted_copy": str(out), "at": dt.datetime.now().isoformat(timespec="seconds")})
    print(f"Comment added to {a.key} (id {cid})")
    print(f"posted copy: {out}")
    return 0


def cmd_edit(a) -> int:
    path = Path(a.file)
    md, wiki = prepare(a.key, path, a.allow_keys, a.allow_links)
    jc = jira()
    s, cur = jc.api("GET", f"/rest/api/2/issue/{a.key}/comment/{a.comment_id}")
    jc.expect_ok(s, cur, f"Reading comment {a.comment_id}")
    if not a.yes:
        print("\n--- current (Jira text) ---\n" + (cur.get("body") or "")[:3000])
        print("\n--- new (Jira text) ---\n" + wiki)
        print("\nNOT EDITED. Re-run with --yes after the user says to update the comment.")
        return 0
    status, res = jc.api("PUT", f"/rest/api/2/issue/{a.key}/comment/{a.comment_id}", body={"body": wiki})
    jc.expect_ok(status, res, f"Editing comment {a.comment_id}")
    out = posted_path(path)
    out.write_text(md)
    log_comment({"key": a.key, "id": a.comment_id, "action": "edit", "draft": str(path),
                 "posted_copy": str(out), "at": dt.datetime.now().isoformat(timespec="seconds")})
    print(f"Comment {a.comment_id} on {a.key} updated")
    print(f"posted copy: {out}")
    return 0


def cmd_log(a) -> int:
    f = STATE_DIR / "comments.jsonl"
    if not f.exists():
        print("no comments posted through qa-loop yet")
        return 0
    rows = [json.loads(x) for x in f.read_text().splitlines() if x.strip()]
    if a.key:
        rows = [r for r in rows if r["key"] == a.key]
    print("| When | Ticket | Action | Comment id | Posted copy |\n|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['at']} | {r['key']} | {r['action']} | {r['id']} | {r['posted_copy']} |")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    n = sub.add_parser("new", help="start a draft from a template")
    n.add_argument("key")
    n.add_argument("--template", choices=sorted(TEMPLATES), required=True)
    n.add_argument("--env", help="environment text, e.g. 'dev (Admin console)'")
    n.add_argument("--title", help="feature title (default: the ticket summary)")
    n.add_argument("--out")
    n.add_argument("--force", action="store_true")
    n.set_defaults(fn=cmd_new)

    for name, fn, extra in (("lint", cmd_lint, False), ("post", cmd_post, True), ("edit", cmd_edit, True)):
        p = sub.add_parser(name)
        if name == "lint":
            p.add_argument("file")
            p.add_argument("--key")
            p.add_argument("--fix", action="store_true", help="remove links in place")
        else:
            p.add_argument("key")
            if name == "edit":
                p.add_argument("comment_id")
            p.add_argument("file")
            p.add_argument("--yes", action="store_true", help="really post/edit (only after the user's OK)")
        p.add_argument("--allow-keys", action="store_true")
        p.add_argument("--allow-links", action="store_true")
        p.set_defaults(fn=fn)

    lg = sub.add_parser("log", help="comments posted through qa-loop")
    lg.add_argument("--key")
    lg.set_defaults(fn=cmd_log)

    a = ap.parse_args()
    return a.fn(a) or 0


if __name__ == "__main__":
    sys.exit(main())
