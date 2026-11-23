# qa-annotate

Marks failing screenshots so the reader sees at once what is wrong:

- a **box or arrow** on the failing element, with a **numbered reason**,
- an **Expected / Actual banner** above the image, taken from the test record,
- **blur** over emails, tokens, UUIDs and long IDs (and anything else you add),
- a footer saying it is a marked copy, and whether any box was placed by eye.

The original screenshot is never changed. For `02.png` the marks are saved in
`02.marks.json` and the marked copy in `02.marked.png`, next to it.

Requires **qa-agent** (its playwright-cli setup and `qa_record.py` case
folders). Works with **qa-loop** results files when it's installed. No MCP
servers, no image library: drawing goes through playwright-cli.

## Install

```
/plugin install qa-annotate@qa-tools
```

Restart Claude Code so the skills load. playwright-cli must be set up
(qa-agent's `qa-setup`), and Python 3.8+.

## Skills

| Skill | Say | Does |
| --- | --- | --- |
| `qa-mark` | "mark the failure on the screenshot", "highlight where it's wrong", "blur the email in this shot" | Marks one screenshot: exact box from the open page, or by eye (dashed) from an old screenshot |
| `qa-mark-run` | "mark all the failures for PROJ-12", "which failure screenshots aren't marked yet" | Specs for every failing check / item with a screenshot, draws them, marks the rest, reports what's left |

## How to use it

### During a test run (best: exact positions)

Ask while testing, or right after a failure:

> Run TC-07 on staging and mark the failure on the screenshot.

After the failing screenshot and `qa_record.py check --fail`, Claude runs:

```bash
M="python3 ${CLAUDE_PLUGIN_ROOT}/scripts/qa_mark.py"
$M from-record TC-07                                   # banner from the failed check
$M locate -s qa e42 --spec qa-results/tc-07/02-applied.png --label "Success shown for an expired code"
$M redact -s qa --spec qa-results/tc-07/02-applied.png  # blur personal data on the page
$M draw qa-results/tc-07/02-applied.png
```

→ `qa-results/tc-07/02-applied.marked.png`

### After the run (page closed)

> Mark all the failure screenshots for PROJ-12.

Claude runs `batch` to create a spec with the banner for every failing
screenshot, then reads each image, places the boxes by eye (`add --approx`,
drawn dashed), draws them and checks the result.

### By hand

```bash
$M new shot.png --title "Profile save" --expected "Profile saved" --actual "Error 500 shown"
$M add shot.png --box 20,1420,1240,38 --label "Server error instead of save" --approx
$M add shot.png --blur 1085,17,177,22 --why email
$M draw shot.png
```

## Commands (`scripts/qa_mark.py`)

| Command | What it does |
| --- | --- |
| `from-record CASE [--check N]` | Spec(s) from a qa_record case (`result.json`): banner from each failed check that has a screenshot |
| `from-results FILE [--item ID]` | Spec(s) from a qa-loop results file: failing/partial ACs, issues, not-fixed retests with a PNG in `evidence` |
| `new PNG --expected … --actual … [--title] [--status]` | Spec with your own banner |
| `locate -s SESSION TARGET --spec SPEC [--label] [--level] [--scroll --shoot PNG]` | Exact box of an element on the open page (snapshot ref or selector). Doesn't scroll by default, so it matches the shot already taken; `--scroll --shoot` takes a new matching shot with the banner copied |
| `redact -s SESSION --spec SPEC [--pattern RE]` | Blur boxes over emails, JWTs, UUIDs, long hex IDs, API-key-like strings and filled password fields visible on the page |
| `add SPEC --box\|--arrow\|--blur\|--solid … [--approx] [--units px\|css]` | A mark by coordinates (image pixels by default) |
| `show SPEC`, `remove SPEC N` | List / drop marks |
| `draw SPEC [SPEC …] [--out PNG]` | Draw the marked copies (one browser session for all) |
| `batch PATH [--banner-only] [--force]` | Specs for every failure under a case folder, `qa-results/`, `docs/KEY/` or a results file; draws those that have marks |
| `check PATH` | Read-only: unmarked failures, not drawn / out of date / missing source, by-eye marks. Exit 1 on problems |

`SPEC` is the `.marks.json` or the original `.png`. Mark levels: `fail` (red),
`warn` (amber), `info` (blue).

## The spec (`<name>.marks.json`)

```json
{
  "source": "02-applied.png",
  "output": "02-applied.marked.png",
  "image": {"width": 1280, "height": 720},
  "banner": {"status": "fail", "title": "TC-07 Expired discount code is rejected",
             "findings": [{"label": "", "expected": "Inline error reads \"This code has expired\"",
                           "actual": "Green \"Discount applied\" shown; total changed to $96.00"}]},
  "marks": [
    {"kind": "box", "n": 1, "level": "fail", "label": "Should be an expiry error, shows success",
     "rect": [40, 200.8, 600, 34], "units": "css",
     "frame": {"sx": 0, "sy": 0, "vw": 1280, "vh": 720, "dpr": 1}, "source": "locate #msg", "approx": false},
    {"kind": "blur", "rect": [1083, 15, 181, 26], "units": "css", "frame": {"…": "…"}, "why": "email"}
  ],
  "record": {"kind": "qa_record", "file": "result.json", "case": "TC-07", "n": 3}
}
```

Positions from `locate` / `redact` are CSS pixels with the page's scroll and
viewport; `draw` scales them to the image (so `--hires` screenshots work) and
adds the scroll for full-page screenshots. Marks from `add` are image pixels.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `QA_MARK_SESSION` | `qa-mark` | playwright-cli session used for drawing (separate from your test session) |
| `QA_OUT_DIR` | `./qa-results` | Where `from-record CASE-ID` looks for case folders (same as qa-agent) |

## Safety

- The original screenshot is never modified.
- Banner text comes from the recorded check or results item; the skills don't
  write reasons that aren't recorded.
- Boxes placed by eye are drawn dashed and the footer says so.
- `redact` finds common patterns only; the skills also look at the image for
  names, phone numbers and addresses. Keep the unblurred originals in the
  git-ignored `qa-results/` folder.
- Drawing serves the page from a temporary server on `127.0.0.1` (playwright-cli
  blocks `file://` pages) and removes it afterwards.
- Nothing is attached to Jira by this plugin.
