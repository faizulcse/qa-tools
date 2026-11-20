---
name: qa-changes
description: >
  This skill should be used before retesting a ticket and when the user asks
  what is still open - "retest KEY", "retest the feedback", "is it ready for
  retest", "what changed on KEY", "did the developer reply", "the acceptance
  criteria were updated, test again", "what's still open", "which drafts are
  not posted", "what test data did I leave changed". Shows everything on a
  ticket since my last comment (other people's comments, status and assignee
  changes, description / AC edits with a diff) and lists unposted or edited
  drafts and unrestored test data across ticket folders. Read-only. Requires
  qa-agent (uses its Jira client and .env).
metadata:
  version: "0.1.0"
---

# What changed, and what is still open

Script: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_changes.py <command>`
Run it from the project root. It only reads.

## Before every retest

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_changes.py since-mine KEY
```

It prints, since my last comment on KEY:

- **Comments from others**, e.g. "ready for testing in dev", "other issue has
  been also resolved", explanations such as preconditions for a feature.
- **Field changes**: status, assignee, labels, sprint, and **description /
  acceptance-criteria edits as a line diff**.
- **Hint**: a developer said it's ready → retest; the ACs changed → re-read
  them first; or nothing says it's ready yet.

Use it to decide scope:

- Retest exactly the items in my last QA comment, plus anything a developer
  comment or an AC edit changed.
- If the ACs changed, test against the **new** text and say so in the report
  ("AC2 updated on <date> to …").
- If a developer comment explains a precondition (e.g. "the section only
  appears when …"), set that state up before testing, and record any data you
  change with `qa-ledger`.
- If nothing says it's ready, tell the user before spending time on a full
  retest.

`--since 2026-11-20T18:51:00.000+0600` overrides "my last comment".
`--json` gives the same data for further processing.

## What is still open

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_changes.py open-items [--key KEY]
```

Per ticket (with its current status):

- drafts that were **never posted** (a draft counts as posted when qa-loop
  posted it, a matching `-posted` copy exists, or one of my Jira comments on
  the ticket has nearly the same text);
- drafts **changed after posting**;
- **test data not restored** (open ledger entries).

Use it at the end of a session or when the user asks what's left, and offer
to post, delete or update stale drafts. `--no-jira` skips the Jira lookups.
