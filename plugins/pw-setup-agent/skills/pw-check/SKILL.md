---
name: pw-check
description: >
  This skill should be used when the user wants to verify a Playwright test
  project - "check my Playwright setup", "verify the setup", "is my test
  project configured correctly", "does my framework follow the conventions",
  "audit my page objects", "validate the tests folder", or after pw-setup
  finishes, or after adding pages and specs. Runs a read-only check of the
  project structure and coding conventions and reports each rule as pass,
  warning or failure with the file and line and how to fix it.
metadata:
  version: "0.1.0"
---

# Playwright Setup Check

Verify that a test project follows the pw-setup-agent conventions. The check is
**read-only**: it never changes files and never prints `.env` values.

## Run it

From the repository root:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/check_setup.mjs"               # the project (always at the root since 0.3.0)
node "$CLAUDE_PLUGIN_ROOT/scripts/check_setup.mjs" --root tests  # an older 0.1.0/0.2.0 project in tests/
```

Find the project by its `pw-setup.json`: at the root, or in `tests/` for
projects set up before 0.3.0.

Inside the project (works without the plugin, and on CI), with the package
manager and script name from `pw-setup.json`:

```bash
npm run check          # standalone (an older tests/ project: cd tests first)
npm run pw:check       # merged into an app's package.json (pnpm pw:check, yarn pw:check...)
```

The check reads `pw-setup.json` for the folders (`folders.specs` may be an
adopted `e2e/`, `folders.pages` may be `page-objects/`), the Playwright config
file and `testDir`, the tsconfig name (`tsconfig.e2e.json` only for apps on
`nodenext` or an old target), the script names and the package manager, so
its checks and fix hints match the project. It looks only at the test
project's folders, never at the app's code.

Two rules soften for things the app already had (recorded under `adopted` and
`preexisting` in `pw-setup.json`):

- A convention finding that sits **only in files that existed before
  pw-setup** (the app's own tests and page objects) is a warning, not a
  failure, with "(in files that existed before pw-setup)".
- `strict` off in the app's own tsconfig is a warning: the app owns it.

Add `--json` to parse the results. Exit code `0` means no failures (warnings are
allowed), `1` means at least one failure, `2` means bad arguments or the folder
does not exist.

## What it checks

**Level 1 - structure**

| Check | Passes when |
|---|---|
| Folders | the spec and page-object folders from `pw-setup.json` (default `specs/`, `pages/`), `fixtures/`, `test-data/`, `utils/` exist |
| Config | `playwright.config.ts` exists, `testDir` is `./specs`, `baseURL` comes from env |
| TypeScript | `strict: true`; aliases `@pages/*`, `@fixtures`, `@data/*`, `@utils/*` exist and point at real folders |
| Gitignore | `.env`, `.auth/`, `test-results/`, `playwright-report/` are ignored |
| Env example | every variable the code reads is listed in `.env.example` |
| .env file | locally: present with every key (warning if not); on CI: skipped; always a failure if `.env` is tracked by git |
| Manifest | `pw-setup.json` exists (warning if not: the project was not made by pw-setup) |

**Level 2 - conventions**

| Check | Passes when |
|---|---|
| Page objects | every `*.page.ts` in the page-object folder extends `BasePage`; no `expect` outside `waitForReady()`; no `expect` in components |
| Fixtures | every page object is created in `fixtures/`; specs never call `new XxxPage(page)` |
| Imports | specs import `test` from `@fixtures`, not `@playwright/test` |
| Locators | no XPath, no `page.$` / `$$` / `$eval`; CSS locators are counted (info) |
| Waits | no `waitForTimeout`, no `.only`; `waitForSelector` and `networkidle` are warnings |
| Secrets | no string literal assigned to a password, token, secret or API key in specs, pages or fixtures |
| Artifacts | `trace`, `screenshot` and `video` keep output for failures only; a blob reporter on CI |

Levels 1-2 are static. Running the project (install, type check, auth and smoke
run) is planned for a later version; `--run` and `--smoke` currently exit with
code 2 and a message.

## Report the result

- **All passed:** say so in one line with the counts.
- **Failures or warnings:** list each one with its file:line locations and the
  fix. Each finding names the skill that explains the rule (`pw-locators`,
  `pw-page-objects`, `pw-core-config`, `pw-setup`); load that skill before
  proposing a non-trivial fix.
- **Offer to fix** findings one rule at a time, and show the change before
  making it. Do not fix everything silently.
- **`.env` is tracked by git:** treat this as urgent. Tell the user to run
  `git rm --cached .env`, commit, and rotate every credential it held.
  Do not print the file.
- The CSS count is information only. Mention it only if it is high, and point
  to `pw-locators`.
