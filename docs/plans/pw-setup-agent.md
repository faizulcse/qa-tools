# pw-setup-agent: Plan

Status: Phase 1 released as pw-setup-agent 0.1.0 in qa-tools marketplace 0.4.0.
Next: the root layout (pw-setup-agent 0.2.0), planned below; not built yet.
Code changes for it wait for explicit approval.

### Phase 1 notes (changes from the original plan)

- Templates live in `templates/project/` (copied into `tests/`); the GitHub
  workflow will go in `templates/github/`. Dotfiles are stored without the dot
  (`gitignore`, `env.example`, `nvmrc`) so they don't affect this repo.
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
├── .env.example                  # BASE_URL, TEST_ENV, FAKER_SEED, AUTH_MAX_AGE_MINUTES, role credentials (committed)
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

Each role logs in once and its session is saved as JSON, then reused until it
is an hour old.

- **File:** `.auth/<role>.json`, written with
  `page.context().storageState({ path })` (cookies and localStorage, the
  format Playwright loads with `use: { storageState }`). `.auth/` is
  gitignored; the files are never committed.
- **Reuse rule:** in `auth.setup.ts`, for each role, a shared helper
  (`utils/auth-session.ts`, `isSessionFresh(file, maxAgeMinutes)`) checks the
  file:
  - **Missing, unreadable, not valid JSON, or no cookies and no origins:**
    log in.
  - **Older than `AUTH_MAX_AGE_MINUTES` (default 60), by file modification
    time:** force a new login, even though the file exists.
  - **Otherwise:** reuse it and skip the login (the setup test passes and logs
    `reusing .auth/<role>.json (age 23 min)`).
- **After a login:** overwrite `.auth/<role>.json` with the new session. The
  write goes to a temp file first and is then renamed, so a run that dies
  mid-write never leaves a half-written JSON behind.
- **Force a login now:** `AUTH_FORCE_LOGIN=1 npm test` (or `pw:test` in merged
  mode) ignores the age and logs in for every role. Deleting `.auth/` does the
  same.
- **Settings:** `AUTH_MAX_AGE_MINUTES` in `.env.example` (default `60`), read
  through `utils/env.ts`. If the app expires sessions sooner than an hour, set
  it lower. Not a secret, so `init_env.mjs` fills in the default.
- **How login happens:** through the UI with the login page object by
  default; through the API when the skill finds a login endpoint and the user
  agrees. Either way the result is the same JSON file.
- **Where it runs:** the `setup` project, which every browser project depends
  on, so it runs once per `npx playwright test` before any test, not once per
  worker. On CI the `.auth/` folder starts empty, so every job logs in once.
- **Auth tests themselves** (login, logout, wrong password) don't use the
  saved session: they start from an empty `storageState` in the spec.

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
| Auth works | `npx playwright test --project=setup` writes a valid `.auth/<role>.json` for each role; a second run within the hour reuses it (file unchanged); with `AUTH_FORCE_LOGIN=1` it is rewritten |
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
| 2. Data and auth | `pw-test-data` (faker and builders), `pw-auth`, `auth.setup.ts` with the 1-hour JSON session reuse, `utils/auth-session.ts`, `utils/env.ts`, check level 3 (`--run`, `--smoke`, env values filled) |
| 3. Quality and CI | `pw-artifacts`, `pw-best-practices`, `gen_page_object`, the GitHub workflow template, README and CHANGELOG |

Each phase ends with a test scaffold into a temporary folder and a
`pw-check --run` against it.

## Release (0.1.0, done)

1. Add `plugins/pw-setup-agent` at **0.1.0**.
2. Add its entry to `.claude-plugin/marketplace.json` and bump the marketplace
   `metadata.version` to **0.4.0**.
3. Update the root README's plugin list and the pinning example (`@v0.4.0`).
4. Commit to `main` and push.
