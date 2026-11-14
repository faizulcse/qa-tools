# Changelog

## Unreleased

- **`qa-setup.sh` creates `.env`** too, matching `qa-setup.mjs`: it copies
  `.env.example` to `.env` on the first run and leaves an existing `.env`
  unchanged. The READMEs no longer tell you to copy it by hand.

## 0.6.0

- **Jira comment template revised.** Template A reports earlier QA feedback as
  one table per feedback date (newest first) instead of a required Issues found
  section; Issues found, Questions, Recommendation and the report pointer are
  now optional. Tickets without ACs use the story requirement as AC1. Status
  icons add Fixed and Open, the verdict guide counts open earlier feedback,
  headings drop the ticket key, and the writing rules, formatting notes and
  posting checklist are updated to match.
- **`qa-setup.mjs` creates `.env`.** On first run it copies `.env.example` to
  `.env`; an existing `.env` is left unchanged. (`qa-setup.sh` still creates
  only `.env.example`.)

## 0.5.0

- **Jira comment template.** New `templates/jira-comment.md` with two comment
  shapes - Testing Summary (results per AC, totals, issues by S1-S4 severity)
  and Retest - plus status icons, a verdict guide, writing rules, Jira
  formatting notes, and a posting checklist. `qa-jira` and `qa-report` now use
  it when posting results to a ticket.

## 0.4.0

- **Removed the MCP server.** Deleted `.mcp.json` and the `mcpServers` manifest
  key. The plugin declares no MCP servers and needs no connectors; all Jira
  access goes through the bundled REST client.
- **First-run project context.** Before the first test in a working folder, the
  agent asks once — optionally — for the frontend and backend project paths,
  framework, test-id convention, API base URL, and contract file. Recorded in
  `.qa-agent/context.json` so it is never asked twice. Declining is remembered
  too. New `scripts/qa_context.py`.
- With source available, `qa-analyze` grounds requirements in the real
  validation code (disagreements become `Q-` items), `qa-test-api` reads the
  endpoint's serializer instead of trusting a stale spec, and `qa-bug` may cite
  a file and line — marked unverified unless the link was reproduced.
- **Jira search migrated to the v3 enhanced-search endpoint.** `search` and
  `duplicates` now call `/rest/api/3/search/jql` with `nextPageToken` cursor
  pagination (`/rest/api/2/search` was retired on Cloud). `search` paginates to
  `--max` at up to 100 per page; counts printed are what was fetched, since the
  endpoint returns no `total`. These two commands are Cloud-only — `/rest/api/3/`
  does not exist on Data Center.

  Known issue: `fields` still calls the classic
  `GET /rest/api/2/issue/createmeta`, which was removed on Jira Cloud in favour
  of `/issue/createmeta/{projectIdOrKey}/issuetypes`. Expect a 404 on Cloud.

## 0.3.0

- **playwright-cli is the only execution path.** Writing Playwright spec files
  or scripts to execute a case is now forbidden — no `npx playwright test`, no
  `page.*` through `run-code` as a substitute for a subcommand. Generating specs
  is a separate, opt-in task.
- **A page snapshot is saved at every step**, into the case evidence directory
  as `NN-<what-happened>.snapshot.md`, attached to the recorded case and
  rendered into the HTML report. `qa_record.py finish` warns when a case
  recorded none. Diffing two snapshots shows exactly what an action changed.
- Filtered playwright-cli's update banner out of recorded console evidence.

## 0.2.0

- Browser execution moved from a custom Playwright harness to **playwright-cli**
  and its official installed skills. `qa-harness.mjs` removed.
- New `scripts/qa_record.py` records steps, checks, and evidence, preserving the
  `result.json` contract that reporting and bug filing depend on.
- `build_report.py` also ingests `npx playwright test --reporter=json`, so a
  cycle mixing hand-driven cases with an existing suite produces one report.
- Cross-platform `qa-setup.mjs` alongside the bash setup script.

## 0.1.0

- Initial release: `qa-analyze`, `qa-test-ui`, `qa-test-api`, `qa-bug`,
  `qa-report`, `qa-jira`, with four reference files behind `qa-analyze`
  (test-design techniques, ambiguity checklist, coverage heuristics, risk
  scoring) and a zero-dependency Jira REST client.
