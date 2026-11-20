#!/usr/bin/env python3
"""qa_browser.py - safe helpers on top of playwright-cli sessions.

All commands take -s/--session (the playwright-cli session name, default
"default").

    tabs                              list tabs with their host
    use --host HOST [--open URL]      switch to the tab on HOST (open URL in a new tab if none);
                                      prints the tab index; fails if it can't land on HOST
    guard --host HOST                 exit 2 unless the current tab is on HOST
                                      (run before typing codes or clicking anything important)
    otp --inbox NAME [--type support|sign-in|any] [--after HH:MM] [--back HOST] [--wait 60]
                                      read the newest 6-digit code from yopmail.com/<NAME>,
                                      then switch back to the tab on --back; prints the code only.
                                      Exit 3 = yopmail shows a human check: the user solves it in
                                      the headed window, then run otp again
    toast-watch                       start recording toasts / added text on the current page
    toast-read [--match REGEX] [--clear]
    wait --js EXPR [--timeout 600] [--interval 5]
                                      poll until the JS expression is truthy
                                      (for long waits run it in the background)
    deploy-check                      detect "Something went wrong" / ChunkLoadError after a deploy
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.parse

TAB_RE = re.compile(r"^- (\d+): (\(current\) )?\[(.*)\]\((.*)\)\s*$")


def pw(session: str, *args: str, check=True) -> str:
    cmd = ["playwright-cli", f"-s={session}", *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if "is not open" in (r.stdout + r.stderr):
        sys.exit(f"ERROR: playwright-cli session '{session}' is not open. "
                 f"Open it (playwright-cli -s={session} open --headed <url>) and sign in first.")
    if check and r.returncode != 0:
        sys.exit(f"ERROR: {' '.join(cmd[:3])} … failed: {(r.stderr or r.stdout).strip()[:300]}")
    return r.stdout


def ev(session: str, js: str):
    out = pw(session, "--raw", "eval", js, check=False).strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return out


def tabs(session: str):
    rows = []
    for line in pw(session, "tab-list").splitlines():
        m = TAB_RE.match(line.strip())
        if m:
            url = m.group(4)
            rows.append({"index": int(m.group(1)), "current": bool(m.group(2)), "title": m.group(3),
                         "url": url, "host": urllib.parse.urlparse(url).netloc})
    return rows


def current_host(session: str) -> str:
    return ev(session, "location.host") or ""


def use(session: str, host: str, open_url: str | None = None) -> int:
    for t in tabs(session):
        if host in t["host"]:
            pw(session, "tab-select", str(t["index"]))
            if host in current_host(session):
                return t["index"]
    if not open_url:
        sys.exit(f"ERROR: no tab on {host}; pass --open URL to open one")
    pw(session, "tab-new", open_url)
    time.sleep(3)
    for t in tabs(session):
        if t["current"] and host in t["host"]:
            return t["index"]
    # tab-new may not focus the new tab: find it and select it
    for t in reversed(tabs(session)):
        if host in t["host"]:
            pw(session, "tab-select", str(t["index"]))
            if host in current_host(session):
                return t["index"]
    sys.exit(f"ERROR: opened {open_url} but no tab is on {host}")


def cmd_tabs(a) -> int:
    for t in tabs(a.session):
        print(f"{t['index']}{'*' if t['current'] else ' '} {t['host']:<32} {t['title'][:50]}")
    return 0


def cmd_use(a) -> int:
    i = use(a.session, a.host, a.open)
    print(f"tab {i}: {current_host(a.session)}")
    return 0


def cmd_guard(a) -> int:
    h = current_host(a.session)
    if a.host not in h:
        print(f"GUARD FAILED: current tab is on {h or '?'}, expected {a.host}. Run: qa_browser.py use --host {a.host}",
              file=sys.stderr)
        return 2
    print(f"ok: {h}")
    return 0


INBOX_JS = r"""(()=>{const d=document.querySelector('#ifinbox')?.contentDocument;if(!d)return [];
return [...d.querySelectorAll('.m')].map((m,i)=>({i,text:m.innerText.replace(/\s+/g,' ').trim()}))})()"""

MAIL_JS = r"""(()=>{const d=document.querySelector('#ifmail')?.contentDocument;return d?d.body.innerText:''})()"""


def pick_code(body: str) -> str | None:
    m = re.search(r"(?:code|call)[^0-9]{0,40}(\d{6})\b", body, re.I) or re.search(r"(?<![\d:/.-])(\d{6})(?![\d:/.-])", body)
    return m.group(1) if m else None


def cmd_otp(a) -> int:
    back = a.back or current_host(a.session)
    inbox_url = f"https://yopmail.com/en/?login={urllib.parse.quote(a.inbox)}"
    use(a.session, "yopmail.com", inbox_url)
    want = {"support": r"support", "sign-in": r"sign-?in|login", "any": r"."}[a.type]
    deadline = time.time() + a.wait
    code = None
    while time.time() < deadline and not code:
        pw(a.session, "goto", inbox_url)
        time.sleep(4)
        page = ev(a.session, "document.body.innerText.slice(0,2000)") or ""
        if re.search(r"confirm you.?re human|captcha", page, re.I):
            if back and back != "yopmail.com":
                use(a.session, back)
            print("HUMAN CHECK: yopmail asks to confirm you're human. Solve it once in the browser "
                  "window (the yopmail tab, headed session), then run otp again.", file=sys.stderr)
            return 3
        items = ev(a.session, INBOX_JS) or []
        for it in items:
            t = it["text"]
            hhmm = re.match(r"(\d{1,2}:\d{2})", t)
            if not re.search(want, t, re.I):
                continue
            if a.after and hhmm and hhmm.group(1).zfill(5) < a.after.zfill(5):
                break  # newest matching mail is older than wanted
            ev(a.session, f"document.querySelector('#ifinbox').contentDocument.querySelectorAll('.m')[{it['i']}].click()")
            time.sleep(2)
            code = pick_code(ev(a.session, MAIL_JS) or "")
            break
        if not code:
            time.sleep(5)
    if back and back != "yopmail.com":
        use(a.session, back)
    if not code:
        print(f"ERROR: no {a.type} code in {a.inbox}@yopmail.com within {a.wait}s", file=sys.stderr)
        return 1
    print(code)
    return 0


WATCH_JS = r"""(()=>{window.__qaToasts=window.__qaToasts||[];if(window.__qaObs)return 'already watching';
window.__qaObs=new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{const s=(n.innerText||n.textContent||'').trim();
if(s&&s.length<300)window.__qaToasts.push({t:new Date().toISOString().slice(11,19),s})})));
window.__qaObs.observe(document.body,{childList:true,subtree:true});return 'watching'})()"""


def cmd_toast_watch(a) -> int:
    print(ev(a.session, WATCH_JS))
    return 0


def cmd_toast_read(a) -> int:
    rows = ev(a.session, "window.__qaToasts||[]") or []
    if a.clear:
        ev(a.session, "window.__qaToasts=[]")
    seen, rx = set(), re.compile(a.match, re.I) if a.match else None
    for r in rows:
        if r["s"] in seen or (rx and not rx.search(r["s"])):
            continue
        seen.add(r["s"])
        print(f"{r['t']}  {r['s']}")
    if not rows:
        print("(nothing recorded – run toast-watch before the action; it resets on full page loads)")
    return 0


def cmd_wait(a) -> int:
    start = time.time()
    while time.time() - start < a.timeout:
        if ev(a.session, f"!!({a.js})") is True:
            print(f"ok after {int(time.time() - start)}s")
            return 0
        time.sleep(a.interval)
    print(f"TIMEOUT after {a.timeout}s: {a.js}", file=sys.stderr)
    return 1


def cmd_deploy_check(a) -> int:
    text = ev(a.session, "document.body.innerText.slice(0,3000)") or ""
    console = pw(a.session, "console", "error", check=False)
    hits = []
    if re.search(r"Something went wrong", text, re.I):
        hits.append('page shows "Something went wrong"')
    if re.search(r"ChunkLoadError|Failed to load chunk", console):
        hits.append("ChunkLoadError in the console (a new build was deployed while the page was open)")
    if hits:
        print("DEPLOY ISSUE: " + "; ".join(hits) + " → reload the page and retry; note it, don't log it as a ticket bug")
        return 1
    print("ok: no deploy errors")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-s", "--session", default="default")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("tabs").set_defaults(fn=cmd_tabs)
    u = sub.add_parser("use")
    u.add_argument("--host", required=True)
    u.add_argument("--open")
    u.set_defaults(fn=cmd_use)
    g = sub.add_parser("guard")
    g.add_argument("--host", required=True)
    g.set_defaults(fn=cmd_guard)
    o = sub.add_parser("otp")
    o.add_argument("--inbox", required=True, help="yopmail inbox name (the part before @yopmail.com)")
    o.add_argument("--type", choices=["support", "sign-in", "any"], default="any")
    o.add_argument("--after", help="only mails at or after HH:MM (inbox time)")
    o.add_argument("--back", help="host to switch back to (default: the current tab's host)")
    o.add_argument("--wait", type=int, default=60)
    o.set_defaults(fn=cmd_otp)
    sub.add_parser("toast-watch").set_defaults(fn=cmd_toast_watch)
    tr = sub.add_parser("toast-read")
    tr.add_argument("--match")
    tr.add_argument("--clear", action="store_true")
    tr.set_defaults(fn=cmd_toast_read)
    w = sub.add_parser("wait")
    w.add_argument("--js", required=True)
    w.add_argument("--timeout", type=int, default=600)
    w.add_argument("--interval", type=int, default=5)
    w.set_defaults(fn=cmd_wait)
    sub.add_parser("deploy-check").set_defaults(fn=cmd_deploy_check)
    a = ap.parse_args()
    return a.fn(a) or 0


if __name__ == "__main__":
    sys.exit(main())
