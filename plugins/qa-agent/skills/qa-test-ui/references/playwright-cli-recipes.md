# playwright-cli Recipes for QA

QA-specific patterns built on `playwright-cli`. The official skills installed by
`playwright-cli install --skills` are the authority on command syntax; check
`playwright-cli --help` or `playwright-cli --help <command>` when a flag is
uncertain. These recipes cover how to *use* those commands to find defects.

---

## Saving Page Snapshots

The auto-written snapshot under `.playwright-cli/` is transient. Save your own
into the case directory at every step:

```bash
playwright-cli snapshot --filename=$OUT/02-after-apply.snapshot.md
```

| Flag | Use it when |
| --- | --- |
| *(none)* | The default - full page tree, the right choice most of the time |
| `--boxes` | Layout, overlap, off-screen, or responsive defects: adds each element's bounding box in CSS pixels |
| `--depth N` | A very large page where the full tree is unreadable; take a shallow one for context plus a targeted one for the region under test |
| `[target]` | A single region: `snapshot e12` or `snapshot "#cart"` captures just that subtree |

Naming: `NN-<what-just-happened>.snapshot.md`, with the same `NN` as the
screenshot from that step, so the pair reads in order.

Snapshots earn their keep in three places. They are the **audit trail** - a
reviewer can see what the assertion was made against without rerunning the case.
They are the **diff** - saving one before and one after an action shows exactly
what the app changed, which is how you catch a control that silently did nothing
or a value that changed somewhere else on the page. And they are the **evidence
a developer can read**, since the tree names roles and accessible names rather
than pixel positions.

Take the failure snapshot *before* highlighting, screenshotting, or clicking
anything else. Each subsequent command can change the page, and the state you
needed is then gone.

---

## Assertions with `find`

`find` searches the current snapshot and is the assertion primitive for a test
case. It answers in exactly the terms a bug report needs:

```bash
playwright-cli find "This code has expired"
# "No matches found for ..."   -> the expected result did not happen
# "Found 1 match for ..."      -> it did, with surrounding context
```

For every failing check, run `find` twice: once for the expected text, once for
what appears instead. The first gives the "Expected result" line, the second the
"Actual result" line, and the surrounding context it prints shows the state of
the region - all three of which the ticket needs.

`find` takes a regexp as well as literal text, which is how to assert on
formatted values (`"Order total: \\$1[0-9]{2}\\.[0-9]{2}"`) without pinning the
exact number.

Two failure modes to keep apart: text that is genuinely absent, and text that is
present but rendered differently - a non-breaking space, a different dash, a
currency symbol on the wrong side. When `find` misses something you can see in
the screenshot, read the snapshot file directly before concluding it is absent.

---

## Sessions and Roles

One named session per role under test. Sessions are isolated, so a permissions
matrix can be walked without logging in and out.

```bash
playwright-cli -s=admin  open https://staging.example.com
playwright-cli -s=viewer open https://staging.example.com
playwright-cli -s=anon   open https://staging.example.com
```

Log in once per role, save the state, and reload it at the start of later cases
so each case starts from a known authenticated state rather than repeating the
login flow:

```bash
playwright-cli -s=admin state-save qa-results/session-admin.json
playwright-cli -s=case state-load qa-results/session-admin.json
```

Saved state is credentials in a file. Keep it under `qa-results/`, which the
setup script adds to `.gitignore`, and delete it at the end of a cycle.

**Permission testing:** for every control the UI hides for a role, load that
role's session and navigate straight to the URL behind the control. A hidden
button is not an access control; the direct request is the test.

```bash
playwright-cli -s=viewer open https://staging.example.com/admin/users
playwright-cli -s=viewer snapshot        # expect a 403/404 page, not the list
```

Then confirm the same at the API layer with **qa-test-api** - a UI that hides
the route while the endpoint answers is a high-severity defect.

---

## Reading the Snapshot Like a Tester

The snapshot is an accessibility tree. Read it for defects, not just for refs:

- **Missing accessible names.** A `button` with no name in the tree is a button
  a screen-reader user cannot identify. That is an accessibility defect, filed
  as S3 unless it blocks a core flow.
- **Wrong roles.** A `div` acting as a button will not appear as `button`.
  Keyboard users cannot reach it.
- **Heading structure.** Skipped levels and multiple `h1`s show up here.
- **Duplicate names.** Two controls with the identical accessible name in one
  view is both an a11y defect and a sign the UI is ambiguous.
- **Content that should not be there.** Draft records, other tenants' data, or
  debug text visible in the tree is a finding regardless of whether it is
  visually hidden.

For attributes the tree does not show (a `disabled` state, a `data-` value, an
input's `type`), the official element-attribute skill covers inspection; `eval`
also works:

```bash
playwright-cli eval "el => el.getAttribute('aria-invalid')" e8
playwright-cli eval "el => el.disabled" e9
```

Check that a visually disabled control is genuinely disabled - a button styled
grey but still clickable is a real defect, and double-submit bugs come from it.

---

## Evidence Capture

Capture at the moment of failure, before doing anything that changes the page.

```bash
playwright-cli snapshot --filename=$OUT/03-failure.snapshot.md   # tree first
playwright-cli highlight e3                     # ring the offending element
playwright-cli screenshot --filename=$OUT/03-failure.png
playwright-cli screenshot e12 --filename=$OUT/03-error-region.png
playwright-cli highlight --hide                 # clear before the next case
```

Snapshot before highlight, because `highlight` alters the page.

`highlight` is what turns a screenshot into evidence: the full page shows
context, the highlight says which part is wrong, and the cropped element
screenshot proves the detail. A reader should not have to hunt.

Console and network output are the backend half of a UI failure:

```bash
playwright-cli console          > $OUT/console.txt   # add a min-level to filter
playwright-cli requests         > $OUT/requests.txt  # --static to include assets
playwright-cli request 5        > $OUT/discount.txt  # full exchange, one request
playwright-cli response-body 5                       # just the response body
```

Triage rule: when a UI action silently does nothing, check `requests` first. The
three common causes are a 4xx/5xx from the endpoint, a request that was never
sent (client-side validation blocked it), and a request that succeeded while the
UI ignored the response. Each is a different bug with a different owner, and the
request log tells you which one to file.

For multi-step or timing-dependent failures, record a trace and attach it - a
developer can replay the whole run, which usually removes an entire round trip
of questions. Video is worth it for animation, drag, and focus-order defects
that a still frame cannot show.

---

## Error Paths via Request Interception

Most acceptance criteria describe only the happy path, so the error states are
untested and frequently unimplemented. Route interception reaches them without
needing the backend to actually fail.

`route <pattern>` installs a mock, `route-list` shows what is active, and
`unroute` removes it — always unroute before the next case, or a later failure
will be your own mock. `network-state-set offline` (and `online`) covers the
connectivity cases without a route at all.

The QA value is in what to simulate:

- **500 from the save endpoint** - is the user told, and is their input kept?
- **Slow response (10s+)** - is there a loading state, or does the UI look
  frozen and invite a second click?
- **Network failure mid-request** - is there a retry, and does a retry duplicate
  the record?
- **Empty list response** - is the empty state rendered, or a blank page?
- **Malformed/unexpected JSON** - does the UI degrade or throw?
- **401 mid-session** - is the user sent to login, and is their work preserved?
- **Partial failure** - one item in a bulk operation fails; is the result
  reported accurately or silently rounded to "success"?

Each of these maps directly to a `Q-` item from **qa-analyze**: the requirement
that never said what happens on failure.

---

## Responsive and Cross-Browser

```bash
playwright-cli open --device="iphone 15" https://staging.example.com/checkout
playwright-cli open --mobile https://staging.example.com/checkout
playwright-cli open --browser=webkit https://staging.example.com/checkout
playwright-cli resize 320 720        # sweep widths without reopening
```

Check at 320px, 768px, 1024px, and 1440px. Look for horizontal scroll on the
page body, controls pushed off screen, text truncated without a tooltip, touch
targets too small, and hover-only interactions with no touch equivalent.

`--browser` accepts installed channels (`chrome`, `msedge`) as well as the
bundled engines, which is how to check the exact browser build your users have
rather than a Chromium approximation of it.

Run the P1 path on at least one non-Chromium engine before sign-off. Safari and
Firefox differences in date inputs, form validation, and flexbox are the usual
source of "works on my machine" defects.

---

## Reproducing a Reported Bug

1. Read the report and restate the minimal steps you intend to run.
2. Match the reported environment - role, browser, viewport, data.
3. Execute, capturing a screenshot at each step.
4. If it reproduces, capture console, requests, and a trace, then narrow: other
   browser, other role, other data, previous build.
5. If it does not reproduce, do not close it. Record exactly what you tried and
   what you observed, and ask the reporter for the missing variable - build,
   account, data, or timing. "Cannot reproduce" without that list is not a
   result.

---

## Data Hygiene

Test data created during a run is a cost to everyone using the environment.

- Prefix created records so they are identifiable (`QA-AGENT-<date>-...`).
- Clean up at the end of each case where the product allows it.
- Never run a destructive case against production, and confirm before running
  one against any shared environment.
- If cleanup is impossible, list what was created at the end of the report so
  someone can remove it.

---

## Promoting a Case to a Spec (only when asked)

Executing a case is always `playwright-cli` commands. Generating a spec is a
different job, done only when the user asks to automate something.

When they do, `generate-locator <ref>` produces the Playwright locator for an
element you already interacted with, so the spec uses the same targeting the
manual run proved works:

```bash
playwright-cli generate-locator e5
# -> getByRole('button', { name: 'Apply' })
```

Keep the case ID at the front of the test title (`test('TC-07 expired discount
code is rejected', ...)`) so `build_report.py --playwright-json` matches the
spec back to the plan.

---

## Environment Notes

- **Running as root** (containers, some CI images): Chromium's sandbox refuses
  to start. Add `.playwright/cli.config.json` to the workspace with
  `{"browser":{"launchOptions":{"chromiumSandbox":false}}}`. Only where the
  environment forces it - it removes a real security boundary.
- **Proxy**: set `HTTPS_PROXY` before `install-browser`, or drive an already
  installed browser with `--browser=chrome`.
- **Stale sessions**: `list` shows what is open, `close-all` shuts them down,
  `kill-all` clears zombies after a crash.

---

## Closing Down

Close sessions when the cycle finishes so browsers are not left running, and
delete saved storage-state files - they contain live credentials. Clear any
routes and highlights first so nothing leaks into the next cycle.
