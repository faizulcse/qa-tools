# pw-setup-agent: Plan

Status: Phase 1 released as pw-setup-agent 0.1.0 in qa-tools marketplace 0.4.0.
Next: the root layout (pw-setup-agent 0.2.0) is built and tested, not released yet.
Google SSO login (`--auth google-sso`, also 0.2.0) is built and tested against a
mock app; it includes the auth setup step and session reuse below. Session
reuse for the username/password template is still Phase 2.

### Phase 1 notes (changes from the original plan)

- Templates live in `templates/project/` (copied into `tests/`); the GitHub
  workflow will go in `templates/github/`. Dotfiles are stored without the dot
  (`gitignore`, `env.example`, `nvmrc`) so they don't affect this repo, and
  `tsconfig.json` is stored as `tsconfig.json.tmpl` so editors don't treat the
  template folder as a TypeScript project.
- Added `pages/home.page.ts` and `specs/home/home.spec.ts` (`@smoke`) so the
  header component has a page to live on and the smoke run has a target.
- `pw-check` skill and a minimal `test-data/` (`types.ts`, `users.ts`, credentials
  from env) moved into Phase 1. Faker and builders are still Phase 2.
- `typescript` is pinned to 6.0.3: `typescript-eslint` 8.x supports `<6.1`.
- `.env` is loaded with Node's `process.loadEnvFile` (no dotenv); `.nvmrc` is `lts/*`.
- Check rules for the setup project, faker usage and the CI workflow arrive
  with the phases that add those files.

## Change for 0.2.0: project at the repository root

0.1.0 scaffolds everything into `tests/`. In 0.2.0 the project is created at
the **repository root** by default. `--root tests` (or any folder) stays
available for teams that want the old layout.

### Modes

`scaffold.mjs` picks a mode from what is already at the root and records it in
`pw-setup.json`:

| Mode | When | What happens |
|---|---|---|
| **standalone** | No `package.json` at the root (empty repo or a test-only repo) | Files are written as in 0.1.0, just at `./` instead of `tests/` |
| **merged** | The root has an app `package.json` | Shared files are merged (add only, never replace); conflicting configs stop setup and ask |
| **subfolder** | `--root <dir>` given | Same as 0.1.0 |

### Merge rules (merged mode)

| File or folder | Rule |
|---|---|
| `package.json` | Add missing `devDependencies` at the pinned versions. If a dependency is already there at another version, keep the app's and report it (a different `@playwright/test` major is a stop-and-ask). Scripts are added under a `pw:` prefix (`pw:test`, `pw:smoke`, `pw:ui`, `pw:report`, `pw:typecheck`, `pw:lint`, `pw:check`, `pw:env:init`) so they never clash with the app's `test` or `lint` |
| Lockfile / package manager | Install with the package manager the root lockfile belongs to (npm, pnpm, yarn or bun), never npm next to another lockfile. The 0.1.0 rule "the test project always uses npm" applies only to standalone and subfolder modes |
| `.gitignore` | Append the missing entries in a `# Playwright (pw-setup-agent)` block, anchored to the root: `/test-results/`, `/playwright-report/`, `/blob-report/`, `/.auth/`, `.env` |
| `.env.example` | Append missing keys in a `# Playwright (pw-setup-agent)` block. If a key we need already exists (`BASE_URL` often does, meaning the app's own URL), the dry run lists it and the skill asks: reuse it, or use `E2E_`-prefixed names (`E2E_BASE_URL`, `E2E_<ROLE>_USERNAME`...). The chosen names are written into `utils/env.ts` and the manifest |
| `.env` | Never replaced. Missing keys are added with `init_env.mjs --sync` semantics; the gitignore check still runs first |
| `tsconfig.json` | **Stop and ask.** Recommended: write `tsconfig.e2e.json` with the strict settings and aliases, point `playwright.config.ts` at it (`tsconfig: './tsconfig.e2e.json'`), use `tsc -p tsconfig.e2e.json` for `pw:typecheck`, and offer to add the test folders to the app tsconfig's `exclude` so the app build doesn't compile specs. The alternative offered is `--root tests` |
| ESLint config (`eslint.config.*`, `.eslintrc*`) | **Stop and ask.** Recommended: write `eslint.e2e.config.mjs`, run `pw:lint` with `eslint -c eslint.e2e.config.mjs specs pages fixtures test-data utils`, and offer to add those folders to the app config's `ignores` |
| `playwright.config.*` or `@playwright/test` already used | **Stop and ask** (as in 0.1.0): set up in a subfolder, or stop |
| `.nvmrc` | Keep the app's. Warn if it pins Node below 20.12 |
| Folders `specs/`, `pages/`, `fixtures/`, `test-data/`, `utils/` | If any exists with app code in it, **stop and ask**; suggest `--root tests`. `detect_env` calls out Next.js (and similar file-based routers) specifically, because a root `pages/` folder becomes app routes there |

Nothing is merged without the dry run showing it first: the dry run marks each
file `+` create, `~` merge (with the lines or keys it adds), `=` skipped, or
`?` needs a decision.

### What changes where

- **`detect_env.mjs`:** `--root` defaults to `.`. Reports the mode it would
  use, the root lockfile and package manager, existing `tsconfig`/ESLint/
  Playwright configs, folder clashes, framework hints (Next.js `pages/`), and
  `.env.example` keys that clash.
- **`scaffold.mjs`:** `--root` defaults to `.`. Adds the merge logic above, the
  `pw:` script names, the `E2E_` env option (`--env-prefix E2E_`), and the
  `tsconfig.e2e.json` / `eslint.e2e.config.mjs` variants
  (`--split-configs`). Writes to the manifest: `mode`, `root`, script names,
  config file names, env key names, package manager.
- **`init_env.mjs`:** `--root` defaults to `.`. Handles the marked block in a
  shared `.env.example`.
- **`check_setup.mjs`:** `--root` defaults to `.`. Reads the manifest to know
  the mode, config file names and env key names. In merged mode it checks only
  the pw-setup files and the pw-setup block of shared files, and never flags
  the app's own code. Folder checks list the five folders at the root.
- **Templates:** `playwright.config.ts` gets an optional `tsconfig` line;
  `package.json` scripts and `utils/env.ts` key names come from placeholders;
  `gitignore` entries become root-anchored.
- **Skills:** `pw-setup` gains a "choose the mode" step and the stop-and-ask
  prompts above; every skill and the README replace `tests/...` paths with
  root-relative ones and mention `--root tests`. `pw-check` and
  `pw-core-config` explain the split config files in merged mode.
- **GitHub workflow (Phase 3):** no `working-directory`; Node from `.nvmrc` at
  the root; cache keyed on the root lockfile; uses the root package manager;
  runs `pw:check` and `pw:test` in merged mode. In merged mode `npm ci`
  installs the app's dependencies too, which makes the job slower; noted in
  the README.
- **Existing 0.1.0 projects in `tests/`:** keep working. The manifest says
  `root: tests`, and the skills pass `--root tests` when they find it there.
  No automatic migration; moving to the root is a manual step documented in
  the README.

### Testing the change

Scaffold into scratch repos and run `typecheck`, `lint`, `--list` and
`check` in each:

1. Empty git repo → standalone at the root.
2. Node app with `package.json`, `tsconfig.json`, `eslint.config.mjs`,
   `.gitignore` and `.env.example` containing `BASE_URL` → merged, with each
   stop-and-ask taken through its recommended answer; the app's files keep
   every original line.
3. Next.js app with `pages/` → stops and suggests `--root tests`.
4. `--root tests` → identical output to 0.1.0 (regression check).
5. Repo using pnpm → installs with pnpm, no `package-lock.json` created.

### Release

pw-setup-agent **0.2.0** (the default location changes), marketplace bump,
CHANGELOG entry with the migration note. The items earlier marked "Deferred
to v0.2" move to v0.3.

## Purpose

A plugin that sets up and maintains a Playwright test project in TypeScript
that uses the Page Object Model. It does three things:

1. **Scaffolds the project:** config, folders, a base page, a login flow, test
   data and GitHub CI.
2. **Generates code** inside that structure: a new page object, a spec or a
   test-data builder.
3. **Teaches and enforces conventions** through skills (locators, auth, config,
   artifacts, test data, best practices), and **checks** that a project follows
   them and works.

**Relationship to qa-agent:** `qa-agent:qa-test-ui` runs tests through
`playwright-cli` and never writes spec files. pw-setup-agent is the plugin that
does write spec files. Skill descriptions must say this so the wrong skill
doesn't trigger.

## Decisions

| Area | Decision |
|---|---|
| Plugin name | `pw-setup-agent`, with skills prefixed `pw-` |
| Language | TypeScript, `strict: true` |
| Root folder | 0.1.0: `tests/`, with its own `package.json`. From 0.2.0: the repository root by default (merged safely into an app repo), `--root tests` optional; specs in `specs/` |
| Pattern | Page objects plus fixtures; specs import `test` from `@fixtures` |
| Test data | TS modules and `@faker-js/faker` |
| CI | GitHub Actions |
| Scripts | Node `.mjs` with no dependencies (users already need Node for Playwright) |
| Safety | Scaffold defaults to dry-run, never overwrites without `--force`; the check asks before `--run` and `--smoke` |
| Versions | `@playwright/test` and faker pinned in the template; no wrapping of `npm init playwright` |
| Deferred to v0.3 | `--fix` auto-fix, and turning `qa-analyze` test plans into specs |

## Plugin layout

```
plugins/pw-setup-agent/
├── .claude-plugin/plugin.json
├── README.md
├── CHANGELOG.md
├── skills/
│   ├── pw-setup/SKILL.md            # entry point: scaffold a new project
│   ├── pw-check/SKILL.md            # verify structure, conventions and that it works
│   ├── pw-core-config/SKILL.md
│   ├── pw-page-objects/SKILL.md     # POM + fixtures
│   ├── pw-locators/SKILL.md
│   ├── pw-test-data/SKILL.md
│   ├── pw-auth/SKILL.md
│   ├── pw-artifacts/SKILL.md
│   └── pw-best-practices/SKILL.md   # explains pw-check findings, reviews specs
├── templates/
│   ├── playwright.config.ts · tsconfig.json · package.json · .nvmrc
│   ├── .env.example · .gitignore · eslint.config.mjs
│   ├── pages/ (base.page.ts, login.page.ts, components/header.component.ts)
│   ├── fixtures/pages.fixture.ts
│   ├── specs/ (auth.setup.ts, login/login.spec.ts)
│   ├── test-data/ (types.ts, faker.ts, users.ts, builders/, static/)
│   ├── utils/env.ts
│   └── github/playwright.yml
└── scripts/
    ├── detect_env.mjs        # Node version, package manager, existing Playwright/config
    ├── scaffold.mjs          # copy templates, fill placeholders, write pw-setup.json
    ├── check_setup.mjs       # the check; also copied to tests/utils/check-setup.mjs
    ├── init_env.mjs          # create/sync .env from .env.example; copied to tests/utils/init-env.mjs
    └── gen_page_object.mjs   # page object + spec stub + fixture registration
```

Topic skills can keep longer guidance in a `references/` folder, as
`git-agent:commit-draft` does.

## Generated project

Shown for 0.1.0 (`tests/`). From 0.2.0 the same files sit at the repository
root, plus `tsconfig.e2e.json` / `eslint.e2e.config.mjs` in merged mode; see
the 0.2.0 section above.

```
tests/
├── playwright.config.ts          # testDir: './specs'
├── package.json                  # own scripts + @playwright/test (isolated from the app)
├── tsconfig.json                 # path aliases @pages/*, @data/*, @fixtures/*, @utils/*
├── .nvmrc
├── .env.example                  # BASE_URL, ENVIRONMENT, TEST_ENV, FAKER_SEED, AUTH_MAX_AGE_MINUTES, FORCE_LOGIN, role credentials (committed)
├── .env                          # created by init-env from .env.example (gitignored)
├── .gitignore                    # .auth/, test-results/, playwright-report/, .env
├── eslint.config.mjs             # with eslint-plugin-playwright
├── pw-setup.json                 # setup manifest, read by the check
├── specs/
│   ├── auth.setup.ts             # per role: reuse .auth/<role>.json if < 1 h old, else log in and rewrite it
│   └── login/login.spec.ts
├── pages/
│   ├── base.page.ts              # goto(), waitForReady(), shared helpers
│   ├── login.page.ts
│   └── components/header.component.ts
├── fixtures/pages.fixture.ts     # test.extend({ loginPage, ... })
├── test-data/
│   ├── types.ts                  # User, Role, Address… interfaces
│   ├── faker.ts                  # single faker instance + seed handling
│   ├── users.ts                  # role accounts, credentials from env
│   ├── builders/user.builder.ts  # buildUser(overrides?: Partial<User>): User
│   └── static/countries.ts       # fixed lookup data, typed `as const`
├── utils/
│   ├── env.ts                    # validated env loading, one place
│   ├── check-setup.mjs           # copy of the check, so CI doesn't need the plugin
│   └── init-env.mjs              # copy of init_env, run with `npm run env:init`
└── .auth/                        # gitignored session files: <role>.json (Playwright storageState)

.github/workflows/playwright.yml  # at the repo root
```

## Skills

| Skill | Triggers on | Covers |
|---|---|---|
| **pw-setup** (entry) | "set up Playwright", "scaffold e2e tests" | Runs `detect_env`, asks the key questions, runs `scaffold.mjs --dry-run`, shows the file list, writes the files, installs dependencies and browsers, then runs `pw-check --run` |
| **pw-check** | "check my Playwright setup", "verify the setup" | Runs `check_setup.mjs` and reports each check with a fix hint and the skill that explains the rule |
| **pw-core-config** | "configure playwright.config", "add a project/browser" | `testDir: './specs'`, baseURL from env, `projects` (setup project, then chromium/firefox/webkit/mobile), timeouts, retries and workers on CI vs local, `fullyParallel`, `forbidOnly` on CI, multiple environments via `TEST_ENV` |
| **pw-page-objects** | "create a page object", "add a page" | Locators as readonly fields set in the constructor, methods named after user actions, assertions kept in specs (except `waitForReady`), components for shared UI, registering pages in the fixture |
| **pw-locators** | "which locator", "fix flaky selector" | Priority: `getByRole`, then `getByLabel`/`getByPlaceholder`, then `getByText`, then `getByTestId`, with CSS last and XPath avoided. Chaining and `filter()`, strict mode, `data-testid` conventions, using `playwright-cli` snapshots to choose locators from a live page |
| **pw-test-data** | "test data", "factory", "unique users" | Typed builders with faker, seeds, uniqueness for parallel runs, static data, credentials from env, cleanup through the API in `afterEach` |
| **pw-auth** | "login once", "storageState", "multiple roles", "session expired" | Setup project plus `storageState`, one JSON session file per role, the 1-hour reuse rule (see Auth sessions), logging in through the API vs the UI, refreshing expired sessions, keeping `.auth/` out of git, test-scoped login for auth tests themselves |
| **pw-artifacts** | "trace", "screenshots", "report", "CI artifacts" | `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`, `outputDir`, reporters (html and list locally, blob on CI), merging sharded reports, downloading and opening a trace from a failed Actions run |
| **pw-best-practices** | "review my tests", "why is this flaky" | Explains `pw-check` findings: no `waitForTimeout`, web-first assertions (`await expect(...)`), no `page.$`, isolated tests, no `test.only`, no hard-coded credentials, tags (`@smoke`), `test.step` |

Keep descriptions from overlapping: `pw-best-practices` is about *reviewing*
existing tests; the topic skills cover *how to do X*.

## Test data rules

- **One faker instance.** `faker.ts` reads a `FAKER_SEED` env var, or creates a
  seed if it's missing, and logs it. Running again with the same seed
  reproduces a failure exactly.
- **Builders take overrides.** `buildUser({ role: 'admin' })` returns a
  complete, valid object with only that field changed.
- **Unique values for parallel runs.** Emails and names include the worker
  index and a short run ID, so parallel workers never collide.
- **Accounts come from env.** `users.ts` maps roles to env variables; passwords
  never appear in code.
- **Specs stay out of faker.** They call builders and never import faker
  directly.

## Auth sessions

Each role logs in once and its session is saved as JSON, then reused while it
is under an hour old **and** still accepted by the app.

Built first for Google SSO (0.2.0, see "Google SSO login" below); the
username/password template gets the same setup step in Phase 2.

- **File:** `.auth/<role>.json`, written with
  `page.context().storageState({ path })` (cookies and localStorage, the
  format Playwright loads with `use: { storageState }`). `.auth/` is
  gitignored; the files are never committed.
- **Reuse rule:** in `auth.setup.ts`, for each role, helpers in
  `utils/auth.ts` (`sessionAgeMinutes`, `meStatus`) check the file:
  - **Missing:** log in.
  - **Older than `AUTH_MAX_AGE_MINUTES` (default 60), by file modification
    time:** log in again, even though the file exists.
  - **The app's who-am-I endpoint does not return 200 with it** (checked
    through `request.newContext({ storageState })`, no browser): log in
    again. This catches sessions the server expired early.
  - **Otherwise:** reuse it and skip the login (the setup test passes and logs
    `reusing <role>.json (23 min old)`, in under a second).
- **After a login:** overwrite `.auth/<role>.json` with the new session. The
  write goes to a temp file first and is then renamed, so a run that dies
  mid-write never leaves a half-written JSON behind.
- **Force a login now:** `FORCE_LOGIN=1`, or the `login:force` script
  (detected through `npm_lifecycle_event`, so it works on Windows without
  `cross-env`), skips the reuse check for every role. Deleting the JSON files
  does the same.
- **Settings:** `AUTH_MAX_AGE_MINUTES` in `.env.example` (default `60`), read
  through `utils/env.ts`. If the app expires sessions sooner than an hour, set
  it lower. Not a secret, so `init_env.mjs` fills in the default.
- **How login happens:** through the UI with the login page object by
  default; through the API when the skill finds a login endpoint and the user
  agrees. Either way the result is the same JSON file.
- **Where it runs:** the `setup` project, which every browser project depends
  on, so it runs once per `npx playwright test` before any test, not once per
  worker.
- **Auth tests themselves** (login, logout, wrong password) don't use the
  saved session: they start from an empty `storageState` in the spec.

## Google SSO login (`--auth google-sso`, 0.2.0)

For apps whose only login is "Sign in with Google" (Google Identity Services
popup). The design was verified end to end on a real project; the plugin
version was then
tested against a local mock app with fake Google screens.

### Facts the design is built around

1. Google blocks sign-in in **any** browser Playwright launches (headed or
   headless, bundled Chromium or `channel: 'chrome'`): "Couldn't sign you in –
   This browser or app may not be secure". No config change avoids it, and the
   plugin adds no flags or tricks to evade Google's bot detection.
2. A normal Google Chrome process that Playwright only **connects** to over
   CDP (`chromium.connectOverCDP`) is accepted.
3. Chrome refuses remote debugging on its default user-data directory, so a
   dedicated profile folder is needed.
4. `launchPersistentContext` can't reuse a profile real Chrome created:
   Playwright starts Chrome with a mock keychain on macOS, so the profile's
   cookies can't be decrypted. Chrome is started as a plain child process.
5. A profile can be open in one Chrome at a time (`SingletonLock`).
6. Google's screens vary (email box or account chooser, password, 2-Step
   code, consent "Continue"). Automatic filling is best-effort and falls back
   to the user finishing by hand; it never fails the run by itself.

### Architecture

- **Tests load only JSON:** `.auth/<role>.json`. Every browser project has
  `dependencies: ['setup']` and `storageState: storageStatePath('<first
  role>')`; the `chromium`-based projects also take `channel` from
  `AUTH_BROWSER_CHANNEL` (empty = bundled Chromium).
- **Chrome profile per role:** `.auth/chrome-profile/<role>/`, used only by
  the setup step to create or refresh the JSON. Everything is under the
  gitignored `.auth/`. (The reference used one `.auth/chrome-profile/`; one per
  role keeps each role's Google account separate.)
- **Setup step** `specs/auth/auth.setup.ts` (project `setup`,
  `testMatch: /.*\.setup\.ts/`, timeout 5 min), per role:
  1. Reuse `.auth/<role>.json` when it passes the reuse rule above (age and
     who-am-I 200), unless forced. No browser opens.
  2. On CI, stop with a clear error instead of opening Chrome (see CI below).
  3. Otherwise `openChromeProfile(<base URL + login path>, profile)`.
  4. If who-am-I (through `page.request`) is not 200: wait for the
     "Sign in with Google" button, click it, and if the account email is set,
     try `GoogleSignInComponent.signIn()` in try/catch. Any error logs
     "finish signing in by hand in the Chrome window".
  5. Unconditionally `expect.poll(meStatus, { timeout: 4 min, intervals: [2s] })
     .toBe(200)` (unconditional so `playwright/no-conditional-expect` passes).
  6. `context.storageState()` to a temp file, rename to `.auth/<role>.json`;
     close Chrome in `finally`.
- **`utils/chrome-profile.ts`** `openChromeProfile(url, profileDir)`:
  - Executable from `CHROME_PATH`, else the per-OS default (macOS
    `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, Linux
    `google-chrome`, Windows `%ProgramFiles%\Google\Chrome\Application\chrome.exe`);
    a clear error if missing.
  - Refuses with a clear message when the profile is open in a running
    Chrome. A `SingletonLock` whose process is gone is stale and ignored, as
    Chrome itself does (found in testing: a killed Chrome leaves the lock).
  - Deletes `DevToolsActivePort`, spawns Chrome with
    `--user-data-dir=<profile> --remote-debugging-port=0 --no-first-run
    --no-default-browser-check <url>` (stdio ignored), polls
    `DevToolsActivePort` (port on line 1, 20 s), `connectOverCDP`, and finds
    the app's tab.
  - `close()` quits Chrome gracefully with the CDP `Browser.close` command (so
    it releases the profile lock), falls back to killing the process, then
    disconnects.
- **`pages/components/google-sign-in.component.ts`**, rooted on the popup
  `Page`: email `getByRole('textbox', { name: /email or phone/i })`, password
  `getByLabel(/enter your password/i)`, code
  `getByRole('textbox', { name: /code|otp|pin/i })`, `Next`, consent
  `/^(continue|allow)$/i`, the account-chooser entry for the email,
  "Use another account", and the blocked text
  `/browser or app may not be secure/i` with `.first()` (several nodes match).
  `signIn()` races "popup closed" against every known screen (60 s each,
  `Promise.any`) and handles them in any order, up to 10 steps. **Account
  chooser and email box are alternatives** (the known gap from the reference:
  automatic email entry timed out because Google showed the chooser first).
  An input on screen wins over a chooser match, since later screens also show
  the email. It clicks `Next` explicitly (filling alone did not move Google
  on), waits until each screen's element is gone or the URL changes, and
  throws a clear error on the blocked screen. No `expect` in the component.
- **`LoginPage`** (path from `--login-path`, default `/`): heading and the
  "Sign in with Google" button; `openGoogleSignIn()` returns the component for
  the popup. **`HomePage.waitForReady()`:** main visible, loading text hidden,
  sign-in button hidden.
- **Credentials from env only**, never asked for in chat: `<ROLE>` (account
  email), optional `<ROLE>_PASSWORD`, optional `OTP` (a fixed code, entered if
  a code screen appears). `BASE_URL` may contain `{ENVIRONMENT}`, filled from
  `ENVIRONMENT` (both modes).
- **New env keys** in `.env.example`: `ENVIRONMENT`, `<ROLE>`,
  `<ROLE>_PASSWORD`, `OTP`, `AUTH_MAX_AGE_MINUTES`, `FORCE_LOGIN`,
  `CHROME_PATH`, `AUTH_BROWSER_CHANNEL` (all with the env prefix, if any).
  pw-check fails if the code reads a key missing from the example; OS and npm
  variables (`ProgramFiles`, `npm_lifecycle_event`) are exempt.
- **Scripts** (`pw:` prefix in merged mode): `login`
  (`playwright test --project=setup --headed`), `login:force` (same, forces a
  new sign-in), `login:chrome` (`utils/login-chrome.mjs`: connects to a Chrome
  the user started with `--remote-debugging-port=9222`, checks who-am-I is
  200, saves the JSON; the manual fallback).
- **ESLint:** `playwright/no-conditional-in-test` is off for
  `specs/**/*.setup.ts` only.

### Specs scaffolded

- `specs/login/login.spec.ts`, signed out
  (`test.use({ storageState: { cookies: [], origins: [] } })`): the sign-in
  screen shows (`@smoke`); the button opens a popup at `accounts.google.com`;
  who-am-I returns 401.
- `specs/home/home.spec.ts`, signed in: the app loads without the sign-in
  button (`@smoke`); who-am-I returns 200.

### Skill flow

- **pw-setup Step 1:** open the app's login page (playwright-cli snapshot, or
  ask the user). If the only option is "Sign in with Google", use
  `--auth google-sso` and find the who-am-I endpoint from the network calls (a
  request that returns 401 signed out); confirm it with the user. Pass
  `--me-endpoint` and `--login-path`.
- **Hand-over:** the first run needs the user at the screen: a Chrome window
  opens and they finish signing in by hand if asked (up to 4 min). Later runs
  reuse the JSON silently; after an hour, or when the app rejects it, the
  profile refreshes it, usually without typing anything.
- **CI:** no interactive login is possible. Two options, documented in the
  README: restore the session JSON from a secret before the tests run (it then
  passes the reuse rule), or ask the app team for a test-login endpoint that
  skips Google. The setup step fails with that advice instead of trying to
  open Chrome on CI.

### Acceptance

- Fresh scaffold: `typecheck`, `lint` (0 warnings), `playwright test --list`
  and `check` pass. Done, including merged mode with `E2E_` and two roles.
- First run: Chrome opens on the profile, sign-in completes, tests pass.
  Done against the mock app (2 s); real Google still needs a run on a real
  project.
- Second run: no browser for setup, under 1 s. Done (0.45 s).
- Blocked by Google: the clear error, not a strict-mode or timeout error.
  Done (mock blocked screen).
- Account chooser and email box both handled. Done (mock screens).

## The check (`pw-check` / `check_setup.mjs`)

```
node scripts/check_setup.mjs --root tests                 # levels 1–2 (default, no commands run)
node scripts/check_setup.mjs --root tests --run           # + level 3 up to --list
node scripts/check_setup.mjs --root tests --run --smoke   # + auth setup and smoke tests
```

### Level 1: structure (static, fast, safe)

| Check | Pass when |
|---|---|
| Folders | `tests/` has `specs/`, `pages/`, `fixtures/`, `test-data/`, `utils/` |
| Config | `playwright.config.ts` exists, `testDir` is `./specs`, `baseURL` comes from env, a setup project exists |
| TypeScript | `tsconfig.json` has `strict: true` and the path aliases resolve |
| Gitignore | `.auth/`, `.env`, `test-results/` and `playwright-report/` are ignored |
| Env | `.env.example` exists, and every variable read in `utils/env.ts` (including `FAKER_SEED`) is listed |
| `.env` file | Locally: `.env` exists and has every key in `.env.example` (⚠️ if missing, hint `npm run env:init`). On CI (`CI` set): skipped, values come from secrets. Always ❌ if `.env` is tracked by git (`git ls-files`) |
| CI | `.github/workflows/playwright.yml` exists, uses `working-directory: tests`, runs the check step, uploads artifacts on failure |

### Level 2: conventions (static analysis)

| Check | Pass when |
|---|---|
| POM | Every `pages/*.page.ts` extends `BasePage`; no `expect(` in page objects except in `waitForReady` |
| Fixtures | Every page object is registered in `pages.fixture.ts`; specs don't call `new XxxPage(page)` |
| Imports | Specs import `test` from `@fixtures`, not `@playwright/test` |
| Locators | No XPath, no `page.$`/`$$`; the number of CSS locators is reported |
| Waits | No `waitForTimeout`, no `test.only` |
| Test data | Faker imported only in `test-data/`; no `Math.random()` in specs or pages; builders return typed objects (no `any`) |
| Secrets | No hard-coded passwords or tokens in specs and pages |
| Artifacts | `trace`, `screenshot` and `video` match the recommended values; CI reporters are set |

### Level 3: working (runs commands)

| Check | Command |
|---|---|
| Env values filled | Required keys in `.env` (`BASE_URL`, role credentials) are not empty; checked before auth and smoke runs. Reports key names only, never values |
| Dependencies installed | `node_modules/@playwright/test` exists and its version matches `pw-setup.json` |
| Browsers installed | Browsers in the Playwright cache match the configured projects |
| Type check | `npx tsc --noEmit` |
| Lint | `npx eslint .` |
| Tests discovered | `npx playwright test --list` finds at least one test in each project |
| Auth works | `npx playwright test --project=setup` writes a valid `.auth/<role>.json` for each role; a second run within the hour reuses it (file unchanged); with `FORCE_LOGIN=1` it is rewritten |
| Smoke run | `npx playwright test --grep @smoke --project=chromium` passes |

### Behaviour

- **Output:** one row per check with ✅ / ⚠️ / ❌, a fix hint, and a link to the
  skill that explains the rule. JSON output for the skill to format.
- **Exit code:** 0 if everything passed, 1 on any ❌, so it works as a CI gate.
- **Safety:** levels 1–2 only read files. Level 3 runs commands, and `--smoke`
  sends requests to the real app, so the skill asks first and names the
  `BASE_URL` it will hit.
- **Manifest:** `pw-setup.json` (plugin version, root folder, roles, browsers,
  Playwright version) lets the check tell a deliberate removal apart from a
  setup that was never done.
- **No auto-fix in v0.1.** The skill can offer to fix findings one at a time.

## GitHub Actions workflow

`.github/workflows/playwright.yml` at the repo root:

- **Triggers:** pull requests and pushes to `main`, plus `workflow_dispatch`
  with an optional `FAKER_SEED` input.
- **Defaults:** `working-directory: tests`.
- **Setup:** check out; set up Node from `tests/.nvmrc` with the npm cache keyed
  on `tests/package-lock.json`; `npm ci`; cache Playwright browsers keyed on the
  Playwright version; `npx playwright install --with-deps`.
- **Gate:** `node utils/check-setup.mjs --root .` (levels 1–2) fails the job
  before any test runs.
- **Tests:** a 2-shard matrix, each running
  `npx playwright test --shard=${{ matrix.shard }}/2` with the blob reporter.
- **Merge job:** `npx playwright merge-reports`, then upload the HTML report.
- **On failure:** upload `test-results/` (traces, screenshots, videos), kept for
  7 days.
- **Secrets:** `BASE_URL` and role credentials from GitHub Secrets as env
  variables. `.auth/` files are created during the run, never committed.

## Scripts

- **`detect_env.mjs`:** reports Node version, package manager, and any existing
  Playwright install or config, so `pw-setup` doesn't clobber a project.
- **`scaffold.mjs`:** `--dry-run` by default (prints planned files); never
  overwrites without `--force` and reports what it skipped; fills placeholders
  (base URL, roles, browsers, package manager); writes `pw-setup.json`. After
  writing the files it runs `init_env.mjs` to create `tests/.env`.
- **`check_setup.mjs`:** the check above.
- **`init_env.mjs`:** creates and maintains the local `.env`. See below.
- **`gen_page_object.mjs Dashboard --url /dashboard`:** creates
  `pages/dashboard.page.ts`, a spec stub, and the fixture registration.

## Creating the .env file (`init_env.mjs`)

```
node scripts/init_env.mjs --root tests                              # create .env if missing
node scripts/init_env.mjs --root tests --base-url https://staging.example.com
node scripts/init_env.mjs --root tests --sync                       # add new keys only
node scripts/init_env.mjs --root tests --force                      # recreate (backs up to .env.bak)

cd tests && npm run env:init                                        # same, for teammates without the plugin
```

- **When it runs:** automatically as the last step of `scaffold.mjs` (so
  `pw-setup` always ends with a `.env`), and on demand through the
  `env:init` npm script in `tests/package.json`.
- **Source:** reads `.env.example` and writes `.env` with the same keys,
  comments and order.
- **Values it fills:** `BASE_URL` from `--base-url` (or the value chosen
  during `pw-setup`), `TEST_ENV=local`. `FAKER_SEED` stays empty so each run
  gets a new seed.
- **Values it never fills:** passwords, tokens and other secrets stay empty,
  marked `# fill in locally`. The skill tells the user to open `.env` and
  fill them in themselves, and never asks for them in chat, so secrets don't
  pass through the conversation.
- **Never overwrites:** an existing `.env` is left alone. `--sync` adds keys
  that are in `.env.example` but missing from `.env` and keeps every existing
  value. `--force` recreates it after copying the old file to `.env.bak`.
  `scaffold.mjs --force` does not touch `.env`.
- **Safety:** before writing, it confirms `.env` is in `.gitignore` and stops
  if it isn't. Output lists key names and which are still empty, never values.
- **Runtime hint:** `utils/env.ts` throws a clear error for a missing required
  variable, e.g. `BASE_URL is not set. Run "npm run env:init" and fill in
  tests/.env.`

## Build order

| Phase | Builds |
|---|---|
| 1. Working project (0.1.0, done) | `plugin.json`, `pw-setup`, `pw-core-config`, `pw-page-objects`, `pw-locators`, `detect_env`, `scaffold`, `init_env`, `check_setup` levels 1–2, and the config, page, fixture, spec and `.env.example` templates |
| 1.5 Root layout (0.2.0) | The modes and merge rules above, script and skill updates, the five test scenarios |
| 1.6 Google SSO (0.2.0) | `--auth google-sso`: the auth setup step with session reuse, Chrome profile over CDP, Google sign-in component, SSO login/home specs, login scripts, skill and README updates |
| 2. Data and auth | `pw-test-data` (faker and builders), `pw-auth`, an `auth.setup.ts` for the username/password template with the same session reuse as Google SSO, `utils/env.ts`, check level 3 (`--run`, `--smoke`, env values filled) |
| 3. Quality and CI | `pw-artifacts`, `pw-best-practices`, `gen_page_object`, the GitHub workflow template, README and CHANGELOG |

Each phase ends with a test scaffold into a temporary folder and a
`pw-check --run` against it.

## Release (0.1.0, done)

1. Add `plugins/pw-setup-agent` at **0.1.0**.
2. Add its entry to `.claude-plugin/marketplace.json` and bump the marketplace
   `metadata.version` to **0.4.0**.
3. Update the root README's plugin list and the pinning example (`@v0.4.0`).
4. Commit to `main` and push.
