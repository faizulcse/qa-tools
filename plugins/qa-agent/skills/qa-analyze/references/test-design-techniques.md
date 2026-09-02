# Test Design Techniques

Formal techniques for deriving test conditions from requirements. Each section
gives the rule, the procedure, and a worked example. Apply techniques in the
order listed - later techniques assume the earlier models exist.

---

## 1. Equivalence Partitioning

**Rule:** Divide each input's domain into classes where every member is expected
to be treated identically. Test one representative per class, plus every invalid
class separately (invalid classes are tested one at a time so one rejection
cannot mask another).

**Procedure**

1. List every input: form fields, query params, headers, path segments, file
   uploads, toggles, dropdowns, and implicit inputs like current date, timezone,
   locale, role, and feature flags.
2. For each, write the valid classes and the invalid classes.
3. Include the classes people forget: empty, whitespace-only, null vs absent,
   type mismatch, and "valid format but nonexistent" (a well-formed ID that is
   not in the database).

**Worked example - "Discount code" text field, 6-12 alphanumeric chars**

| Class | Type | Representative |
| --- | --- | --- |
| 6-12 alphanumeric, exists, active | Valid | `SAVE20` |
| 6-12 alphanumeric, exists, expired | Invalid | `OLD2019` |
| 6-12 alphanumeric, does not exist | Invalid | `ZZZZ99` |
| Fewer than 6 chars | Invalid | `AB1` |
| More than 12 chars | Invalid | `ABCDEFGHIJKLM` |
| Contains symbols | Invalid | `SAVE-20!` |
| Empty | Invalid | `` |
| Whitespace only | Invalid | `   ` |
| Lowercase form of a valid code | Ambiguous - raise `Q-` | `save20` |
| Valid code with leading/trailing spaces | Ambiguous - raise `Q-` | ` SAVE20 ` |

The last two rows demonstrate the point of the technique: partitioning surfaces
questions the acceptance criteria never answered.

---

## 2. Boundary Value Analysis

**Rule:** Defects cluster at edges. For any ordered domain with bounds, test
min-1, min, min+1, max-1, max, max+1.

**Apply to:** string length, numeric range, item counts, file size, date ranges,
pagination offsets, array sizes, retry counts, timeouts, currency amounts.

**Also test the universal edges:** `0`, negative, `null`, empty string, empty
array, and the maximum the storage type allows (a 32-bit overflow, a `DECIMAL`
precision limit).

**Worked example - "Quantity" field, 1-99**

`0` (below), `1` (min), `2` (min+1), `98` (max-1), `99` (max), `100` (above),
`-1`, `1.5`, `01`, `1e2`, `99999999999`, empty, `abc`.

**Date-specific boundaries:** the day before/after the range, the same day at
23:59:59 and 00:00:00, month ends, Feb 29 in a leap year, DST transition days,
the user's timezone vs the server's, and year boundaries.

---

## 3. Decision Tables

**Rule:** When an outcome depends on two or more conditions, enumerate the
combinations. Requirements written as prose almost always leave combinations
undefined - those gaps become `Q-` items.

**Procedure**

1. List the conditions (boolean or enumerated).
2. Build the table of all combinations (2^n for n booleans).
3. Fill in the expected action from the requirements.
4. Any cell you cannot fill from the requirements is a documented gap.
5. Collapse rows only where a condition is provably irrelevant.

**Worked example - "User can submit an expense report"**

Conditions: report has at least one line item (A), total is under the approval
limit (B), user's manager is assigned (C).

| # | A | B | C | Expected |
| --- | --- | --- | --- | --- |
| 1 | Y | Y | Y | Submits, auto-approved |
| 2 | Y | Y | N | **Undefined in AC -> Q-item** |
| 3 | Y | N | Y | Submits, routed to manager |
| 4 | Y | N | N | **Undefined in AC -> Q-item** |
| 5 | N | - | - | Blocked, "Add at least one item" |

Rows 2 and 4 are the value of the technique. Three lines of acceptance criteria
produced two unanswered questions.

---

## 4. State Transition Testing

**Rule:** Model the entity lifecycle as states and transitions. Cover every
valid transition once, then attempt the invalid ones.

**Procedure**

1. Name the states (`Draft`, `Submitted`, `Approved`, `Rejected`, `Cancelled`).
2. Name the events and who can fire them.
3. Build the state x event table. Fill each cell with the resulting state or
   "not allowed".
4. Derive: one test per valid transition; one test per "not allowed" cell,
   attempted through **both** the UI and the API (the UI usually hides the
   button, the API often does not check).
5. Add loop tests: `Draft -> Submitted -> Rejected -> Draft -> Submitted`.

**Invalid-transition tests are where authorization bugs live.** For each
disabled or hidden control, test the direct request behind it.

---

## 5. Pairwise / Combinatorial Reduction

**Rule:** Most combination defects involve only two parameters. When full
enumeration is infeasible, cover every pair of parameter values at least once.

**When to use:** browser x role x plan tier x feature flag, or any matrix where
the product exceeds ~30 combinations.

**Procedure:** list parameters and their values, generate a pairwise set (by
hand for small matrices, or with a generator), then add back any business-critical
combination the algorithm dropped - pairwise is a reduction, not a replacement
for judgment about known-risky combinations.

**Example:** 4 browsers x 3 roles x 3 plans x 2 flags = 72 full combinations,
reduced to roughly 12 pairwise cases, plus the 2 combinations known to be
high-revenue (Chrome/Admin/Enterprise/flag-on and Safari/Viewer/Free/flag-off).

---

## 6. CRUD and Permissions Matrix

**Rule:** Every role x every operation x every object ownership case.

Build a matrix with rows = roles (including anonymous, deactivated, expired
trial, and a user from a *different* tenant) and columns = operations (Create,
Read, List, Update, Delete, Export, Share). Fill each cell with Allow or Deny.

For every Deny cell, write two tests:

1. The control is not offered in the UI.
2. The direct request (API call, or navigating straight to the URL with a valid
   object ID) is rejected with the correct status - and the response body does
   not leak the object's contents or confirm its existence when it should not.

Add the cross-tenant case explicitly: user from Org A requests object owned by
Org B. This is the single most common high-severity defect class in
multi-tenant products.

---

## 7. Negative, Malformed, and Abuse Input

For every text input, test: SQL-ish strings (`' OR 1=1--`), script strings
(`<script>alert(1)</script>`), template strings (`{{7*7}}`), path traversal
(`../../etc/passwd`), very long strings (10k+ chars), unicode and emoji,
right-to-left characters, null bytes, HTML entities, leading/trailing/internal
whitespace, and a copy-pasted value with invisible formatting characters.

The expectation is not that the app rejects everything - it is that the app
either safely stores and renders the value or rejects it with a clear message,
and never executes it, corrupts the page, or returns a 500.

For every numeric input: negative, zero, decimal where integer expected,
scientific notation, thousands separators, leading zeros, and values exceeding
the storage type.

For every file upload: wrong extension, correct extension with wrong content,
zero-byte file, oversized file, file with a very long name, file with unicode
name, double extension (`x.pdf.exe`), and an upload cancelled mid-transfer.

---

## 8. Interruption, Concurrency, and Idempotency

Test conditions that only appear when the user is not perfectly behaved:

- Browser refresh mid-flow; browser back after submit; forward after back.
- Double-click a submit button - is the record created twice?
- Submit, then immediately submit again from a second tab.
- Session expiry mid-form - is the form data preserved after re-login?
- Two users edit the same record simultaneously - last-write-wins, or a
  conflict warning? (Check what the requirements say; usually nothing - `Q-`.)
- Network drop mid-request; slow 3G; request timeout then retry.
- Navigate away with unsaved changes - is there a warning?
- Deep-link directly into step 3 of a wizard without completing steps 1-2.
- Delete a record in one tab that is open for editing in another.

---

## 9. Regression Blast Radius

For each feature, list what shares its data or its surface, then derive one
smoke test per neighbor:

- Screens that display the same entity (lists, dashboards, exports, search
  results, notification text, audit log).
- Aggregations and counts that include the entity.
- Downstream consumers: webhooks, emails, reports, third-party syncs.
- Anything that filters or sorts on a field this feature changed.
- Permissions that were touched.
- Any shared component modified by the change (a shared modal, a date picker).

---

## 10. Oracle Selection

Every test needs a way to tell pass from fail. Rank oracles by strength and use
the strongest available:

1. **Specified oracle** - the AC states the exact expected output.
2. **Consistency oracle** - the value matches what another part of the system
   shows (list total vs detail sum; UI value vs API response vs database).
3. **Comparable oracle** - behavior matches a comparable existing feature.
4. **Heuristic oracle** - it does not crash, data is not lost, the message is
   comprehensible, the state is recoverable.

If only a heuristic oracle exists for a P1 condition, raise a `Q-` item - the
requirement is not testable as written.
