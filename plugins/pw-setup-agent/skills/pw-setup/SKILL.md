---
name: pw-setup
description: >
  This skill should be used when the user wants a Playwright test automation
  project created - "set up Playwright", "scaffold e2e tests", "create a
  Playwright framework", "add Playwright with TypeScript", "set up a page
  object model project", "bootstrap UI test automation", or when a repository
  has no Playwright project and the user wants to start writing automated
  tests. Scaffolds a TypeScript project in tests/ with page objects, fixtures,
  typed test data, a .env file and lint rules, then verifies it with pw-check.
  Not for running manual browser tests through playwright-cli (that is
  qa-agent:qa-test-ui).
metadata:
  version: "0.1.0"
---

# Playwright Setup

Create a Playwright + TypeScript test project that follows the conventions the
other `pw-` skills teach and `pw-check` enforces. Everything lives in one
folder, `tests/`, with its own `package.json`, so the app's dependencies stay
untouched.

This skill **writes spec files**. If the user wants to drive a browser and
report what happened without writing code, that is `qa-agent:qa-test-ui`.

## What gets created

```
tests/
├── playwright.config.ts      testDir ./specs, baseURL from env, artifacts on failure
├── package.json              own scripts and pinned dependencies
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

## Step 1 - Inspect the repository

Run from the **repository root**:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/detect_env.mjs" --root tests
```

- **Exit 1 (blocker):** stop and tell the user what to fix (usually Node older
  than 20.12, or npm missing).
- **`pw-setup.json` already exists:** the project was set up before. Do not
  scaffold again; switch to `pw-check`.
- **An existing Playwright config or `@playwright/test` dependency elsewhere:**
  tell the user and ask whether to set up a separate project in `tests/`
  anyway, or stop.
- **`tests/` already has files:** the scaffold skips existing files. Say so,
  and list which of the planned files will be skipped after the dry run.
- **The repo uses pnpm, yarn or bun:** fine. The test project uses npm on its
  own; mention it once.

## Step 2 - Ask what you need

Ask only for what you cannot infer. Use these defaults when the user has no
preference:

| Option | Flag | Default |
|---|---|---|
| Application URL | `--base-url` | `http://localhost:3000` |
| Browsers | `--browsers` | `chromium` (also: `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`) |
| Test account roles | `--roles` | `user` (lowercase, e.g. `admin,viewer`) |

**Never ask for passwords, usernames or tokens.** Each role gets
`<ROLE>_USERNAME` and `<ROLE>_PASSWORD` keys in `.env`, left empty for the user
to fill in themselves. If the user pastes credentials into the chat anyway, do
not write them anywhere; tell them to put them in `tests/.env`.

## Step 3 - Dry run, then write

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" --root tests --base-url <url> --browsers <list> --roles <list>
```

The default is a dry run: it prints every file with `+` (create), `!`
(overwrite) or `=` (exists, skipped) and writes nothing. Show the user the
list. When they agree:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" --root tests --base-url <url> --browsers <list> --roles <list> --write
```

- `--write` also creates `tests/.env` from `.env.example` (via `init_env.mjs`),
  with `BASE_URL` filled in and credentials empty.
- Use `--force` only if the user explicitly wants existing files replaced.
  It never touches `.env`.

## Step 4 - Install

```bash
cd tests
npm install
npx playwright install <browsers>
```

Map projects to browser downloads: `chromium` and `mobile-chrome` need
`chromium`; `webkit` and `mobile-safari` need `webkit`; `firefox` needs
`firefox`. On Linux, add `--with-deps` (it may ask for sudo; tell the user
first).

## Step 5 - Verify

```bash
npm run typecheck
npm run lint
npx playwright test --list
npm run check
```

All four must pass. `npm run check` is `pw-check` levels 1-2. If anything
fails, fix it before handing over; the templates pass all four as shipped, so a
failure usually means an existing file was skipped or the user edited
something.

Do **not** run the tests themselves yet: the example page objects use guessed
labels (`Username`, `Password`, `Sign in`) and the credentials are empty.

## Step 6 - Hand over

Tell the user, briefly:

1. **Fill in `tests/.env`** - open it and add the credentials for each role.
   Never commit it. Teammates create their own with `npm run env:init`.
2. **Adapt the example pages** - update the path, labels and button names in
   `pages/login.page.ts` and `pages/home.page.ts` to match the app (see
   `pw-locators`), then run `npx playwright test --project=chromium`.
3. **Add pages and specs** following `pw-page-objects`.
4. **Daily commands:** `npm test`, `npm run test:smoke`, `npm run test:ui`,
   `npm run report`, `npm run check`.

Summarize what was created in a few lines; do not paste the file list again.
