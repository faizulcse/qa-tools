---
name: qa-report
description: >
  This skill should be used when the user wants a test report or cycle summary -
  "write the test report", "summarize the testing", "generate a QA report",
  "what's the test status", "prepare sign-off", "give me the coverage summary",
  "send the results to the team", or after a test run when results need to be
  communicated. Produces an evidence-backed report with results, coverage,
  defects, open questions, and a sign-off recommendation.
metadata:
  version: "0.2.0"
---

# Test Reporting

A test report answers one question for the reader: **can we ship this, and what
are we accepting if we do?** Lead with that answer, then support it.

## Audience

Write for two readers in one document:

- **Decision makers** read only the verdict, the risk paragraph, and the open
  defect list. Put those first.
- **Engineers** read the failed cases, evidence, and environment details. Put
  those after.

Never bury a failed P1 case below a table of passing ones.

## Structure

### 1. Verdict (first, always)

One of **Pass**, **Pass with conditions**, **Fail**, or **Blocked**, with a
one-sentence reason. Use the rubric in
`qa-analyze/references/risk-scoring.md`.

> **Fail** - 2 of 18 P1 cases failed; an expired discount code is accepted and
> discounts the order (S1/P0, QA-4471).

### 2. Risk summary

One paragraph in plain language: what is most likely to break in production,
what was not tested and why, and what the reader is accepting if they ship.
This paragraph is the most-read part of the report - write it last, with care.

### 3. Scope

What was tested: feature, ticket keys, build/commit, environments, browsers,
roles, and date range. Equally important, what was **not** tested and why -
out of scope, blocked by environment, deferred to automation, or not reachable
with available test data. Untested areas presented as untested are useful;
untested areas presented as passing are how defects reach production.

### 4. Results

A summary table first, then the detail table.

| | Total | Pass | Fail | Blocked | Not run |
| --- | --- | --- | --- | --- | --- |
| P1 | | | | | |
| P2 | | | | | |
| P3 | | | | | |

Then per case: ID, title, priority, technique, status, evidence link, and a
one-line observation. Order failures first.

### 5. Defects

Every bug found in this cycle: key, title, severity, priority, status, and the
case that found it. Separate **new this cycle** from **pre-existing/known**.
Call out regressions explicitly - a defect in something that worked last build
is a different conversation than a defect in new code.

### 6. Coverage

Requirement-to-case traceability summary: how many requirements have coverage,
which have none, and coverage by technique (so a plan with no negative or
boundary cases is visible as such). Pull this from `traceability.md` produced by
**qa-analyze**.

State coverage honestly: it is the percentage of *identified* requirements with
at least one executed case. It is not a statement that the feature is 92%
bug-free, and the report should not let a reader believe it is.

### 7. Open questions

Unresolved `Q-` items with the assumption used and its blast radius. Any
blocking question still open on a P1 condition means the verdict cannot be Pass.

### 8. Environment and evidence

Build/commit, URLs, accounts (by role, never with passwords), data set used,
tooling versions, and where the evidence lives. Enough for someone to re-run
the cycle in three months.

## Generating It

Build the tables from the recorded result files rather than from memory:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/build_report.py" ./qa-results \
  --title "Checkout discount codes - QA-4410" \
  --out qa-report.html
```

This reads every `qa-results/*/result.json` - browser cases recorded with
`qa_record.py` and API cases from `api_harness.py` alike - builds the summary
and detail tables, embeds screenshots inline, and writes a self-contained HTML
report that can be shared as a file or attached to the ticket. Add the verdict,
risk summary, scope, and open questions with `--summary summary.md`; that file's
content is placed above the tables.

When the project *already has* a Playwright suite, fold its results into the same
report so the cycle is reported once. This is for including a suite someone runs
anyway - it is not how a test case gets executed, which is always through
`playwright-cli` (see **qa-test-ui**):

```bash
npx playwright test --reporter=json > qa-results/playwright.json
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/build_report.py" ./qa-results \
  --playwright-json qa-results/playwright.json --out qa-report.html
```

For a markdown report instead, pass `--format md`.

## Rules

- **Every claim traces to evidence.** A case marked Pass must have an artifact
  or an explicit note that it was verified manually and how.
- **Never report a case as passed if it was not run.** Use "Not run" and say why.
- **Counts must reconcile.** Total = pass + fail + blocked + not run, and the
  defect list must match the failed cases.
- **No adjectives about quality.** "The feature is solid" is not a finding.
  "18 of 18 P1 cases passed across Chrome and Safari; 3 S3 defects open" is.
- **Report the negative space.** Time spent, areas skipped, and cases that could
  not be executed belong in the report as prominently as the passes.

## Distribution

Deliver the HTML report as a file. When the user wants it on the ticket, invoke
**qa-jira** to post the summary as a comment on the feature issue and attach the
report - link the individual bug keys inline so the ticket becomes the record.
The comment follows Template A in `${CLAUDE_PLUGIN_ROOT}/templates/jira-comment.md`.

Keep a chat summary to five lines: verdict, counts, the top defect, the top
risk, and the recommended next action.
