---
name: pw-login
description: >
  This skill should be used when the user wants to sign in to an app that
  uses Google sign-in, for its Playwright tests - "sign me in for the tests",
  "log in to the app", "refresh the test session", "my session expired",
  "the auth setup fails", "who-am-I returns 401", "set up the Google login",
  "which endpoint is the who-am-I" - in a project set up by pw-setup with
  Google sign-in (auth.mode google-sso in pw-setup.json), or when pw-setup
  needs the app's who-am-I endpoint. Checks the saved session first, opens a
  headed Chrome through playwright-cli for the user to sign in by hand, saves
  .auth/<role>.json, and explains failures from page snapshots and network
  requests. Never types or stores Google credentials.
metadata:
  version: "0.3.0"
---

# Google Sign-in for the Tests

Sign the user in to a Google-sign-in app **with them, in this session**, using
playwright-cli. It does the same as the project's `utils/login-cli.mjs`
(same profile, session name and files), plus what a script can't: check the
session first, look at the page when something is off, and say why.

`login-cli.mjs` stays the path for `npx playwright test`, the `login`
scripts, teammates without Claude, and the setup step. Don't replace or edit
it as part of signing in.

**Scope:** projects whose `pw-setup.json` has `"auth": { "mode": "google-sso" }`.
For any other project, say this doesn't apply: username/password projects
sign in inside their own tests or setup step. For explaining how auth is
configured (setup project, `storageState`), use `pw-core-config`.

## Rules

- **The user signs in by hand.** Never type, ask for or store their Google
  email, password or verification codes. Never click through Google's screens
  for them. Never work around Google's checks (flags, user agents, stealth
  plugins, a different automation browser).
- **Only with the user at the screen.** Say a browser window is about to open
  before opening it. Never open a visible window in a background or
  unattended run. On CI (`CI` is set), stop and give the CI options (see the
  end).
- **Never print secrets.** No `.env` values other than the base URL and
  environment name. No cookie or token contents from `.auth/*.json`,
  `state-save` output or requests: when showing a request, leave out
  `cookie`, `authorization` and `set-cookie` headers and any token in the
  body.
- **Same files as the script:** `.auth/<role>.json`,
  `.auth/cli-profile/<role>/`, session `auth-<role>`. The headless check uses
  its own `check-<role>` session so it never disturbs an open sign-in window.
- **Run playwright-cli from the repository root.** It keeps working files in
  `.playwright-cli/` (gitignored by the template).

## Step 1 - Read the project

1. Read `pw-setup.json`: `auth.mode` (must be `google-sso`),
   `auth.meEndpoint`, `auth.loginPath`, `roles`, `env.prefix`.
2. Read `.env` for `<prefix>BASE_URL` and, if the URL contains
   `{ENVIRONMENT}`, `<prefix>ENVIRONMENT`; build the base URL. Read
   `<prefix>AUTH_MAX_AGE_MINUTES` (default 60). Don't print anything else.
3. Find playwright-cli: `node_modules/.bin/playwright-cli` (the project's dev
   dependency), else `playwright-cli` on the PATH. Below, `pwcli` means that
   command. If neither exists, offer the project install (or
   `npm install -g @playwright/cli`) and stop.
4. Roles: the ones the user named, else the first in `roles`.

## Step 2 - Check the saved session first

For each role, without a visible window:

- If `.auth/<role>.json` is missing, go to Step 3.
- Note its age (file modification time). Then:

```bash
pwcli -s=check-<role> open <base URL>
pwcli -s=check-<role> state-load .auth/<role>.json
pwcli -s=check-<role> goto <base URL>
pwcli -s=check-<role> --raw eval "async () => (await fetch('<meEndpoint>', { credentials: 'include' })).status"
pwcli -s=check-<role> close
```

- **200 and younger than `AUTH_MAX_AGE_MINUTES`:** tell the user the role is
  still signed in ("admin: signed in, 23 min old; tests will reuse it") and
  stop, unless they asked to sign in again.
- **200 but older:** it still works now, but the setup step will ask for a
  new sign-in at the next run. Offer to sign in now.
- **Anything else:** go to Step 3.

## Step 3 - Open the sign-in window

Tell the user, in one or two lines: a Chrome window is about to open on the
app's sign-in page; they sign in themselves, including any verification
Google asks for; then they tell you when they're done. Then:

```bash
pwcli -s=auth-<role> open <base URL + loginPath> --browser chrome --headed --persistent --profile .auth/cli-profile/<role>
```

The profile remembers the Google account between sign-ins, so later ones are
usually a click.

## Step 4 - Wait for the user

When the user says they're done (or asks you to check), run:

```bash
pwcli -s=auth-<role> --raw eval "async () => (await fetch('<meEndpoint>', { credentials: 'include' })).status"
```

- **200:** go to Step 5.
- **Not 200:** check again two or three times a few seconds apart (the app
  may still be loading). Still not 200: go to "When something is off".

Don't poll in a tight loop while the user is still signing in; wait for them.

## Step 5 - Save and confirm

```bash
pwcli -s=auth-<role> state-save .auth/<role>.json.tmp.json
mv .auth/<role>.json.tmp.json .auth/<role>.json
pwcli -s=auth-<role> close
```

(On Windows, `move /Y` instead of `mv`.) Confirm with the headless check from
Step 2: it must return 200. Then do the next role, if any.

## Step 6 - Hand over

One or two lines: which roles are signed in, that sessions are reused for
`AUTH_MAX_AGE_MINUTES` minutes, and that `npx playwright test` (or the `test`
script) will now run without opening a browser. Mention the `login` script
for next time when Claude isn't around.

## When something is off

Look before guessing: take a snapshot of the sign-in window, and list the
requests when the page made API calls.

```bash
pwcli -s=auth-<role> snapshot
pwcli -s=auth-<role> tab-list           # the Google popup is a second tab
pwcli -s=auth-<role> tab-select <n>     # then snapshot it; tab-select 0 to go back
pwcli -s=auth-<role> requests
pwcli -s=auth-<role> request <n>        # one request; redact cookies and tokens
```

Then tell the user what you see, in plain words:

| What you see | What to do |
|---|---|
| Google says "This browser or app may not be secure" | Google refused this browser. Explain that; do not retry with flags or other browsers. Ask the user to close other Chrome windows using `.auth/cli-profile/<role>/` and try again in the same window; if Google keeps refusing, this app can't use interactive Google sign-in from here; the CI options (below) apply locally too |
| Still the app's sign-in screen after the user said done | The Google popup was blocked or closed early. Ask them to click "Sign in with Google" again |
| The app shows the user as signed in, but who-am-I isn't 200 | The endpoint may be wrong. In `requests`, find the app's own "who am I" call (same origin, an API path, 200 now). Offer to change `meEndpoint` in all three places: `pw-setup.json` (`auth.meEndpoint`), `utils/auth.ts` (`ME_ENDPOINT`) and `utils/login-cli.mjs` (`ME_ENDPOINT`), showing the change first. Then check again |
| Who-am-I is 200 in the page's own calls but not from `fetch` | The session may be a token in localStorage, not a cookie, so `fetch` with cookies can't see it. Explain; the who-am-I check in `utils/auth.ts` and `login-cli.mjs` would need adapting to send that token |
| Who-am-I answers with a redirect (3xx), or on another host | The endpoint must answer 200/401 on the app's own origin. Look for another endpoint in `requests` |
| `open` fails, or the profile seems busy | `pwcli close-all`, then try Step 3 once more |
| The page doesn't load at all | Check the base URL with the user (and `ENVIRONMENT`), and whether the app is running |

Close the window (`pwcli -s=auth-<role> close`) when giving up, so the
profile isn't left locked.

## Finding the who-am-I endpoint (for pw-setup)

When `pw-setup` needs the endpoint for `--me-endpoint`, before the project
exists:

```bash
playwright-cli -s=probe open <app login URL>
playwright-cli -s=probe requests
playwright-cli -s=probe request <n>     # for the likely candidates
playwright-cli -s=probe close
```

Pick the request to the app's **own origin**, to an **API path** (not a page,
script or image), that answered **401** while signed out. Typical paths:
`/api/me`, `/api/auth/session`, `/api/user`, `.../me`, `.../whoami`. Show it to
the user and confirm before using it. If nothing answers 401 signed out, say
so: the Google templates need such an endpoint, and the app team may need to
point you at one.

## CI

No one can sign in on CI. Two options, as in the README:

1. Restore the session JSON from a secret into `.auth/<role>.json` before the
   tests run (it's reused while it's fresh; refresh the secret when it
   expires).
2. Ask the app team for a test-login endpoint that skips Google.
