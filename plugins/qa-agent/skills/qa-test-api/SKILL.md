---
name: qa-test-api
description: >
  This skill should be used when the user wants API endpoints tested directly -
  "test this endpoint", "validate the API", "check the response schema", "test
  these API acceptance criteria", "verify the contract", "check status codes",
  "test the API permissions", or when they supply an OpenAPI/Swagger spec,
  Postman collection, or sample request and want it exercised. Covers contract,
  validation, authorization, and error-path testing with recorded evidence.
metadata:
  version: "0.1.0"
---

# API Test Execution

Exercise endpoints directly and validate responses against the acceptance
criteria. API testing reaches conditions the UI cannot: missing fields, wrong
types, forbidden operations the UI hides, and race conditions.

## Prerequisites

Check the project context first - it may already hold the API base URL, the
backend source path, and the contract file:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/qa_context.py" show
```

If it has never been asked (`status` exits 1), ask once, as optional - see
**qa-test-ui** for the question. With the backend source available, read the
serializer or validator for the endpoint under test: that is where the real
required fields, bounds, and error codes live, and testing against them beats
testing against a stale spec.

- **Base URL** for the environment under test.
- **Auth**: token, API key, or a login endpoint - one credential set per role.
- **Contract**: OpenAPI/Swagger, Postman collection, sample payloads, or the
  endpoint documentation from the ticket.
- **Confirmation before writing data.** Ask before running any POST/PUT/PATCH/
  DELETE against a shared environment. Never against production.

Credentials come from environment variables (`.env`), never from the case file.
The harness redacts auth headers and known secret keys before writing evidence.

## Writing a Case

```python
import os, sys
sys.path.insert(0, os.environ["CLAUDE_PLUGIN_ROOT"] + "/scripts")
from api_harness import ApiCase

TOKEN = os.environ["QA_TOKEN"]

with ApiCase("TC-20", "Expired discount code returns 422",
             base_url=os.environ["QA_API_URL"],
             headers={"Authorization": f"Bearer {TOKEN}"}) as c:
    r = c.post("/v1/cart/discount", json_body={"code": "OLD2019"})
    c.check_status(r, 422)
    c.check_json(r, "error.code", "DISCOUNT_EXPIRED")
    c.check_schema(r, {"error": {"code": str, "message": str}})
    c.check_under_ms(r, 1000)
```

Run with `python3 cases/TC-20.py`. Each case writes
`qa-results/<case-id>/result.json` containing every request and response,
redacted, with timings - that file is the evidence attachment for a bug report.

Check helpers: `check_status`, `check_json` (dotted path equality),
`check_present`, `check_absent` (data-leakage checks), `check_schema` (types,
nested), `check_under_ms`, and `check(condition, expected, actual)` for anything
else. Every check records both expected and actual, so a failure is already
written in bug-report form.

## What to Test on Every Endpoint

Derive cases from the acceptance criteria first, then add these standard
conditions - the AC will not mention them and the defects live here.

### Contract

- Status code for success is exactly what the contract says (201 vs 200 matters).
- Response body matches the documented schema: every field present, correct
  type, correct nullability.
- No **extra** fields leaking internal data (`password_hash`, `internal_notes`,
  `is_admin`, raw stack traces, SQL).
- Content-Type header correct; response is valid JSON.
- Pagination fields present and correct: total, page size, next/prev behavior at
  the first, last, and beyond-last page.
- Timestamps in the documented format and timezone.

### Input validation

- Each required field omitted, one at a time - expect a specific 400/422, not a 500.
- Wrong type per field (string where int expected, array where object expected).
- Boundary values per field (see the qa-analyze boundary technique).
- Empty string vs `null` vs field absent - these are three different inputs and
  are frequently handled inconsistently.
- Extra unknown fields in the payload - ignored or rejected? Either is fine;
  a 500 is not.
- Malformed JSON body; empty body; wrong Content-Type.
- Oversized payload; very long string values; unicode and emoji round-tripping.

### Authorization - the highest-value section

- No auth header at all -> 401.
- Malformed, expired, and revoked tokens -> 401.
- Valid token, insufficient role -> 403.
- **Valid token, object owned by another user or another tenant.** Test every
  endpoint that takes an object ID this way. Expect 403 or 404, and confirm the
  response body does not leak the object's contents.
- Confirm the error does not reveal whether the object exists when it should not.
- Any operation the UI hides for a role, attempted directly via the API.

### Error paths and idempotency

- Same request sent twice - duplicate resource created, or handled idempotently?
- Request with an idempotency key replayed.
- Referenced entity that does not exist -> 404 with a useful message.
- Referenced entity in the wrong state (cancel an already-cancelled order).
- Concurrent conflicting updates - last write wins, or 409?
- Downstream dependency failure surfaces as 5xx with a request ID, not a raw
  stack trace.

### Consistency with the UI

For each acceptance criterion verified through the UI, verify the same fact at
the API and, where possible, in the database. A value that is correct on screen
and wrong in the payload is a real defect that UI-only testing misses.

## Working from a Spec

Given an OpenAPI/Swagger file, enumerate endpoints and generate a coverage
matrix of endpoint x method x (happy path, each validation failure, each auth
case). Report which combinations have no case - that gap list is often more
valuable than the cases themselves. Do not assume the spec is accurate: where
the implementation disagrees with the spec, that is a bug in one of them, and
which one is a question for the team.

## Reporting

Summarize as a table of case ID, endpoint, expected, actual, status. For each
failure:

- Confirm it reproduces (re-run once).
- Classify it: product defect, test defect, environment issue, or spec ambiguity.
- For product defects, invoke **qa-bug** with the case ID and the
  `qa-results/<case-id>/result.json` path - the recorded exchange is the
  evidence, and the curl equivalent goes in the reproduction steps.

Build the curl equivalent from the recorded exchange, with credentials replaced
by `$TOKEN`, so the developer can reproduce it in one paste.

## Constraints

- Never print or store real tokens, passwords, or customer PII. If a response
  contains PII, note that it did and redact the values in the report.
- Never run load or stress volumes against a shared environment without
  explicit permission.
- Rate limits are part of the contract: if requests start returning 429, stop
  and report it rather than retrying around it.
