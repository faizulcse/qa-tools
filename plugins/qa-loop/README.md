# qa-loop

The retest loop around **qa-agent**: find out what changed on a ticket, test
it safely, put the test data back, and post a clean Jira comment.

```
what changed? ──► test (safe tabs, OTP, toasts, waits) ──► restore data ──► comment
 qa-changes          qa-browser                            qa-ledger        qa-comment
```

## Install

```
/plugin marketplace add faizulcse/qa-tools
/plugin install qa-agent@qa-tools
/plugin install qa-loop@qa-tools
```

Requires the **qa-agent** plugin (qa-loop reuses its `jira_client.py` and
`.env` settings) and, for the browser helpers, **playwright-cli**. Python 3.8+
standard library only. No MCP servers.

## Skills

| Skill | Say | Does |
| --- | --- | --- |
| `qa-comment` | "draft only the issues with steps", "show the draft", "comment it", "update the comment" | Drafts from templates (issues / retest / pass), lints them, posts only after your OK, saves the posted copy, edits posted comments |
| `qa-changes` | "retest KEY", "what changed on KEY", "what's still open" | Comments, status and AC/description changes since my last comment (with a diff); unposted drafts and unrestored test data |
| `qa-ledger` | "did you restore everything", "what did you change" | Records each test-data change before it's made, checks it's restored or changed by someone else, writes the Test data lines |
| `qa-browser` | "the OTP is in yopmail", "impersonate the owner", "wait for the session to expire" | Tab guard, yopmail code reader, toast recorder, waits, deploy-error check |

## Scripts

Run from the project root (where `.env` and `docs/` live).

| Script | Commands |
| --- | --- |
| `scripts/qa_comment.py` | `new KEY --template issues\|retest\|pass`, `lint FILE [--fix]`, `post KEY FILE [--yes]`, `edit KEY ID FILE [--yes]`, `log` |
| `scripts/qa_changes.py` | `since-mine KEY [--since ISO] [--json]`, `open-items [--key KEY] [--no-jira]` |
| `scripts/qa_ledger.py` | `add`, `restore ID`, `keep ID --note`, `list`, `check`, `report --key KEY` |
| `scripts/qa_browser.py -s SESSION` | `tabs`, `use --host H [--open URL]`, `guard --host H`, `otp --inbox NAME [--type] [--after] [--back]`, `toast-watch`, `toast-read`, `wait --js EXPR`, `deploy-check` |

### Lint rules (`qa_comment.py lint`)

| Level | Rule |
| --- | --- |
| error | ticket keys (the ticket's own key in a heading is allowed: qa-agent removes it) |
| error | links (`--fix` removes them) |
| error | leftover `<<placeholders>>`, TODO/TBD/WIP |
| error | `**` that didn't convert to Jira bold |
| error | curly braces in the Jira text (read as macros) |
| warn | unmasked emails, `token:`/`password=`-style secrets, full UUIDs / long hex IDs, inline code |

Set `QA_LOOP_ALLOW_KEYS=1` or `QA_LOOP_ALLOW_LINKS=1` (or the flags) if your
team wants keys or links in comments.

## Settings (`.env` or environment)

| Variable | Default | Purpose |
| --- | --- | --- |
| `QA_LOOP_DOCS_DIR` | `JIRA_SPRINT_DOCS_DIR` or `docs` | Ticket folders (`docs/KEY/`) |
| `QA_LOOP_STATE_DIR` | `.qa-loop` | Ledger and posted-comment log (git-ignore it) |
| `QA_TESTER_NAME` | your Jira display name | "Tested by" in new drafts |
| `QA_AGENT_JIRA_CLIENT` | found automatically | Path to qa-agent's `jira_client.py` if it isn't next to qa-loop |
| `QA_LOOP_ALLOW_KEYS`, `QA_LOOP_ALLOW_LINKS` | off | Allow ticket keys / links in comments |

## Safety

- `post` and `edit` only preview without `--yes`; the skill passes `--yes`
  only after your explicit OK for that file.
- The ledger never stores passwords, codes or tokens; `otp` prints only the
  code and the skill uses it directly.
- Codes are read only from QA test inboxes on yopmail.com.
- `qa-changes` is read-only.
