---
name: pw-setup
description: >
  This skill should be used when the user wants a Playwright test automation
  project created - "set up Playwright", "scaffold e2e tests", "create a
  Playwright framework", "add Playwright with TypeScript", "set up a page
  object model project", "bootstrap UI test automation", or when a repository
  has no Playwright project, or an incomplete one, and the user wants to start
  writing automated tests. Builds a TypeScript project at the repository root
  with page objects, fixtures, typed test data, a .env file and lint rules,
  adopting and amending whatever already exists (an app, a Playwright config,
  tsconfig, ESLint config, folders, dependencies), then verifies it with
  pw-check. Supports apps whose only login is "Sign in with Google" (signs in
  through real Chrome and reuses the saved session). Not for running manual
  browser tests through playwright-cli (that is qa-agent:qa-test-ui).
metadata:
  version: "0.3.0"
---

# Playwright Setup

Create a Playwright + TypeScript test project that follows the conventions the
other `pw-` skills teach and `pw-check` enforces. The project is **always at
the repository root**. Whatever is already there (an app, a Playwright setup,
tsconfig, ESLint config, folders, files, dependencies, env keys) is **kept
and amended** with what the tests need. Nothing the app has is replaced or
removed, and nothing makes setup stop and ask: the dry run shows every change
first.

This skill **writes spec files**. If the user wants to drive a browser and
report what happened without writing code, that is `qa-agent:qa-test-ui`.

## What the project looks like

```
<repo root>/
├── playwright.config.ts      created, or the app's own config amended
├── package.json              scripts and dev dependencies (added to the app's)
├── tsconfig.json             created, or the app's amended in place
├── eslint.config.mjs         created, or the app's ESLint config amended
├── .env.example / .env       keys added; .env is gitignored
├── .gitignore · .nvmrc · pw-setup.json (manifest read by pw-check)
├── tests/                    the specs, or the existing Playwright testDir (e.g. e2e/)
├── pages/                    page-objects/ in Next.js and Nuxt apps
├── fixtures/pages.fixture.ts page objects as fixtures
├── test-data/                types.ts, users.ts (credentials from env)
└── utils/                    env.ts, check-setup.mjs, init-env.mjs
```

With `--auth google-sso` (see "Google sign-in" below) it also adds
`tests/auth/auth.setup.ts`, `utils/auth.ts`, `utils/login-cli.mjs` and
`<pages>/components/google-sign-in.component.ts`, plus `@playwright/cli` as a
dev dependency,
and the login and home pages and specs are the Google versions.

## How existing things are used

| What exists | What setup does |
|---|---|
| No `package.json` | **standalone**: everything created at the root; scripts `test`, `lint`, `check`... |
| The app's `package.json` | **merged**: adds the `pw:` scripts (`pw:test`, `pw:lint`, `pw:check`...) and missing dev dependencies; app scripts and versions kept; installs with the repo's package manager |
| `@playwright/test` / `playwright` | Kept at the app's version (a note if older than 1.45, with the upgrade command) |
| `playwright.config.*` | Kept, including its `testDir`, projects and reporters. New specs go in its `testDir`. Missing pieces are **amended by you** (Step 4) |
| `tsconfig.json` | Amended in place by the script, comments kept: path aliases (relative to `baseUrl` if set), the test folders in `include`, `node` types. `strict`, `target`, `module` never change. Exception: `nodenext` resolution or a target older than ES2017 → a small `tsconfig.e2e.json` that extends it |
| ESLint config | Kept; a Playwright rules block is **amended by you** (Step 4) |
| `tests/`, `pages/`, `fixtures/`, `test-data/`, `utils/` | Used. Files with the same name are kept, never overwritten. If a kept file lacks something the templates import, **you** add it (Step 4) |
| Jest / Vitest | Kept. Their default patterns also match `tests/**/*.spec.ts`, so their config gets an exclude for the Playwright specs (**amended by you**, Step 4). If `tests/` already holds unit tests, the Playwright config gets `testMatch: '**/*.spec.ts'` so Playwright skips them |
| An older pw-setup project in `tests/` (`tests/pw-setup.json`, 0.1.0/0.2.0) | **Blocks** setup: `tests/` is the specs folder now. Move that project to the root first (README "Upgrading") |
| Next.js / Nuxt | Page objects go in `page-objects/` (their `pages/` is routes); `@pages` points there |
| `.gitignore`, `.env.example`, `.env` | Missing entries/keys appended; `.env` never replaced |
| Env keys such as `BASE_URL` | Reused. `--env-prefix E2E_` only if the user wants separate keys |
| A hard-coded `baseURL` in the Playwright config | Becomes the `BASE_URL` default, so nothing changes |

## Step 1 - Inspect the repository

Run from the **repository root** (the scripts refuse to run anywhere else):

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/detect_env.mjs"
```

It prints the mode, the package manager, the spec and page-object folders, and
an `ADOPTS:` line for each thing it will keep and amend.

- **Exit 1 (blocker):** stop and tell the user what to fix: Node older than
  20.12, npm missing, not the repo root, or an invalid `package.json`.
- **`pw-setup.json` already exists:** the project was set up before. Do not
  scaffold again; switch to `pw-check`.
- **A `tests/pw-setup.json` (0.1.0/0.2.0 sub-folder project):** setup is
  blocked, because `tests/` is the specs folder now. Offer to move that
  project to the root (README "Upgrading"); until then it keeps working with
  `check_setup.mjs --root tests`.

Then look at how the app signs in. Ask for the app URL if you don't have it
(or take it from the existing Playwright config), and open its login page:

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

Ask only for what you cannot infer. There are no location or config
questions. Defaults:

| Option | Flag | Default |
|---|---|---|
| Application URL | `--base-url` | the existing config's `baseURL`, else `http://localhost:3000` |
| Browsers | `--browsers` | `chromium` (also: `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`) |
| Test account roles | `--roles` | `user` (lowercase, e.g. `admin,viewer`) |
| Sign-in | `--auth` | `password`; `google-sso` when Google is the only login (Step 1) |
| Who-am-I endpoint | `--me-endpoint` | Google only, required (Step 1) |
| Login page path | `--login-path` | Google only, `/` |

For Google sign-in, roles are named after the account they use, e.g.
`--roles admin`. Each role gets its own Google account, session file and
Chrome profile. The base URL may contain `{ENVIRONMENT}`
(`https://{ENVIRONMENT}.example.com`); the user then sets `ENVIRONMENT`
in `.env`.

**Never ask for passwords, usernames, emails, codes or tokens.** Each role
gets `<ROLE>_USERNAME` and `<ROLE>_PASSWORD` keys in `.env` (Google sign-in
stores no credentials at all: the user signs in by hand), left empty for the user to fill in themselves. If the user pastes credentials
into the chat anyway, do not write them anywhere; tell them to put them in
`.env`.

## Step 3 - Dry run, then write

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" --base-url <url> --browsers <list> --roles <list> [--auth google-sso --me-endpoint <path>]
```

The default is a dry run. Every file gets a mark:

| Mark | Meaning |
|---|---|
| `+` | created |
| `~` | the app's file amended by the script (`package.json`, `.gitignore`, `.env.example`, `tsconfig.json`), with what it adds |
| `=` | exists; kept as is |
| `>` | kept; **you** amend it in Step 4 (Playwright config, ESLint config, app files the templates import from) |
| `!` | `--force` only: a file pw-setup created earlier, refreshed |

Then `AMEND` sections (exactly what to add to each `>` file, with a block to
paste for ESLint), `NOTE` lines and any `BLOCKED` line. Show the user the
list, every `~` line and every `AMEND` item, since those touch the app's
files. When they agree:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" <same options> --write
```

It writes the files, then creates `.env` from `.env.example` (or adds the
missing keys to an existing `.env`). Reused keys keep the app's values. Use
`--force` only if the user explicitly wants pw-setup's own files refreshed; it
never touches `.env` or the app's files.

## Step 4 - Apply the AMEND items

For each `AMEND` file, read it, make the listed additions, and show the user
the diff before saving. Rules:

- **Add, never remove or rewrite.** Keep every existing setting, project,
  reporter, rule and export. Only change a value when the item says so (a
  hard-coded `baseURL` becomes `env.baseUrl`; its value is already the
  `BASE_URL` default).
- **Playwright config:** add the missing `use` settings, the CI reporter and
  the imports; for Google sign-in, the `setup` project and `dependencies` /
  `storageState` on every browser project. If it's a `.js`/`.mjs` config, use
  the same imports (Playwright loads the TypeScript utils).
- **ESLint config:** add the printed block in the config's own style (flat
  array entry, or `overrides` for `.eslintrc*`). If the config doesn't parse
  TypeScript for the test folders, scope `typescript-eslint`'s recommended
  config (flat) or `@typescript-eslint/parser` + plugin (legacy) to them.
- **Jest / Vitest config:** add the exclude for the Playwright specs, keeping
  the existing patterns (Jest's default `testPathIgnorePatterns` is
  `['/node_modules/']`; Vitest's is `configDefaults.exclude`). If there is no
  config yet, add a `jest` key to `package.json` or create
  `vitest.config.ts`. Then run the unit tests once to confirm they still run
  and don't pick up the specs.
- **App code files** (e.g. the app's own `utils/env.ts` or
  `fixtures/pages.fixture.ts`): add the missing exports or fixture
  registrations, matching the template named in the item, next to what is
  there.
- **The app's own page objects** (a `NOTE` names them): adapt the new
  example specs to them, or drop the example spec if it doesn't fit. Never
  change the app's page objects to fit the examples.

## Step 5 - Install

Run the install line the scaffold printed under `Next:`, for example:

```bash
npm install && npx playwright install chromium
pnpm install && pnpm exec playwright install chromium     # pnpm repo
```

Map projects to browser downloads: `chromium` and `mobile-chrome` need
`chromium`; `webkit` and `mobile-safari` need `webkit`; `firefox` needs
`firefox`. On Linux, add `--with-deps` (it may ask for sudo; tell the user
first).

## Step 6 - Verify

Run the verify commands the scaffold printed, e.g.:

```bash
npm run typecheck     # merged: npm run pw:typecheck
npm run lint          # merged: npm run pw:lint
npm run check         # merged: npm run pw:check
npx playwright test --list
```

All four must pass (warnings are fine). `check` is `pw-check` levels 1-2;
findings that sit only in files that existed before setup are warnings, not
failures. If `--list` doesn't show the new specs, the adopted config's
`testDir`/`testMatch` doesn't reach them: fix that in the config. In merged
mode, also run the app's own build or type check once if it has one: the test
folders are now in its `include` (the dry run notes when its build emits
them).

Do **not** run the tests themselves yet: the example page objects use guessed
labels (`Username`, `Password`, `Sign in`) and the credentials are empty.

## Step 7 - Hand over

Tell the user, briefly:

1. **Fill in `.env`** - open it and add the credentials for each role. Never
   commit it. Teammates create their own with the `env:init` script
   (`pw:env:init` in merged mode).
2. **Adapt the example pages** - update the path, labels and button names in
   the login and home page objects to match the app (see `pw-locators`), then
   run `npx playwright test --project=chromium`.
3. **Add pages and specs** following `pw-page-objects`.
4. **Daily commands:** the `test`, `smoke`, `ui`, `report` and `check` scripts
   (prefixed `pw:` in merged mode).

Say what was adopted and amended (the app's config, tsconfig, ESLint config,
folders) and what was added, in a few lines; do not paste the file list again.

For Google sign-in, replace point 2 with:

2. **Sign in once:** run the `login` script (`npm run login`, or
   `pw:login`). `utils/login-cli.mjs` opens a headed Chrome through
   playwright-cli on a persistent profile (`.auth/cli-profile/<role>/`); the
   user signs in by hand, including any verification, within
   `LOGIN_TIMEOUT_MINUTES` (10). The session is saved to `.auth/<role>.json`
   and the tests run signed in. Later runs reuse it without opening a
   browser; after an hour, or when the app rejects it, the browser opens
   again on the same profile, which remembers the account. `login:force`
   signs in again now; `login:cli` runs the script directly. Also adjust the
   button name and `HomePage.waitForReady()` if needed.

and add:

5. **CI:** Google sign-in cannot run on CI. Either restore the session JSON
   from a secret into `.auth/<role>.json` before the tests run (refresh the
   secret when it expires), or ask the app team for a test-login endpoint
   that skips Google. The setup step fails with this advice on CI.

## Google sign-in: rules

- Sign-in is **by hand**, in the window `utils/login-cli.mjs` opens. Never
  automate Google's screens or try to get around its checks (flags, user
  agents, stealth plugins), and never put Google credentials in `.env`.
- Don't run the `login` script or the setup step yourself unless the user is
  at the screen: it opens a browser and waits for them.
- If Google says "This browser or app may not be secure", the sign-in
  happened somewhere else (for example a spec that signs in itself). Sign-in
  belongs only in `login-cli.mjs`, which `tests/auth/auth.setup.ts` runs; the
  setup step doesn't depend on the app's page objects.
- A browser window left open by a failed run: `npx playwright-cli close-all`.
- Changing the who-am-I endpoint or login path: update both `utils/auth.ts`
  and `utils/login-cli.mjs` (`ME_ENDPOINT`, `LOGIN_PATH`). Adding a role:
  `test-data/users.ts` and `ROLES` in `login-cli.mjs`.
