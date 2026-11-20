---
name: qa-results
description: >
  This skill should be used to record test results and produce the report and
  the Jira draft from them - "give me a report", "test KEY and give a report",
  "write the report", "draft the comment", "retest and report", or at the end
  of any test or retest run. Keeps one structured results file per run
  (ACs, issues with steps, retest items, evidence, observations, not tested),
  checks it against guardrails (evidence for every failure, complete issues,
  regressions re-checked, no contradiction of recorded decisions) and renders
  both the Markdown report and the Jira comment draft from the same data, so
  they never disagree.
metadata:
  version: "0.2.0"
---

# Results → check → report + comment

Script: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_results.py <command>`
Run it from the project root.

## 1. Start the results file

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_results.py init KEY --kind test|retest \
  --env "dev (Admin console)" --accounts "Super Admin"
```

Creates `docs/KEY/results-<date>.json` (title from Jira, tester, date).
Fill it in **while testing**, one item per AC, issue or retested item.
Format: see the docstring (`qa_results.py --help`).

| Item type | Fields |
|---|---|
| `ac` | `id`, `title`, `status` (pass / partial / fail / not_tested / blocked / expected), `outcome`, `evidence` |
| `issue` | `severity` S1–S4, `title`, `ac`, `steps[]`, `now` + `expected` **or** `rows` (a table, first row = header), `evidence`, `regression`, `rechecked` |
| `retest` | `title` (as reported), `reported` (date), `status` (resolved / not_fixed / partly), `outcome`, `evidence` |

Also `no_regression`, `observations[]`, `not_tested[]`, `test_data`. If
`test_data` is empty, the qa-ledger entries for the ticket are used.

Write outcomes the way the comments should read: exact UI text in quotes,
what was done and what was seen, no internal IDs.

## 2. Check: the guardrails

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_results.py check docs/KEY/results-<date>.json
```

Errors (must fix before rendering):

- a failing or partial AC, an issue or a not-fixed retest item **without
  evidence**, or citing a file that doesn't exist;
- an issue without steps, without now/expected (or rows), or without a severity;
- something called a **regression** that wasn't re-checked. Run it again
  and rule out changed test data (e.g. removed seed records), then set
  `"rechecked": true`;
- a reported problem that **contradicts a recorded decision** (expected /
  ignore / out of scope, see `qa-decisions`). Drop it or mark it expected;
- `<<placeholders>>` left.

Never silence a guardrail by editing evidence paths or flags without doing
the check it asks for.

## 3. Render

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_results.py render docs/KEY/results-<date>.json --as report \
  --out docs/KEY/qa-report-<date>.md
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_results.py render docs/KEY/results-<date>.json --as comment \
  --out docs/KEY/jira-comment-draft-<date>.md
```

- **report**: verdict, results with evidence, issues with steps and
  evidence, observations, not tested, decisions on record, test data.
- **comment**: picks the shape: a retest table when there are retest items,
  else issues-only with steps (plus "What passed"), else a pass summary.
  Adds "Not tested", out-of-scope and AC-wording decisions, and the test-data
  line. Evidence paths stay in the report only.

The verdict is computed: S1/S2 or a failing AC → ❌ Fail; other issues or a
partial AC → ⚠️ Pass with conditions; else ✅ Pass. For retests: ✅ Resolved
(n of n) or ⚠️ k of n resolved.

Then hand the comment to `qa-comment` (lint → show → post on OK). If the
user changes the wording, change the **results file** and render again, so
the report and comment stay the same.
