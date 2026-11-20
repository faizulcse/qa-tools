---
name: qa-decisions
description: >
  This skill should be used whenever the user, a BA or the team decides how a
  finding should be treated - "this is expected", "ignore this", "remove this
  from the comment", "fix this in another ticket", "out of scope", "there is a
  mistake in the acceptance criteria", "BA decision: ...", "the blocked count
  including stalled cards is expected" - and before reporting, to check that
  nothing contradicts an earlier decision. Records per-ticket and global
  decisions with an optional match pattern; qa-results uses them to block
  contradicting findings and to add out-of-scope and AC-wording notes.
metadata:
  version: "0.2.0"
---

# Decisions memory

Script: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_decisions.py <command>`
Files: `docs/KEY/decisions.json` (per ticket) and `docs/decisions.json` (global).

## Record a decision as soon as it's made

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_decisions.py add KEY --type out_of_scope \
  --text "Restaurant Owner mobile (letters, no formatting) is fixed in another ticket" \
  --match "owner mobile" --source "tester, 20 Nov"
```

| User says | `--type` | Effect |
|---|---|---|
| "this is expected", "it's by design" | `expected` | findings matching `--match` are blocked from reports |
| "ignore this", "remove this from the comment" | `ignore` | same: never reported again |
| "fix this in another ticket", "out of scope" | `out_of_scope` | blocked as an issue; listed as "Out of scope" in the comment |
| "there is a mistake in the AC" | `ac_wording` | test against the intent; an "AC wording" note goes in the comment |
| "BA decision: …" | `ba` | quoted in the report's decisions table |
| anything else to remember | `note` | report only |

- Write `--text` as it should appear in a report.
- Give `--match` (a case-insensitive regex over item titles and outcomes)
  for `expected`, `ignore` and `out_of_scope`, so the guardrail can catch a
  repeat. Keep it specific enough not to hide real issues.
- Use `--global` for rules that apply to every ticket (e.g. "short dates in
  task lists are expected").
- Tell the user what was recorded, in one line.

## Use them

- **Before testing** a ticket: `qa_decisions.py list KEY`, so you don't
  re-raise settled items.
- **Before reporting:** `qa_results.py check` fails on any reported problem
  that matches an expected / ignore / out-of-scope decision.
- `qa_decisions.py remove KEY ID` (or `--global ID`) when the user reverses
  a decision.

If the project keeps such decisions elsewhere (memory notes, a BA
decisions doc), mirror them here once so the guardrail can use them.
