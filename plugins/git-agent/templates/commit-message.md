# Commit message template

Copy the shape below. Delete the guidance lines. Keep the blank lines.

```
<imperative subject, <=50 chars, no trailing period>

<Why this change exists: the problem it solves or the capability it adds.
Wrap at 72 columns. Describe behaviour changes and migration steps. Only
restate mechanics from the diff when they are non-obvious.>

- <one independent change, if there are several>
- <another>

Refs: <ISSUE-KEY or #number, if the repo uses issue references>
BREAKING CHANGE: <what breaks and how to migrate - only if applicable>
```

## Filled example (plain style)

```
Fix upload retry loop on expired tokens

The upload client retried forever when the access token expired mid-batch,
because a 401 was treated as a transient network error. Refresh the token
once on the first 401 and fail the batch if the retry also 401s.

Refs: PLAT-812
```

## Filled example (Conventional Commits style)

```
feat(auth): allow login with a one-time email code

Adds a passwordless path for users who have not set a password. The code is
6 digits, valid for 10 minutes, single use, and rate-limited to 5 requests
per hour per address.

Closes #204
```
