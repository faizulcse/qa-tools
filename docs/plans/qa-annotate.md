# qa-annotate: Plan

Status: **plugin built as qa-annotate 0.1.0** (not released yet). The
integration changes in qa-agent and qa-loop (step 6 of the build order) are
not done. Differences from the plan found while building:

- playwright-cli blocks `file://` pages, so `draw` serves the overlay page from
  a temporary `127.0.0.1` server (stdlib `http.server`) instead.
- `locate` does not scroll by default, so the box matches the screenshot
  already taken; `--scroll --shoot` takes a fresh matching screenshot and
  copies the banner into its spec.
- Added `new`, `add`, `show`, `remove` and `redact` (blur boxes found on the
  open page) to the commands.
- The banner holds a list of findings, so several failed checks on the same
  screenshot share one marked copy.
- Mobile device emulation (`open --device`) crashes in playwright-cli 0.1.24,
  so the 2x / 3x case was tested with a constructed spec; `--hires`
  screenshots scale by image width / viewport width.

## Purpose

A failing screenshot on its own makes the reader hunt for the problem. A
developer opening `02.png` from a bug report sees a whole page and has to
guess which part is wrong and why.

qa-annotate marks the failing area on the screenshot and writes the failing
reason on the image itself:

- a box (or an arrow) around the element that is wrong,
- a numbered callout next to it with the short reason,
- a banner with **Expected** and **Actual**, taken from the recorded check,
- blur boxes over personal data or secrets that are in the shot.

The original screenshot is never changed. The marked copy is saved next to
it (`02.png` → `02.marked.png`) and used in bug reports, the QA report and
Jira attachments.

## Name

| Name | Notes |
| --- | --- |
| **`qa-annotate`** (recommended) | Says exactly what it does; fits `qa-agent` / `qa-loop` naming and sorts with them |
| `qa-markup` | Short, but "markup" also reads as HTML |
| `qa-evidence` | Broader: room for later evidence tools (GIFs, crops), but vaguer today |
| `failshot` | Catchy, but doesn't match the family and hides the redaction part |

Recommendation: plugin **`qa-annotate`**, with two skills:

- `qa-mark` - mark one screenshot ("highlight the failure on this screenshot",
  "mark where it's wrong", "blur the email in this shot").
- `qa-mark-run` - mark every failing screenshot in a case folder or results
  file ("mark all the failures for PROJ-12").

## Decisions

1. **Original stays untouched.** Marked images are new files
   (`<name>.marked.png`) plus a spec (`<name>.marks.json`) that says what was
   drawn and from which source, so a mark can be re-drawn or audited.
2. **No new dependencies.** No Pillow, no ImageMagick. Drawing is done by
   building a small HTML page (the screenshot plus overlay elements) and
   taking a screenshot of it with **playwright-cli**, which qa-agent already
   requires. The script is plain Python 3 standard library, like the rest of
   qa-tools.
3. **The reason text comes from the record, not from Claude's wording.**
   Expected / Actual come from `qa_record.py check --fail --actual` or the
   results file item (`now` / `expected`, `outcome`). The skill may shorten a
   callout label but must not add claims that aren't in the record.
4. **Exact positions when possible, marked as approximate otherwise.**
   Boxes come from the live page (element bounding box) when the page is
   still open. For an old screenshot, Claude reads the image and places the
   box by eye; those marks are drawn dashed and the spec records
   `"approx": true`.
5. **Redaction is part of marking.** Emails, tokens, phone numbers and
   full IDs visible in the shot can be blurred in the marked copy. qa-loop's
   comment lint already treats these as risky; the image should follow the
   same rule. The original (unblurred) file stays in the git-ignored
   `qa-results/` folder only.
6. **Requires qa-agent** (playwright-cli setup, `qa_record.py` layout).
   Works with qa-loop when installed (results files, Jira drafts) but does
   not need it.

## Plugin layout

```
plugins/qa-annotate/
├── .claude-plugin/plugin.json
├── README.md
├── CHANGELOG.md
├── scripts/
│   └── qa_mark.py            # locate, draw, batch, check
├── templates/
│   ├── overlay.html          # page used to draw the marks
│   └── marks.example.json    # example spec
└── skills/
    ├── qa-mark/SKILL.md
    └── qa-mark-run/SKILL.md
```

Registered in `.claude-plugin/marketplace.json` and in the root README
(new "What qa-annotate does" section and the versions table).

## Marks spec (`<name>.marks.json`)

```json
{
  "source": "qa-results/tc-07/02.png",
  "output": "qa-results/tc-07/02.marked.png",
  "image": {"width": 2560, "height": 1600, "dpr": 2, "full_page": false,
            "scroll": [0, 0]},
  "banner": {
    "status": "fail",
    "title": "TC-07 Expired discount code is rejected",
    "expected": "Inline error \"This code has expired\"",
    "actual": "Green \"Discount applied\" shown; total changed to $96.00"
  },
  "marks": [
    {"n": 1, "kind": "box", "level": "fail",
     "rect": [812, 430, 360, 48], "units": "css",
     "label": "Should be an error, shows success",
     "source": "ref e42", "approx": false},
    {"n": 2, "kind": "arrow", "level": "warn",
     "to": [1104, 610], "label": "Total changed although code is expired"},
    {"kind": "blur", "rect": [40, 18, 220, 24], "units": "css",
     "why": "email"}
  ],
  "record": {"case": "TC-07", "check": 3}
}
```

- `units: "css"` rectangles are multiplied by `dpr` and offset by `scroll`
  (full-page shots) when drawing, so boxes from `getBoundingClientRect()` land
  on the right pixels. `units: "px"` means image pixels (used for by-eye marks).
- `level`: `fail` (red), `warn` (amber), `info` (blue). Every box has a white
  halo so it shows on both dark and light pages.
- Callout labels are numbered and placed outside the box, moved to stay inside
  the image; long labels wrap at ~40 characters.
- The banner is added above the image (the image is not covered), so nothing
  on the page is hidden by it.

## Script: `qa_mark.py`

| Command | What it does |
| --- | --- |
| `locate -s SESSION REF\|--selector CSS` | Bounding box of an element in the open playwright-cli page (scrolls it into view first), printed as a mark with `units: css`, plus viewport, `dpr` and scroll |
| `draw SPEC [--out PNG]` | Builds the overlay page from the spec and screenshots it at the image's size → marked PNG |
| `from-record CASE [--check N]` | Creates a spec from `qa_record.py`'s `result.json`: banner from the failed check, source image from its `--screenshot` |
| `from-results FILE [--item ID]` | Same, from a qa-loop results file item (`now` / `expected` / `outcome`, first evidence image) |
| `batch DIR\|FILE` | Marks every failing check / item that has a screenshot and no marked copy yet; lists what still needs a box placed by hand |
| `check DIR\|FILE` | Read-only: failing evidence without a marked copy, marked copies older than their source, specs whose source is missing, approximate marks |

Drawing pipeline (`draw`):

1. Read the PNG size from its header (stdlib, no image library).
2. Fill `templates/overlay.html` with the image (as a `file://` path), the
   banner and absolutely positioned elements for each mark; blur marks use a
   CSS `backdrop-filter: blur()` box.
3. `playwright-cli -s=qa-mark open file://…/overlay.html`, `resize` to the
   image width × (image height + banner height), `screenshot --filename=…`,
   `close`. A separate session (`qa-mark`) so the test session is not touched.
4. Write the spec next to the output and print both paths.

## Skills

### `qa-mark`

Input: a screenshot path (or "the last failure"), and optionally what is wrong.

1. Find the record for the screenshot (`result.json` check or results item).
   If none, ask the user for Expected / Actual - do not invent them.
2. Pick where the box goes:
   - page still open in playwright-cli → `qa_mark.py locate` with the ref from
     the latest snapshot (exact);
   - otherwise → Read the image, place the box by eye, mark `approx: true`,
     and say so.
3. Look for personal data or secrets in the shot (from the page snapshot text
   when available, else by reading the image) and add blur marks.
4. `qa_mark.py draw`, then Read the marked PNG and check the box covers the
   right element and the label is readable. Re-draw once if it's off.
5. Report the marked path. Offer to use it in the bug report / results file.
   Never attach to Jira without the user's OK (the qa-agent hook asks anyway).

### `qa-mark-run`

Input: a case folder, a ticket key or a results file.

1. `qa_mark.py batch` for everything it can mark from the record.
2. For items it couldn't place, run the `qa-mark` steps one by one.
3. `qa_mark.py check` and report: marked, approximate, skipped (and why).

## Integration with qa-agent and qa-loop

Changes in the other plugins, done in the same release:

- **qa-agent `qa-test-ui`:** after a failed check, while the page is still
  open, run `qa_mark.py locate` for the failing element and keep the box in
  the case record (`qa_record.py check … --mark-ref e42`). This is the cheap
  moment to get exact positions.
- **qa-agent `qa_record.py`:** optional `--mark-ref` / `--mark-rect` on
  `check`, stored on the check.
- **qa-agent `qa-bug` and `build_report.py`:** prefer `*.marked.png` when it
  exists; list the original as "unmarked original" in the evidence section.
- **qa-loop `qa_results.py`:** `render` uses the marked image for evidence;
  `check` warns (not errors) when a failing item's screenshot has no marked
  copy and qa-annotate is installed.

Every integration is optional: without qa-annotate installed, qa-agent and
qa-loop behave exactly as today.

## Things to verify first (Phase 0)

- playwright-cli: `eval` against a snapshot ref (to get a bounding box),
  `resize`, and whether `screenshot` is viewport-only or full-page by default.
- `devicePixelRatio` in the qa session on macOS (Retina = 2) and in headless
  CI (1); confirm the css → px conversion on both.
- `backdrop-filter: blur()` works in the bundled Chromium when the overlay
  page is screenshotted; fallback is a solid box.
- Opening a `file://` page that references a PNG elsewhere on disk.

## Testing

A local fixture page with elements at known positions:

| Case | Expect |
| --- | --- |
| Viewport shot, DPR 1 and DPR 2 | Box edges within 2 px of the element |
| Full-page shot, element below the fold | Box offset by scroll, still exact |
| Element off-screen at locate time | Scrolled into view, box correct |
| Tiny element (icon button) | Minimum box size, label still readable |
| Dark page and light page | Box visible on both (halo) |
| Long Actual text | Banner wraps, nothing cut off |
| Mark near the image edge | Callout moved inside the image |
| Blur over an email | Text unreadable in the marked copy; original unchanged |
| By-eye mark | Dashed box, `approx: true` in spec, skill says so |
| No record for the screenshot | Skill asks for Expected / Actual |
| `check` after re-taking the source | Marked copy reported as out of date |

## Build order

1. Phase 0 checks above.
2. `qa_mark.py draw` + overlay template + spec format.
3. `locate`, `from-record`, `from-results`.
4. `qa-mark` skill; try it on real failures from a past ticket.
5. `batch`, `check`, `qa-mark-run` skill.
6. qa-agent / qa-loop integration (`--mark-ref`, marked images in reports).
7. README, CHANGELOG, marketplace entry, root README.

## Release

- New plugin `qa-annotate` 0.1.0.
- qa-agent and qa-loop minor versions for the integration changes.
- Marketplace minor version bump.

## Open questions

- Should `qa-test-ui` mark failures automatically at the end of a run, or
  only when asked? (Plan: locate automatically, draw only when asked or when
  a bug / report is written.)
- Animated evidence (GIF of the failing flow with the mark on the last
  frame) - later, if wanted.
- Should Jira get only the marked copy, or both? (Plan: marked only; the
  original stays local.)
