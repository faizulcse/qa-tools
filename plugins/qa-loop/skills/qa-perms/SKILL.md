---
name: qa-perms
description: >
  This skill should be used for role and permission testing and before any
  test pass that depends on what the signed-in account may do - "test the
  role permissions", "check the backend blocks it", "is the API protected",
  "test with a limited role", "compare Super Admin and the limited user",
  "which account am I signed in as", "does my role have access". Checks who
  is signed in and with which permissions (preflight), runs a list of API
  calls from the signed-in browser session and classifies each response
  (allowed, blocked, passed the permission check, no route, signed out), and
  compares two runs. Works on top of playwright-cli sessions.
metadata:
  version: "0.2.0"
---

# Permission checks

Script: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_perms.py -s <session> <command>`

## 1. Preflight: who am I? (always first)

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_perms.py -s S whoami --path /api/bff/admin/me
```

(`QA_LOOP_ME_PATH` in `.env` sets the default path.) It prints the user
(email masked), role, scope and permissions. Compare them with what the
planned tickets need **before** planning the pass. If the account lacks
permissions, say so and ask how to continue (another account, a role
change, or test only what this role should and shouldn't see).

## 2. Permission matrix

Write a spec next to the ticket, e.g. `docs/KEY/perms-spec.json`:

```json
{
  "base": "/api/bff/admin",
  "vars": {"fake": "00000000-0000-0000-0000-000000000000"},
  "calls": [
    {"group": "Bank Account", "name": "list",   "method": "GET",  "path": "/restaurants/{brand}/bank-accounts", "expect": "blocked"},
    {"group": "Bank Account", "name": "create", "method": "POST", "path": "/restaurants/{brand}/bank-accounts", "body": {}, "expect": "blocked"},
    {"group": "Bank Account", "name": "cancel", "method": "POST", "path": "/restaurants/{brand}/bank-accounts/{fake}/cancel", "expect": "blocked"},
    {"group": "Locations",    "name": "list",   "method": "GET",  "path": "/restaurants/{brand}/locations", "expect": "allowed"}
  ]
}
```

- **Writes use fake IDs and empty bodies** so nothing is created: a 400/404
  "not found" then proves the permission check passed without changing data.
- Find real endpoint paths in the app's network requests
  (`playwright-cli requests`) or its JS bundle. Don't guess them. A result of
  `no route` means the path is wrong.

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_perms.py -s limited matrix --spec docs/KEY/perms-spec.json \
  --var brand=<restaurant id> --label limited --out qa-results/KEY/perms-limited.json
```

| Result | Meaning |
|---|---|
| allowed | 2xx: the user got the data or the action ran |
| blocked | 403: the permission check refused it |
| passed check | 400 / 404 "not found" / 409 / 422: allowed past the permission check, failed later |
| no route | 404 "Cannot GET …": the endpoint doesn't exist (fix the path) |
| signed out | 401: the session expired; the run says nothing about permissions |

`expect: blocked` passes only on 403; `expect: allowed` passes on allowed
or passed check. The command exits 1 when any call is not as expected.

## 3. Compare two accounts

Run the same spec as the full-access account (label `admin`) and as the
limited one (label `limited`), then:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_perms.py compare qa-results/KEY/perms-admin.json qa-results/KEY/perms-limited.json
```

Rows where the limited user gets the **same** access are flagged. Those are
the backend gaps to report.

## Setting up a limited user

Changing roles affects real accounts, so **ask first**. Then:

1. Record every change with `qa-ledger` before making it (the user's role
   and scope, the role's permissions).
2. Make the change as the admin; open a **separate** playwright-cli session
   (`playwright-cli -s=limited open --headed <url>`) and let the user sign
   in as the limited user. Never type their credentials.
3. `whoami` in that session to confirm the role took effect.
4. Run the matrix, check the UI (tabs hidden or disabled, `?tab=` URLs), and
   test that turning one permission on applies without editing the user.
5. Restore everything, `qa_ledger.py check`, and close the extra session.

## Reporting

Report each backend gap as its own issue, with the call, the status now and
the expected 403 (e.g. "GET …/bank-accounts → 200 with the account list;
expected 403"), and a "for comparison" line listing calls that are
correctly blocked. Leave real IDs out of Jira comments; use `<id>`.
