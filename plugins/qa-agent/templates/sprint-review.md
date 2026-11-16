# Sprint Ticket Review

Template for the `qa-sprint` skill: the sprint's tickets, which of them are
mine, and what QA work I have done on each. Works with any Jira Cloud project
and workflow; everything project-specific is a setting.

## Settings

Pass them in the request, or keep them in `.env` so a plain "sprint review"
needs no questions. Only the project is required.

| Setting | Meaning | `.env` key | Default |
| --- | --- | --- | --- |
| Project | Jira project key | `JIRA_SPRINT_PROJECT` | - (asked once) |
| Labels | Only tickets with one of these labels; matched case-insensitively | `JIRA_SPRINT_LABELS` | none: every sprint ticket |
| Status order | Statuses to list first, in this order | `JIRA_SPRINT_STATUS_ORDER` | QA statuses first, then by status category: In Progress, To Do, Done |
| QA statuses | Statuses that mean "waiting for QA" | `JIRA_SPRINT_QA_STATUSES` | any status whose name contains test, qa, review or verif |
| Docs folder | Where per-ticket QA files live, as `<folder>/<KEY>/` | `JIRA_SPRINT_DOCS_DIR` | `docs` |
| Report files | File names that count as a QA report | `JIRA_SPRINT_REPORT_FILES` | `qa-report.md,qa-report.html` |
| Draft file | File name of an unposted Jira comment | `JIRA_SPRINT_DRAFT_FILE` | `jira-comment-draft.md` |

"Me" is always the account behind the Jira credentials in `.env`.

## The prompt

```text
Review the Jira sprint tickets for project <PROJECT> (the open sprint, unless
I name another one).

1. Fetch the sprint tickets: key, title, status, assignee. If labels are set,
   keep only tickets with one of <LABELS> (case-insensitive). Only show every
   sprint ticket if I ask for "all tickets". Use the Jira credentials in .env
   (never print them). Confirm the sprint name from the sprint field.
2. For each ticket, work out my involvement (I am the account in .env):
   - "Assigned to me": ✅ Now if I'm the current assignee; Earlier if the
     changelog shows it was assigned to me before; – otherwise.
   - "My QA work": the dates of my comments on the ticket, plus whether a QA
     report or comment draft exists in <DOCS>/<KEY>/. Mark a draft that hasn't
     been posted as "⚠️ comment drafted, not posted".
3. Show one table with these columns, in this order:
   | Key | Title | Status | Assignee | Assigned to me | My QA work |
   Sort by status (<STATUS ORDER>). Within each status, put my tickets (Now,
   then Earlier) first, then the rest by key.
4. After the table, give a short summary:
   - how many tickets are mine: Now, and Earlier (with keys);
   - anything of mine that needs action (e.g. a drafted comment not posted);
   - tickets in a QA status that have no QA work from me yet.
5. End with one suggested next step.
```

## Output

```markdown
**Sprint:** <sprint name> · **Project:** <PROJECT> · **Filter:** <labels, or all tickets> · <N> tickets

| Key | Title | Status | Assignee | Assigned to me | My QA work |
|---|---|---|---|---|---|
| <KEY> | <title> | <status> | <name> | ✅ Now / Earlier / – | <dates and files, or –> |

**Mine:** <n> now (<keys>), <n> earlier (<keys>).
**Needs action:** <KEY>: <what>, or "nothing".
**No QA work yet:** <keys in a QA status with no comment or file from me>, or "none".

**Next step:** <one concrete action>.
```

### Example rows

| Key | Title | Status | Assignee | Assigned to me | My QA work |
|---|---|---|---|---|---|
| PROJ-201 | Password reset email | In QA | QA Engineer (me) | ✅ Now | ✅ Tested 12 Nov, report done · ⚠️ comment drafted, not posted |
| PROJ-202 | Export orders to CSV | In QA | Another QA | Earlier | ✅ Report + comment (13 Nov) |
| PROJ-198 | Checkout discount codes | In QA | A Developer | – | – |
| PROJ-210 | Profile page layout | In Progress | A Developer | – | – |

## How each column is checked

| Column | Source |
|---|---|
| Tickets | JQL `project = <PROJECT> AND sprint in openSprints()`, a named sprint as `sprint = "<name>"`, plus `labels in (<label variants>)` when labels are set |
| Sprint name | the sprint custom field on the returned tickets (state `active`, or the named sprint) |
| Status, Assignee | the same search, fields `status, assignee` |
| Assigned to me: Now | `assignee.accountId` equals the `/rest/api/3/myself` accountId |
| Assigned to me: Earlier | changelog `assignee` items whose `from` or `to` is my accountId |
| My QA work: comments | comments whose `author.accountId` is mine, by date |
| My QA work: files | report files and the draft file in `<DOCS>/<KEY>/` |
| Drafted, not posted | a draft file with no comment of mine dated after the file was last changed |

`jira_client.py sprint` does all of the above in one call. Its "not posted"
check is a date comparison: when it matters, open the draft and the latest
comment and confirm they match before telling the user it was posted.

## Rules

- Read-only. This review never comments, transitions or assigns; offer those as
  the next step and use `qa-jira` (with its confirmation rules) if accepted.
- Never print the Jira credentials, and never put account IDs or emails in the
  output, only display names.
- Report only what the data shows. "No QA work" means no comment by me and no
  QA file, not that nobody tested the ticket.
