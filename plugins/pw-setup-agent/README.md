# pw-setup-agent

Sets up a Playwright + TypeScript test project and keeps it in shape. By
default the project goes at the repository root, merged safely into an app
that is already there; a sub-folder such as `tests/` is an option. The project
comes with page objects, fixtures, typed test data, a `.env` file and lint
rules, and a check that confirms it still follows the conventions as it grows.
Apps whose only login is "Sign in with Google" are supported too: sign-in
happens once in real Chrome, and the saved session is reused.

This plugin **writes spec files**. To drive a browser by hand and report what
happened without writing code, use qa-agent's `qa-test-ui` instead.

## What it does

| Skill | Trigger it by saying | What it produces |
| --- | --- | --- |
| **pw-setup** | "set up Playwright", "scaffold e2e tests", "add Playwright with TypeScript", "set up a page object model project" | A test project at the root (or in `tests/`), installed and verified, with a short handover |
| **pw-check** | "check my Playwright setup", "does my framework follow the conventions", "audit my page objects" | A read-only report: each rule as pass, warning or failure, with file, line and fix |
| **pw-page-objects** | "create a page object", "add a component", "write a spec for this page", "register a fixture" | Page objects, components, fixtures and specs written the project's way |
| **pw-locators** | "which locator should I use", "fix this flaky selector", "strict mode violation", "replace XPath" | Role- and label-based locators, patterns for hard cases, correct waits |
| **pw-core-config** | "add a browser", "run against staging", "change the timeout", "set retries", "add mobile testing" | Safe changes to `playwright.config.ts` and the tsconfig, explained |

You never invoke a skill by name. Describe what you want and it loads.

## Requirements

| Need | Check |
| --- | --- |
| Node 20.12+ (Playwright needs 20+; `.env` loading uses `process.loadEnvFile`) | `node --version` |
| npm, or the package manager the repo already uses (pnpm, yarn, bun) | `npm --version` |
| git (recommended: `.env` must be gitignored before it is written) | `git --version` |
| Google Chrome, only for apps that sign in with Google | `CHROME_PATH` in `.env` if it isn't in the default place |

No MCP servers or connectors.

## Install

```
/plugin marketplace add faizulcse/qa-tools
/plugin install pw-setup-agent@qa-tools
```

Restart Claude Code so the skills load.

## Where the project goes

Setup picks one of three modes and records it in `pw-setup.json`:

| Mode | When | What happens |
| --- | --- | --- |
| **standalone** | Repo root with no `package.json` (an empty or test-only repo) | Files are written at the root. Scripts: `test`, `lint`, `check`... |
| **merged** | Repo root with the app's `package.json` | Test files are added next to the app. Shared files are merged add-only, scripts are prefixed `pw:`, and installs use the repo's package manager |
| **subfolder** | You ask for `--root tests` (or another folder) | A self-contained project in that folder with its own `package.json`, using npm |

### What merged mode changes in the app's files

| File | Change |
| --- | --- |
| `package.json` | Adds `pw:test`, `pw:smoke`, `pw:headed`, `pw:ui`, `pw:report`, `pw:typecheck`, `pw:lint`, `pw:check`, `pw:env:init`, and missing dev dependencies. Every app script and dependency version is kept |
| `.gitignore` | Appends missing entries (`/.auth/`, `/test-results/`, `/playwright-report/`...) in a `# Playwright (pw-setup-agent)` block |
| `.env.example` | Appends missing keys in the same kind of block |
| `.env` | Adds missing keys only; never replaced |
| `tsconfig.json`, ESLint config, `.nvmrc` | Never changed. The tests get `tsconfig.e2e.json` and `eslint.e2e.config.mjs` instead |

Setup **asks** before going ahead when:

- **The app has its own tsconfig or ESLint config:** use the split
  `*.e2e.*` configs (recommended), or `--root tests`.
- **`.env.example` already has `BASE_URL`:** reuse the app's keys, or give the
  test keys an `E2E_` prefix (`E2E_BASE_URL`, `E2E_ADMIN_USERNAME`...).

Setup **won't use the root** when:

- the repo already has a Playwright config or `@playwright/test`
- it is a Next.js or Nuxt app, where a root `pages/` folder becomes app routes
- `specs/`, `pages/`, `fixtures/`, `test-data/` or `utils/` already hold files

In those cases it suggests `--root tests`.

## How setup works

Open Claude Code at the **repository root** and say "set up Playwright with
TypeScript". The `pw-setup` skill then:

1. **Inspects** the repo with `detect_env.mjs`: Node and npm versions, the
   mode it would use, the package manager, and anything that blocks the root
   or needs a decision.
2. **Asks** only for what it can't infer: the app URL (default
   `http://localhost:3000`), browsers (default `chromium`), test account
   roles (default `user`), and the decisions above. It never asks for
   passwords or tokens.
3. **Dry-runs** `scaffold.mjs` and shows you every file: `+` create, `~` merge
   (with what it adds), `=` skipped, `?` needs a decision. It writes only once
   you agree.
4. **Offers** to exclude the test folders from the app's own tsconfig and
   ESLint config, if those would otherwise pick them up.
5. **Installs** dependencies and browsers.
6. **Verifies** with `typecheck`, `lint`, `playwright test --list` and
   `check`. All four must pass before handover.
7. **Hands over** with what to do next (below).

## What gets created

```
<root>/
├── playwright.config.ts      testDir ./specs, baseURL from env, artifacts on failure
├── package.json              scripts and pinned dependencies (merged into the app's)
├── tsconfig.json             strict, aliases @pages/* @fixtures @data/* @utils/*   (or tsconfig.e2e.json)
├── eslint.config.mjs         typescript-eslint + eslint-plugin-playwright         (or eslint.e2e.config.mjs)
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

1. **Fill in `.env`.** Each role has `<ROLE>_USERNAME` and `<ROLE>_PASSWORD`
   (with the prefix, if you chose one), left empty. Never commit it.
   Teammates create their own with the `env:init` script.
2. **Adapt the example pages.** The login and home page objects use guessed
   labels (`Username`, `Password`, `Sign in`). Update them to match your app,
   then run `npx playwright test --project=chromium`.
3. **Add pages and specs** by asking for them (`pw-page-objects`).

### Commands in the generated project

Run these in the project folder. In merged mode the script names start with
`pw:`, and you run them with the repo's package manager (`pnpm pw:test`,
`yarn pw:test`...).

| Standalone / subfolder | Merged | Does |
| --- | --- | --- |
| `npm test` | `npm run pw:test` | Run all tests |
| `npm run test:smoke` | `npm run pw:smoke` | Run tests tagged `@smoke` |
| `npm run test:headed` | `npm run pw:headed` | Run with a visible browser |
| `npm run test:ui` | `npm run pw:ui` | Open Playwright's UI mode |
| `npm run report` | `npm run pw:report` | Open the last HTML report |
| `npm run typecheck` | `npm run pw:typecheck` | Type-check the test files |
| `npm run lint` | `npm run pw:lint` | ESLint with the Playwright rules, on the test files |
| `npm run check` | `npm run pw:check` | The pw-check structure and convention checks |
| `npm run env:init` | `npm run pw:env:init` | Create `.env` from `.env.example` |

## Google sign-in

For apps where "Sign in with Google" is the only login. Setup spots this on
the login page and uses the Google templates (`--auth google-sso`). It finds
the app's **who-am-I endpoint** (a request that returns 401 signed out and 200
signed in) and confirms it with you.

**Why real Chrome:** Google refuses sign-in in any browser Playwright launches
("This browser or app may not be secure"), whatever the config. A normal
Chrome that Playwright only connects to is accepted. So the tests never sign
in themselves: they load a saved session, and only the setup step opens Chrome
to create it.

| Piece | What it does |
| --- | --- |
| `.auth/<role>.json` | The saved session the tests load. Gitignored |
| `.auth/chrome-profile/<role>/` | A dedicated Chrome profile per role, used only to sign in. Gitignored |
| `specs/auth/auth.setup.ts` | Runs before the tests (project `setup`). Reuses the JSON while it is under `AUTH_MAX_AGE_MINUTES` (60) old **and** who-am-I returns 200 with it; otherwise opens Chrome, tries the account from `.env`, and waits up to 4 minutes for you to finish by hand |
| `pages/components/google-sign-in.component.ts` | Fills Google's screens when it can: email box or account chooser, password, 2-Step code, consent. Best effort: anything it can't do, you do in the window |
| `utils/chrome-profile.ts` | Starts Chrome on the profile and connects over CDP |
| `utils/login-chrome.mjs` | Manual fallback: saves the session from a Chrome you started yourself |

**In `.env`** (all optional; without them you sign in by hand): `<ROLE>` is
the account email (e.g. `ADMIN=you@company.com`), `<ROLE>_PASSWORD`,
`OTP` (a fixed 2-Step code), `AUTH_MAX_AGE_MINUTES`, `FORCE_LOGIN`,
`CHROME_PATH`, and `AUTH_BROWSER_CHANNEL` (e.g. `chrome` to run the tests in
installed Chrome). `BASE_URL` may contain `{ENVIRONMENT}`, filled from
`ENVIRONMENT`.

**Day to day:**

| Script (`pw:` prefix when merged) | Does |
| --- | --- |
| `login` | Runs only the setup step. The first time, a Chrome window opens: finish signing in there |
| `login:force` | Signs in again now, even with a valid session |
| `login:chrome` | Manual fallback; see the top of `utils/login-chrome.mjs` |
| `test` | Runs setup (instant when the session is valid), then the tests |

The first run needs you at the screen. Later runs don't open a browser for
setup. After an hour, or when the app rejects the session, Chrome reopens on
the profile and refreshes it, usually without any typing because the profile
remembers your Google account.

**On CI** there's no one to sign in. Either restore the session JSON from a
secret into `.auth/<role>.json` before the tests run (it's reused while
fresh; refresh the secret when it expires), or ask the app team for a
test-login endpoint that skips Google. On CI the setup step fails with this
advice instead of trying to open Chrome.

## Scripts

All scripts are Node 18+ with no dependencies, run from the repository root.
`--root` defaults to `.` (the root). Each takes `--json` for machine-readable
output.

```bash
# Inspect the repo before scaffolding (exit 1 = blocked, e.g. Node too old)
node "$CLAUDE_PLUGIN_ROOT/scripts/detect_env.mjs"

# Dry run (default), then write
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" \
  --base-url https://staging.example.com --browsers chromium,firefox --roles admin,user
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" ... --write

# Into an app that has its own tsconfig and a BASE_URL of its own
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" --split-configs --env-prefix E2E_ --write

# In a sub-folder instead
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" --root tests --write

# An app whose only login is Google
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" --auth google-sso --me-endpoint /api/me \
  --roles admin --base-url 'https://{ENVIRONMENT}.example.com' --write

# Create or update .env
node "$CLAUDE_PLUGIN_ROOT/scripts/init_env.mjs"            # create if missing
node "$CLAUDE_PLUGIN_ROOT/scripts/init_env.mjs" --sync     # add keys new in .env.example
node "$CLAUDE_PLUGIN_ROOT/scripts/init_env.mjs" --force    # recreate, old file -> .env.bak

# Check structure and conventions (read-only)
node "$CLAUDE_PLUGIN_ROOT/scripts/check_setup.mjs"
```

| Script | Options |
| --- | --- |
| `detect_env.mjs` | `--root DIR` |
| `scaffold.mjs` | `--root DIR`, `--base-url URL`, `--browsers` (`chromium`, `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`), `--roles LIST`, `--project-name NAME`, `--split-configs`, `--env-prefix PREFIX` or `--reuse-env-keys`, `--auth password\|google-sso`, `--me-endpoint PATH` and `--login-path PATH` (Google), `--write`, `--force` (pw-setup's own files only; never `.env` or the app's files). Exit `1` when blocked, or on `--write` with an open decision |
| `init_env.mjs` | `--root DIR`, `--base-url URL`, `--sync` or `--force`. Uses the env prefix from `pw-setup.json` |
| `check_setup.mjs` | `--root DIR`. Exit `0` no failures, `1` failures, `2` bad arguments |

## What pw-check enforces

- **Structure:** required folders, `testDir` and `baseURL` from env, strict
  TypeScript with the path aliases (and `playwright.config.ts` pointing at
  `tsconfig.e2e.json` when configs are split), `.env` and artifacts
  gitignored, every env variable the code reads listed in `.env.example`,
  `.env` never tracked.
- **Conventions:** page objects extend `BasePage` and hold no assertions; page
  objects are fixtures and specs import `test` from `@fixtures`; no XPath or
  element handles; no `waitForTimeout` or `.only`; no hard-coded secrets;
  trace, screenshot and video kept on failure.

In a merged project, the check looks only at the test project's files.

## Bundled files

| File | Purpose |
| --- | --- |
| `scripts/detect_env.mjs` | Pre-scaffold repo inspection: mode, package manager, blockers, decisions |
| `scripts/scaffold.mjs` | Writes or merges the project from the templates (dry run by default) |
| `scripts/init_env.mjs` | Creates or syncs `.env` from `.env.example` |
| `scripts/check_setup.mjs` | Structure and convention checks |
| `skills/pw-setup/SKILL.md` | Setup procedure |
| `skills/pw-check/SKILL.md` | Check procedure and rule list |
| `skills/pw-page-objects/` | Page object, fixture and spec conventions, with `references/examples.md` |
| `skills/pw-locators/` | Locator priority and waits, with `references/patterns.md` |
| `skills/pw-core-config/SKILL.md` | Config and tsconfig settings |
| `templates/project/` | The project files (dotfiles stored without the dot, `tsconfig.json` as `tsconfig.json.tmpl`) |
| `templates/auth/google-sso/` | Files that replace or add to the project for Google sign-in |

## Safety rules the skills follow

- Nothing is written before you've seen the dry run, including every line it
  adds to the app's files.
- The app's scripts, dependency versions, tsconfig, ESLint config and `.nvmrc`
  are never changed by the scaffold. Excluding the test folders from the app's
  configs is offered separately, and only done when you agree.
- Existing pw-setup files are skipped unless you ask for `--force`; `.env` is
  never overwritten without `init_env.mjs --force`, which backs it up first.
- `.env` is only written when it is gitignored.
- Credentials are never asked for, filled in or printed. Scripts print key
  names, never values.
- Nothing tries to get Google to accept a Playwright-launched browser. Google
  sign-in happens only in real Chrome, with you able to take over.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `detect_env` exits 1 | Upgrade Node to 20.12+ and re-run. |
| Setup says the project already exists | `pw-setup.json` is there. Ask for a check instead. To refresh pw-setup's own files, re-run the scaffold with `--force`. |
| Setup won't use the root | It found a Playwright config, a Next.js/Nuxt app, or folders it needs that already hold files. Use `--root tests`. |
| The app's build or lint now picks up the specs | Add `playwright.config.ts`, `specs`, `pages`, `fixtures`, `test-data` and `utils` to the app tsconfig's `exclude` and the app ESLint config's `ignores`. |
| `init_env` refuses to write | Add `.env` to `.gitignore` (the scaffold does this; it fails only if the file was changed). |
| Login spec fails | Expected until you fill in `.env` and adapt the labels in `pages/login.page.ts`. |
| Browser download fails behind a proxy | Set `HTTPS_PROXY` and re-run `npx playwright install chromium`. |
| On Linux, browsers fail to start | Run `npx playwright install --with-deps chromium` (may need sudo). |
| "Google blocked the sign-in: This browser or app may not be secure" | Something signed in inside a Playwright-launched browser. Sign-in belongs only in the setup step, which uses real Chrome. |
| "The Chrome profile ... is already open" | Close the Chrome window that uses `.auth/chrome-profile/<role>/` and run again. |
| "Google Chrome was not found" | Install Chrome, or set `CHROME_PATH` in `.env`. |
| Setup waits, then fails "who-am-I endpoint did not return 200" | Sign-in wasn't finished within 4 minutes, or `--me-endpoint` is wrong. Check the endpoint returns 200 in the signed-in Chrome window, then run `login` again. |

## Upgrading from 0.1.0

0.1.0 projects live in `tests/` and keep working: their `pw-setup.json` says
`root: tests`, and the skills pass `--root tests` when they find it there.
There is no automatic move to the root. To move one, move the files out of
`tests/` into the root, merge its `package.json` and `.gitignore` into the
root ones, set `"root": "."` in `pw-setup.json`, and run
`node utils/check-setup.mjs`.

## Roadmap

See the plan in
[`docs/plans/pw-setup-agent.md`](../../docs/plans/pw-setup-agent.md). Next:
the same saved-session setup step for username/password apps, faker-based
test data builders, a GitHub Actions workflow, and more skills.
