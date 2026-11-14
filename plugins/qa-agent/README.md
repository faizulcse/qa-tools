# QA Agent

An agentic QA assistant for manual testing. It reads the requirements, works out
what should be tested, executes what can be executed, and writes up what it
found - in browser, against APIs, and into Jira.

## What it does

| Skill | Trigger it by saying | What it produces |
| --- | --- | --- |
| **qa-analyze** | "analyze PROJ-1234", "what should I test", "write test cases for this" | `test-plan.md`, `traceability.md`, `open-questions.md` |
| **qa-test-ui** | "run these tests", "test this on staging", "reproduce this bug" | playwright-cli session + page snapshots, screenshots, console, network, trace |
| **qa-test-api** | "test this endpoint", "validate the API contract" | Recorded request/response evidence per case |
| **qa-bug** | "file a bug", "write this up", "what severity is this" | Structured bug report, filed to Jira on approval |
| **qa-report** | "write the test report", "prepare sign-off" | Self-contained HTML or Markdown cycle report |
| **qa-jira** | "pull up PROJ-1234", "file it to Jira" | Ticket reads, bug creation, comments, attachments |

The intended loop: **analyze → execute → report defects → summarize → file**.
Any skill can be used on its own.

## First run in a project

Before the first test in a working folder, the agent asks once — **optional** —
whether you have the frontend and/or backend source handy. Point it at them and
it reads the real validation rules, routes, and API contract instead of
inferring them, which sharpens the test cases and lets bug reports cite a
specific file. Decline and everything still works against the running app.

The answer is remembered in `.qa-agent/context.json` in the working folder, so
you are asked once and never again:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/scripts/qa_context.py" show    # what's known
python3 "$CLAUDE_PLUGIN_ROOT/scripts/qa_context.py" clear   # ask me again
```

## How browser execution works

Two rules `qa-test-ui` holds to, because they are what separate this from
writing an automation suite:

1. **Execution is `playwright-cli` commands only.** The agent never writes a
   spec file, a script, or `page.*` code to carry out a test case, and never
   runs `npx playwright test` as a way to execute one. It opens the browser,
   reads the accessibility snapshot, acts on element refs, and asserts with
   `find` - the way a person tests. Generating spec files is a separate,
   opt-in task, only when you ask for automation.
2. **Every step saves a page snapshot.** `playwright-cli` writes transient
   snapshots under `.playwright-cli/`; the skill saves its own copy per step
   into the case's evidence directory as `NN-<what-happened>.snapshot.md`.
   Those are attached to the recorded case and rendered into the HTML report,
   so a reviewer can see the tree each assertion was made against - and
   diffing two snapshots shows exactly what an action changed.

## Depth is in requirements analysis

`qa-analyze` is the heart of this plugin and carries four reference files it
loads on demand:

- `test-design-techniques.md` - equivalence partitioning, boundary values,
  decision tables, state transition, pairwise, CRUD/permissions matrices,
  negative input, concurrency, regression blast radius, oracle selection.
- `ambiguity-checklist.md` - requirement smells and a question bank that turns a
  thin ticket into a list of answerable questions before testing starts.
- `coverage-heuristics.md` - condition checklists per feature type: forms, auth,
  lists, search, uploads, permissions, payments, notifications, reports,
  real-time, accessibility, responsive, localization.
- `risk-scoring.md` - risk model, P1/P2/P3 rubric, severity definitions, and the
  sign-off decision rule.

Ambiguities are reported as `Q-` items with the assumption used and its blast
radius, rather than silently guessed at.

## Setup

### Browser testing (one time per project)

Execution runs on [playwright-cli](https://playwright.dev/agent-cli/introduction),
Microsoft's browser CLI for coding agents, plus the official skills it installs.
Requires Node 18+.

macOS / Linux:

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/qa-setup.sh" ./qa-workspace   # then fill in qa-workspace/.env
```

Windows (or anywhere without bash) — same result, no shell required:

```powershell
node "%CLAUDE_PLUGIN_ROOT%\scripts\qa-setup.mjs" .\qa-workspace
```

Either script installs `@playwright/cli`, runs `playwright-cli install --skills`
to place the official Playwright skill files, adds the Playwright test runner for
cases promoted to specs, and downloads Chromium. Both also create `.env` from `.env.example` on the first
run and leave an existing `.env` alone. Or do it yourself:

```bash
npm install -g @playwright/cli@latest
playwright-cli install --skills
```

If the Chromium download is blocked by a proxy, set `HTTPS_PROXY` and re-run, or
drive an installed browser with `playwright-cli open --browser=chrome`.

### API testing

No setup. `scripts/api_harness.py` uses only the Python standard library.

### Jira

All Jira access uses the bundled REST client - no MCP server, no connector.
Create a `.env` in the working folder:

```
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=...
# Optional, discover with: jira_client.py fields --project PROJ
JIRA_AC_FIELD=customfield_10101
JIRA_SEVERITY_FIELD=customfield_10202
```

Then verify:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/scripts/jira_client.py" check
```

Jira Data Center/Server: use `JIRA_PAT=` in place of email + token.

**Add `.env` to `.gitignore`.**

## A typical session

```
"Analyze PROJ-1234 and build me a test plan"
   -> pulls the ticket, ACs, comments, attachments
   -> requirement inventory, feature model, Q- items
   -> risk-ordered test cases + traceability matrix

"Run the P1 cases against staging"
   -> drives the browser with playwright-cli, reading the accessibility
      snapshot after each action, recording evidence per step

"TC-07 failed - file it"
   -> classifies the failure, checks for duplicates, drafts the report
   -> shows it to you, files to Jira on your OK, attaches the evidence

"Write the report and post it to the ticket"
   -> HTML report from the result files, comment + attachment on PROJ-1234
```

## Bundled scripts

| Script | Purpose |
| --- | --- |
| `scripts/qa-setup.sh` | Install playwright-cli + skills and build the workspace (bash) |
| `scripts/qa-setup.mjs` | Same, cross-platform - Windows, macOS, Linux |
| `scripts/qa_context.py` | Remember the project's frontend/backend, asked once per folder |
| `scripts/qa_record.py` | Record a playwright-cli run as steps, checks, snapshots, and evidence |
| `scripts/api_harness.py` | HTTP case runner with redaction and recorded exchanges |
| `scripts/build_report.py` | Turn `result.json` (and Playwright runner JSON) into an HTML/MD report |
| `scripts/jira_client.py` | Jira REST: get, search, fields, duplicates, create-bug, comment, attach, transition |

Templates for hand-written artifacts live in `templates/`:

| Template | Used for |
| --- | --- |
| `templates/test-plan.md` | Test plan produced by `qa-analyze` |
| `templates/bug-report.md` | Bug report produced by `qa-bug` |
| `templates/jira-comment.md` | Jira comments: Testing Summary (A) and Retest (B) |
| `templates/example-session.md`, `templates/example-case.py` | Worked examples |

## Safety rules the skills follow

- Confirm before any write to a shared system - test data, Jira issues, comments.
- Never run destructive cases against production.
- Credentials live in `.env` only; auth headers and known secret keys are
  redacted from all recorded evidence.
- A failure is classified (product defect / test defect / environment / spec
  ambiguity) and re-run before it is filed as a bug.
- Nothing is reported as passed that was not actually observed.
