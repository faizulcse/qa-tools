# Changelog

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
