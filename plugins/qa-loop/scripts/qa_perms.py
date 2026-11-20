#!/usr/bin/env python3
"""qa_perms.py - permission checks from a signed-in playwright-cli session.

    whoami -s SESSION [--path /api/me]
        Preflight: who is signed in, with which role and permissions
        (QA_LOOP_ME_PATH sets the default path). Run it before planning a
        test pass, so a limited account is spotted before, not after.

    matrix -s SESSION --spec SPEC.json [--var name=value ...] [--label limited] [--out FILE]
        Calls every endpoint in the spec from the page (same cookies as the
        user) and classifies each response:
          allowed        2xx
          blocked        403
          signed out     401
          passed check   400 / 404 "not found" / 409 / 422: the permission check
                         passed and the request failed later (use fake IDs for writes)
          no route       404 "Cannot GET/POST ..." : the endpoint doesn't exist
          server error   5xx
        Each call may say "expect": "blocked" | "allowed"; the result column
        then shows ✅ / ❌. Writes the results as JSON (default qa-results/).

    compare A.json B.json
        Side by side, e.g. Super Admin vs limited user: rows where the
        limited user still gets data are flagged.

Spec (JSON):
{
  "base": "/api/bff/admin",
  "vars": {"brand": "<id>", "fake": "00000000-0000-0000-0000-000000000000"},
  "calls": [
    {"group": "Bank Account", "name": "list", "method": "GET",
     "path": "/restaurants/{brand}/bank-accounts", "expect": "blocked"},
    {"group": "Bank Account", "name": "create", "method": "POST",
     "path": "/restaurants/{brand}/bank-accounts", "body": {}, "expect": "blocked"}
  ]
}
Use fake IDs and empty bodies for write calls so nothing is created.
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
from qa_browser import ev, current_host  # noqa: E402

ROUTE_MISSING = re.compile(r"Cannot (GET|POST|PUT|PATCH|DELETE)\b", re.I)
NOT_FOUND = re.compile(r"not.?found", re.I)


def classify(status: int, text: str) -> str:
    if 200 <= status < 300:
        return "allowed"
    if status == 401:
        return "signed out"
    if status == 403:
        return "blocked"
    if status == 404 and ROUTE_MISSING.search(text or ""):
        return "no route"
    if status in (400, 404, 409, 422):
        return "passed check"
    if status >= 500:
        return "server error"
    return f"HTTP {status}"


def verdict(expect: str | None, result: str) -> str:
    if not expect:
        return ""
    if expect == "blocked":
        return "✅" if result == "blocked" else "❌"
    if expect == "allowed":
        return "✅" if result in ("allowed", "passed check") else "❌"
    return ""


def mask(v: str) -> str:
    if "@" in v:
        user, dom = v.split("@", 1)
        return f"{user[:1]}•••••@{dom}"
    return v


def cmd_whoami(a) -> int:
    path = a.path or os.environ.get("QA_LOOP_ME_PATH")
    if not path:
        sys.exit("ERROR: pass --path (e.g. /api/bff/admin/me) or set QA_LOOP_ME_PATH")
    host = current_host(a.session)
    res = ev(a.session, f"fetch({json.dumps(path)}).then(async r=>({{status:r.status,body:await r.text()}}))")
    if not isinstance(res, dict):
        sys.exit(f"ERROR: no response from {path}: {res}")
    print(f"host: {host} · GET {path} → {res['status']}")
    if res["status"] in (401, 403):
        print("NOT SIGNED IN (or no access) – sign in first")
        return 1
    try:
        body = json.loads(res["body"])
    except json.JSONDecodeError:
        print(res["body"][:300])
        return 0
    d = body.get("data", body) if isinstance(body, dict) else body
    if not isinstance(d, dict):
        print(json.dumps(d)[:500])
        return 0
    name = d.get("fullName") or d.get("name") or d.get("displayName") or "?"
    role = d.get("role")
    role = role.get("name") if isinstance(role, dict) else role
    email = mask(str(d.get("email") or ""))
    perms = d.get("permissions") or d.get("perms") or []
    scope = "all restaurants" if d.get("allRestaurants") else (d.get("restaurants") and f"{len(d['restaurants'])} restaurants") or "-"
    print(f"user: {name} ({email}) · role: {role or '-'} · scope: {scope}")
    print(f"permissions ({len(perms)}): " + (", ".join(map(str, perms)) or "none"))
    return 0


def run_matrix(session: str, spec: dict) -> list[dict]:
    vars_ = dict(spec.get("vars") or {})
    for _ in range(3):  # let a var refer to another: --var brand={fake}
        vars_ = {k: re.sub(r"\{(\w+)\}", lambda m: str(vars_.get(m.group(1), m.group(0))), str(v)) for k, v in vars_.items()}
    calls = []
    for c in spec["calls"]:
        path = c["path"]
        for k, v in vars_.items():
            path = path.replace("{" + k + "}", str(v))
        left = re.findall(r"\{(\w+)\}", path)
        if left:
            sys.exit(f"ERROR: {c.get('name')}: no value for {left} (add --var {left[0]}=...)")
        calls.append({**c, "url": (spec.get("base") or "") + path})
    js = ("(async()=>{const calls=" + json.dumps(calls) + ";const out=[];for(const c of calls){try{"
          "const r=await fetch(c.url,{method:c.method||'GET',headers:{'content-type':'application/json'},"
          "body:c.body!==undefined?JSON.stringify(c.body):undefined});const t=await r.text();"
          "out.push({status:r.status,text:t.slice(0,4000)})}catch(e){out.push({status:0,text:String(e)})}}"
          "return out})()")
    res = ev(session, js)
    if not isinstance(res, list):
        sys.exit(f"ERROR: matrix call failed: {str(res)[:300]}")
    rows = []
    for c, r in zip(calls, res):
        msg = r["text"]
        try:
            j = json.loads(msg)
            err = j.get("error") if isinstance(j, dict) else None
            msg = (err.get("message") if isinstance(err, dict) else None) or ("data" if isinstance(j, dict) and "data" in j else msg)
        except (json.JSONDecodeError, AttributeError):
            pass
        result = classify(r["status"], r["text"])
        rows.append({"group": c.get("group", ""), "name": c.get("name", c["path"]), "method": c.get("method", "GET"),
                     "path": c["path"], "status": r["status"], "result": result, "expect": c.get("expect"),
                     "ok": verdict(c.get("expect"), result), "message": str(msg)[:90]})
    return rows


def print_rows(rows: list[dict]) -> None:
    print("| Group | Call | HTTP | Result | Expected | | Message |\n|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['group']} | {r['method']} {r['path']} | {r['status']} | {r['result']} | "
              f"{r['expect'] or '-'} | {r['ok']} | {r['message']} |")
    bad = [r for r in rows if r["ok"] == "❌"]
    if any(r["result"] == "signed out" for r in rows):
        print("\nWARNING: some calls returned 401 – the session is signed out; results are not about permissions.")
    nr = [r for r in rows if r["result"] == "no route"]
    print(f"\n{len(rows)} calls · {len(bad)} not as expected" + (f" · {len(nr)} with no route (check the path)" if nr else ""))


def cmd_matrix(a) -> int:
    spec = json.loads(Path(a.spec).read_text())
    for kv in a.var or []:
        k, v = kv.split("=", 1)
        spec.setdefault("vars", {})[k] = v
    host = current_host(a.session)
    rows = run_matrix(a.session, spec)
    print(f"host: {host} · label: {a.label or '-'}\n")
    print_rows(rows)
    out = Path(a.out) if a.out else Path("qa-results") / f"perms-{a.label or 'run'}-{dt.datetime.now():%Y%m%d-%H%M%S}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"label": a.label, "host": host, "at": dt.datetime.now().isoformat(timespec="seconds"),
                               "rows": rows}, indent=2, ensure_ascii=False) + "\n")
    print(f"saved: {out}")
    return 1 if any(r["ok"] == "❌" for r in rows) else 0


def cmd_compare(a) -> int:
    A, B = json.loads(Path(a.a).read_text()), json.loads(Path(a.b).read_text())
    la, lb = A.get("label") or "A", B.get("label") or "B"
    bmap = {(r["method"], r["path"]): r for r in B["rows"]}
    print(f"| Call | {la} | {lb} | |\n|---|---|---|---|")
    flagged = 0
    for r in A["rows"]:
        o = bmap.get((r["method"], r["path"]))
        rb = o["result"] if o else "-"
        flag = ""
        if o and r["result"] == rb and rb in ("allowed", "passed check"):
            flag = f"⚠️ {lb} gets the same access"
            flagged += 1
        b_cell = f"{rb} ({o['status']})" if o else "-"
        print(f"| {r['method']} {r['path']} | {r['result']} ({r['status']}) | {b_cell} | {flag} |")
    print(f"\n{flagged} call(s) where {lb} has the same access as {la}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-s", "--session", default="default")
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("whoami")
    w.add_argument("--path")
    w.set_defaults(fn=cmd_whoami)
    m = sub.add_parser("matrix")
    m.add_argument("--spec", required=True)
    m.add_argument("--var", action="append", help="name=value for {name} in paths")
    m.add_argument("--label")
    m.add_argument("--out")
    m.set_defaults(fn=cmd_matrix)
    c = sub.add_parser("compare")
    c.add_argument("a")
    c.add_argument("b")
    c.set_defaults(fn=cmd_compare)
    a = ap.parse_args()
    return a.fn(a) or 0


if __name__ == "__main__":
    sys.exit(main())
