# Changelog

## 0.2.0

- **qa-perms** (`qa_perms.py`): `whoami` preflight (user, masked email,
  role, scope, permissions) before planning a pass; `matrix` runs a JSON spec
  of API calls from the signed-in browser session and classifies each one as
  allowed, blocked, passed check (400/404 not found/409/422), no route
  ("Cannot GET"), signed out or server error, with ✅/❌ against
  `expect` and a warning when the session is signed out; `compare` flags
  calls where a limited account gets the same access as a full one. Vars can
  refer to other vars (`--var brand={fake}`).
- **qa-results** (`qa_results.py`): one results file per run
  (`docs/KEY/results-<date>.json`); `check` enforces the guardrails: evidence
  that exists for every failure, complete issues (steps, now/expected,
  severity), regressions re-checked, no contradiction of recorded decisions,
  no placeholders; `render --as report|comment` builds the Markdown report
  and the Jira draft (retest table, issues with steps, or pass summary) from
  the same data, with a computed verdict and the ledger's Test data line.
- **qa-decisions** (`qa_decisions.py`): per-ticket and global decisions
  (expected, ignore, out of scope, AC wording, BA decision, note) with an
  optional match pattern, used by `qa_results.py check` and `render`.

## 0.1.0

- First release: four skills for the QA retest loop on top of qa-agent.
- **qa-comment** (`qa_comment.py`): `new` drafts from the issues / retest /
  pass templates; `lint` blocks ticket keys, links, placeholders, unconverted
  bold and curly braces, and warns about unmasked emails, secrets, full IDs
  and inline code; `post` lints, previews without `--yes`, posts with it,
  saves the posted copy and logs the comment id; `edit` updates a posted
  comment; `log` lists them.
- **qa-changes** (`qa_changes.py`): `since-mine` shows other people's comments
  and status / assignee / description / AC changes (with a diff) since my last
  comment, with a retest hint; `open-items` lists unposted or edited drafts
  (matched against my Jira comments too) and unrestored test data per ticket.
- **qa-ledger** (`qa_ledger.py`): record a change before making it, restore
  or keep it, `check` it (restored / still changed / changed by someone
  else) and print the Test data lines for reports.
- **qa-browser** (`qa_browser.py`): switch tabs by host and guard before
  typing, read 6-digit codes from yopmail inboxes (exit 3 on yopmail's human
  check), record toasts, wait for a page condition, detect ChunkLoadError
  after a deploy, and say clearly when a playwright-cli session is closed.
