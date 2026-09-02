---
name: qa-bug
description: >
  This skill should be used when a defect needs to be written up or filed -
  "file a bug", "write a bug report", "log this issue", "create a Jira bug",
  "report this defect", "what severity is this", "turn this into a ticket", or
  after a test run produced a failure that needs reporting. Produces a
  structured bug report with reproduction steps, expected versus actual results,
  severity and priority with reasoning, and attached evidence, then optionally
  files it to Jira.
metadata:
  version: "0.1.0"
---

# Bug Reporting

A bug report has one job: let a developer reproduce the defect without asking a
single follow-up question. Anything that does not serve that job is noise.

## Before Writing Anything

Answer these four questions. If any answer is "I don't know", find out first.

1. **Is it a product defect?** Or a test defect, an environment issue, or an
   ambiguous requirement? Only the first is a bug. See the classification
   section in **qa-test-ui**.
2. **Does it reproduce?** Run it again. Record the rate ("5 of 5", "3 of 5").
   An intermittent defect is still filed - as intermittent, with the rate.
3. **What is the minimal reproduction?** Strip every step that is not required.
   A 12-step repro that works in 4 steps wastes developer time and hides the
   real trigger.
4. **Is it already filed?** Search the tracker for the component and the symptom
   before creating a duplicate. If a similar bug exists, comment on it with the
   new evidence instead.

Then narrow the defect before filing: does it happen on other browsers, other
roles, other data, other environments? Each answer you can give up front is a
round trip the developer does not have to make.

## Required Fields

### Title

One line, under ~90 characters, in the form **[Area] What breaks when what
happens**. It must be specific enough that someone reading the backlog knows
whether it affects them.

- Good: `[Checkout] Expired discount code is accepted and reduces the order total`
- Good: `[API /v1/orders] Returns 500 instead of 422 when quantity is 0`
- Bad: `Discount bug`, `Checkout not working`, `Issue with codes`

Never put the severity in the title - that is a field.

### Environment

Environment name and URL, build or commit, browser and version, OS, device and
viewport, user role and account used, date and time with timezone, and any
feature flag state. Copy this from `result.json` when the run was recorded.

### Preconditions

The exact state required before step 1: which account, which data, which
settings. "A cart containing one item priced $120.00 and a discount code
`OLD2019` with an expiry date in the past."

### Steps to Reproduce

Numbered, imperative, one action per step, with exact values. A person who has
never seen the feature must be able to follow them.

```
1. Log in as qa-buyer@example.com (role: Buyer).
2. Add "Standard Plan" to the cart. Cart total shows $120.00.
3. Go to /checkout.
4. Enter OLD2019 in the "Discount code" field.
5. Click Apply.
```

Do not merge navigation into an assertion. Do not write "do the usual setup".

### Expected Result

Quote the source: the acceptance criterion, the spec line, or the documented
behavior, with its ID. If no requirement covers it, say so explicitly and state
the reasoning oracle instead - this signals the team may also have a spec gap.

> Expected (AC-4): the code is rejected with the inline error "This code has
> expired" and the order total remains $120.00.

### Actual Result

What happened, observably and specifically, including exact on-screen text,
status codes, and error messages. No interpretation of the cause unless you have
evidence for it.

> Actual: the code is accepted, a green "Discount applied" message appears, and
> the order total changes to $96.00. `POST /v1/cart/discount` returned 200 with
> `{"status":"applied","discount":24.00}`.

### Severity and Priority

Assign both using `qa-analyze/references/risk-scoring.md`, and give the
reasoning in one line:

> S1/P0 - revenue impact: expired codes discount every order they are applied
> to, no workaround, affects all users, reproduces 5 of 5.

Severity is a QA judgment about technical impact. Priority is a proposal to the
team about scheduling - phrase it as a recommendation and include the factors
(user reach, frequency, workaround, regression status).

### Evidence

Attach, in this order of usefulness:

1. A screenshot of the failure state with the relevant area visible.
2. The failing request/response pair, or the console error and stack trace.
3. A Playwright trace (or video) for a multi-step or timing-dependent defect -
   the developer can replay the whole run, which usually removes a round trip.
4. `result.json` from the recorded run.
5. Correlation IDs, request IDs, or log timestamps the developer can search.

Redact credentials, tokens, and customer PII before attaching. Warn the user if
a screenshot contains real customer data.

### Supporting Analysis (optional but high value)

Include only what is evidenced:

- **Scope**: which browsers/roles/environments reproduce, and which do not.
- **Regression**: does it happen on the previous build? Name the build where it
  started if known.
- **First failing point**: the earliest step where observable state diverges.
- **Related tickets**: the feature ticket, the failing test case ID, similar bugs.

Never guess at the root cause or name a file or function unless you have looked
at the code. A wrong guess sends the developer down the wrong path.

When the project's source is available (`qa_context.py show` - asked once per
folder, see **qa-test-ui**), you may look. If you do, cite the file and line and
say what you observed there, keeping it separate from the observed behavior:

> Observed: the API accepts `OLD2019` and returns a 24.00 discount.
> Possibly related: `discounts/validators.py:41` checks `code.active` but not
> `code.expires_at`. Not verified - offered as a starting point.

Mark it as unverified unless you actually reproduced the link. A cited line the
developer can dismiss in ten seconds is useful; a confident wrong diagnosis is
worse than none.

## Template

Use `${CLAUDE_PLUGIN_ROOT}/templates/bug-report.md`. Fill every field; write
"N/A - <reason>" rather than leaving a field blank, so the reader knows it was
considered.

## Filing to Jira

Present the completed report to the user for review **before** filing. Then
invoke **qa-jira** to create the issue. Provide it with: project key, issue type
(Bug), summary, the formatted description, severity, priority, labels,
components, affected version, the linked feature issue key, and the paths of the
evidence files to attach.

After filing, report the issue key and URL, and link the bug back to the feature
ticket (`relates to` or `is caused by`).

## Batch Reporting

When a run produces several failures, group before filing:

- **Same root symptom on multiple screens** - one bug, listing all affected
  places.
- **Same screen, unrelated symptoms** - separate bugs.
- **One failure that blocks other cases** - file the blocker, and mark the
  dependent cases Blocked rather than filing cascading bugs.

File the highest-severity bug first so the team sees it first.

## Anti-Patterns

- Reporting a symptom without steps ("sometimes the total is wrong").
- Combining several defects in one ticket so it cannot be closed.
- Expected results copied from the tester's assumption rather than the spec.
- Severity inflated to get attention - it destroys trust in the whole queue.
- Filing before checking for duplicates, or before confirming reproduction.
- Screenshots of the whole screen when the defect is in one control, with no
  annotation of what to look at.
