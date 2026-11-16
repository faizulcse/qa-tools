#!/usr/bin/env python3
"""jira_client.py - zero-dependency Jira REST client for the QA agent.

Used by the qa-jira skill, interactively and in unattended/CI runs. Calls the
REST v2 API so descriptions can be plain wiki markup instead of ADF.

Issue search is the one exception: `search` and `duplicates` use the Jira Cloud
v3 enhanced-search endpoint /rest/api/3/search/jql (as does `sprint`), because /rest/api/2/search
was retired on Cloud. That endpoint is cursor-paged (`nextPageToken`, no
`startAt`), caps `maxResults` at 100 per page, and returns no `total` - counts
printed by those two commands are therefore what was actually fetched, not a
server-side total. NOTE: /rest/api/3/ does not exist on Jira Data Center /
Server, so those two commands are Cloud-only; every other command still works
on both.

Configuration (environment, or a .env file in the working directory):

    JIRA_BASE_URL=https://your-org.atlassian.net
    JIRA_EMAIL=you@example.com
    JIRA_API_TOKEN=<token from id.atlassian.com/manage-profile/security/api-tokens>

    # Jira Data Center / Server instead of Cloud:
    # JIRA_BASE_URL=https://jira.internal.example.com
    # JIRA_PAT=<personal access token>

    # Optional field mapping, discovered with the `fields` command:
    # JIRA_AC_FIELD=customfield_10101        # Acceptance Criteria
    # JIRA_SEVERITY_FIELD=customfield_10202  # Severity

    # Optional defaults for the `sprint` command:
    # (Comments go on their own line: a trailing "# ..." would become the value.)
    # Empty labels = every sprint ticket:
    # JIRA_SPRINT_PROJECT=PROJ
    # JIRA_SPRINT_LABELS=web
    # Default status order: QA statuses first, then by status category:
    # JIRA_SPRINT_STATUS_ORDER=In QA,In Progress,To Do
    # Default QA statuses: names containing test/qa/review/verif:
    # JIRA_SPRINT_QA_STATUSES=In QA
    # JIRA_SPRINT_DOCS_DIR=docs
    # JIRA_SPRINT_REPORT_FILES=qa-report.md,qa-report.html
    # JIRA_SPRINT_DRAFT_FILE=jira-comment-draft.md

Commands:

    python3 jira_client.py check
    python3 jira_client.py get PROJ-123 [--json] [--comments] [--links]
    python3 jira_client.py search "project = PROJ AND status = 'In QA'" [--max 20]
    python3 jira_client.py fields --project PROJ --issuetype Bug
    python3 jira_client.py sprint --project PROJ [--labels web] [--sprint "Sprint 12"] [--json]
    python3 jira_client.py create-bug --project PROJ --summary "..." \
        --description-file bug.md --priority High --severity Major \
        --labels qa-agent,regression --components Checkout \
        --link-to PROJ-123 --attach shot.png --attach result.json
    python3 jira_client.py comment PROJ-123 --body-file summary.md
    python3 jira_client.py attach PROJ-123 report.html
    python3 jira_client.py duplicates --project PROJ --terms "discount expired"

Every write command supports --dry-run, which prints the exact payload without
sending it. Use it to show the user what will be filed before filing.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

# --------------------------------------------------------------------------- #
# config


def load_dotenv(path=".env"):
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def config():
    load_dotenv()
    base = (os.environ.get("JIRA_BASE_URL") or "").rstrip("/")
    if not base:
        die("JIRA_BASE_URL is not set. Add it to .env or the environment.")
    pat = os.environ.get("JIRA_PAT")
    if pat:
        auth = f"Bearer {pat}"
    else:
        email = os.environ.get("JIRA_EMAIL")
        token = os.environ.get("JIRA_API_TOKEN")
        if not (email and token):
            die("Set JIRA_EMAIL and JIRA_API_TOKEN (Cloud) or JIRA_PAT (Data Center).")
        auth = "Basic " + base64.b64encode(f"{email}:{token}".encode()).decode()
    return base, auth


def die(msg, code=1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


# --------------------------------------------------------------------------- #
# transport


def api(method, path, body=None, params=None, raw_headers=None, raw_body=None):
    base, auth = config()
    url = f"{base}{path}"
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)

    headers = {"Authorization": auth, "Accept": "application/json"}
    data = raw_body
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    headers.update(raw_headers or {})

    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(text) if text.strip() else {})
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            payload = json.loads(text)
        except Exception:  # noqa: BLE001
            payload = {"raw": text[:2000]}
        return e.code, payload
    except Exception as e:  # noqa: BLE001
        die(f"Request failed: {method} {url}\n{e}")


def expect_ok(status, payload, what):
    if status >= 400:
        msgs = payload.get("errorMessages") or []
        errs = payload.get("errors") or {}
        detail = "; ".join(msgs + [f"{k}: {v}" for k, v in errs.items()]) or json.dumps(payload)[:800]
        die(f"{what} failed (HTTP {status}): {detail}")
    return payload


# --------------------------------------------------------------------------- #
# markdown -> Jira wiki markup


def md_to_jira(md: str) -> str:
    BOLD = "\x00B\x00"  # sentinel so bold survives the italic pass
    SEP = re.compile(r"\|[\s:|-]+\|")
    lines = md.splitlines()
    out, in_code = [], False

    for i, line in enumerate(lines):
        stripped = line.strip()

        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            out.append(f"{{code:{lang}}}" if (not in_code and lang) else "{code}")
            in_code = not in_code
            continue
        if in_code:
            out.append(line)
            continue

        if m := re.match(r"^(#{1,6})\s+(.*)$", line):
            out.append(f"h{len(m.group(1))}. {inline(m.group(2), BOLD)}")
            continue

        if SEP.fullmatch(stripped):
            continue  # markdown table separator row - carried by the header above

        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [inline(c.strip(), BOLD) for c in stripped.strip("|").split("|")]
            nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
            bar = "||" if SEP.fullmatch(nxt) else "|"
            out.append(bar + bar.join(cells) + bar)
            continue

        s = re.sub(r"^(\s*)[-*+]\s+", lambda m: m.group(1) + "* ", line)
        s = re.sub(r"^(\s*)\d+[.)]\s+", lambda m: m.group(1) + "# ", s)
        out.append(inline(s, BOLD))

    return "\n".join(out).replace(BOLD, "*")


def inline(s: str, bold_token: str) -> str:
    """Inline markdown -> Jira wiki markup for a single line."""
    s = re.sub(r"`([^`]+?)`", r"{{\1}}", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"[\1|\2]", s)
    s = re.sub(r"\*\*(.+?)\*\*", lambda m: f"{bold_token}{m.group(1)}{bold_token}", s)
    s = re.sub(r"__(.+?)__", lambda m: f"{bold_token}{m.group(1)}{bold_token}", s)
    s = re.sub(r"(?<![\w*])\*([^*\n]+?)\*(?![\w*])", r"_\1_", s)
    s = re.sub(r"~~(.+?)~~", r"-\1-", s)
    return s


def jira_to_text(v) -> str:
    """Render a description field that may be plain wiki markup or ADF."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, dict):  # Atlassian Document Format
        parts = []

        def walk(node):
            t = node.get("type")
            if t == "text":
                parts.append(node.get("text", ""))
            elif t == "hardBreak":
                parts.append("\n")
            for c in node.get("content", []) or []:
                walk(c)
            if t in ("paragraph", "heading", "listItem", "codeBlock", "tableRow"):
                parts.append("\n")

        walk(v)
        return re.sub(r"\n{3,}", "\n\n", "".join(parts)).strip()
    return str(v)


# --------------------------------------------------------------------------- #
# commands


def cmd_check(a):
    base, _ = config()
    status, me = api("GET", "/rest/api/2/myself")
    if status >= 400:
        die(f"Authentication failed (HTTP {status}): {json.dumps(me)[:400]}")
    print(f"Connected to {base}")
    print(f"  as: {me.get('displayName')} <{me.get('emailAddress', 'n/a')}>")
    s2, projects = api("GET", "/rest/api/2/project/search", params={"maxResults": 10})
    if s2 < 400:
        vals = projects.get("values", projects if isinstance(projects, list) else [])
        print(f"  projects visible: " +
              ", ".join(f"{p.get('key')} ({p.get('name')})" for p in vals[:10]))


def cmd_get(a):
    fields = ("summary,description,status,issuetype,priority,labels,components,"
              "assignee,reporter,created,updated,fixVersions,parent,subtasks,"
              "issuelinks,attachment,comment")
    if os.environ.get("JIRA_AC_FIELD"):
        fields += "," + os.environ["JIRA_AC_FIELD"]
    status, issue = api("GET", f"/rest/api/2/issue/{a.key}",
                        params={"fields": fields, "expand": "renderedFields"})
    expect_ok(status, issue, f"Fetching {a.key}")

    if a.json:
        print(json.dumps(issue, indent=2))
        return

    f = issue.get("fields", {})
    base, _ = config()
    print(f"# {issue.get('key')} - {f.get('summary','')}")
    print(f"{base}/browse/{issue.get('key')}\n")
    print(f"Type: {(f.get('issuetype') or {}).get('name')}   "
          f"Status: {(f.get('status') or {}).get('name')}   "
          f"Priority: {(f.get('priority') or {}).get('name')}")
    print(f"Assignee: {(f.get('assignee') or {}).get('displayName','unassigned')}   "
          f"Reporter: {(f.get('reporter') or {}).get('displayName','')}")
    print(f"Components: {', '.join(c['name'] for c in f.get('components') or []) or '-'}   "
          f"Labels: {', '.join(f.get('labels') or []) or '-'}")
    print(f"Fix versions: {', '.join(v['name'] for v in f.get('fixVersions') or []) or '-'}")
    print(f"Created: {f.get('created')}   Updated: {f.get('updated')}")

    print("\n## Description\n")
    print(jira_to_text(f.get("description")) or "(empty)")

    ac_field = os.environ.get("JIRA_AC_FIELD")
    if ac_field and f.get(ac_field):
        print(f"\n## Acceptance Criteria ({ac_field})\n")
        print(jira_to_text(f.get(ac_field)))

    subs = f.get("subtasks") or []
    if subs:
        print("\n## Subtasks\n")
        for s in subs:
            print(f"- {s['key']} [{(s['fields'].get('status') or {}).get('name')}] "
                  f"{s['fields'].get('summary')}")

    links = f.get("issuelinks") or []
    if links and (a.links or True):
        print("\n## Linked issues\n")
        for l in links:
            other = l.get("outwardIssue") or l.get("inwardIssue") or {}
            rel = (l.get("type") or {}).get("outward" if l.get("outwardIssue") else "inward", "")
            print(f"- {rel}: {other.get('key')} - {(other.get('fields') or {}).get('summary','')}")

    atts = f.get("attachment") or []
    if atts:
        print("\n## Attachments\n")
        for at in atts:
            print(f"- {at.get('filename')} ({at.get('size')} bytes) {at.get('content')}")

    comments = ((f.get("comment") or {}).get("comments")) or []
    if comments and (a.comments or True):
        print(f"\n## Comments ({len(comments)})\n")
        for cm in comments:
            who = (cm.get("author") or {}).get("displayName", "?")
            print(f"--- {who} at {cm.get('created')}")
            print(jira_to_text(cm.get("body")))
            print()


def cmd_search(a):
    # /rest/api/3/search/jql is cursor-paged: ask for a page, follow
    # nextPageToken, stop on isLast (or on a missing token, which is how older
    # Cloud instances signal the end). No `total` is returned by this endpoint.
    fields = "summary,status,priority,issuetype,assignee,updated"
    issues, token = [], None
    while len(issues) < a.max:
        params = {"jql": a.jql,
                  "maxResults": min(a.max - len(issues), 100),
                  "fields": fields}
        if token:
            params["nextPageToken"] = token
        status, res = api("GET", "/rest/api/3/search/jql", params=params)
        expect_ok(status, res, "Search")
        page = res.get("issues") or []
        issues.extend(page)
        token = res.get("nextPageToken")
        if res.get("isLast") or not token or not page:
            break
    issues = issues[:a.max]
    print(f"{len(issues)} match(es)\n")
    for i in issues:
        f = i.get("fields") or {}
        print(f"{i['key']:<12} [{(f.get('status') or {}).get('name','')}] "
              f"{(f.get('priority') or {}).get('name','-'):<8} {f.get('summary','')}")


def cmd_fields(a):
    status, res = api("GET", "/rest/api/2/issue/createmeta",
                      params={"projectKeys": a.project, "issuetypeNames": a.issuetype,
                              "expand": "projects.issuetypes.fields"})
    expect_ok(status, res, "Fetching create metadata")
    for proj in res.get("projects", []):
        for it in proj.get("issuetypes", []):
            print(f"\n{proj['key']} / {it['name']}\n" + "-" * 50)
            for fid, meta in (it.get("fields") or {}).items():
                req = "REQUIRED" if meta.get("required") else "optional"
                allowed = meta.get("allowedValues")
                vals = ""
                if allowed:
                    names = [v.get("name") or v.get("value") or v.get("key")
                             for v in allowed[:12]]
                    vals = "  values: " + ", ".join(str(n) for n in names if n)
                print(f"  {fid:<24} {meta.get('name','')}  [{req}]{vals}")
    print("\nMap custom fields in .env, e.g. JIRA_AC_FIELD=customfield_10101")


def cmd_duplicates(a):
    jql = (f'project = {a.project} AND issuetype = Bug AND '
           f'text ~ {json.dumps(a.terms)} ORDER BY created DESC')
    # One page is enough for a duplicate check; no pagination needed.
    status, res = api("GET", "/rest/api/3/search/jql",
                      params={"jql": jql, "maxResults": 15,
                              "fields": "summary,status,created,priority"})
    if status >= 400:
        die(f"Duplicate search failed: {json.dumps(res)[:400]}")
    issues = res.get("issues", [])
    if not issues:
        print("No similar bugs found. Safe to file a new one.")
        return
    print(f"{len(issues)} possibly-similar bug(s) - review before filing:\n")
    for i in issues:
        f = i.get("fields") or {}
        print(f"{i['key']:<12} [{(f.get('status') or {}).get('name','')}] "
              f"{f.get('summary','')}  ({f.get('created','')[:10]})")


# --------------------------------------------------------------------------- #
# sprint review
#
# Nothing here is tied to one project or workflow: project, labels, status
# order, QA statuses, docs folder and file names all come from flags or .env.
# Without a configured status order, tickets are grouped by Jira's status
# category (In Progress, then To Do, then Done), which every workflow has.

CATEGORY_RANK = {"indeterminate": 0, "new": 1, "done": 2}
QA_STATUS_HINTS = ("test", "qa", "review", "verif")
DEFAULT_REPORT_FILES = "qa-report.md,qa-report.html"
DEFAULT_DRAFT_FILE = "jira-comment-draft.md"


def csv_list(v):
    return [x.strip() for x in (v or "").split(",") if x.strip()]


def label_variants(labels):
    """Jira label matching is case-sensitive; search the common spellings."""
    out = []
    for l in labels:
        title = "-".join(p[:1].upper() + p[1:] for p in l.split("-"))
        for v in (l, l.lower(), l.upper(), title):
            if v and v not in out:
                out.append(v)
    return out


def jql_quote(v):
    return json.dumps(v)


def paged(path, key, params=None):
    """Follow startAt/maxResults paging for changelog and comment endpoints."""
    items, start = [], 0
    while True:
        p = dict(params or {}, startAt=start, maxResults=100)
        status, res = api("GET", path, params=p)
        expect_ok(status, res, f"GET {path}")
        page = res.get(key) or []
        items.extend(page)
        start += len(page)
        total = res.get("total")
        if not page or res.get("isLast") or (total is not None and start >= total):
            return items


def parse_ts(ts):
    import datetime as dt
    if not ts:
        return None
    # Jira: 2026-11-12T10:15:00.000+0600
    try:
        return dt.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%f%z")
    except ValueError:
        return None


def short_date(d):
    return f"{d.day} {d.strftime('%b')}" if d else "?"


def sprint_field_id():
    status, fields = api("GET", "/rest/api/3/field")
    expect_ok(status, fields, "Listing fields")
    for f in fields:
        if (f.get("schema") or {}).get("custom") == "com.pyxis.greenhopper.jira:gh-sprint":
            return f["id"]
    return None


def cmd_sprint(a):
    import datetime as dt

    load_dotenv()
    env = os.environ.get
    a.project = a.project or env("JIRA_SPRINT_PROJECT")
    if not a.project:
        die("Pass --project or set JIRA_SPRINT_PROJECT in .env.")
    labels_in = a.labels if a.labels is not None else env("JIRA_SPRINT_LABELS", "")
    docs_dir = Path(a.docs_dir or env("JIRA_SPRINT_DOCS_DIR", "docs"))
    order = [x.lower() for x in csv_list(a.status_order or env("JIRA_SPRINT_STATUS_ORDER"))]
    qa_statuses = [x.lower() for x in csv_list(a.qa_statuses or env("JIRA_SPRINT_QA_STATUSES"))]
    report_files = csv_list(a.report_files or env("JIRA_SPRINT_REPORT_FILES", DEFAULT_REPORT_FILES))
    draft_file = a.draft_file or env("JIRA_SPRINT_DRAFT_FILE", DEFAULT_DRAFT_FILE)

    status, me = api("GET", "/rest/api/3/myself")
    expect_ok(status, me, "Fetching the current user")
    my_id = me.get("accountId")

    sprint_fid = sprint_field_id()
    sprint_clause = (f"sprint = {jql_quote(a.sprint)}" if a.sprint
                     else "sprint in openSprints()")
    jql = f"project = {jql_quote(a.project)} AND {sprint_clause}"
    labels = [] if a.all else label_variants(csv_list(labels_in))
    if labels:
        jql += " AND labels in (" + ", ".join(jql_quote(l) for l in labels) + ")"

    fields = "summary,status,assignee,labels" + (f",{sprint_fid}" if sprint_fid else "")
    issues, token = [], None
    while True:
        params = {"jql": jql, "maxResults": 100, "fields": fields}
        if token:
            params["nextPageToken"] = token
        st, res = api("GET", "/rest/api/3/search/jql", params=params)
        expect_ok(st, res, "Sprint search")
        page = res.get("issues") or []
        issues.extend(page)
        token = res.get("nextPageToken")
        if res.get("isLast") or not token or not page:
            break

    def status_rank(name, category):
        # Configured statuses first, in the given order; then QA statuses;
        # then the rest by status category (In Progress, To Do, Done), by name.
        if name.lower() in order:
            return (0, order.index(name.lower()), 0, "")
        return (1, 0 if is_qa_status(name) else 1, CATEGORY_RANK.get(category, 3), name.lower())

    def is_qa_status(name):
        n = name.lower()
        if qa_statuses:
            return n in qa_statuses
        return any(h in n for h in QA_STATUS_HINTS)

    sprints, rows = set(), []
    for i in issues:
        key, f = i["key"], i.get("fields") or {}
        for sp in (f.get(sprint_fid) or []) if sprint_fid else []:
            if isinstance(sp, dict) and (
                    (a.sprint and sp.get("name") == a.sprint)
                    or (not a.sprint and sp.get("state") == "active")):
                sprints.add(sp.get("name"))

        assignee = f.get("assignee") or {}
        now = bool(my_id) and assignee.get("accountId") == my_id

        was_mine = any(
            item.get("field") == "assignee" and my_id in (item.get("from"), item.get("to"))
            for h in paged(f"/rest/api/3/issue/{key}/changelog", "values")
            for item in h.get("items") or [])
        mine = "Now" if now else ("Earlier" if was_mine else "")

        my_comments = sorted(
            filter(None, (parse_ts(c.get("created"))
                          for c in paged(f"/rest/api/3/issue/{key}/comment", "comments")
                          if (c.get("author") or {}).get("accountId") == my_id)))

        doc_dir = docs_dir / key
        files = {p.name: p for p in doc_dir.iterdir() if p.is_file()} if doc_dir.is_dir() else {}
        reports = [n for n in report_files if n in files]
        draft = files.get(draft_file)
        draft_time = (dt.datetime.fromtimestamp(draft.stat().st_mtime, dt.timezone.utc)
                      if draft else None)
        # A draft counts as posted when one of my comments is newer than it.
        draft_unposted = bool(draft) and not any(c >= draft_time for c in my_comments)
        other_docs = sorted(n for n in files if n not in reports and n != draft_file)

        st = f.get("status") or {}
        st_name = st.get("name", "")
        category = (st.get("statusCategory") or {}).get("key", "")
        tail = key.rsplit("-", 1)[-1]
        in_qa = is_qa_status(st_name)
        has_work = bool(my_comments or reports or draft)
        rows.append({
            "key": key,
            "title": f.get("summary", ""),
            "status": st_name,
            "status_category": category,
            "in_qa_status": in_qa,
            "assignee": assignee.get("displayName", "Unassigned"),
            "labels": f.get("labels") or [],
            "assigned_to_me": mine,
            "my_comment_dates": [c.date().isoformat() for c in my_comments],
            "reports": reports,
            "draft": bool(draft),
            "draft_unposted": draft_unposted,
            "other_docs": other_docs,
            "needs_my_qa": in_qa and not has_work,
            "_sort": (status_rank(st_name, category),
                      {"Now": 0, "Earlier": 1}.get(mine, 2),
                      int(tail) if tail.isdigit() else 0),
            "_comments": my_comments,
        })

    rows.sort(key=lambda r: r["_sort"])
    sprint_names = sorted(s for s in sprints if s)

    if a.json:
        out = {
            "me": me.get("displayName"),
            "project": a.project,
            "sprints": sprint_names,
            "jql": jql,
            "settings": {
                "labels": labels,
                "status_order": order or "status category",
                "qa_statuses": qa_statuses or f"names containing {', '.join(QA_STATUS_HINTS)}",
                "docs_dir": str(docs_dir),
                "report_files": report_files,
                "draft_file": draft_file,
            },
            "tickets": [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows],
        }
        print(json.dumps(out, indent=2))
        return

    def work(r):
        bits = []
        if r["_comments"]:
            bits.append("✅ Commented " + ", ".join(short_date(c) for c in r["_comments"]))
        if r["reports"]:
            bits.append("report done")
        if r["draft_unposted"]:
            bits.append("⚠️ comment drafted, not posted")
        return " · ".join(bits) or "–"

    print(f"Sprint: {', '.join(sprint_names) or '(sprint field not found)'}")
    print(f"Me: {me.get('displayName')}   Tickets: {len(rows)}"
          f"   Filter: {'all tickets' if not labels else 'labels in (' + ', '.join(labels) + ')'}\n")
    print("| Key | Title | Status | Assignee | Assigned to me | My QA work |")
    print("|---|---|---|---|---|---|")
    for r in rows:
        mine = {"Now": "✅ Now", "Earlier": "Earlier"}.get(r["assigned_to_me"], "–")
        title = r["title"].replace("|", "/")
        print(f"| {r['key']} | {title} | {r['status']} | {r['assignee']} | {mine} | {work(r)} |")
    waiting = [r["key"] for r in rows if r["needs_my_qa"]]
    if waiting:
        print(f"\nIn a QA status with no QA work from me: {', '.join(waiting)}")


def build_bug_payload(a, description):
    fields = {
        "project": {"key": a.project},
        "issuetype": {"name": a.issuetype},
        "summary": a.summary,
        "description": md_to_jira(description),
    }
    if a.priority:
        fields["priority"] = {"name": a.priority}
    if a.labels:
        fields["labels"] = [l.strip() for l in a.labels.split(",") if l.strip()]
    if a.components:
        fields["components"] = [{"name": c.strip()} for c in a.components.split(",") if c.strip()]
    if a.affects_version:
        fields["versions"] = [{"name": a.affects_version}]
    if a.assignee_id:
        fields["assignee"] = {"id": a.assignee_id}
    if a.parent:
        fields["parent"] = {"key": a.parent}
    sev_field = a.severity_field or os.environ.get("JIRA_SEVERITY_FIELD")
    if a.severity and sev_field:
        fields[sev_field] = {"value": a.severity}
    for kv in a.field or []:
        if "=" not in kv:
            die(f"--field expects id=value, got {kv!r}")
        fid, val = kv.split("=", 1)
        try:
            fields[fid] = json.loads(val)
        except json.JSONDecodeError:
            fields[fid] = val
    return {"fields": fields}


def cmd_create_bug(a):
    if a.description_file:
        description = Path(a.description_file).read_text()
    elif a.description:
        description = a.description
    else:
        description = sys.stdin.read()
    payload = build_bug_payload(a, description)

    if a.dry_run:
        print(json.dumps(payload, indent=2))
        if a.attach:
            print(f"\nWould attach: {', '.join(a.attach)}")
        if a.link_to:
            print(f"Would link to: {a.link_to} ({a.link_type})")
        return

    status, res = api("POST", "/rest/api/2/issue", body=payload)
    expect_ok(status, res, "Creating issue")
    key = res.get("key")
    base, _ = config()
    print(f"Created {key}  {base}/browse/{key}")

    for path in a.attach or []:
        upload_attachment(key, path)

    if a.link_to:
        s, r = api("POST", "/rest/api/2/issueLink", body={
            "type": {"name": a.link_type},
            "inwardIssue": {"key": key},
            "outwardIssue": {"key": a.link_to},
        })
        if s >= 400:
            print(f"  warning: could not link to {a.link_to}: {json.dumps(r)[:300]}")
        else:
            print(f"  linked: {key} {a.link_type} {a.link_to}")


def upload_attachment(key, path):
    p = Path(path)
    if not p.exists():
        print(f"  warning: attachment not found: {p}")
        return
    boundary = uuid.uuid4().hex
    mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{p.name}"\r\n'.encode(),
        f"Content-Type: {mime}\r\n\r\n".encode(),
        p.read_bytes(),
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    status, res = api("POST", f"/rest/api/2/issue/{key}/attachments",
                      raw_body=body,
                      raw_headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                                   "X-Atlassian-Token": "no-check"})
    if status >= 400:
        print(f"  warning: attach {p.name} failed (HTTP {status}): {json.dumps(res)[:300]}")
    else:
        print(f"  attached: {p.name}")


def strip_own_key(md: str, key: str):
    """Remove an issue's own key from Markdown headings in a comment on it.

    Jira renders any issue key in a comment as a link card, so "## Retest:
    PROJ-12, Login" on PROJ-12 shows a card for the ticket the comment is
    already on. Keys elsewhere in the body are left alone (other tickets are
    meant to link) but the own key there is reported. Returns (md, notes).
    """
    proj, _, num = key.upper().partition("-")
    k = rf"{re.escape(proj)}[-‑]{re.escape(num)}(?!\d)"
    notes, out, in_code = [], [], False
    for n, line in enumerate(md.splitlines(), 1):
        if line.strip().startswith("```"):
            in_code = not in_code
        m = None if in_code else re.match(r"^(#{1,6}\s+)(.*)$", line)
        if m and re.search(k, m.group(2), re.I):
            text = re.sub(rf"\s*[(\[]\s*{k}\s*[)\]]", "", m.group(2), flags=re.I)
            text = re.sub(rf"(?<![\w-]){k}\s*[,:–—-]?\s*", "", text, flags=re.I)
            text = re.sub(r"\s*[,:–—-]\s*$", "", text).strip() or "Testing Summary"
            notes.append(f"line {n}: removed {key} from the heading "
                         f"(Jira would show it as a link card)")
            line = m.group(1) + text
        elif not in_code and re.search(rf"(?<![\w-]){k}", line, re.I):
            notes.append(f"line {n}: mentions {key} itself; Jira will render it as a link card")
        out.append(line)
    return "\n".join(out), notes


def cmd_comment(a):
    body = Path(a.body_file).read_text() if a.body_file else (a.body or sys.stdin.read())
    body, notes = strip_own_key(body, a.key)
    for note in notes:
        print(f"NOTE: {note}", file=sys.stderr)
    payload = {"body": md_to_jira(body)}
    if a.dry_run:
        print(json.dumps(payload, indent=2))
        return
    status, res = api("POST", f"/rest/api/2/issue/{a.key}/comment", body=payload)
    expect_ok(status, res, f"Commenting on {a.key}")
    print(f"Comment added to {a.key} (id {res.get('id')})")


def cmd_attach(a):
    for path in a.files:
        upload_attachment(a.key, path)


def cmd_transition(a):
    status, res = api("GET", f"/rest/api/2/issue/{a.key}/transitions")
    expect_ok(status, res, "Listing transitions")
    transitions = res.get("transitions", [])
    if not a.to:
        for t in transitions:
            print(f"{t['id']:<6} {t['name']:<24} -> {(t.get('to') or {}).get('name')}")
        return
    match = next((t for t in transitions
                  if a.to.lower() in (t["name"].lower(),
                                      (t.get("to") or {}).get("name", "").lower())), None)
    if not match:
        die(f"No transition matching {a.to!r}. Available: "
            + ", ".join(t["name"] for t in transitions))
    if a.dry_run:
        print(f"Would transition {a.key} via '{match['name']}' (id {match['id']})")
        return
    s, r = api("POST", f"/rest/api/2/issue/{a.key}/transitions",
               body={"transition": {"id": match["id"]}})
    expect_ok(s, r, "Transition")
    print(f"{a.key} -> {match['name']}")


# --------------------------------------------------------------------------- #


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check", help="verify credentials and connectivity").set_defaults(fn=cmd_check)

    g = sub.add_parser("get", help="fetch an issue with ACs, comments, links")
    g.add_argument("key")
    g.add_argument("--json", action="store_true")
    g.add_argument("--comments", action="store_true")
    g.add_argument("--links", action="store_true")
    g.set_defaults(fn=cmd_get)

    s = sub.add_parser("search", help="run a JQL search")
    s.add_argument("jql")
    s.add_argument("--max", type=int, default=25)
    s.set_defaults(fn=cmd_search)

    sp = sub.add_parser("sprint", help="sprint tickets with my assignment history and QA work")
    sp.add_argument("--project", help="default: JIRA_SPRINT_PROJECT")
    sp.add_argument("--sprint", help="sprint name (default: the open sprint)")
    sp.add_argument("--labels", help="comma-separated labels, case variants added (default: JIRA_SPRINT_LABELS)")
    sp.add_argument("--all", action="store_true", help="ignore --labels, list every ticket")
    sp.add_argument("--docs-dir", help="folder holding <KEY>/ QA files (default: docs)")
    sp.add_argument("--status-order", help="comma-separated statuses to list first, in order "
                    "(default: group by status category)")
    sp.add_argument("--qa-statuses", help="comma-separated statuses that mean 'in QA' "
                    "(default: names containing test, qa, review, verif)")
    sp.add_argument("--report-files", help=f"QA report file names (default: {DEFAULT_REPORT_FILES})")
    sp.add_argument("--draft-file", help=f"comment draft file name (default: {DEFAULT_DRAFT_FILE})")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(fn=cmd_sprint)

    fl = sub.add_parser("fields", help="list creatable fields for a project/issue type")
    fl.add_argument("--project", required=True)
    fl.add_argument("--issuetype", default="Bug")
    fl.set_defaults(fn=cmd_fields)

    d = sub.add_parser("duplicates", help="search for possibly-duplicate bugs")
    d.add_argument("--project", required=True)
    d.add_argument("--terms", required=True)
    d.set_defaults(fn=cmd_duplicates)

    c = sub.add_parser("create-bug", help="create a bug issue")
    c.add_argument("--project", required=True)
    c.add_argument("--issuetype", default="Bug")
    c.add_argument("--summary", required=True)
    c.add_argument("--description")
    c.add_argument("--description-file")
    c.add_argument("--priority")
    c.add_argument("--severity")
    c.add_argument("--severity-field")
    c.add_argument("--labels")
    c.add_argument("--components")
    c.add_argument("--affects-version")
    c.add_argument("--assignee-id")
    c.add_argument("--parent")
    c.add_argument("--field", action="append",
                   help="extra field as id=value (value may be JSON); repeatable")
    c.add_argument("--attach", action="append")
    c.add_argument("--link-to")
    c.add_argument("--link-type", default="Relates")
    c.add_argument("--dry-run", action="store_true")
    c.set_defaults(fn=cmd_create_bug)

    cm = sub.add_parser("comment", help="add a comment to an issue")
    cm.add_argument("key")
    cm.add_argument("--body")
    cm.add_argument("--body-file")
    cm.add_argument("--dry-run", action="store_true")
    cm.set_defaults(fn=cmd_comment)

    at = sub.add_parser("attach", help="attach files to an issue")
    at.add_argument("key")
    at.add_argument("files", nargs="+")
    at.set_defaults(fn=cmd_attach)

    tr = sub.add_parser("transition", help="list or perform a workflow transition")
    tr.add_argument("key")
    tr.add_argument("--to")
    tr.add_argument("--dry-run", action="store_true")
    tr.set_defaults(fn=cmd_transition)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
