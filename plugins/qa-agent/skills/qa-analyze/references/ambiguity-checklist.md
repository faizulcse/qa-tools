# Ambiguity Checklist and Question Bank

Run every requirement through this checklist before designing tests. Each hit
becomes a `Q-` item with: the quoted text, the ambiguity type, candidate
interpretations, the assumption being made, and the blast radius.

---

## Part 1 - Requirement Smells

Scan the source text for these patterns. Each one is a defect in the
requirement, findable before a single test is run.

### Vague quantifiers and qualifiers

`fast`, `quickly`, `responsive`, `slow`, `large`, `small`, `many`, `few`,
`several`, `most`, `some`, `reasonable`, `appropriate`, `sufficient`,
`user-friendly`, `intuitive`, `seamless`, `robust`, `properly`, `correctly`,
`as expected`, `gracefully`.

> Ask: what is the number, and how is it measured?

### Undefined pronouns and referents

`it`, `they`, `this`, `that`, `the user`, `the system`, `the page`, `the data`.

> Ask: which user role specifically? which of the three lists on this screen?

### Ambiguous conjunctions

`and/or`, `A and B or C`, `either ... or`, `unless`, `except when`.

> Ask: is this inclusive or exclusive? what is the precedence?

### Implicit universals

`always`, `never`, `all`, `every`, `none`, `any`.

> Ask: what are the exceptions? Requirements with `always` almost always have one.

### Passive voice hiding the actor

"The report is generated", "the record is archived", "an email is sent".

> Ask: triggered by whom, or by what, and when exactly?

### Missing units and formats

Time without a timezone. Money without a currency. Dates without a format.
Sizes without a unit. Percentages without a base.

> Ask: whose timezone - the user's, the server's, or the org's?

### Unstated error behavior

The requirement describes only the happy path.

> Ask: what does the user see when this fails? Is it retryable? Is partial
> work saved?

### Comparative without a baseline

"Faster than before", "improved", "better handling".

> Ask: what is the measured baseline and the target?

### Duplicated or conflicting statements

The description says one thing, the AC list another, a comment a third.

> Flag both, cite both locations, and ask which wins. Comments usually contain
> the most recent decision and the description the oldest.

### Design-doc drift

The mockup shows a field, state, or button that no requirement mentions - or a
requirement describes something the mockup does not show.

> Ask which is authoritative. Both directions are real defects in the spec.

---

## Part 2 - The Question Bank

Ask these of every feature. Most acceptance criteria answer fewer than half.
Unanswered questions become `Q-` items with an assumption attached.

### Scope and boundaries

- Which user roles can access this? Which explicitly cannot?
- Is it available on mobile web, native apps, and tablet, or desktop only?
- Which browsers and minimum versions are in scope?
- Is it behind a feature flag? What is the behavior with the flag off?
- Does it apply to existing records, or only records created after release?
- Is there a migration for existing data? What happens to records mid-flight?

### Data and validation

- For each field: required or optional? Min/max? Allowed characters? Default?
- What happens to leading/trailing whitespace - trimmed or preserved?
- Is the field case-sensitive for comparison, uniqueness, or search?
- Are duplicates allowed? Scoped globally, per org, or per user?
- What is the maximum number of records/items/rows supported?
- What is stored versus what is displayed (rounding, truncation, formatting)?
- Is the field editable after creation? By whom? Is there an audit trail?
- Is deletion soft or hard? Is it reversible? Who can see deleted records?

### States and lifecycle

- What are all the states, and what is the full transition table?
- Can a state be skipped or reversed? By whom?
- What happens to child records when the parent changes state?
- Are there timed transitions (auto-expire, auto-archive)? What is the clock?

### Permissions and multi-tenancy

- Can a user act on objects they do not own? Within their org? Across orgs?
- What does a forbidden request return - 403, 404, or a redirect?
- Are object IDs sequential or guessable?
- What does a deactivated user, expired trial, or downgraded plan see?

### Errors and failure

- What is the exact user-facing message for each failure case?
- If a dependency is down or slow, does the feature degrade or block?
- Are partial successes possible? Is the operation atomic?
- Is the operation idempotent? What happens on retry or double-submit?
- Are errors logged, and does anything alert on them?

### Concurrency and timing

- What happens if two users act on the same record at once?
- Is there optimistic locking, a conflict warning, or silent overwrite?
- Are there async steps? How does the user know when they finish?
- What is the acceptable latency, and what is shown while waiting?

### Notifications and side effects

- Does this trigger emails, push notifications, webhooks, or Slack messages?
- Who receives them, with what content, and can they be turned off?
- Does the action appear in any activity feed, audit log, or report?
- Does it affect any count, total, or dashboard metric?

### Non-functional

- Expected volume: records, concurrent users, requests per second?
- Accessibility: keyboard-only operation, screen reader labels, contrast,
  focus management in modals?
- Localization: translated strings, RTL layout, date/number/currency formats?
- Analytics: which events are expected to fire, with which properties?
- Security: is any of this data sensitive? Is it masked in logs and exports?

### Release and rollback

- Is anything else being released alongside this?
- What is the rollback plan if a defect is found post-release?
- Is there a monitoring dashboard or alert for this feature?

---

## Part 3 - Writing the `Q-` Item

Use this format:

```
Q-3  [Blocking]  Timezone for the "Expires on" date
Source:      AC-4 - "The code expires on the selected date."
Ambiguity:   Missing units/format - no timezone stated.
Candidates:  (a) user's local timezone  (b) org timezone  (c) UTC
Assumption:  (a) user's local timezone, matching the rest of the product.
Blast radius: If (c), 6 boundary cases (TC-11..TC-16) have wrong expected
             results, and users near midnight see off-by-one-day expiry.
Ask:         Product owner, before execution.
```

Mark an item `Blocking` when an assumption being wrong would change expected
results for a P1 test case; otherwise `Non-blocking`.
