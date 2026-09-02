"""api_harness.py - zero-dependency HTTP harness for agentic API testing.

Records every request and response as bug evidence, redacts credentials, and
writes a machine-readable result file per case.

Usage:

    import os, sys
    sys.path.insert(0, os.environ["CLAUDE_PLUGIN_ROOT"] + "/scripts")
    from api_harness import ApiCase

    with ApiCase("TC-20", "Expired discount code is rejected",
                 base_url=os.environ["QA_API_URL"],
                 headers={"Authorization": "Bearer " + os.environ["QA_TOKEN"]}) as c:
        r = c.request("POST", "/v1/cart/discount", json={"code": "OLD2019"})
        c.check_status(r, 422)
        c.check_json(r, "error.code", "DISCOUNT_EXPIRED")
        c.check_schema(r, {"error": {"code": str, "message": str}})
        c.check(r.elapsed_ms < 1000, "responds in under 1s", f"took {r.elapsed_ms}ms")

Environment:
    QA_API_URL   base URL for relative paths
    QA_OUT_DIR   results directory (default ./qa-results)
    QA_TIMEOUT   per-request timeout in seconds (default 30)
    QA_INSECURE  "true" to skip TLS verification (staging with self-signed certs)
"""

from __future__ import annotations

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REDACT_HEADERS = {"authorization", "cookie", "set-cookie", "x-api-key",
                  "x-auth-token", "proxy-authorization"}
REDACT_BODY_KEYS = {"password", "token", "secret", "access_token", "refresh_token",
                    "api_key", "apikey", "client_secret", "authorization", "pin",
                    "ssn", "card_number", "cvv"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug(s: str) -> str:
    return re.sub(r"-+$", "", re.sub(r"^-+", "", re.sub(r"[^a-z0-9]+", "-", str(s).lower())))[:60]


def _redact_headers(h: dict) -> dict:
    return {k: ("<redacted>" if k.lower() in REDACT_HEADERS else v) for k, v in h.items()}


def _redact_body(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: ("<redacted>" if k.lower() in REDACT_BODY_KEYS else _redact_body(v))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact_body(v) for v in obj]
    return obj


class Response:
    def __init__(self, status, headers, body_bytes, elapsed_ms, url, method):
        self.status = status
        self.headers = dict(headers)
        self.body_bytes = body_bytes
        self.text = body_bytes.decode("utf-8", errors="replace")
        self.elapsed_ms = elapsed_ms
        self.url = url
        self.method = method

    @property
    def json(self):
        try:
            return json.loads(self.text)
        except Exception:
            return None

    def path(self, dotted: str, default=None):
        """Read a value by dotted path, supporting list indices: 'items.0.id'."""
        cur = self.json
        for part in dotted.split("."):
            if cur is None:
                return default
            if isinstance(cur, list):
                try:
                    cur = cur[int(part)]
                except (ValueError, IndexError):
                    return default
            elif isinstance(cur, dict):
                if part not in cur:
                    return default
                cur = cur[part]
            else:
                return default
        return cur


class ApiCase:
    def __init__(self, case_id, title, base_url=None, headers=None,
                 out_dir=None, timeout=None):
        self.case_id = case_id
        self.title = title
        self.base_url = (base_url or os.environ.get("QA_API_URL") or "").rstrip("/")
        self.default_headers = headers or {}
        self.timeout = float(timeout or os.environ.get("QA_TIMEOUT", 30))
        root = Path(out_dir or os.environ.get("QA_OUT_DIR", "./qa-results")).resolve()
        self.dir = root / _slug(case_id)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.result = {
            "caseId": case_id, "title": title, "status": "PASS",
            "startedAt": _now(), "finishedAt": None, "durationMs": 0,
            "baseUrl": self.base_url, "exchanges": [], "checks": [],
            "failure": None, "artifacts": {"dir": str(self.dir)},
        }
        self._t0 = time.time()
        self._ctx = ssl.create_default_context()
        if os.environ.get("QA_INSECURE", "").lower() == "true":
            self._ctx.check_hostname = False
            self._ctx.verify_mode = ssl.CERT_NONE

    # -- requests ---------------------------------------------------------

    def request(self, method, path, json_body=None, data=None, headers=None,
                params=None, json=None) -> Response:
        import json as _json
        body = json_body if json_body is not None else json
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)

        hdrs = dict(self.default_headers)
        hdrs.update(headers or {})
        payload = None
        if body is not None:
            payload = _json.dumps(body).encode()
            hdrs.setdefault("Content-Type", "application/json")
        elif data is not None:
            payload = data if isinstance(data, bytes) else str(data).encode()

        req = urllib.request.Request(url, data=payload, method=method.upper())
        for k, v in hdrs.items():
            req.add_header(k, v)

        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self._ctx) as r:
                resp = Response(r.status, r.headers.items(), r.read(),
                                int((time.time() - t0) * 1000), url, method.upper())
        except urllib.error.HTTPError as e:
            resp = Response(e.code, e.headers.items(), e.read(),
                            int((time.time() - t0) * 1000), url, method.upper())
        except Exception as e:
            resp = Response(0, [], f"<transport error: {e}>".encode(),
                            int((time.time() - t0) * 1000), url, method.upper())

        self.result["exchanges"].append({
            "n": len(self.result["exchanges"]) + 1,
            "at": _now(),
            "request": {
                "method": method.upper(), "url": url,
                "headers": _redact_headers(hdrs),
                "body": _redact_body(body) if body is not None else None,
            },
            "response": {
                "status": resp.status,
                "elapsedMs": resp.elapsed_ms,
                "headers": _redact_headers(resp.headers),
                "body": _redact_body(resp.json) if resp.json is not None
                        else resp.text[:4000],
            },
        })
        return resp

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, **kw):
        return self.request("POST", path, **kw)

    def put(self, path, **kw):
        return self.request("PUT", path, **kw)

    def patch(self, path, **kw):
        return self.request("PATCH", path, **kw)

    def delete(self, path, **kw):
        return self.request("DELETE", path, **kw)

    # -- checks -----------------------------------------------------------

    def check(self, condition, expected, actual=""):
        entry = {"n": len(self.result["checks"]) + 1, "expected": expected,
                 "actual": str(actual), "status": "PASS" if condition else "FAIL"}
        self.result["checks"].append(entry)
        if not condition:
            self.result["status"] = "FAIL"
            if self.result["failure"] is None:
                self.result["failure"] = {"check": entry["n"], "expected": expected,
                                          "actual": str(actual)}
        return bool(condition)

    def check_status(self, r: Response, expected_status):
        allowed = expected_status if isinstance(expected_status, (list, tuple, set)) \
            else [expected_status]
        return self.check(r.status in allowed,
                          f"HTTP {expected_status} from {r.method} {r.url}",
                          f"HTTP {r.status}" + (f" - {r.text[:200]}" if r.status not in allowed else ""))

    def check_json(self, r: Response, dotted_path, expected_value):
        actual = r.path(dotted_path, "<missing>")
        return self.check(actual == expected_value,
                          f"{dotted_path} == {expected_value!r}", repr(actual))

    def check_present(self, r: Response, *dotted_paths):
        ok = True
        for p in dotted_paths:
            v = r.path(p, "<missing>")
            ok = self.check(v != "<missing>", f"{p} is present", repr(v)) and ok
        return ok

    def check_absent(self, r: Response, *dotted_paths):
        """Assert a field is NOT returned - use for data leakage checks."""
        ok = True
        for p in dotted_paths:
            v = r.path(p, "<missing>")
            ok = self.check(v == "<missing>", f"{p} is NOT returned", repr(v)) and ok
        return ok

    def check_schema(self, r: Response, shape: dict, _prefix=""):
        """Shallow-to-deep type check: {'id': int, 'user': {'email': str}}."""
        data = r.json
        if not isinstance(data, dict):
            return self.check(False, f"response body is an object{_prefix}",
                              type(data).__name__)
        ok = True
        for key, expected in shape.items():
            full = f"{_prefix}{key}"
            if key not in data:
                ok = self.check(False, f"{full} present", "<missing>") and ok
                continue
            val = data[key]
            if isinstance(expected, dict):
                sub = Response(r.status, [], json.dumps(val).encode(), 0, r.url, r.method)
                ok = self.check_schema(sub, expected, _prefix=f"{full}.") and ok
            else:
                types = expected if isinstance(expected, tuple) else (expected,)
                ok = self.check(isinstance(val, types),
                                f"{full} is {'/'.join(t.__name__ for t in types)}",
                                f"{type(val).__name__} ({val!r})") and ok
        return ok

    def check_under_ms(self, r: Response, budget_ms):
        return self.check(r.elapsed_ms <= budget_ms,
                          f"responds within {budget_ms}ms", f"{r.elapsed_ms}ms")

    def note(self, key, value):
        self.result.setdefault("notes", {})[key] = value

    # -- lifecycle --------------------------------------------------------

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is not None:
            self.result["status"] = "ERROR"
            self.result["failure"] = {"error": f"{exc_type.__name__}: {exc}"}
        self.result["finishedAt"] = _now()
        self.result["durationMs"] = int((time.time() - self._t0) * 1000)
        (self.dir / "result.json").write_text(json.dumps(self.result, indent=2, default=str))
        print(f"[{self.result['status']}] {self.case_id} - {self.title} "
              f"({self.result['durationMs']}ms)")
        for c in self.result["checks"]:
            mark = "  ok  " if c["status"] == "PASS" else "  FAIL"
            print(f"{mark} expected: {c['expected']}")
            if c["status"] == "FAIL":
                print(f"        actual: {c['actual']}")
        print(f"   evidence: {self.dir}")
        return False  # never swallow exceptions
