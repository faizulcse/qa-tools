---
name: qa-mark
description: >
  This skill should be used when a failing screenshot needs to show what is
  wrong - "mark the failure on the screenshot", "highlight where it's wrong",
  "annotate this screenshot", "put the failing reason on the image", "circle
  the error", "blur the email in this screenshot", "make the screenshot clear
  for the developer" - and right after a failed check in a qa-test-ui run,
  while the page is still open. Draws a box or arrow with a numbered reason on
  the failing element, an Expected / Actual banner from the test record, and
  blur over personal data, into a separate marked copy. The original
  screenshot is never changed.
metadata:
  version: "0.1.0"
---

# Mark a failing screenshot

Script: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_mark.py <command>`
(below: `M=...qa_mark.py`, written as `$M`)

For `02.png` the marks live in `02.marks.json` and the marked copy is
`02.marked.png`, both next to the original. The original is never changed.

## Rules

- **The reason comes from the record.** The banner's Expected / Actual come
  from the failed `qa_record.py check` (`--fail --actual`) or the results file
  item. Never write a reason that isn't recorded. If there is no record, ask
  the user for Expected and Actual before drawing.
- **Labels are short** (under ~8 words) and only restate the record for that
  element ("Success shown for an expired code"). No new claims, no guesses
  about the cause.
- **Exact beats by-eye.** Use `locate` on the open page whenever you can. A box
  placed by reading the image must use `--approx` (drawn dashed, noted under
  the image) and you must tell the user it is approximate.
- **Blur personal data** in every marked copy that leaves the machine: run
  `redact` while the page is open, then look at the image for names, phone
  numbers or addresses it did not catch and add `--blur` boxes.
- **Check your own work.** After drawing, Read the marked PNG and confirm each
  box sits on the right element and nothing important is covered. Fix and
  redraw once if needed.
- Attaching to Jira is a separate step that needs the user's OK.

## A. During a test run (page still open) - exact

Right after the failing screenshot and `qa_record.py check --fail`, before
the page changes:

```bash
OUT=qa-results/tc-07
$M from-record TC-07                       # spec + banner from the failed check
$M locate -s qa e42 --spec $OUT/02-applied.png \
   --label "Success shown for an expired code"
$M locate -s qa e57 --spec $OUT/02-applied.png \
   --label "Total changed" --level warn     # optional second mark
$M redact -s qa --spec $OUT/02-applied.png  # emails, tokens, UUIDs, long IDs
$M draw $OUT/02-applied.png
```

- `e42` is the ref from the page snapshot taken for this step; a unique CSS
  selector works too.
- `locate` does not scroll, so the box matches the screenshot already taken.
  If it warns that the mark is **outside the screenshot**, the element was
  scrolled away. `remove` that mark and take a matching shot:
  `$M locate -s qa e42 --spec $OUT/02-applied.png --scroll --shoot $OUT/02-applied-focus.png --label ...`
  scrolls the element into view, saves the new screenshot, creates
  `02-applied-focus.marks.json` with the banner copied from `02-applied`, and
  puts the mark there. Draw that one.
- Levels: `fail` (red, default), `warn` (amber), `info` (blue).

## B. Later, page closed - by eye

```bash
$M from-record TC-07          # or: from-results docs/KEY/results-<date>.json --item I1
                              # or: new shot.png --title ... --expected ... --actual ...
```

Read the screenshot, find the failing element, and estimate its rectangle in
**image pixels** (the PNG's own size; `show` prints it):

```bash
$M add $OUT/02-applied.png --box 40,200,600,34 --approx --label "Success shown for an expired code"
$M add $OUT/02-applied.png --arrow 327,269 --approx --label "Apply accepted the code"
$M add $OUT/02-applied.png --blur 1085,17,177,22 --why email
$M draw $OUT/02-applied.png
```

Then Read the marked copy; if a box is off, `show`, `remove SPEC N`, add it
again and redraw.

## Other commands

| Command | Use |
| --- | --- |
| `show SPEC` | Banner and marks with their image-pixel positions |
| `remove SPEC N` | Drop the Nth mark listed by `show` |
| `add SPEC --solid X,Y,W,H` | Solid cover instead of blur (secrets) |
| `check PATH` | Unmarked failures, out-of-date or missing marked copies, by-eye marks |

`SPEC` can be the `.marks.json` or the original `.png`.

## Reporting back

One line per marked copy: path, number of marks, and whether any were
approximate or blurred. Offer to use the marked copies in the bug report or
results file (`evidence`), keeping the original listed as the unmarked copy.
