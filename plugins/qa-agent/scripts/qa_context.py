#!/usr/bin/env python3
"""qa_context.py - remember the project's frontend/backend so it is asked once.

Knowing where the application's source lives makes every other skill better:
test design can read the real validation rules and routes, execution can use the
project's actual test-id convention instead of guessing at selectors, and bug
reports can point at the failing endpoint rather than describing it. All of it
is optional - the plugin works with no context at all.

Stored in ./.qa-agent/context.json in the working folder, so the question is
asked on the first run in a project and never again.

    qa_context.py status          # has this been asked yet? exit 0 = yes, 1 = no
    qa_context.py show            # print what is known (human readable)
    qa_context.py show --json     # ... as JSON

    qa_context.py set --frontend-path ../shop-web \
                      --frontend-framework "React 18 + Vite" \
                      --frontend-url http://localhost:5173 \
                      --testid-attr data-testid \
                      --backend-path ../shop-api \
                      --backend-framework "Django REST" \
                      --api-url http://localhost:8000/api \
                      --api-docs ../shop-api/openapi.yaml \
                      --note "feature flags live in config/flags.yml"

    qa_context.py set --frontend-path ../shop-web    # partial updates are fine
    qa_context.py skip            # user declined - never ask again
    qa_context.py clear           # forget everything, including the skip

Set QA_CONTEXT_DIR to keep the file somewhere other than ./.qa-agent.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

FIELDS = {
    "frontend_path": "Frontend project path",
    "frontend_framework": "Frontend framework",
    "frontend_url": "Frontend dev/staging URL",
    "testid_attr": "Test-id attribute",
    "backend_path": "Backend project path",
    "backend_framework": "Backend framework",
    "api_url": "API base URL",
    "api_docs": "API contract / docs",
}


def store() -> Path:
    d = Path(os.environ.get("QA_CONTEXT_DIR", "./.qa-agent"))
    d.mkdir(parents=True, exist_ok=True)
    return d / "context.json"


def load() -> dict:
    f = store()
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text())
    except Exception:  # noqa: BLE001
        return {}


def save(data: dict) -> None:
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    store().write_text(json.dumps(data, indent=2) + "\n")


def resolved(data: dict) -> bool:
    """True once the user has either answered or explicitly declined."""
    return bool(data.get("skipped")) or any(data.get(k) for k in FIELDS)


def warn_missing(path: str | None, label: str) -> None:
    if path and not Path(path).expanduser().exists():
        print(f"  note: {label} not found at {path} - saved anyway, "
              f"correct it with another `set` if that is wrong")


def cmd_status(a):
    data = load()
    if resolved(data):
        if data.get("skipped"):
            print("asked: yes (user declined to provide project paths)")
        else:
            have = [FIELDS[k] for k in FIELDS if data.get(k)]
            print(f"asked: yes ({len(have)} field(s) known: {', '.join(have)})")
        sys.exit(0)
    print("asked: no - ask the user once for optional frontend/backend project "
          "context, then record it with `set` or `skip`")
    sys.exit(1)


def cmd_show(a):
    data = load()
    if a.json:
        print(json.dumps(data, indent=2))
        return
    if not resolved(data):
        print("No project context recorded yet.")
        return
    if data.get("skipped"):
        print("Project context: declined by the user. Work without source access.")
    width = max(len(v) for v in FIELDS.values())
    for k, label in FIELDS.items():
        if data.get(k):
            print(f"{label:<{width}} : {data[k]}")
    for n in data.get("notes", []):
        print(f"{'Note':<{width}} : {n}")


def cmd_set(a):
    data = load()
    data.pop("skipped", None)
    for k in FIELDS:
        v = getattr(a, k, None)
        if v:
            data[k] = v
    if a.note:
        data.setdefault("notes", [])
        for n in a.note:
            if n not in data["notes"]:
                data["notes"].append(n)
    save(data)
    warn_missing(data.get("frontend_path"), "frontend path")
    warn_missing(data.get("backend_path"), "backend path")
    warn_missing(data.get("api_docs"), "API docs")
    print(f"saved to {store()}")
    cmd_show(argparse.Namespace(json=False))


def cmd_skip(a):
    data = load()
    data["skipped"] = True
    save(data)
    print("Recorded: no project context. The question will not be asked again "
          "in this folder (`qa_context.py clear` to reset).")


def cmd_clear(a):
    f = store()
    if f.exists():
        f.unlink()
    print("Project context cleared.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="exit 0 if already asked, 1 if not").set_defaults(fn=cmd_status)

    sh = sub.add_parser("show", help="print what is known")
    sh.add_argument("--json", action="store_true")
    sh.set_defaults(fn=cmd_show)

    st = sub.add_parser("set", help="record answers (partial updates allowed)")
    for k, label in FIELDS.items():
        st.add_argument("--" + k.replace("_", "-"), dest=k, help=label)
    st.add_argument("--note", action="append", help="free-form note, repeatable")
    st.set_defaults(fn=cmd_set)

    sub.add_parser("skip", help="user declined - do not ask again").set_defaults(fn=cmd_skip)
    sub.add_parser("clear", help="forget everything").set_defaults(fn=cmd_clear)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
