# Changelog

## 0.1.0

- Initial release. One skill, `commit-draft`: reads the staged (or, if nothing
  is staged, the unstaged) diff plus a sample of recent commits, detects the
  repository's commit style, and produces a draft subject and body.
- Flags unrelated changes bundled together and proposes a split.
- Never runs `git add`, `git commit`, or `git push` without an explicit
  go-ahead from the user; commits via `git commit -F` so multi-line bodies
  survive.
- `scripts/git_context.py` - zero-dependency collector (Python 3.8+, standard
  library only) with `changes` and `log-style` subcommands, JSON output, and a
  configurable diff cap.
- `references/commit-conventions.md` - fallback rules (subject/body/footers,
  Conventional Commits, when to split) for repos with thin or inconsistent
  history.
- `templates/commit-message.md` - the message shape with worked examples.
