# Commit message conventions

Fallback rules for when the repository's history is thin, inconsistent, or
you are starting a new repo. If the history has a clear style, that always
wins over this file.

## The shape

```
<subject: imperative, <=50 chars, no period>
<blank line>
<body: wrapped at 72, explains why>
<blank line>
<footers: issue refs, BREAKING CHANGE, trailers>
```

## Subject line

- **Imperative mood** - complete the sentence "If applied, this commit will
  ___": "Add retry to the upload client", "Fix off-by-one in pagination".
- **<=50 characters** preferred, **72** is the hard limit. Editors and
  `git log --oneline` truncate past that.
- **No trailing period.**
- **Capitalize** the first word (unless the repo uses lowercase subjects, or
  a Conventional Commits type prefix which is always lowercase).
- **Specific over generic.** "Fix crash on empty search query" beats "Fix
  bug". Name the symptom or the component.
- **No ticket number as the whole subject.** `PROJ-123` alone tells a reader
  nothing; put the key in a footer and describe the change.

## Conventional Commits (only if the repo uses it)

```
<type>(<optional scope>): <subject>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
`ci`, `chore`, `revert`.

- `feat` and `fix` map to minor / patch version bumps for tools that read the
  log. Do not use `feat` for a refactor.
- Breaking change: append `!` after the type/scope (`feat(api)!: ...`) **and**
  add a `BREAKING CHANGE:` footer explaining the migration.
- Scope is a noun for the area touched (`feat(auth):`, `fix(parser):`). Keep
  the vocabulary consistent with previous commits.

## Body

- Include one whenever the change is not self-evident from the subject.
- **Explain the motivation**: what was wrong, what the change enables, what
  constraint forced this approach. The diff shows *what* changed; the body is
  for *why*.
- Describe observable behaviour changes, migration steps, and follow-up work.
- Mention alternatives considered and why they were rejected, if it will save
  the next person the investigation.
- Wrap at 72 columns. Git does not wrap for you; unwrapped bodies read badly
  in `git log` and email.
- Bullets (`-`) are fine for several independent points.

## Footers

- **Issue references**: `Refs: PROJ-123`, `Closes #45`, `Fixes #45`. Use the
  repo's existing keyword. `Closes/Fixes` auto-close the issue on some hosts -
  only use them when this commit actually resolves it.
- **BREAKING CHANGE:** `<description of what breaks and how to migrate>` - one
  paragraph, on its own after a blank line.
- **Trailers**: `Co-Authored-By: Name <email>`, `Signed-off-by: Name <email>`
  (DCO). Only add these if the project requires them or the author asks.
- One blank line between the body and the footer block.

## Splitting commits

Prefer several small commits over one large mixed one:

- Each commit should build and pass tests on its own.
- One logical change per commit: a refactor and the feature it enables are two
  commits; a fix and an unrelated typo cleanup are two commits.
- A dependency bump, a generated-file update, and a formatting-only pass each
  get their own commit so review and `git blame` stay clean.

## Things to avoid

- "WIP", "fixes", "misc", "address review comments" as a final subject.
- Past tense ("Added", "Fixed") or gerund ("Adding", "Fixing").
- Restating the file path: "Edit README".
- A body that is just the diff retyped in prose.
- Committing formatting changes together with logic changes.
