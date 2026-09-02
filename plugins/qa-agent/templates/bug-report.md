# [AREA] Short specific statement of what breaks and when

| Field | Value |
| --- | --- |
| Issue type | Bug |
| Severity | S? - Critical / Major / Minor / Trivial |
| Priority | P? - Blocker / High / Medium / Low |
| Reproducibility | ?/? runs |
| Component | |
| Affects version / build | |
| Found in | Environment name + URL |
| Found by | QA agent run <date> |
| Related | Feature ticket KEY, failing case TC-? |

## Severity and priority reasoning

One line: technical impact, user reach, workaround availability, regression
status.

## Environment

- URL:
- Build / commit:
- Browser + version:
- OS / device / viewport:
- User account and role:
- Feature flags:
- Date/time (with timezone):

## Preconditions

The exact state that must exist before step 1 - account, data, settings.

## Steps to reproduce

1.
2.
3.

## Expected result

Quote the acceptance criterion or spec line with its ID. If none exists, say so
and state the reasoning oracle used.

## Actual result

Exactly what happened, including on-screen text, status codes, and error
messages. No speculation about cause.

## Evidence

- `screenshot-05-apply-code.png` - failure state
- `result.json` - full step log and captured requests
- Console error:
- Failing request:

```
POST /v1/cart/discount
{"code":"OLD2019"}
-> 200 {"status":"applied","discount":24.00}
```

## Scope and narrowing

- Reproduces on:
- Does NOT reproduce on:
- Regression: yes/no/unknown - last known good build:
- First step where observable state diverges:

## Impact

Who is affected, how often, and what it costs them. Workaround, if any.

## Notes

Anything the developer should know that does not fit above. Leave out
speculation about root cause unless it is evidenced.
