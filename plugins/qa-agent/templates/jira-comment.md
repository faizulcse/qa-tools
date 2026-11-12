# QA Jira Comment Templates (workspace version)

Based on the qa-agent plugin template (v0.5.0,
`~/.claude/plugins/cache/qa-tools/qa-agent/0.5.0/templates/jira-comment.md`).
This copy is the one to use in this workspace. Changes from the plugin version:

1. **Issues found** is optional. By default, open items are shown as ❌ Open or
   ⚠️ Open rows in the Previous feedback tables instead.
2. **Previous feedback** uses one table per feedback date.
3. **Tickets without acceptance criteria:** use the story requirement as AC1 and
   say so in the Scope note.
4. **Questions, Recommendation and the report pointer** are left out unless asked for.

Two comment shapes:

- **Template A - Testing Summary:** after testing a ticket against its
  acceptance criteria and retesting earlier feedback.
- **Template B - Retest:** after a developer reports an issue as fixed.

Fill the chosen template into a file (e.g. `qa-results/PROJ-1234/verdict-PROJ-1234.md`),
replace every `<placeholder>`, delete rows that do not apply, then preview and
post through the bundled client:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jira_client.py" comment PROJ-1234 --body-file verdict-PROJ-1234.md --dry-run
```

Show the user the dry-run output and get an explicit go-ahead before sending it
without `--dry-run`.

---

## Status icons

| Icon | Use for |
| --- | --- |
| ✅ Pass / ✅ Fixed | The criterion is fully met, or the earlier feedback is fixed |
| ⚠️ Partial | Met with a gap, or only partly verified (e.g. spec checked, live response not) |
| ⚠️ Open | Earlier feedback still open, but not a defect (e.g. needs a product decision) |
| ❌ Fail / ❌ Open | Not met, or the earlier feedback is still not fixed |
| ⛔ Blocked | Cannot be tested because of the environment, data or a dependency (say why) |
| ⏸️ Not run | Not tested yet (say what is needed) |
| ℹ️ Info | An observation, not a defect |

## Severity scale

Used only when the optional Issues found section is included.

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
| ✅ Pass | Every in-scope criterion passes, no earlier feedback is ❌ Open, and no S1 or S2 issues are open |
| ⚠️ Pass with conditions | Criteria pass or partially pass, with only ⚠️ items or S3/S4 issues, or items not run that are agreed for later |
| ❌ Fail | Any criterion fails, any earlier feedback is ❌ Open, or any S1 or S2 issue is open |
| ⛔ Blocked | Testing cannot proceed (environment, data or access) |

The verdict reason must name something that is shown in the comment.

---

## Template A: Testing Summary

```markdown
## Testing Summary: <Ticket title>

**Verdict:** <✅ Pass | ⚠️ Pass with conditions | ❌ Fail | ⛔ Blocked> <optional: (short reason, shown below)>
**Tested by:** <Name> (QA) · **Date:** <YYYY-MM-DD> · **Environment:** <env name> (`<url or build>`)

### Scope
- **Feature:** <what was tested, in one line>.
- **Accounts / roles:** <roles or user types used>.
- **Test data:** <data set or records used; no customer names or IDs>.
- **Layers:** <UI (browser/device), API (<endpoints>), database, Swagger spec, ...>.
- **Note:** <out of scope or assumptions. If the ticket has no ACs: "the ticket has no formal ACs; the story requirement is used as AC1.">

### Results
| Status | AC | Outcome |
|---|---|---|
| ✅ Pass | AC1: <short criterion> | <what was observed: the exact message, status code or value> |
| ⚠️ Partial | AC2: <short criterion> | <what works> <what doesn't> |
| ❌ Fail | AC3: <short criterion> | <what's missing or wrong> |
| ⏸️ Not run | AC4: <short criterion> | Needs <account / data / environment>. |

**Totals:** <N> ACs: ✅ <n> pass, ⚠️ <n> partial, ❌ <n> fail, ⏸️ <n> not run.

### Previous feedback: status
| Status | Feedback (<newest date>) | Now |
|---|---|---|
| ✅ Fixed | <earlier feedback, short> | <current behaviour: status code and message> |
| ❌ Open | <earlier feedback> | <still happens> |

| Status | Feedback (<older date>) | Now |
|---|---|---|
| ✅ Fixed | <earlier feedback> | <current behaviour> |
| ⚠️ Partial | <earlier feedback> | <what was verified and what was not> |
| ⚠️ Open | <earlier feedback> | <current behaviour; needs a decision> |
```

### Previous feedback rules

- One table per feedback comment, **newest date first**, with the date in the
  `Feedback (<date>)` header.
- Leave out feedback items the user asks to skip.
- Feedback confirmed as intended behaviour: drop it, or, if the user wants it
  shown, add it to the optional Issues found table with Need Fix "As per design".

### Optional sections

Add these only when the user asks for them.

**Issues found** - new defects found during this run:

```markdown
### Issues found
| Severity | Need Fix | Issue |
|---|---|---|
| S2 ❌ | Yes | **<Short title>.** <What happens, and where.> <BUG-KEY if filed> |
| S3 ⚠️ | Yes | **<Short title>.** <Detail.> |
| Info ℹ️ | No / As per design | **<Observation>.** |
```

**Questions:**

```markdown
### Questions for the product owner
1. <Open question about scope, expected behaviour or a missing rule>?
```

**Recommendation:**

```markdown
### Recommendation
<One or two lines: what to fix, and what to retest next.>
```

**Evidence pointer:**

```markdown
_Full report and evidence: attached `qa-report.html`._
```

**Test data note:**

```markdown
_Test data: <records created, changed or restored during testing>._
```

---

## Template B: Retest

```markdown
## Retest: <short issue name>

**Result:** <✅ Resolved | ⚠️ Partially resolved | ❌ Not resolved>
**Tested by:** <Name> (QA) · **Date:** <YYYY-MM-DD> · **Environment:** <env name>

| Status | Issue | Retest result |
|---|---|---|
| ✅ Resolved | <The issue as originally reported.> | <What happens now: the exact message or value, and how it was checked.> |
| ❌ Not resolved | <Issue> | <What still happens.> [Screenshot](<link>) |
```

---

## Writing rules

- **AC order:** one row per acceptance criterion, in the ticket's AC order and
  numbering. With no ACs, use the story requirement as AC1.
- **Only observed results:** ✅ only if it was actually exercised and observed in
  this run. Spec-only checks are ⚠️ Partial. Anything not executed is ⏸️ or ⛔.
- **Exact evidence:** quote the real status code, message or value, e.g.
  `400` "size must be between 0 and 255". Avoid "works well" or "looks fine".
- **No dangling references:** do not mention questions, issues or reports that
  are not in the comment (e.g. "See question 1." without a Questions section).
- **Sensitive data:** no customer names, account IDs, personal data, passwords,
  tokens or API keys. Say "a test client account" instead.
- **Short comments:** the comment is the headline. Detail goes in an attached
  report when the user wants one.

## Jira formatting notes

`jira_client.py comment --body-file` converts markdown to Jira wiki markup.

| Avoid | Why | Use instead |
| --- | --- | --- |
| The ticket's own key (e.g. `PROJ-1234`) in the heading or text | Jira turns issue keys into link cards showing the key, title and status | Leave it out; the comment is already on that ticket. Reference other tickets only when needed |
| Curly braces such as `{id}` in paths or JSON | `{...}` is a Jira macro and may show "Unknown macro" | `<id>`, or describe the value: `error: UNAUTHORIZED` |
| A `*` inside inline code in a list item, e.g. `qa-*` | The converter treats it as italics and breaks the line | Write the full name, e.g. `qa-PCH-841-client` |
| A pipe `\|` inside a table cell | It splits the cell | "View/Edit" |
| An empty first header cell | It renders as `\|\|\|\|` | Always name the column, e.g. `Status` |

Always run with `--dry-run` first and check the converted body for leftover
`**` markers, lines starting with `_ `, or broken table rows.

## Posting checklist

- [ ] The heading has no ticket key (it would render as a link card), and the
      title matches the ticket being commented on.
- [ ] The verdict matches the results and its reason is shown in the comment.
- [ ] The totals add up to the number of AC rows.
- [ ] Every ❌ and ⚠️ row explains what is wrong or missing.
- [ ] No references to removed sections.
- [ ] No sensitive data in the text, screenshots or links.
- [ ] The dry-run output was shown to the user and approved before posting.
