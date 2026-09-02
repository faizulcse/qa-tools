# Git Agent

Turns "draft a commit for this" into a review-ready commit message. It reads
your working-tree changes and the repo's recent history, then writes a subject
and body in the style the project already uses. It stops there - nothing is
staged, committed, or pushed until you say so.

## What it does

| Skill | Trigger it by saying | What it produces |
| --- | --- | --- |
| **commit-draft** | "draft a commit", "write a commit message", "what should the commit message be", "summarize my changes into a commit" | A draft commit subject + body, a note on what is / isn't included, and a split recommendation if the changes are unrelated |

You never invoke the skill by name - describe what you want and it loads.

## How it works

1. **Collect.** `scripts/git_context.py changes` prints the branch, the staged /
   unstaged / untracked file lists, the diffstat, the full diff, and the last
   ten commits.
2. **Match the style.** From the recent commits it detects Conventional Commits
   vs. plain imperative subjects, scope tags, subject length and case, and
   whether the repo uses trailers or issue keys - then follows that.
3. **Group.** If the diff mixes unrelated concerns, it proposes splitting into
   separate commits rather than writing one vague subject.
4. **Draft.** Imperative subject (≤50 chars, 72 hard limit), body wrapped at 72
   explaining *why*, footers for issues / breaking changes if applicable.
5. **Present and wait.** You see the message exactly as it would be committed.
   It commits only on an explicit "go ahead", via `git commit -F` so multi-line
   bodies survive, and never pushes.

### What ends up in the commit

- **Something staged** → the draft covers the staged changes only; unstaged and
  untracked files are called out but excluded.
- **Nothing staged** → the draft covers all tracked modifications, and the skill
  tells you what it will `git add` on approval. Untracked files are never added
  without confirmation.

## Setup

None. `scripts/git_context.py` uses only the Python standard library (3.8+) and
shells out to `git`. Run it from inside a git repository.

## Usage

```bash
# See what the skill sees
python3 "$CLAUDE_PLUGIN_ROOT/scripts/git_context.py" changes

# Just the recent-commit style sample
python3 "$CLAUDE_PLUGIN_ROOT/scripts/git_context.py" log-style --count 15

# Cap a large diff; ignore anything not staged; machine-readable
python3 "$CLAUDE_PLUGIN_ROOT/scripts/git_context.py" changes --max-diff-lines 400 --staged-only --json
```

In a session, just say:

```
"Draft a commit for my changes"
   -> reads the diff + recent commits
   -> detects the repo's style
   -> shows a subject + body, notes staged vs. unstaged, flags any split

"Looks good, commit it"
   -> stages what the draft described, commits with git commit -F, reports the hash
```

## Bundled files

| File | Purpose |
| --- | --- |
| `scripts/git_context.py` | Zero-dependency collector: `changes`, `log-style`, JSON output, diff cap |
| `skills/commit-draft/SKILL.md` | The drafting procedure |
| `skills/commit-draft/references/commit-conventions.md` | Fallback rules: subject/body/footers, Conventional Commits, when to split |
| `templates/commit-message.md` | Message shape with worked examples |

## Safety rules the skill follows

- No `git add`, `git commit`, or `git push` without an explicit go-ahead.
- Untracked files are never staged without confirmation.
- Nothing in the message that the diff does not support - no invented rationale.
- If the target branch is `main` / `master`, that is called out before any push
  (which is always a separate explicit ask).
