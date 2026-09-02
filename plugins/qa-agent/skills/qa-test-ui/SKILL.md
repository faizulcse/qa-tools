---
name: qa-test-ui
description: >
  This skill should be used when the user wants test cases actually executed in
  a real browser - "run these tests", "test this in the browser", "execute the
  test plan", "verify this on staging", "reproduce this bug", "click through
  this flow", "take screenshots of the failure", "explore this feature", or any
  request to drive a web application and report what happened. Execution is
  always via playwright-cli commands - never by writing Playwright spec files
  or scripts - and every step saves a page snapshot as evidence.
metadata:
  version: "0.4.0"
---

# Browser Test Execution

Drive the application the way a tester does - look at the page, decide, act,
look again - using `playwright-cli`. Report what actually happened; never mark a
step passed without having observed it.

## Two Non-Negotiable Rules

**1. Execute with `playwright-cli` commands. Never by writing Playwright code.**

Every browser action in this skill is a `playwright-cli` subcommand run through
the shell. Do not write a `.spec.ts`/`.spec.js` file, a `.mjs` script, or any
other Playwright program to execute a test case, and do not run `npx playwright
test`, `playwright codegen`, or `page.*` code through `run-code` as the way to
carry out a step. Those produce a program that must be debugged before it can
find a defect, which is the opposite of manual testing.

If a step seems to need scripting, it almost certainly maps to a subcommand -
check `playwright-cli --help` and `references/playwright-cli-recipes.md` first.
The only exception is a browser-level capability with no subcommand at all (for
example granting a permission), where a single `run-code` call is acceptable;
say so when you use one.

Writing spec files is a *separate, opt-in* activity - see "Promoting a Case",
last section. Never do it as part of executing a case.

**2. Save a page snapshot at every step.**

`playwright-cli` writes a snapshot to `.playwright-cli/page-<timestamp>.yml`
after each command, but those are transient, auto-named, and overwritten as the
session goes. Save your own copy into the case's evidence directory:

```bash
playwright-cli -s=qa snapshot --filename=$OUT/02-after-apply.snapshot.md
```

Then attach it to the recorded step with `--snapshot`. The snapshot is the
accessibility tree you asserted against - it is what makes a result auditable
after the fact, and what lets a developer see the DOM state without rerunning
anything. A case recorded with no snapshots is incomplete evidence.

## Tooling

Execution runs on **playwright-cli** (Microsoft's browser CLI for coding agents)
plus its own installed skills. Verify it is present before starting:

```bash
playwright-cli --help
```

If missing, install it once:

```bash
npm install -g @playwright/cli@latest
playwright-cli install --skills
playwright-cli install-browser chromium
```

`install --skills` places the official Playwright skill files locally. They
cover running and debugging tests, request mocking, running Playwright code,
session management, storage state, test generation, tracing, video recording,
and inspecting element attributes. **Consult those skills for command detail** -
they are the authority on syntax. This skill covers the QA workflow around them,
and `references/playwright-cli-recipes.md` holds the QA-specific recipes.

The plugin's setup script installs all of this:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/qa-setup.sh" ./qa-workspace      # macOS/Linux
node "${CLAUDE_PLUGIN_ROOT}/scripts/qa-setup.mjs" ./qa-workspace     # any OS
```

## First Run in a Project - Ask About the Codebase

Before the first test in a working folder, check whether project context has
already been gathered:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/qa_context.py" status
```

Exit 1 means it has never been asked. Ask once, then record the answer. Exit 0
means it is settled - read it with `show` and never ask again.

Put the question to the user as **optional**, and say what it buys them:

> Do you have the frontend and/or backend source for this application handy? If
> you point me at them I can read the real validation rules, routes, and API
> contract instead of inferring them - which makes the test cases sharper and
> the bug reports more specific. Entirely optional; I can test the running app
> without it.

Worth capturing, all optional:

| Field | Why it helps |
| --- | --- |
| Frontend path | Real routes, components, states, and copy strings |
| Frontend framework | Which rendering and validation behavior to expect |
| Frontend URL | The dev/staging address to drive |
| Test-id attribute | The project's own convention (`data-testid`, `data-cy`) |
| Backend path | Actual validation rules, permissions, error codes |
| Backend framework | Expected error shapes and status-code conventions |
| API base URL | Where **qa-test-api** should point |
| API contract | OpenAPI/Postman file to test against |

Record what you get:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/qa_context.py" set \
    --frontend-path ../shop-web --frontend-framework "React 18 + Vite" \
    --testid-attr data-testid --backend-path ../shop-api \
    --api-url http://localhost:8000/api
```

If the user declines or does not answer, record that and move on - **do not ask
again, and do not block on it**:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/qa_context.py" skip
```

When context exists, use it: read the component for the screen under test to
find its real test ids and states, read the validation code to learn the true
boundaries, and cite the specific file and rule in bug reports rather than
guessing. Reading the source never replaces observing the running app - a
defect is what the application *does*, not what the code appears to say.

## Prerequisites

Confirm before running anything:

- **Environment URL** - staging/QA, reachable from this machine.
- **Credentials per role** under test, in `.env` (never inline, never echoed).
- **Test data** - records that must exist, or a way to create them.
- **Permission to write data.** Ask explicitly before running cases that create,
  modify, or delete records in a shared environment. Never run destructive cases
  against production.

## The Execution Loop

After every command `playwright-cli` writes an accessibility snapshot to
`.playwright-cli/page-<timestamp>.yml` and prints a link to it. The snapshot
gives each interactive element a `ref` (`e4`, `e5`). Work from those refs rather
than guessing at selectors, and save a copy of each one you acted on:

```bash
OUT=qa-results/tc-07 && mkdir -p $OUT

playwright-cli -s=qa open https://staging.example.com/checkout
playwright-cli -s=qa snapshot --filename=$OUT/01-checkout.snapshot.md
# - paragraph [ref=e3]: "Order total: $120.00"
# - textbox "Discount code" [ref=e4]
# - button "Apply" [ref=e5]

playwright-cli -s=qa fill e4 "OLD2019"
playwright-cli -s=qa click e5
playwright-cli -s=qa snapshot --filename=$OUT/02-after-apply.snapshot.md
```

Name saved snapshots `NN-<what-just-happened>.snapshot.md` so the sequence reads
in order alongside the screenshots. Useful flags: `--boxes` adds each element's
bounding box (worth saving for a layout or overlap defect), `--depth` trims a
huge tree, and passing a `[target]` captures one region instead of the page.

**Assert with `find`.** It searches the current snapshot and answers in exactly
the terms a test case needs:

```bash
playwright-cli -s=qa find "This code has expired"
# -> "No matches found for ..."      = the check fails
# -> "Found 1 match for ..."         = the check passes
```

Run `find` for the expected text *and* for what you suspect is there instead -
the second result is the `--actual` line of the bug report, already written.

Rules for the loop:

- **Refs die on every page change.** After a navigation, submit, or any DOM
  update, take a fresh snapshot rather than reusing an earlier ref.
- **Save the snapshot at every step**, and always at the moment of failure -
  before clicking anything else, since the next command destroys that state.
- **Assert against what the snapshot says**, not what you expect it to say. If
  the expected text is absent, that is the finding - do not go hunting for a
  friendlier selector until it passes.
- Use a **named session** (`-s=qa`) per role or parallel thread, so runs do not
  collide and a saved login is reusable. `playwright-cli list` shows open
  sessions; `close` and `close-all` shut them down.
- Prefer refs. When a selector is unavoidable, pass a role- or label-based one
  as the command's target (`playwright-cli click "getByRole('button', { name:
  'Apply' })"`) - it fails when the user-visible thing breaks, not when a class
  name changes. That is a *target argument*, not Playwright code.
- Never use fixed sleeps to force a pass. If something is genuinely async, wait
  on the observable condition.
- `--json` and `--raw` change the output shape when a command's result needs to
  be parsed or piped rather than read.

For flows behind login, log in once and reuse the state:

```bash
playwright-cli -s=admin open https://staging.example.com/login
# ... fill credentials, submit ...
playwright-cli -s=admin state-save qa-results/session-admin.json
# later, or in another session:
playwright-cli -s=qa state-load qa-results/session-admin.json
```

## Recording the Case

Executing is half the job; the evidence has to survive into the report and the
bug ticket. Record as you go with `qa_record.py`:

```bash
R="python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_record.py"
OUT=qa-results/tc-07 && mkdir -p $OUT

$R start TC-07 --title "Expired discount code is rejected" \
    --base-url https://staging.example.com --priority P1 --covers AC-4

playwright-cli -s=qa snapshot   --filename=$OUT/01-checkout.snapshot.md
playwright-cli -s=qa screenshot --filename=$OUT/01-checkout.png
$R step TC-07 "Open the checkout page" \
    --screenshot $OUT/01-checkout.png --snapshot $OUT/01-checkout.snapshot.md

$R step TC-07 "Enter OLD2019 in Discount code and click Apply"

# capture the failure state before touching anything else: snapshot first,
# then highlight the offending element so the screenshot points at what is
# wrong instead of leaving the reader to find it
playwright-cli -s=qa snapshot   --filename=$OUT/02-applied.snapshot.md
playwright-cli -s=qa highlight e3
playwright-cli -s=qa screenshot --filename=$OUT/02-applied.png

$R check TC-07 'Inline error reads "This code has expired"' \
    --fail --actual 'Green "Discount applied" shown; total changed to $96.00' \
    --screenshot $OUT/02-applied.png --snapshot $OUT/02-applied.snapshot.md

playwright-cli -s=qa console  > $OUT/console.txt
playwright-cli -s=qa requests > $OUT/requests.txt
$R evidence TC-07 --console $OUT/console.txt --requests $OUT/requests.txt

$R finish TC-07
```

`step` is an action you performed. `check` is an assertion, and its label must
be the expected result copied verbatim from the test case - that text becomes
the "Expected result" line of the bug report, so it must match the acceptance
criterion. `--actual` is required whenever a check fails.

This writes `qa-results/<case-id>/result.json`, which **qa-report** turns into
the cycle report and **qa-bug** reads for evidence. A case abandoned half way
still leaves usable evidence on disk. `finish` warns when a case recorded no
page snapshots - treat that warning as a defect in the run, not a formality.

Saved snapshots are rendered into the HTML report as collapsible blocks per
case, so a reviewer can see the tree each assertion was made against without
rerunning anything.

Wrap anything multi-step or timing-dependent in `tracing-start` / `tracing-stop`
- the trace is the single most useful artifact you can hand a developer. For
defects that a still frame cannot show (animation, drag, focus order), record
with `video-start`, and turn on `video-show-actions` first so each action is
labelled and its target highlighted in the recording.

## Exploratory Passes

When there is no case file yet - reproducing a reported bug, or charter-based
exploration - drive the browser directly and narrate findings. Structure the
session as a charter ("explore checkout with invalid discount codes to discover
validation gaps, 20 minutes"), and record each observation with a screenshot and
a saved snapshot, including ones that turn out to be correct behavior. Record the
whole charter as one case with `qa_record.py` so it lands in the report alongside
scripted work.

## Promoting a Case (opt-in only)

**Do not do this while executing a case.** Generating spec files is a separate
task, and only when the user explicitly asks to automate or add a case to a
regression suite. Executing a test case always means `playwright-cli` commands,
whatever spec files may exist in the project.

When the user does ask, `generate-locator <ref>` yields the Playwright locator
for an element the manual run already proved works, so the spec targets what
was actually verified. Keep the case ID at the front of the test title
(`test('TC-07 expired discount code is rejected', ...)`).

`build_report.py --playwright-json` folds an existing suite's results in
alongside the recorded cases, so a project that already has specs still gets one
report - reading that file is not the same as running the suite to execute a
case, and does not license doing so.

## Interpreting a Failure Before Reporting It

Never file a bug straight from a red result. First determine which it is:

1. **Product defect** - the application behaved differently from the expected
   result. File it.
2. **Test defect** - the ref, data, or expected result was wrong. Fix and re-run.
3. **Environment issue** - service down, data missing, deploy mid-flight. Note
   it and re-run; do not file it as a product bug.
4. **Ambiguous requirement** - the app does something reasonable that the
   acceptance criteria never specified. That is a `Q-` item, and possibly a spec
   bug, not automatically a product bug.

Re-run any failure once before reporting it, and record whether it reproduced.
An intermittent failure is still a bug - report it as intermittent with the
observed rate ("3 of 5 runs"), never discard it.

## Reporting

Summarize each run as a table of case ID, title, priority, status, and a
one-line observation. Then invoke **qa-bug** for each product defect (with the
case ID and its evidence directory), and **qa-report** for the cycle summary.

## Constraints

- **Never write or run Playwright code to execute a case** - no spec files, no
  scripts, no `npx playwright test`, no `page.*` through `run-code` as a
  substitute for a subcommand. If you catch yourself opening an editor to
  execute a test, stop and find the `playwright-cli` command instead.
- **Never finish a case with no saved snapshot.** If a step's snapshot could not
  be captured, say so in the record rather than leaving the gap silent.
- Never run against production unless the user explicitly says so, and never run
  destructive cases there under any circumstance.
- Never store or print credentials, tokens, or personal data. Screenshots may
  contain them - warn the user before attaching one showing real customer data.
- If a step cannot be automated reliably (CAPTCHA, OTP to a real phone,
  third-party payment sandbox), say so and hand that step back as a manual step
  with precise instructions rather than faking a pass.
- Close sessions when finished (`close`, or `close-all`) so browsers are not
  left running; `kill-all` clears stale ones.
- In a container or CI image running as root, Chromium's sandbox fails to
  start. Write `.playwright/cli.config.json` in the workspace:
  `{"browser":{"launchOptions":{"chromiumSandbox":false}}}`. Do this only where
  the environment forces it, never on a normal workstation.

## References

- `references/playwright-cli-recipes.md` - QA-specific command recipes:
  roles and sessions, evidence capture, network interception for error-path
  testing, responsive and mobile checks, accessibility inspection, and the
  console/request triage that turns a UI symptom into a filed backend bug.
