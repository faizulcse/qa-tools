---
name: qa-comment
description: >
  This skill should be used whenever a QA comment for a Jira ticket is drafted,
  checked, posted or changed - "draft the comment", "draft only the issues with
  steps", "show the draft", "comment it", "post it", "update the comment",
  "remove the links from the comment", "make a retest comment", "write the pass
  comment". Starts drafts from the issues / retest / pass templates, lints them
  (ticket keys, links, curly braces, unconverted bold, leftover placeholders,
  unmasked emails, secrets and full IDs), posts only after the user's explicit
  OK, saves the posted copy next to the draft and can edit a posted comment.
  Requires qa-agent (uses its Jira client and .env).
metadata:
  version: "0.1.0"
---

# QA Comments: draft → lint → show → post → saved copy

Script: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_comment.py <command>`
Run it from the project root (where `.env` and `docs/` are).

## Rules that always apply

- **Show the draft, post only on an explicit OK** ("comment it", "post it",
  "yes post"). Approval of one draft is not approval of another.
- `post` and `edit` **without `--yes` only preview**. Pass `--yes` only after
  the OK for that exact file.
- **No ticket keys and no links** in comment text, unless the user asks for
  them (`--allow-keys` / `--allow-links`). The ticket's own key in a heading
  is removed automatically.
- Keep unmasked emails, tokens, passwords, OTP codes and full IDs out of
  comments. Lint warns about them; fix every warning that is real.
- If the project has its own comment template or rules (for example
  `docs/templates/jira-testing-summary-template.md` or a memory note), follow
  them first. The built-in templates are the fallback.

## 1. Start a draft

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_comment.py new KEY --template issues|retest|pass \
  --env "dev (Admin console)"
```

| Template | Use for | Shape |
|---|---|---|
| `issues` | new problems found ("draft only the issues with steps") | summary table, then per issue: **Steps** + "What happens now ❌ / What should happen ✅" table, then "What passed" |
| `retest` | checking earlier feedback | Status / Issue (date) / Retest result table, "No regression" line |
| `pass` | everything passed | Status / AC / Outcome table |

It writes `docs/KEY/jira-comment-<template>-draft-<date>.md` with the ticket
summary, tester and date filled in. Replace every `<<…>>` placeholder (lint
fails on any that remain). Keep `<restaurant>`-style generic placeholders
only where the comment really means "any".

Writing tips that worked well: quote exact UI text in quotes; one issue per
section; severity S1–S4 with ❌ for failures and ⚠️ for partial; end with a
one-line `_Test data: …_` (from `qa_ledger.py report --key KEY` when the
ledger was used).

## 2. Lint

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_comment.py lint docs/KEY/<draft>.md --key KEY [--fix]
```

Errors block posting: ticket keys, links, `<<placeholders>>`, `**` that
did not convert, curly braces in the Jira text (Jira reads them as macros).
`--fix` removes links in place. Warnings (emails, secrets, full IDs, inline
code) need a human look.

## 3. Show, then post

Show the user the draft text (the Markdown, not the Jira wiki text). After
an explicit OK:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_comment.py post KEY docs/KEY/<draft>.md --yes
```

It lints again, posts, prints the comment id, saves the posted copy
(`…draft…` → `…posted…`, with today's date if the name has none) and logs it in
`.qa-loop/comments.jsonl`. Report: ticket, time, comment id, posted-copy path.

## 4. Change a posted comment

When the user asks to update or fix a comment already on Jira, edit the
posted copy (or the draft), show the change, and after the OK:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_comment.py edit KEY COMMENT_ID docs/KEY/<file>.md --yes
```

Without `--yes` it prints the current and the new text side by side.
`qa_comment.py log [--key KEY]` lists comment ids posted through qa-loop.
