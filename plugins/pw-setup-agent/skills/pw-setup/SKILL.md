---
name: pw-setup
description: >
  This skill should be used when the user wants a Playwright test automation
  project created - "set up Playwright", "scaffold e2e tests", "create a
  Playwright framework", "add Playwright with TypeScript", "set up a page
  object model project", "bootstrap UI test automation", or when a repository
  has no Playwright project and the user wants to start writing automated
  tests. Scaffolds a TypeScript project at the repository root (or in a
  sub-folder such as tests/) with page objects, fixtures, typed test data, a
  .env file and lint rules, merging safely into an existing app, then verifies
  it with pw-check. Supports apps whose only login is "Sign in with Google"
  (signs in through real Chrome and reuses the saved session). Not for running manual browser tests through playwright-cli
  (that is qa-agent:qa-test-ui).
metadata:
  version: "0.2.0"
---

# Playwright Setup

Create a Playwright + TypeScript test project that follows the conventions the
other `pw-` skills teach and `pw-check` enforces. By default the project goes
at the **repository root**. In an app repo it is merged in without changing
anything the app already has; when that is not possible, it goes in a
sub-folder (`--root tests`) with its own `package.json`.

This skill **writes spec files**. If the user wants to drive a browser and
report what happened without writing code, that is `qa-agent:qa-test-ui`.

## What gets created

```
<root>/
├── playwright.config.ts      testDir ./specs, baseURL from env, artifacts on failure
├── package.json              scripts and pinned dependencies (merged into the app's)
├── tsconfig.json             strict, aliases @pages/* @fixtures @data/* @utils/*
├── eslint.config.mjs         typescript-eslint + eslint-plugin-playwright
├── .env.example / .env       .env is gitignored and created from the example
├── .gitignore · .nvmrc · pw-setup.json (manifest read by pw-check)
├── specs/                    home/home.spec.ts (@smoke), login/login.spec.ts
├── pages/                    base.page.ts, home.page.ts, login.page.ts, components/
├── fixtures/pages.fixture.ts page objects as fixtures
├── test-data/                types.ts, users.ts (credentials from env)
└── utils/                    env.ts, check-setup.mjs, init-env.mjs
```

When the app has its own tsconfig or ESLint config, the test ones are
`tsconfig.e2e.json` and `eslint.e2e.config.mjs` instead.

With `--auth google-sso` (see "Google sign-in" below) it also adds
`specs/auth/auth.setup.ts`, `utils/auth.ts`, `utils/chrome-profile.ts`,
`utils/login-chrome.mjs` and `pages/components/google-sign-in.component.ts`,
and the login and home pages and specs are the Google versions.

## The three modes

`scaffold.mjs` picks the mode from what is at the target and records it in
`pw-setup.json`:

| Mode | When | Result |
|---|---|---|
| **standalone** | Root, no `package.json` (empty or test-only repo) | Files written at the root; scripts are `test`, `lint`, `check`... |
| **merged** | Root, the app's `package.json` is there | Shared files merged add-only; scripts are prefixed `pw:` (`pw:test`, `pw:lint`, `pw:check`...); installs with the repo's package manager |
| **subfolder** | `--root tests` (or another folder) | A self-contained project in that folder, using npm |

In merged mode:

- `package.json`: adds missing dev dependencies and the `pw:` scripts. Keeps
  every app script and every dependency version the app already has.
- `.gitignore`, `.env.example`: missing lines and keys are appended in a
  `# Playwright (pw-setup-agent)` block.
- `.env`: never replaced; missing keys are added.
- The app's `tsconfig.json`, ESLint config and `.nvmrc` are never changed.

## Step 1 - Inspect the repository

Run from the **repository root**:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/detect_env.mjs"
```

It prints the mode it would use and the package manager.

- **Exit 1 (blocker):** stop and tell the user what to fix (usually Node older
  than 20.12, or npm missing).
- **`pw-setup.json` already exists:** the project was set up before. Do not
  scaffold again; switch to `pw-check`.
- **WARNING lines about an existing Playwright config, Next.js/Nuxt, or
  folders that already hold files:** the root is not usable. Tell the user why
  in one sentence and propose `--root tests`.
- **DECISION lines:** ask them in Step 2.

Then look at how the app signs in. Ask for the app URL if you don't have it,
and open its login page:

- With playwright-cli (if installed): `playwright-cli open <url>`, then
  `playwright-cli snapshot` and `playwright-cli network`. Close it afterwards.
- Without it, ask the user what the login page offers.

If the **only** way to sign in is "Sign in with Google", use the Google
templates (`--auth google-sso`). They need the app's **who-am-I endpoint**: an
API request that returns 401 while signed out (and 200 once signed in), such
as `/api/me` or `/api/auth/session`. Pick it from the network calls the login
page made, and confirm it with the user. Note the path where the button is
(`--login-path`, default `/`). Anything else (a username/password form, or
Google next to other options) uses the default `--auth password` templates.

## Step 2 - Ask what you need

Ask only for what you cannot infer. Use these defaults when the user has no
preference:

| Option | Flag | Default |
|---|---|---|
| Application URL | `--base-url` | `http://localhost:3000` |
| Browsers | `--browsers` | `chromium` (also: `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`) |
| Test account roles | `--roles` | `user` (lowercase, e.g. `admin,viewer`) |
| Location | `--root` | `.` (repository root); `tests` when the root is blocked |
| Sign-in | `--auth` | `password`; `google-sso` when Google is the only login (Step 1) |
| Who-am-I endpoint | `--me-endpoint` | Google only, required (Step 1) |
| Login page path | `--login-path` | Google only, `/` |

For Google sign-in, roles are named after the account they use, e.g.
`--roles admin`. Each role gets its own Google account, session file and
Chrome profile. The base URL may contain `{ENVIRONMENT}`
(`https://{ENVIRONMENT}.example.com`); the user then sets `ENVIRONMENT`
in `.env`.

Then the merged-mode decisions, only if `detect_env` or the dry run reports
them. Ask each as one short question with the recommended answer first:

- **The app has its own `tsconfig.json` or ESLint config.** Recommended:
  `--split-configs`. The tests get `tsconfig.e2e.json` and
  `eslint.e2e.config.mjs`; `playwright.config.ts` points at the tsconfig.
  Alternative: `--root tests`.
- **`.env.example` already has `BASE_URL` (or `TEST_ENV`).** Ask whether the
  tests should use the app's value. If it is the same URL, `--reuse-env-keys`.
  If it means something else (often the app's own server URL),
  `--env-prefix E2E_`, which gives `E2E_BASE_URL`, `E2E_ADMIN_USERNAME` and so
  on.

**Never ask for passwords, usernames, emails, codes or tokens.** Each role
gets `<ROLE>_USERNAME` and `<ROLE>_PASSWORD` keys in `.env` (Google:
`<ROLE>` for the account email, optional `<ROLE>_PASSWORD`, optional `OTP`),
with the prefix if any, left empty for the user to fill in themselves. If the user pastes
credentials into the chat anyway, do not write them anywhere; tell them to put
them in `.env`.

## Step 3 - Dry run, then write

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" --base-url <url> --browsers <list> --roles <list> [decision flags] [--root tests]
```

The default is a dry run: it prints every file with `+` (create), `~` (merge,
with what it adds), `!` (overwrite), `=` (exists, skipped) or `?` (needs a
decision), then any `BLOCKED`, `DECISION` and `NOTE` lines. Show the user the
list, especially every `~` line, since those change the app's files. When they
agree:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" <same options> --write
```

- `--write` refuses (exit 1) while anything is blocked or undecided.
- It also creates `.env` from `.env.example` (via `init_env.mjs`), with the
  base URL filled in and credentials empty, or adds the missing keys to an
  existing `.env`.
- Use `--force` only if the user explicitly wants pw-setup's own files
  replaced. It never touches `.env` or the app's files.

## Step 4 - App configs (merged mode with split configs)

If the dry run printed the NOTE lines about the app's tsconfig or ESLint
config, read those files. If the app tsconfig's `include` would pick up the
test folders (for example `**/*.ts` or no `include` at all), or the app's
ESLint config lints the whole repo, show the user the one-line change (add
`playwright.config.ts`, `specs`, `pages`, `fixtures`, `test-data` and `utils`
to `exclude` / `ignores`) and make it only when they agree. Skip this step
when the app config already limits itself to its own folders (e.g.
`"include": ["src"]`).

## Step 5 - Install

Run the install line the scaffold printed under `Next:`. For example:

```bash
npm install && npx playwright install chromium                  # standalone
pnpm install && pnpm exec playwright install chromium            # merged, pnpm repo
cd tests && npm install && npx playwright install chromium       # subfolder
```

Map projects to browser downloads: `chromium` and `mobile-chrome` need
`chromium`; `webkit` and `mobile-safari` need `webkit`; `firefox` needs
`firefox`. On Linux, add `--with-deps` (it may ask for sudo; tell the user
first).

## Step 6 - Verify

Run the verify commands the scaffold printed, e.g. for npm:

```bash
npm run typecheck     # merged: npm run pw:typecheck
npm run lint          # merged: npm run pw:lint
npm run check         # merged: npm run pw:check
npx playwright test --list
```

All four must pass. `check` is `pw-check` levels 1-2. If anything fails, fix
it before handing over; the templates pass all four as shipped, so a failure
usually means an existing file was skipped or the user edited something. In
merged mode, also run the app's own build or type check once if it has one,
to confirm the test folders did not leak into it.

Do **not** run the tests themselves yet: the example page objects use guessed
labels (`Username`, `Password`, `Sign in`) and the credentials are empty.

## Step 7 - Hand over

Tell the user, briefly:

1. **Fill in `.env`** - open it and add the credentials for each role. Never
   commit it. Teammates create their own with the `env:init` script
   (`pw:env:init` in merged mode).
2. **Adapt the example pages** - update the path, labels and button names in
   `pages/login.page.ts` and `pages/home.page.ts` to match the app (see
   `pw-locators`), then run `npx playwright test --project=chromium`.
3. **Add pages and specs** following `pw-page-objects`.
4. **Daily commands:** the `test`, `smoke`, `ui`, `report` and `check` scripts
   (prefixed `pw:` in merged mode).

For Google sign-in, replace point 2 with:

2. **Sign in once:** run the `login` script (`npm run login`, or
   `pw:login`). A Chrome window opens on a dedicated profile; the setup step
   tries the email, password and code from `.env`, and the user finishes by
   hand whatever it can't (up to 4 minutes). Then the tests run signed in.
   Later runs reuse `.auth/<role>.json` without opening a browser; after an
   hour, or when the app rejects it, Chrome reopens and refreshes it, usually
   without typing. `login:force` signs in again now; `login:chrome` is the
   manual fallback (instructions at the top of `utils/login-chrome.mjs`).
   Also adjust the button name and `HomePage.waitForReady()` if needed.

and add:

5. **CI:** Google sign-in cannot run on CI. Either restore the session JSON
   from a secret into `.auth/<role>.json` before the tests run (refresh the
   secret when it expires), or ask the app team for a test-login endpoint
   that skips Google. The setup step fails with this advice on CI.

Summarize what was created and which app files were merged in a few lines; do
not paste the file list again.

## Google sign-in: rules

- **Never** try to make Google accept a Playwright-launched browser (flags,
  user agents, stealth plugins). Google blocks them on purpose; the setup step
  uses real Chrome over CDP instead.
- Don't run the setup step yourself on the user's behalf unless they are at
  the screen: it opens a Chrome window and may wait for them.
- If the run fails with "Google blocked the sign-in", the sign-in happened in
  a Playwright-launched browser (for example a spec that signs in itself).
  Sign-in belongs only in `specs/auth/auth.setup.ts`.
- "The Chrome profile ... is already open": a Chrome window still uses
  `.auth/chrome-profile/<role>/`. Close it and run again.
