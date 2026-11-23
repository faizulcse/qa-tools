---
name: qa-mark-run
description: >
  This skill should be used when every failing screenshot of a run, case or
  ticket should be marked - "mark all the failures", "annotate the screenshots
  for PROJ-12", "highlight the failures in this run", "prepare the screenshots
  for the bug reports", "which failure screenshots aren't marked yet". Creates
  a spec with the Expected / Actual banner for each failing check or results
  item that has a screenshot, draws the ones that can be drawn, marks the rest
  one by one with qa-mark, and reports what is marked, approximate or skipped.
metadata:
  version: "0.1.0"
---

# Mark every failure in a run

Script: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_mark.py <command>` (`$M`)

Input: a case folder (`qa-results/tc-07`), the whole `qa-results/` folder, a
ticket folder (`docs/PROJ-12/`) or a results file
(`docs/PROJ-12/results-<date>.json`). If the user names only a ticket key,
use `docs/KEY/` and `qa-results/`.

## Steps

1. **Status first** (read-only):
   `$M check PATH` - lists failing screenshots that are unmarked, marked copies
   that are out of date (the screenshot or the marks changed since drawing),
   and marks placed by eye.
2. **Specs for everything:** `$M batch PATH`. For each failing check
   (`result.json`) and each failing / partial AC, issue and not-fixed retest
   (results file) that has a PNG, it creates `<name>.marks.json` with the
   banner from the record, and draws those that already have marks. Existing
   specs keep their marks; `--force` recreates them and drops their marks, so
   only use it when the user asks.
3. **Place the missing marks** - for each "needs a mark" line, follow the
   `qa-mark` skill: `locate` if that page is still open in playwright-cli
   (rarely, after a run), otherwise Read the screenshot and `add --box ...
   --approx --label ...`. Add `--blur` for personal data you can see.
4. **Draw:** `$M draw SPEC [SPEC ...]` (one browser session for all of them).
5. **Look at each marked copy** (Read the PNG). Fix and redraw any box that is
   off.
6. **`$M check PATH` again** and report.

If the user only wants the Expected / Actual banner without boxes,
`$M batch PATH --banner-only` draws every spec as is.

## Report

```
Marked 4 of 5 failing screenshots for PROJ-12:
- qa-results/tc-07/02-applied.marked.png - 2 marks (exact), 1 blur
- docs/PROJ-12/01.marked.png - 1 mark (approximate, placed by eye)
...
Skipped: R1 - no screenshot in its evidence.
```

Never attach marked copies to Jira or post them without the user's OK.
