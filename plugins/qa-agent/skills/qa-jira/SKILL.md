---
name: qa-jira
description: >
  This skill should be used for any Jira interaction in the QA workflow -
  "pull up ticket PROJ-123", "get the acceptance criteria from Jira", "what does
  this ticket say", "file this to Jira", "create a Jira bug", "comment on the
  ticket", "attach the report to the ticket", "find similar bugs", "what's in QA
  right now", or whenever a Jira issue key like PROJ-1234 appears in a QA
  request. Uses a bundled zero-dependency REST client - no MCP server or
  connector required.
metadata:
  version: "0.2.0"
---

# Jira Integration

All Jira access goes through the bundled REST client at
`${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py` - zero dependencies, Python 3.8+,
no MCP server and no connector to install. It works the same interactively and
in unattended runs.

Verify it once before relying on it:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" check
```

It prints the authenticated user and the visible projects. If it fails, walk the
user through creating a `.env` in the working folder:

```
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=...        # id.atlassian.com/manage-profile/security/api-tokens
```

For Jira Data Center/Server, use `JIRA_PAT=` instead of email + token. Add
`.env` to `.gitignore`. Never print the token back to the user or write it into
any file other than `.env`.

## Reading a Ticket for Test Analysis

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" get PROJ-1234
```

This returns description, status, components, labels, fix versions, subtasks,
linked issues, attachments, and **all comments**.

When feeding a ticket into **qa-analyze**, extract in this order:

1. **Acceptance criteria** - usually a custom field or a checklist in the
   description. Discover the field ID once with `fields --project PROJ` and set
   `JIRA_AC_FIELD=customfield_XXXXX` in `.env` so later runs pick it up.
2. **Description** - the prose requirements.
3. **Comments, oldest to newest.** Scope changes, clarifications, and "actually
   we decided..." live here and routinely contradict the description. When they
   conflict, treat the newest as current, flag the conflict as a `Q-` item, and
   cite both locations.
4. **Attachments** - designs, specs, API contracts. Download and read them.
5. **Linked issues** - "blocks", "relates to", and especially "caused by" links
   to previous bugs in the same area, which tell you where to focus.
6. **Subtasks** - often the real breakdown of what was actually built.

Report what the ticket does **not** contain as clearly as what it does. A ticket
with three vague ACs and no error-handling requirements is itself a finding.

Useful searches:

```bash
# What is waiting for QA
jira_client.py search "project = PROJ AND status = 'Ready for QA' ORDER BY priority DESC"
# Past defects in this component - where to focus regression testing
jira_client.py search "project = PROJ AND component = Checkout AND issuetype = Bug ORDER BY created DESC" --max 20
```

## Filing a Bug

**Always show the user the completed report and confirm before creating the
issue.** Filing is a write to a shared system.

Check for duplicates first:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" duplicates \
  --project PROJ --terms "discount code expired accepted"
```

Discover the project's fields once (severity, sprint, environment fields vary by
instance):

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" fields --project PROJ --issuetype Bug
```

Preview with `--dry-run`, then file:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" create-bug \
  --project PROJ \
  --summary "[Checkout] Expired discount code is accepted and reduces the order total" \
  --description-file bug-QA-4471.md \
  --priority Highest \
  --severity Critical \
  --components Checkout \
  --labels qa-agent,regression,checkout \
  --affects-version "2026.8.0" \
  --link-to PROJ-1234 --link-type "Relates" \
  --attach qa-results/tc-07/05-apply-code.png \
  --attach qa-results/tc-07/result.json \
  --dry-run
```

Markdown in the description file is converted to Jira wiki markup
automatically - headings, bold, inline code, fenced code blocks, lists, links,
and tables.

Field notes:

- `--severity` needs `--severity-field customfield_XXXXX` or
  `JIRA_SEVERITY_FIELD` in `.env`; many instances have no severity field at all,
  in which case put severity in the description and use labels.
- `--field id=value` sets any other field; the value may be JSON
  (`--field customfield_10030='{"value":"Staging"}'`).
- Required fields vary by project. If creation fails with a field error, run
  `fields` and add what the project demands rather than guessing.

After filing, report the key and URL, and tell the user what was attached.

## Posting Test Results

Attach the cycle report to the feature ticket and post the verdict as a comment:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" attach PROJ-1234 qa-report.html
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" comment PROJ-1234 --body-file verdict.md
```

Write the comment from `${CLAUDE_PLUGIN_ROOT}/templates/jira-comment.md`:
**Template A (Testing Summary)** after testing a ticket against its acceptance
criteria, **Template B (Retest)** after a developer reports an issue as fixed.
Follow its status icons, S1-S4 severity scale, verdict guide, and posting
checklist. Reference filed bug keys (Jira links them automatically) and say
where the full evidence lives. Keep it short - the report is the attachment,
the comment is the headline. Preview with `comment ... --dry-run` and confirm
before posting.

Moving the ticket's status is a team-process decision. List transitions and ask
before performing one:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" transition PROJ-1234
```

## Rules

- **Confirm before every write.** Create, comment, attach, and transition all
  modify a shared system. Preview with `--dry-run` and get an explicit go-ahead.
  In an unattended run, write the payload to a file for review and do not send
  it unless the user pre-authorized filing for that run.
- **Never create duplicates.** Search first; comment on the existing bug with
  new evidence instead.
- **Never edit or close someone else's issue** unless asked.
- **Redact before attaching.** Screenshots and `result.json` can contain tokens,
  emails, and customer data. Check them, and tell the user what an attachment
  contains before uploading it.
- **Quote, do not paraphrase, acceptance criteria.** When a bug's expected
  result cites AC-3, use the ticket's exact words.
- **Keep credentials in `.env`.** Never in a case file, a command the user can
  see echoed, a commit, or a Jira comment.
