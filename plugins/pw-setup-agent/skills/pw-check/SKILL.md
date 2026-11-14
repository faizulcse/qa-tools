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
node "$CLAUDE_PLUGIN_ROOT/scripts/check_setup.mjs" --root tests
```

Inside the project (works without the plugin, and on CI):

```bash
cd tests && npm run check
```

Add `--json` to parse the results. Exit code `0` means no failures (warnings are
allowed), `1` means at least one failure, `2` means bad arguments or the folder
does not exist.

## What it checks

**Level 1 - structure**

| Check | Passes when |
|---|---|
| Folders | `specs/`, `pages/`, `fixtures/`, `test-data/`, `utils/` exist |
| Config | `playwright.config.ts` exists, `testDir` is `./specs`, `baseURL` comes from env |
| TypeScript | `strict: true`; aliases `@pages/*`, `@fixtures`, `@data/*`, `@utils/*` exist and point at real folders |
| Gitignore | `.env`, `.auth/`, `test-results/`, `playwright-report/` are ignored |
| Env example | every variable the code reads is listed in `.env.example` |
| .env file | locally: present with every key (warning if not); on CI: skipped; always a failure if `.env` is tracked by git |
| Manifest | `pw-setup.json` exists (warning if not: the project was not made by pw-setup) |

**Level 2 - conventions**

| Check | Passes when |
|---|---|
| Page objects | every `pages/*.page.ts` extends `BasePage`; no `expect` outside `waitForReady()`; no `expect` in components |
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
  `git rm --cached tests/.env`, commit, and rotate every credential it held.
  Do not print the file.
- The CSS count is information only. Mention it only if it is high, and point
  to `pw-locators`.
