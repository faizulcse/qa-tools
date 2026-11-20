---
name: qa-ledger
description: >
  This skill should be used whenever testing changes shared data or settings
  that must be put back - switching a user's role, toggling role permissions
  or feature flags, changing a setting such as a session length, moving an
  onboarding card, requesting go-live, adding or editing records - and when
  the user asks "did you restore everything", "what did you change",
  "restore the test data", or a report needs its "Test data" line. Records
  each change with its before value and how to restore it, checks what is
  restored, still changed or changed by someone else, and writes the Test
  data lines for reports and Jira comments.
metadata:
  version: "0.1.0"
---

# Test-data ledger

Script: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_ledger.py <command>`
Ledger file: `.qa-loop/ledger.json` in the project (keep `.qa-loop/` git-ignored).

## The rule

**Record before you change.** Before any change to shared data, add an entry
with the current value and how to put it back. Ask the user first when the
change affects other people (roles, platform settings, real restaurants).

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_ledger.py add --key KEY --env dev \
  --what "Impersonation session length" --before "6" --to "5" \
  --restore "Settings → Impersonation Session → Custom 6 → Save changes" \
  --check "<command that prints the current value>"
```

- `--before` / `--to`: plain values, no secrets, passwords or codes.
- `--check` (optional but best): any shell command that prints the current
  value, e.g. a `playwright-cli --raw eval "fetch('/api/…').then(r=>r.json()).then(j=>j.data.x)"`
  call or a `curl`. It lets `check` verify the restore instead of trusting it.

## After the test

1. Put each value back, then mark it:
   `qa_ledger.py restore ID [--value "6"]`
2. If something can't be restored by QA (e.g. a go-live request only another
   approver can reject), keep it on purpose and tell the user:
   `qa_ledger.py keep ID --note "needs an approver to reject it"`
3. Verify everything:
   `qa_ledger.py check [--key KEY]`, which reports each entry as
   - **restored ✓**,
   - **STILL CHANGED** (restore it now), or
   - **CHANGED BY SOMEONE ELSE** (now X; was Y, QA set Z): don't overwrite
     another person's change. Leave it and mention it in the report.
4. Put the result in the report and comment:
   `qa_ledger.py report --key KEY` prints the "Test data" lines.

`qa_ledger.py list [--key KEY] [--all]` shows open entries (all with `--all`).
`qa-changes open-items` also lists unrestored entries per ticket.
