# pw-setup-agent

Sets up a Playwright + TypeScript test project in `tests/` and keeps it in
shape. The project comes with page objects, fixtures, typed test data, a
`.env` file and lint rules, and a check that confirms it still follows the
conventions as it grows.

This plugin **writes spec files**. To drive a browser by hand and report what
happened without writing code, use qa-agent's `qa-test-ui` instead.

## What it does

| Skill | Trigger it by saying | What it produces |
| --- | --- | --- |
| **pw-setup** | "set up Playwright", "scaffold e2e tests", "add Playwright with TypeScript", "set up a page object model project" | A `tests/` project, installed and verified, with a short handover |
| **pw-check** | "check my Playwright setup", "does my framework follow the conventions", "audit my page objects" | A read-only report: each rule as pass, warning or failure, with file, line and fix |
| **pw-page-objects** | "create a page object", "add a component", "write a spec for this page", "register a fixture" | Page objects, components, fixtures and specs written the project's way |
| **pw-locators** | "which locator should I use", "fix this flaky selector", "strict mode violation", "replace XPath" | Role- and label-based locators, patterns for hard cases, correct waits |
| **pw-core-config** | "add a browser", "run against staging", "change the timeout", "set retries", "add mobile testing" | Safe changes to `playwright.config.ts` and `tsconfig.json`, explained |

You never invoke a skill by name. Describe what you want and it loads.

## Requirements

| Need | Check |
| --- | --- |
| Node 20.12+ (Playwright needs 20+; `.env` loading uses `process.loadEnvFile`) | `node --version` |
| npm | `npm --version` |
| git (recommended: `.env` must be gitignored before it is written) | `git --version` |

The test project uses npm on its own, even if the app uses pnpm, yarn or bun.
No MCP servers or connectors.

## Install

```
/plugin marketplace add faizulcse/qa-tools
/plugin install pw-setup-agent@qa-tools
```

Restart Claude Code so the skills load.

## How setup works

Open Claude Code at the **repository root** and say "set up Playwright with
TypeScript". The `pw-setup` skill then:

1. **Inspects** the repo with `detect_env.mjs`: Node and npm versions, an
   existing Playwright install, a non-empty `tests/`, or an earlier setup. If
   the project was already set up, it switches to `pw-check` instead.
2. **Asks** only for what it can't infer: the app URL (default
   `http://localhost:3000`), browsers (default `chromium`) and test account
   roles (default `user`). It never asks for passwords or tokens.
3. **Dry-runs** `scaffold.mjs` and shows you every file it would write, then
   writes them once you agree. Existing files are skipped, not overwritten.
4. **Installs** dependencies and browsers in `tests/`.
5. **Verifies** with `typecheck`, `lint`, `playwright test --list` and
   `npm run check`. All four must pass before handover.
6. **Hands over** with what to do next (below).

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

`utils/check-setup.mjs` and `utils/init-env.mjs` are copies of the plugin
scripts, so the checks and `.env` creation work for teammates and on CI
without the plugin.

## After setup

1. **Fill in `tests/.env`.** Each role has `<ROLE>_USERNAME` and
   `<ROLE>_PASSWORD`, left empty. Never commit it. Teammates create their own
   with `npm run env:init`.
2. **Adapt the example pages.** The login and home page objects use guessed
   labels (`Username`, `Password`, `Sign in`). Update them to match your app,
   then run `npx playwright test --project=chromium`.
3. **Add pages and specs** by asking for them (`pw-page-objects`).

### Commands in the generated project

Run these inside `tests/`:

| Command | Does |
| --- | --- |
| `npm test` | Run all tests |
| `npm run test:smoke` | Run tests tagged `@smoke` |
| `npm run test:headed` | Run with a visible browser |
| `npm run test:ui` | Open Playwright's UI mode |
| `npm run report` | Open the last HTML report |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint with the Playwright rules |
| `npm run check` | The pw-check structure and convention checks |
| `npm run env:init` | Create `.env` from `.env.example` |

## Scripts

All scripts are Node 18+ with no dependencies, run from the repository root.
Each takes `--json` for machine-readable output.

```bash
# Inspect the repo before scaffolding (exit 1 = blocked, e.g. Node too old)
node "$CLAUDE_PLUGIN_ROOT/scripts/detect_env.mjs" --root tests

# Dry run (default), then write
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" --root tests \
  --base-url https://staging.example.com --browsers chromium,firefox --roles admin,user
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" ... --write

# Create or update .env
node "$CLAUDE_PLUGIN_ROOT/scripts/init_env.mjs" --root tests            # create if missing
node "$CLAUDE_PLUGIN_ROOT/scripts/init_env.mjs" --root tests --sync     # add keys new in .env.example
node "$CLAUDE_PLUGIN_ROOT/scripts/init_env.mjs" --root tests --force    # recreate, old file -> .env.bak

# Check structure and conventions (read-only)
node "$CLAUDE_PLUGIN_ROOT/scripts/check_setup.mjs" --root tests
```

| Script | Options |
| --- | --- |
| `detect_env.mjs` | `--root DIR` |
| `scaffold.mjs` | `--root DIR`, `--base-url URL`, `--browsers` (`chromium`, `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`), `--roles LIST`, `--project-name NAME`, `--write`, `--force` (never touches `.env`) |
| `init_env.mjs` | `--root DIR`, `--base-url URL`, `--sync` or `--force` |
| `check_setup.mjs` | `--root DIR`. Exit `0` no failures, `1` failures, `2` bad arguments |

## What pw-check enforces

- **Structure:** required folders, `testDir` and `baseURL` from env, strict
  TypeScript with the path aliases, `.env` and artifacts gitignored, every env
  variable the code reads listed in `.env.example`, `.env` never tracked.
- **Conventions:** page objects extend `BasePage` and hold no assertions; page
  objects are fixtures and specs import `test` from `@fixtures`; no XPath or
  element handles; no `waitForTimeout` or `.only`; no hard-coded secrets;
  trace, screenshot and video kept on failure.

## Bundled files

| File | Purpose |
| --- | --- |
| `scripts/detect_env.mjs` | Pre-scaffold repo inspection |
| `scripts/scaffold.mjs` | Writes the project from the templates (dry run by default) |
| `scripts/init_env.mjs` | Creates or syncs `.env` from `.env.example` |
| `scripts/check_setup.mjs` | Structure and convention checks |
| `skills/pw-setup/SKILL.md` | Setup procedure |
| `skills/pw-check/SKILL.md` | Check procedure and rule list |
| `skills/pw-page-objects/` | Page object, fixture and spec conventions, with `references/examples.md` |
| `skills/pw-locators/` | Locator priority and waits, with `references/patterns.md` |
| `skills/pw-core-config/SKILL.md` | Config and tsconfig settings |
| `templates/project/` | The project files copied into `tests/` (dotfiles stored without the dot) |

## Safety rules the skills follow

- Nothing is written before you've seen the dry run.
- Existing files are skipped unless you ask for `--force`; `.env` is never
  overwritten without `init_env.mjs --force`, which backs it up first.
- `.env` is only written when it is gitignored.
- Credentials are never asked for, filled in or printed. Scripts print key
  names, never values.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `detect_env` exits 1 | Upgrade Node to 20.12+ and re-run. |
| Setup says the project already exists | `tests/pw-setup.json` is there. Ask for a check instead, or delete `tests/` to start over. |
| `init_env` refuses to write | Add `.env` to `tests/.gitignore` (the scaffold does this; it fails only if the file was changed). |
| Login spec fails | Expected until you fill in `tests/.env` and adapt the labels in `pages/login.page.ts`. |
| Browser download fails behind a proxy | Set `HTTPS_PROXY` and re-run `npx playwright install chromium`. |
| On Linux, browsers fail to start | Run `npx playwright install --with-deps chromium` (may need sudo). |

## Roadmap

0.1.0 is Phase 1 of the plan in
[`docs/plans/pw-setup-agent.md`](../../docs/plans/pw-setup-agent.md). Later
phases add an auth setup project, faker-based test data builders, a GitHub
Actions workflow, and more skills.
