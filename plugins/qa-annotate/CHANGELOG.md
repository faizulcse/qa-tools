# Changelog

## 0.1.0

- First release.
- **`qa_mark.py`**: `from-record`, `from-results` and `new` create a marks
  spec with an Expected / Actual banner; `locate` gets an element's exact box
  from the open playwright-cli page (`--scroll --shoot` for a fresh matching
  screenshot); `redact` adds blur boxes over emails, JWTs, UUIDs, long IDs,
  key-like strings and filled password fields; `add`, `show` and `remove`
  edit marks by hand (`--approx` draws them dashed); `draw` renders the
  marked copy; `batch` and `check` cover a whole case folder, `qa-results/`,
  a ticket folder or a results file.
- Drawing uses a page served from a temporary `127.0.0.1` server and
  screenshotted by playwright-cli (which blocks `file://`), so no image
  library is needed. CSS positions are scaled to the image, so `--hires` and
  full-page screenshots line up.
- Skills: `qa-mark` (one screenshot) and `qa-mark-run` (every failure in a
  run or ticket).
