---
name: qa-browser
description: >
  This skill should be used during browser testing with playwright-cli when a
  flow needs an emailed code, more than one tab or window, a toast message, a
  long wait or a check after a deploy - "the OTP is in yopmail", "get the code
  from the inbox", "impersonate the owner", "verify the caller", "sign in with
  the email code", "check the toast", "wait for the session to expire",
  "Something went wrong after deploy". Reads 6-digit codes from yopmail.com
  inboxes, keeps actions on the right tab (guard before typing), records
  toasts, waits for a page condition without chained sleeps and detects
  ChunkLoadError after a deploy. Works on top of qa-agent's qa-test-ui.
metadata:
  version: "0.1.0"
---

# Safe browser helpers (playwright-cli)

Script: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_browser.py -s <session> <command>`
`-s` is the playwright-cli session name (e.g. `default`, `admin`, `uat`).

## Tabs: always know where you are

Several tabs in one session (admin console, owner dashboard, yopmail) are
easy to mix up; a code once went into the wrong tab. So:

- **Switch by host, not by index:** `qa_browser.py -s S use --host dev.admin.example.com`
  (add `--open URL` to open it when there is no such tab).
- **Guard before anything important**, such as typing a code, clicking Save
  or Delete: `qa_browser.py -s S guard --host dev.admin.example.com` exits 2
  if the current tab is elsewhere. Then switch with `use`, never guess.
- `qa_browser.py -s S tabs` lists tabs with their host.
- If tabs change unexpectedly (closed, a search page appears), stop and ask
  the user. Someone may be using the same window.

## Codes from yopmail

```bash
CODE=$(python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_browser.py -s S otp --inbox qa-owner \
       --type support --after 20:15 --back dev.admin.example.com)
```

- Opens (or reuses) the yopmail tab, reads the newest mail of that type
  (`support`, `sign-in` or `any`) that is not older than `--after` (inbox
  time), prints only the code and switches back to `--back`.
- Exit 3 means yopmail shows **"confirm you're human"**. Ask the user to solve
  it once in the headed window, then run `otp` again.
- Only read inboxes that belong to QA test accounts. Never send codes to
  real people's addresses; check the masked address in the dialog first.
- Don't echo the code in messages or reports; use it straight in the next
  command (`fill … "${CODE:0:1}"` per digit box). Run `guard` first.

## Toasts

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_browser.py -s S toast-watch     # before the action
# … click Save …
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_browser.py -s S toast-read --match "saved|updated"
```

The recorder resets on a full page load; client-side navigation keeps it.

## Waiting

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_browser.py -s S wait \
  --js "!/RE-LOCKS IN/.test(document.body.innerText)" --timeout 420 --interval 5
```

Polls until the expression is true. For waits longer than a minute, run it
as a **background** command and work on something else (e.g. the report)
meanwhile; don't chain `sleep` calls.

## After a deploy

`qa_browser.py -s S deploy-check` reports "Something went wrong" or a
`ChunkLoadError`, meaning a new build was deployed while the page was open.
Reload and retry. Mention it as an observation, not as a ticket bug.

## Gotchas seen in practice

- Some apps log the user out on a full reload (e.g. an owner dashboard with
  impersonation). Navigate with in-app links or
  `window.next.router.push('/path')` instead of `goto`/reload.
- A session that is closed overnight needs a new sign-in. The helpers say so
  instead of failing silently.
