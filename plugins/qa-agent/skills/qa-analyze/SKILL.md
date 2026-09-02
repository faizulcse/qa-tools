---
name: qa-analyze
description: >
  This skill should be used when the user wants to turn a feature's requirements
  into a test plan - "analyze this ticket", "what should I test", "write test
  cases for", "review these acceptance criteria", "generate test scenarios",
  "build a test plan", "what edge cases am I missing", "check coverage for this
  feature", or when they paste a Jira ticket, PRD, spec, design doc, or list of
  acceptance criteria and want QA analysis. This is the entry point for the QA
  agent workflow and runs before any test execution.
metadata:
  version: "0.1.0"
---

# Requirements Analysis and Test Design

Turn requirements into a rigorous, traceable, risk-ordered test plan. Depth here
is what makes execution and bug reports worth anything - never skip to writing
test cases from a skim of the ticket.

## Operating Rules

- **Never invent requirements.** Every test condition traces to a stated
  requirement, an explicit assumption, or a named heuristic. Label which.
- **Ambiguity is a finding, not a blocker.** Missing or contradictory
  requirements are reported as `Q-` items and are often the most valuable output
  of a run. Continue analysis using a stated assumption.
- **Implied requirements are real requirements.** Acceptance criteria almost
  never mention permissions, concurrency, error states, or data limits. Derive
  them from the feature type using `references/coverage-heuristics.md`.
- **Order by risk, not by ticket order.** A P1 test plan the user can execute in
  30 minutes beats a 200-case plan they will never run.

## Phase 0 - Gather Inputs

First, check whether the project's codebase context is known - it is asked once
per working folder and makes every later phase sharper:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/qa_context.py" status   # exit 1 = never asked
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/qa_context.py" show
```

If it has never been asked, ask once - framed as optional - for the frontend
and backend project paths, then record the answer with `set`, or `skip` if the
user declines. **qa-test-ui** holds the full question and the field list. Never
block analysis on it.

With source available, read the validation code and route definitions to ground
the requirement inventory in what the application actually enforces; where code
and acceptance criteria disagree, that gap is a `Q-` item, not a decision to
make silently.

Then collect the rest before analyzing. Ask for anything missing that materially
changes the plan; proceed with stated assumptions for the rest.

| Input | Why it matters |
| --- | --- |
| Ticket / PRD / spec | Source of truth for requirements |
| Acceptance criteria | Direct test oracles |
| Designs / mockups | UI states, empty/error/loading states |
| API contract (OpenAPI, Postman, sample payloads) | Field-level validation rules |
| Test environment URL + credentials per role | Needed for execution |
| Test data (accounts, records, fixtures) | Determines feasible scenarios |
| Out-of-scope notes | Prevents false bug reports |
| Related/regression areas | Blast-radius coverage |

If a Jira key is supplied (e.g. `PROJ-1234`), invoke the **qa-jira** skill first
to pull description, acceptance criteria, comments, attachments, linked issues,
and subtasks. Comments frequently contain scope changes that never made it into
the description - read them all.

## Phase 1 - Atomize Requirements

Rewrite the source material as a numbered inventory of atomic, testable
statements. One rule per line. Split compound sentences ("user can edit and
delete") into separate requirements.

Give every item a stable ID:

- `AC-n` - stated acceptance criterion
- `REQ-n` - requirement stated in prose but not in the AC list
- `IMP-n` - implied requirement derived from a heuristic (mark the source)
- `ASM-n` - assumption made to proceed (must also appear as a `Q-` item)

For each, record: ID, statement, source (ticket field / doc / heuristic),
testable yes/no, and the observable oracle - how a tester can tell it passed.
A requirement with no observable oracle is a `Q-` item.

## Phase 2 - Ambiguity and Gap Audit

Run the source material against `references/ambiguity-checklist.md` before
designing tests. Produce a `Q-` list where each entry has: the ambiguous text,
why it is ambiguous, the candidate interpretations, which one is being assumed,
and the blast radius if the assumption is wrong.

Prioritize questions that change what gets tested (`Blocking`) over cosmetic
ones (`Non-blocking`).

## Phase 3 - Model the Feature

Build an explicit model before deriving cases. Cover:

- **Actors and roles** - every role that can reach the feature, plus anonymous
  and deactivated users.
- **Entry points** - UI paths, deep links, API, background jobs, notifications.
- **States** - the lifecycle of the primary entity; draw the state machine.
- **Data** - every input field with type, required/optional, format, min/max,
  allowed characters, default, and persistence.
- **Rules** - conditional logic, computations, thresholds.
- **Integrations** - upstream/downstream services, webhooks, third parties,
  and what happens when each is slow or down.
- **Non-functional** - performance budgets, security, accessibility, browser and
  device matrix, i18n/timezone/currency.

State plainly which parts of the model are unknown rather than guessing.

## Phase 4 - Derive Test Conditions

Apply the formal techniques in `references/test-design-techniques.md`. At
minimum, for every feature:

1. **Equivalence partitioning** on each input - valid classes and invalid classes.
2. **Boundary value analysis** - min-1, min, min+1, max-1, max, max+1, plus
   zero, empty, and null for every bounded field.
3. **Decision table** for any requirement with more than one condition, so
   condition combinations are covered rather than sampled.
4. **State transition** coverage - all valid transitions, plus attempts at
   invalid ones.
5. **Pairwise combination** when the parameter space is too large to enumerate.
6. **CRUD + permissions matrix** - every role against every operation, including
   direct-URL and direct-API attempts at forbidden operations.
7. **Negative and abuse paths** - malformed input, oversized input, injection
   strings, unicode/emoji, leading/trailing whitespace, duplicate submissions.
8. **Interruption and concurrency** - refresh mid-flow, back button, double
   click, session expiry, two tabs, two users editing the same record.
9. **Regression blast radius** - what else touches this data or this screen.

Then apply the feature-type checklists in `references/coverage-heuristics.md`
(forms, auth, lists and tables, search, file upload, payments, notifications,
permissions, dashboards) to catch conditions the techniques miss.

## Phase 5 - Risk-Score and Prioritize

Score each test condition using `references/risk-scoring.md`: impact if broken x
likelihood of breakage, adjusted for usage frequency and code churn. Assign
`P1` (must run before sign-off), `P2` (run this cycle), `P3` (run if time).

Never let the count of P1 cases exceed what one tester can execute in one
session. If it does, the feature is too big for one test cycle - say so.

## Phase 6 - Write Test Cases

Write each case with: ID (`TC-n`), title, priority, preconditions, test data,
numbered steps, expected result per step, the requirement IDs it covers, and
the technique that produced it.

Rules:

- One case verifies one condition. Do not chain unrelated assertions.
- Steps are executable by someone who has never seen the feature - name the
  exact control, the exact value, the exact expected text.
- Expected results are specific and falsifiable. "Works correctly" is not an
  expected result; "an inline error reads `Email is already in use` and the
  form is not submitted" is.
- Include the cleanup or reset needed to re-run the case.

Write the plan to `test-plan.md` in the working folder.

## Phase 7 - Traceability and Coverage

Produce a matrix mapping every `AC-`/`REQ-`/`IMP-` ID to the `TC-` IDs covering
it. Then report:

- Requirements with zero coverage (a gap in the plan).
- Test cases tracing to nothing (either scope creep or an undocumented
  requirement - promote it to a `Q-` item).
- Coverage by technique, so gaps in negative or boundary testing are visible.

Save as `traceability.md` alongside the plan.

## Phase 8 - Handoff

Close every run with:

1. A one-paragraph risk summary - where this feature is most likely to break.
2. The blocking `Q-` list, in priority order.
3. Counts: requirements, test cases by priority, coverage percentage.
4. The recommended next step - **qa-test-ui** for browser execution,
   **qa-test-api** for endpoint validation, or manual execution with the
   generated plan.

## Output Files

| File | Contents |
| --- | --- |
| `test-plan.md` | Requirement inventory, model, full test cases |
| `traceability.md` | Requirement-to-case matrix and coverage gaps |
| `open-questions.md` | `Q-` items with assumptions and blast radius |

Use `${CLAUDE_PLUGIN_ROOT}/templates/test-plan.md` as the structure.

## References

- `references/test-design-techniques.md` - formal derivation techniques with worked examples
- `references/ambiguity-checklist.md` - requirement smells and the question bank
- `references/coverage-heuristics.md` - per-feature-type condition checklists
- `references/risk-scoring.md` - risk model, priority rubric, severity definitions
