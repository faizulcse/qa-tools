---
name: qa-sprint
description: >
  This skill should be used when the user asks about the current sprint's
  tickets from a QA point of view - "show the sprint tickets", "sprint review",
  "sprint ticket list", "what's in the sprint", "which sprint tickets are mine",
  "what do I still need to test this sprint", "all tickets in the sprint", or
  names a sprint ("review Sprint 14"). Lists the sprint's tickets (filtered by
  label unless "all tickets" is asked for) with status, assignee, whether each
  is assigned to me now or was earlier, and my QA work (my comments, QA reports
  and unposted comment drafts), then summarizes what needs action. Read-only.
metadata:
  version: "0.1.0"
---

# Sprint Ticket Review

Answers: **what is in this sprint, which of it is mine, and what QA work is
still outstanding?** The output shape, column rules and sources are in
`${CLAUDE_PLUGIN_ROOT}/templates/sprint-review.md` - read it before the first
review in a session and follow it exactly.

This review only reads. It never comments, assigns or transitions.

## 1. Settings

Work out, in this order of precedence:

| Setting | From the request | Else `.env` | Else |
| --- | --- | --- | --- |
| Project | "for PROJ" | `JIRA_SPRINT_PROJECT` | ask once |
| Sprint | "Sprint 14" | - | the open sprint |
| Labels | "the web tickets", "label mobile" | `JIRA_SPRINT_LABELS` | none: every sprint ticket |
| All tickets | "all tickets" (ignores the labels) | - | - |
| Status order | "show In QA first" | `JIRA_SPRINT_STATUS_ORDER` | QA statuses first, then In Progress, To Do, Done categories |
| QA statuses | "In QA and UAT are the QA statuses" | `JIRA_SPRINT_QA_STATUSES` | names containing test, qa, review or verif |
| Docs folder | - | `JIRA_SPRINT_DOCS_DIR` | `docs` |
| Report / draft file names | - | `JIRA_SPRINT_REPORT_FILES`, `JIRA_SPRINT_DRAFT_FILE` | `qa-report.md,qa-report.html`, `jira-comment-draft.md` |

Do not assume a workflow. If the guessed QA statuses miss the project's real
ones (the JSON `settings` shows what was used), ask which statuses mean
"waiting for QA" and pass `--qa-statuses`.

When you had to ask for the project, labels or QA statuses, offer to save it to `.env` as the
keys above so the next review needs no questions. Credentials come from `.env`
as in `qa-jira`; never print them. If `jira_client.py check` fails, follow the
setup steps in the `qa-jira` skill.

## 2. Fetch

One call gathers everything - the search, my account, each ticket's assignee
changelog and comments, and the local QA files:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" sprint \
  --project PROJ --labels web --json
#  --sprint "Sprint 14"        a named sprint instead of the open one
#  --all                       every sprint ticket, ignoring --labels
#  --status-order "In QA,In Progress"   statuses to list first
#  --qa-statuses "In QA,UAT"   statuses that mean waiting for QA
#  --docs-dir docs             where <KEY>/ QA files live
#  --report-files / --draft-file   QA file names in that folder
```

Labels are matched case-insensitively by adding the common spellings
(`web`, `WEB`, `Web`). Every flag falls back to its `.env` key. Without `--json` it prints a ready table;
use `--json` so you can phrase the "My QA work" cell and the summary.

The JSON gives `settings` (what was actually used) and, per ticket:
`status`, `in_qa_status`, `assigned_to_me` (`Now`, `Earlier` or empty),
`my_comment_dates`, `reports` (report files found), `draft`, `draft_unposted`,
`other_docs` and `needs_my_qa` (in a QA status, no comment or file from me).
Tickets come back already sorted: status, then mine (Now, Earlier), then key.

Confirm the sprint name from `sprints`. If it is empty, the sprint field was
not found or no ticket matched; say which, and show the JQL that was run.

The command uses `/rest/api/3/`, so it is Jira Cloud only. On Data Center, say
so and fall back to `jira_client.py search` plus `get` per ticket.

## 3. Write the review

Follow the **Output** section of the template:

1. A header line: sprint name, project, filter, ticket count.
2. One table: `| Key | Title | Status | Assignee | Assigned to me | My QA work |`,
   in the order returned.
   - **Assigned to me:** `✅ Now`, `Earlier`, or `–`.
   - **My QA work:** my comment dates (`✅ Tested 12 Nov` or `✅ Commented 12 Nov`),
     `report done` when `reports` is not empty, and `⚠️ comment drafted, not
     posted` when `draft_unposted` is true. Join with ` · `. `–` when there is
     nothing. Call it "Tested" only when the comment or report shows testing.
   - Replace `|` in titles with `/`.
3. The summary: mine now and earlier (with keys); anything of mine that needs
   action; tickets with `needs_my_qa` (in a QA status, no QA work from me).
4. One suggested next step - the most useful single action, e.g. "Post the
   drafted comment on PROJ-201 (qa-jira)" or "Start PROJ-198: it is in QA
   with no QA work yet (qa-analyze)".

`draft_unposted` compares dates only. Before telling the user a draft was
posted, or before suggesting they post it, open
the draft file in `<docs>/<KEY>/` and the latest comment with
`jira_client.py get <KEY>` when in doubt, and check they say the same thing.

## Rules

- **Read-only.** Posting a draft, assigning or transitioning is a next step,
  done through `qa-jira` with its confirmation rules.
- **Respect the label filter.** When labels are set, show every sprint ticket
  only when the user says "all tickets".
- **Nothing project-specific is built in.** Project, labels, statuses and file
  names come from the request or `.env`; never hard-code one team's values.
- **No account IDs or emails in the output**, only display names.
- **Report what the data shows.** "No QA work" means none by me, not that
  nobody tested it.
