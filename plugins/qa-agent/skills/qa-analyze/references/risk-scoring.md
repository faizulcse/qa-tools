# Risk Scoring, Priority, and Severity

A shared rubric so priorities are defensible and severity is not argued about
in the ticket.

---

## Part 1 - Risk Score for Test Conditions

Risk = **Impact** x **Likelihood**, adjusted by two modifiers.

### Impact (1-5) - what happens if this is broken in production

| Score | Meaning |
| --- | --- |
| 5 | Data loss, security breach, money moved incorrectly, or the product unusable |
| 4 | A core workflow is blocked with no workaround |
| 3 | A workflow is degraded but has a workaround |
| 2 | Visible defect that does not block work |
| 1 | Cosmetic or internal-only |

### Likelihood (1-5) - how likely this area is to be broken

| Score | Signals |
| --- | --- |
| 5 | New code, complex logic, rushed, no unit tests, unclear requirements |
| 4 | Significant change to existing logic; touched by multiple developers |
| 3 | Moderate change; some test coverage |
| 2 | Small, isolated change with good coverage |
| 1 | Configuration-only or untouched code being smoke-checked |

### Modifiers

- **+1** if the path is used by most users on most days.
- **+1** if the area has a history of defects (check the ticket's linked issues
  and the component's past bugs).
- **-1** if the condition is fully covered by automated tests that run on CI.

### Priority mapping

| Risk score | Priority | Meaning |
| --- | --- | --- |
| 15-25 | **P1** | Must pass before sign-off; blocks release |
| 8-14 | **P2** | Run this cycle |
| 1-7 | **P3** | Run if time allows; candidate for automation instead |

Cap P1 at what one tester can execute in a single focused session (roughly
20-30 UI cases). If more qualify, report that the scope is too large for one
cycle rather than silently producing an unexecutable plan.

---

## Part 2 - Bug Severity

Severity describes the **technical impact of the defect**. It is set by QA and
is not negotiable by schedule pressure.

| Severity | Definition | Examples |
| --- | --- | --- |
| **Critical / S1** | Data loss or corruption, security or privacy breach, incorrect financial calculation, total outage, or a core flow blocked for all users with no workaround | Cross-tenant data visible; payment charged twice; user records deleted on save; login broken |
| **Major / S2** | A significant function fails or a core flow is blocked for a subset of users; workaround is difficult or non-obvious | Cannot submit the form in Safari; filter returns wrong results; email never sent; permission check missing on an endpoint |
| **Minor / S3** | Function works but incorrectly or inconveniently; an easy workaround exists | Sort order wrong on one column; validation message unclear; count off by one in a non-financial context |
| **Trivial / S4** | Cosmetic; no functional impact | Misaligned icon; typo; inconsistent spacing; hover color off |

**Severity rules**

- Any security, privacy, or data-integrity defect is at least S2, regardless of
  how hard it is to reach.
- A defect with no workaround is at least one level above the same defect with
  a workaround.
- Frequency does not change severity - it changes priority.

---

## Part 3 - Bug Priority

Priority describes **how soon it should be fixed**. It is a business decision,
so propose it with reasoning rather than asserting it.

| Priority | Meaning |
| --- | --- |
| **P0 / Blocker** | Stop the release; fix now |
| **P1 / High** | Fix before this release ships |
| **P2 / Medium** | Fix in the next release or sprint |
| **P3 / Low** | Backlog; fix opportunistically |

Priority is derived from severity **and** these factors: how many users hit it,
how often, whether there is a workaround, whether it is a regression, whether
it affects a customer commitment or demo, and how risky the fix is.

**Common non-obvious combinations**

- S1 + P2: critical corruption in a feature nobody has enabled yet.
- S4 + P0: a typo in the company name on the launch landing page.
- S2 + P0: a regression in a flow that worked yesterday and is being demoed today.

Always state the reasoning in one line: *"S2/P1 - blocks checkout for all Safari
users (roughly 18% of traffic) with no workaround; regression from last release."*

---

## Part 4 - Sign-off Recommendation

Close a test cycle with one of these, and state the reason:

- **Pass** - all P1 cases pass; no S1/S2 defects open.
- **Pass with conditions** - all P1 pass; open S3/S4 defects listed and accepted;
  name the conditions.
- **Fail** - any P1 case fails, or any S1/S2 defect is open.
- **Blocked** - the environment, data, or a blocking `Q-` item prevented
  execution of P1 cases. Name exactly what is needed to unblock.

Never report Pass while blocking questions remain unanswered on P1 conditions -
report Blocked and name the question.
