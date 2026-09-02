---
name: commit-draft
description: >
  This skill should be used when the user wants a commit message written for
  their current changes - "draft a commit", "write a commit message", "prepare
  a commit", "what should the commit message be", "commit message for these
  changes", "summarize my changes into a commit", or after finishing a piece of
  work that needs to be committed. Reads the working-tree diff and the
  repository's recent commit style, then produces a draft commit title and
  description. It does not commit anything unless the user explicitly asks.
metadata:
  version: "0.1.0"
---

# Commit Draft

Produce a commit message that a reviewer can read *instead of* the diff and
still understand what changed and why. The subject says what; the body says why
and anything non-obvious. Everything in it must be supported by the actual
changes - never invent a motivation the diff does not show.

## Scope

This skill drafts a message. It does **not** run `git commit`, `git add`, or
`git push`. Only after the user has seen the draft and explicitly asks ("commit
it", "go ahead") do you stage and commit - see **Committing on request** below.

## Step 1 - Gather the changes

Run the bundled collector:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/scripts/git_context.py" changes
```

It prints, in order: the branch and upstream, which files are **staged**,
**unstaged**, and **untracked**, the diffstat, the full diff, and a sample of
recent commits. Exit code `2` means it is not a git repo (stop, tell the user);
`3` means the working tree is clean (stop, nothing to draft).

For a large diff, cap it with `--max-diff-lines N`; add `--staged-only` to
ignore everything not staged. Use `--json` if you want to parse it.

### What goes in the commit

- **Something is staged** → draft for the **staged** changes only. Mention, in
  one line to the user (not in the message), that unstaged/untracked files are
  not included.
- **Nothing is staged** → draft for all tracked modifications, and tell the
  user you will `git add -A` (or a narrower set) when they approve. Call out
  untracked files explicitly and ask whether they belong in this commit -
  never silently add them.

## Step 2 - Read the repository's style

From the recent-commits sample, detect and then follow:

- **Convention** - Conventional Commits (`feat:`, `fix:`, `chore(scope):`) vs.
  plain imperative subjects. Match whichever dominates. Do not impose
  Conventional Commits on a repo that does not use them.
- **Subject case and length** - sentence case vs. lowercase; typical length.
- **Scope tags** - `[area]` or `(scope)` prefixes and how they are named.
- **Trailers** - `Co-Authored-By`, `Signed-off-by`, `Refs:`, issue keys like
  `PROJ-123`. If the repo consistently references an issue, ask for the key.
- **Body presence** - do small changes get a body in this repo, or just a
  subject?

`references/commit-conventions.md` has the rules to fall back on when the
history is thin or inconsistent.

## Step 3 - Group before drafting

Skim the diff for unrelated concerns (a bug fix plus an unrelated rename plus a
dependency bump). If you find them:

- Recommend splitting into separate commits, and propose the split (which files
  / hunks in each) with a subject for each.
- If the user wants one commit anyway, draft one honest subject that covers the
  largest change and enumerate the rest in the body.

Do not paper over a mixed change with a vague subject like "various updates".

## Step 4 - Write the draft

### Subject

- Imperative mood: "Add", "Fix", "Remove", "Rename" - not "Added", "Adds",
  "Fixing".
- One line, aim for ≤50 characters, hard limit 72.
- No trailing period.
- Specific: `Fix timeout when refresh token is expired`, not `Fix bug`.
- Prefix/convention as detected in Step 2.

### Body

- Wrap at 72 columns. Separate from the subject by one blank line.
- Explain **why** the change was made and what problem it solves. The diff
  already shows *what* - only restate mechanics that are non-obvious.
- Note side effects, migrations, follow-ups, and anything a reviewer or a
  future bisect would want: behaviour changes, perf implications, why an
  alternative was rejected.
- Use bullet points for several independent changes.
- Omit the body entirely for a genuinely trivial one-liner (typo, version
  bump) **if** that matches repo style.

### Footers

- Issue reference if the repo uses them and the user supplied a key.
- `BREAKING CHANGE:` paragraph if any public interface changed incompatibly.
- Attribution trailers (`Co-Authored-By`, `Signed-off-by`) only if the repo
  uses them or the user asks.

## Step 5 - Present it

Show the message in a fenced block exactly as it would be committed:

```
<subject>

<body>

<footers>
```

Then, in plain prose beneath the block:

- One line on what is / is not included (staged vs. unstaged vs. untracked).
- Any split recommendation from Step 3.
- Any assumption you made about intent, so the user can correct it.

Offer: "Say the word and I'll commit this" - and wait.

## Committing on request

Only after explicit approval:

1. Stage what the draft describes - the already-staged set, or the files you
   told the user you would add. Never add untracked files the user did not
   confirm.
2. Write the message to a temp file and commit with `git commit -F <file>` so
   multi-line bodies and wrapping survive. Do not cram a body into repeated
   `-m` flags unless it is subject-only.
3. Do **not** push. If the user wants it pushed, that is a separate explicit
   ask; if the branch is the default branch (`main`/`master`), say so first.
4. Report the new commit hash and subject.

If the user has their own attribution or trailer requirements (for example from
their harness configuration), honour those over the repo default.

## Anti-Patterns

- Inventing a rationale ("to improve performance") the diff does not support.
- A subject that restates the filename: `Update utils.py`.
- Dumping the diff into the body as a list of every line changed.
- Bundling unrelated changes under one vague subject.
- Committing, staging, or pushing before the user has approved the draft.
- Forcing `feat:`/`fix:` prefixes onto a repo that never uses them.
- Bodies wrapped at 80+ or not wrapped at all.
