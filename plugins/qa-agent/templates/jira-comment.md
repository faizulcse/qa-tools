# QA Jira Comment Templates

Two comment shapes for posting QA results to a Jira ticket. They work for any
project or ticket type.

- **Template A - Testing Summary:** after testing a ticket against its
  acceptance criteria.
- **Template B - Retest:** after a developer reports an issue as fixed.

Fill the chosen template into a file (e.g. `verdict-PROJ-1234.md`), replace
every `<placeholder>`, delete rows and sections that do not apply, then preview
and post through the bundled client:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" comment PROJ-1234 --body-file verdict-PROJ-1234.md --dry-run
```

Show the user the dry-run output and get an explicit go-ahead before sending it
without `--dry-run`.

---

## Status icons

| Icon | Use for |
| --- | --- |
| ✅ Pass | The criterion is fully met |
| ⚠️ Partial | Met with a gap, or a minor defect |
| ❌ Fail | Not met |
| ⛔ Blocked | Cannot be tested because of the environment, data or a dependency (say why) |
| ⏸️ Not run | Not tested yet (say what is needed) |
| ℹ️ Info | An observation, not a defect |

## Severity scale

| Severity | Meaning |
| --- | --- |
| S1 | Critical: data loss, a security or privacy exposure, or the feature unusable |
| S2 | Major: an acceptance criterion fails, or a main flow is broken or blocked |
| S3 | Moderate: works, but behaves wrongly or misleadingly; a workaround exists |
| S4 | Minor: wording, layout or message text |
| Info | Observation or question; no fix expected |

## Verdict guide

| Verdict | When |
| --- | --- |
| ✅ Pass | Every in-scope criterion passes, and no S1 or S2 issues are open |
| ⚠️ Pass with conditions | Criteria pass or partially pass, with only S3/S4 issues, or items not run that are agreed for later |
| ❌ Fail | Any criterion fails, or any S1 or S2 issue is open |
| ⛔ Blocked | Testing cannot proceed (environment, data or access) |

---

## Template A: Testing Summary

```markdown
## Testing Summary: <TICKET-KEY>, <Ticket title>

**Verdict:** <✅ Pass | ⚠️ Pass with conditions | ❌ Fail | ⛔ Blocked> <optional: short reason>
**Tested by:** <Name> (QA) · **Date:** <YYYY-MM-DD> · **Environment:** <env name> (`<url or build>`)

### Scope
- **Feature:** <what was tested, in one line>.
- **Accounts / roles:** <roles or user types used>.
- **Test data:** <data set or records used>.
- **Layers:** <UI (browser/device), API (`<endpoints>`), database, mobile, ...>.
- **Note:** <optional: out of scope, not used, or assumptions>.

### Results
| Status | AC | Outcome |
|---|---|---|
| ✅ Pass | AC1: <short criterion> | <what was observed: the exact message, status code or value> |
| ⚠️ Partial | AC2: <short criterion> | <what works> <what doesn't> |
| ❌ Fail | AC3: <short criterion> | <what's missing or wrong> |
| ⏸️ Not run | AC4: <short criterion> | Needs <account / data / environment>. |

**Totals:** <N> ACs: ✅ <n> pass, ⚠️ <n> partial, ❌ <n> fail, ⏸️ <n> not run.

### Issues found
| Severity | Issue |
|---|---|
| S2 ❌ | **<Short title of the problem>.** <What happens, and where.> <BUG-KEY if filed> [Screenshot](<link>) |
| S3 ⚠️ | **<Short title>.** <Detail.> |
| S4 ⚠️ | **<Short title>.** <Detail.> Suggestion: <optional expected wording or behaviour>. |
| Info ℹ️ | **<Observation>.** |
```

### Optional sections

Add these only when they are useful.

**Need Fix column** - when issues have been triaged:

```markdown
| Severity | Need Fix | Issue |
|---|---|---|
| S3 ⚠️ | Yes | **<title>.** <detail> |
| S4 ⚠️ | No / Skip / As per design | **<title>.** <detail> |
```

**Questions** - open `Q-` items from the test plan:

```markdown
### Questions for the product owner
1. <Open question about scope, expected behaviour or a missing rule>?
```

**Recommendation:**

```markdown
### Recommendation
<One or two lines: what to fix, and what to retest next.>
```

**Evidence pointer** - where the full report lives:

```markdown
_Full report and evidence: attached `qa-report.html`._
```

**Test data note** - at the end, in italics:

```markdown
_Test data: <records created, changed or restored during testing>._
```

**Previous feedback status** - when earlier QA comments exist on the ticket:

```markdown
### Previous feedback: status
| Status | Feedback (<date>) | Now |
|---|---|---|
| ✅ Fixed | <earlier feedback> | <current behaviour> |
| ❌ Open | <earlier feedback> | <still happens> |
```

---

## Template B: Retest

```markdown
## Retest: <TICKET-KEY>, <short issue name>

**Result:** <✅ Resolved | ⚠️ Partially resolved | ❌ Not resolved>
**Tested by:** <Name> (QA) · **Date:** <YYYY-MM-DD> · **Environment:** <env name>

| Status | Issue | Retest result |
|---|---|---|
| ✅ Resolved | <The issue as originally reported.> | <What happens now: the exact message or value, and how it was checked.> |
| ❌ Not resolved | <Issue> | <What still happens.> [Screenshot](<link>) |
```

---

## Writing rules

- **AC order:** one row per acceptance criterion, in AC order, using the
  ticket's AC numbering. Split a criterion into two rows when it has two
  distinct cases, e.g. "AC5 (permitted user)" and "AC5 (unauthorised user)".
- **Only observed results:** a row is ✅ only if it was actually exercised and
  observed in this run. Anything not executed is ⏸️ or ⛔, never ✅.
- **Exact evidence:** quote the real UI text, status code or value, e.g.
  `403 "Forbidden"` or `"Saved successfully."`. Avoid vague words such as
  "works well" or "looks fine".
- **Short titles:** start each issue with a **bold short title**, then one or
  two lines of detail. Put bug keys and links last.
- **Out of scope:** leave out-of-scope criteria out of the table and mention
  them in one line under **Scope -> Note**.
- **Sensitive data:** no personal or customer data, unmasked emails or phone
  numbers, passwords, tokens or API keys. Redact screenshots too.
- **Short comments:** the full detail goes in the attached report; the comment
  is the headline.

## Jira formatting notes

`jira_client.py comment --body-file` converts markdown to Jira wiki markup
(headings, `**bold**`, inline code, links, lists, tables), so write the
templates in markdown as-is. A few things still break the rendering:

| Avoid | Why | Use instead |
| --- | --- | --- |
| Curly braces such as `{id}` in paths | `{...}` is a Jira macro and may show "Unknown macro" | `<id>` or `:id` |
| A pipe `\|` inside a table cell (e.g. "View \| Edit") | It splits the cell | "View/Edit" |
| An empty first header cell | It renders as `\|\|\|\|` | Always name the column, e.g. `Status` |
| Pasting the markdown by hand into the old Jira editor | `**bold**` is not converted there | Post through the client, or convert to `*bold*` |

Always run with `--dry-run` first and check the converted body for leftover
`**` markers or broken table rows.

## Posting checklist

- [ ] The ticket key in the heading matches the ticket being commented on.
- [ ] The verdict matches the results, using the verdict guide above.
- [ ] The totals add up to the number of rows.
- [ ] Every ❌ and ⚠️ result has a matching issue row, or is explained.
- [ ] Filed bugs are referenced by key.
- [ ] No sensitive data in the text, screenshots or links.
- [ ] The dry-run output was shown to the user and approved before posting.
- [ ] **When editing an existing comment:** re-read it first (`jira_client.py
      get <KEY>` returns all comments) and keep changes others made since.
