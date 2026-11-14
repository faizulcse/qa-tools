# pw-setup-agent

Sets up a Playwright + TypeScript test project and keeps it in shape. The
project always goes at the repository root, and whatever is already there (an
app, a Playwright setup, tsconfig, ESLint config, folders, dependencies) is
kept and amended rather than replaced. The project
comes with page objects, fixtures, typed test data, a `.env` file and lint
rules, and a check that confirms it still follows the conventions as it grows.
Apps whose only login is "Sign in with Google" are supported too: sign-in
happens once in real Chrome, and the saved session is reused.

This plugin **writes spec files**. To drive a browser by hand and report what
happened without writing code, use qa-agent's `qa-test-ui` instead.

## What it does

| Skill | Trigger it by saying | What it produces |
| --- | --- | --- |
| **pw-setup** | "set up Playwright", "scaffold e2e tests", "add Playwright with TypeScript", "set up a page object model project" | A test project at the repo root, adopting what's already there, installed and verified, with a short handover |
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

## Always at the root: what setup does with what's there

The project is always built at the repository root. Whatever is already there
is **kept and amended** with what the tests need: nothing is replaced or
removed, and setup never stops to ask about it. The dry run shows every change
first.

| What exists | What setup does |
| --- | --- |
| No `package.json` | **standalone**: everything is created at the root. Scripts: `test`, `lint`, `check`... |
| The app's `package.json` | **merged**: adds `pw:test`, `pw:smoke`, `pw:headed`, `pw:ui`, `pw:report`, `pw:typecheck`, `pw:lint`, `pw:check`, `pw:env:init` and missing dev dependencies; every app script and dependency version is kept; installs use the repo's package manager |
| `@playwright/test` or `playwright` | Kept at the app's version. A note with the upgrade command if it's older than 1.45 |
| `playwright.config.*` | Kept, with its `testDir`, projects and reporters. New specs go in its `testDir` (e.g. `e2e/`). The skill adds what's missing: `baseURL` from env (a hard-coded one becomes the `BASE_URL` default, so nothing changes), traces/screenshots/videos on failure, a CI reporter, and the `setup` project for Google sign-in |
| `tsconfig.json` | Amended in place, comments and formatting kept: the test aliases (relative to `baseUrl` if set), the test folders in `include`, `node` types. `strict`, `target`, `module` and `moduleResolution` never change. Apps on `nodenext` resolution or a target older than ES2017 get a small `tsconfig.e2e.json` that extends theirs instead |
| ESLint config (flat or `.eslintrc*`) | Kept; the skill adds a block applying the Playwright rules to the spec folder |
| `pages/`, `fixtures/`, `test-data/`, `utils/`, the spec folder | Used. A file with the same name is kept, never overwritten; if it lacks an export the new files need, the skill adds it. The app's own page objects stay as they are: the example specs are adapted to them |
| Next.js or Nuxt | Page objects go in `page-objects/` (their `pages/` folder is routes); the `@pages` alias points there |
| `.gitignore`, `.env.example` | Missing entries and keys appended in a `# Playwright (pw-setup-agent)` block |
| `.env` | Missing keys added; never replaced |
| Env keys the app has (`BASE_URL`...) | Reused by the tests. Pass `--env-prefix E2E_` for separate keys |
| `.nvmrc` | Kept |

Setup only stops for things it can't work around: Node older than 20.12, npm
missing, not run from the repository root, an invalid `package.json`, or an
existing `pw-setup.json` (then it's a check, not a setup).

## How setup works

Open Claude Code at the **repository root** and say "set up Playwright with
TypeScript". The `pw-setup` skill then:

1. **Inspects** the repo with `detect_env.mjs`: Node and npm versions, the
   mode, the package manager, the spec and page-object folders, and what it
   will adopt.
2. **Asks** only for what it can't infer: the app URL (default: the existing
   config's `baseURL`, else `http://localhost:3000`), browsers (default
   `chromium`) and test account roles (default `user`). It never asks for
   passwords or tokens.
3. **Dry-runs** `scaffold.mjs` and shows you every file: `+` create, `~` the
   app's file amended (with what it adds), `=` kept, `>` kept and amended by
   the skill (with the exact additions). It writes only once you agree.
4. **Applies** the `>` amendments (Playwright config, ESLint config, any app
   file the new files import from), showing each change first.
5. **Installs** dependencies and browsers.
6. **Verifies** with `typecheck`, `lint`, `playwright test --list` and
   `check`. All four must pass before handover.
7. **Hands over** with what was adopted, what was added, and what to do next.

## What the project looks like

```
<repo root>/
├── playwright.config.ts      created, or the app's own config amended
├── package.json              scripts and dev dependencies (added to the app's)
├── tsconfig.json             created, or the app's amended in place
├── eslint.config.mjs         created, or the app's ESLint config amended
├── .env.example / .env       .env is gitignored and created from the example
├── .gitignore · .nvmrc · pw-setup.json (manifest read by pw-check)
├── specs/                    or the existing testDir: home/home.spec.ts (@smoke), login/login.spec.ts
├── pages/                    page-objects/ in Next.js/Nuxt: base.page.ts, home.page.ts, login.page.ts, components/
├── fixtures/pages.fixture.ts page objects as fixtures
├── test-data/                types.ts, users.ts (credentials from env)
└── utils/                    env.ts, check-setup.mjs, init-env.mjs
```

`utils/check-setup.mjs` and `utils/init-env.mjs` are copies of the plugin
scripts, so the checks and `.env` creation work for teammates and on CI
without the plugin. `pw-setup.json` records the folders, config files, what
was adopted and which files existed before, so pw-check judges the project as
it is.

## After setup

1. **Fill in `.env`.** Each role has `<ROLE>_USERNAME` and `<ROLE>_PASSWORD`
   (with the prefix, if you chose one), left empty. Never commit it.
   Teammates create their own with the `env:init` script.
2. **Adapt the example pages.** The login and home page objects use guessed
   labels (`Username`, `Password`, `Sign in`). Update them to match your app,
   then run `npx playwright test --project=chromium`.
3. **Add pages and specs** by asking for them (`pw-page-objects`).

### Commands in the generated project

Run these at the repository root. In merged mode the script names start with
`pw:`, and you run them with the repo's package manager (`pnpm pw:test`,
`yarn pw:test`...).

| Standalone | Merged | Does |
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
Each takes `--json` for machine-readable output.

```bash
# Inspect the repo before scaffolding (exit 1 = blocked, e.g. Node too old)
node "$CLAUDE_PLUGIN_ROOT/scripts/detect_env.mjs"

# Dry run (default), then write
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" \
  --base-url https://staging.example.com --browsers chromium,firefox --roles admin,user
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" ... --write

# Separate env keys for the tests (E2E_BASE_URL...) instead of reusing the app's
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" --env-prefix E2E_ --write

# An app whose only login is Google
node "$CLAUDE_PLUGIN_ROOT/scripts/scaffold.mjs" --auth google-sso --me-endpoint /api/me \
  --roles admin --base-url 'https://{ENVIRONMENT}.example.com' --write

# Create or update .env
node "$CLAUDE_PLUGIN_ROOT/scripts/init_env.mjs"            # create if missing
node "$CLAUDE_PLUGIN_ROOT/scripts/init_env.mjs" --sync     # add keys new in .env.example
node "$CLAUDE_PLUGIN_ROOT/scripts/init_env.mjs" --force    # recreate, old file -> .env.bak

# Check structure and conventions (read-only)
node "$CLAUDE_PLUGIN_ROOT/scripts/check_setup.mjs"
node "$CLAUDE_PLUGIN_ROOT/scripts/check_setup.mjs" --root tests   # an older project in tests/
```

| Script | Options |
| --- | --- |
| `detect_env.mjs` | none besides `--json`. Exit `1` when blocked |
| `scaffold.mjs` | `--base-url URL`, `--browsers` (`chromium`, `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`), `--roles LIST`, `--project-name NAME`, `--env-prefix PREFIX`, `--auth password\|google-sso`, `--me-endpoint PATH` and `--login-path PATH` (Google), `--write`, `--force` (files pw-setup created earlier only; never `.env` or the app's files). Exit `1` when blocked |
| `init_env.mjs` | `--root DIR` (default `.`), `--base-url URL`, `--sync` or `--force`. Uses the env prefix from `pw-setup.json` |
| `check_setup.mjs` | `--root DIR` (default `.`; `tests` for an older project). Exit `0` no failures, `1` failures, `2` bad arguments |

`--root` on `scaffold.mjs` and `detect_env.mjs`, `--split-configs` and
`--reuse-env-keys` were removed in 0.3.0: the project is always at the root,
existing configs are amended, and existing env keys are reused.

## What pw-check enforces

- **Structure:** the folders recorded in `pw-setup.json`, `testDir` matching
  the spec folder, `baseURL` from env, strict TypeScript with the path aliases
  (and the config pointing at `tsconfig.e2e.json` where there is one), `.env`
  and artifacts gitignored, every env variable the code reads listed in
  `.env.example`, `.env` never tracked.
- **Conventions:** page objects extend `BasePage` and hold no assertions; page
  objects are fixtures and specs import `test` from `@fixtures`; no XPath or
  element handles; no `waitForTimeout` or `.only`; no hard-coded secrets;
  trace, screenshot and video kept on failure.

The check looks only at the test project's folders. Findings that sit only
in files that existed before setup (the app's own tests and page objects),
and `strict` off in the app's own tsconfig, are warnings rather than
failures.

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
- Existing things are only added to: the app's scripts, dependency versions,
  settings, page objects and tests are never removed or rewritten. The only
  value that changes is a hard-coded `baseURL`, which moves to `.env` with the
  same URL.
- Files pw-setup created are refreshed only with `--force`; `.env` is
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
| "Run from the repository root" | Open Claude Code (or run the script) at the git top-level folder. |
| The app's build now compiles the specs | The test folders are in the app tsconfig's `include`. If its build emits files, exclude the test folders in the build step (e.g. a `tsconfig.build.json`). |
| New specs aren't listed by `--list` | The adopted config's `testDir` or `testMatch` doesn't reach them. Point `testDir` at the spec folder in `pw-setup.json`, or widen `testMatch`. |
| pw-check warns about the app's own tests | They existed before setup and don't follow the conventions yet. Warnings only; update them when convenient. |
| `init_env` refuses to write | Add `.env` to `.gitignore` (the scaffold does this; it fails only if the file was changed). |
| Login spec fails | Expected until you fill in `.env` and adapt the labels in the login page object. |
| Browser download fails behind a proxy | Set `HTTPS_PROXY` and re-run `npx playwright install chromium`. |
| On Linux, browsers fail to start | Run `npx playwright install --with-deps chromium` (may need sudo). |
| "Google blocked the sign-in: This browser or app may not be secure" | Something signed in inside a Playwright-launched browser. Sign-in belongs only in the setup step, which uses real Chrome. |
| "The Chrome profile ... is already open" | Close the Chrome window that uses `.auth/chrome-profile/<role>/` and run again. |
| "Google Chrome was not found" | Install Chrome, or set `CHROME_PATH` in `.env`. |
| Setup waits, then fails "who-am-I endpoint did not return 200" | Sign-in wasn't finished within 4 minutes, or `--me-endpoint` is wrong. Check the endpoint returns 200 in the signed-in Chrome window, then run `login` again. |

## Upgrading from 0.1.0 or 0.2.0

Projects set up in `tests/` (0.1.0, or 0.2.0 with `--root tests`) keep
working: `check_setup.mjs --root tests` checks them. There is no automatic
move to the root. To move one, move the files out of `tests/` into the root,
merge its `package.json` and `.gitignore` into the root ones, set
`"root": "."` in `pw-setup.json`, and run `node utils/check-setup.mjs`.

0.2.0 projects at the root that used `tsconfig.e2e.json` and
`eslint.e2e.config.mjs` also keep working: their `pw-setup.json` names those
files.

## Roadmap

See the plan in
[`docs/plans/pw-setup-agent.md`](../../docs/plans/pw-setup-agent.md). Next:
the same saved-session setup step for username/password apps, faker-based
test data builders, a GitHub Actions workflow, and more skills.
