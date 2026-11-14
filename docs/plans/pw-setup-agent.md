# pw-setup-agent: Plan

Status: planned, not built. Target release: pw-setup-agent 0.1.0, qa-tools marketplace 0.4.0.

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
| Root folder | `tests/`, with its own `package.json`; specs in `tests/specs/` |
| Pattern | Page objects plus fixtures; specs import `test` from `@fixtures` |
| Test data | TS modules and `@faker-js/faker` |
| CI | GitHub Actions |
| Scripts | Node `.mjs` with no dependencies (users already need Node for Playwright) |
| Safety | Scaffold defaults to dry-run, never overwrites without `--force`; the check asks before `--run` and `--smoke` |
| Versions | `@playwright/test` and faker pinned in the template; no wrapping of `npm init playwright` |
| Deferred to v0.2 | `--fix` auto-fix, and turning `qa-analyze` test plans into specs |

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

```
tests/
├── playwright.config.ts          # testDir: './specs'
├── package.json                  # own scripts + @playwright/test (isolated from the app)
├── tsconfig.json                 # path aliases @pages/*, @data/*, @fixtures/*, @utils/*
├── .nvmrc
├── .env.example                  # BASE_URL, TEST_ENV, FAKER_SEED, role credentials (committed)
├── .env                          # created by init-env from .env.example (gitignored)
├── .gitignore                    # .auth/, test-results/, playwright-report/, .env
├── eslint.config.mjs             # with eslint-plugin-playwright
├── pw-setup.json                 # setup manifest, read by the check
├── specs/
│   ├── auth.setup.ts             # logs in once per role, writes storageState
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
└── .auth/                        # gitignored storageState files

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
| **pw-auth** | "login once", "storageState", "multiple roles" | Setup project plus `storageState`, one state file per role, logging in through the API vs the UI, refreshing expired sessions, keeping `.auth/` out of git, test-scoped login for auth tests themselves |
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
| Auth works | `npx playwright test --project=setup` writes `.auth/<role>.json` |
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
| 1. Working project | `plugin.json`, `pw-setup`, `pw-core-config`, `pw-page-objects`, `pw-locators`, `detect_env`, `scaffold`, `init_env`, `check_setup` levels 1–2, and the config, page, fixture, spec and `.env.example` templates |
| 2. Data and auth | `pw-test-data` (faker and builders), `pw-auth`, `auth.setup.ts`, `utils/env.ts`, check level 3 (`--run`, `--smoke`, env values filled) |
| 3. Quality and CI | `pw-artifacts`, `pw-best-practices`, `gen_page_object`, the GitHub workflow template, README and CHANGELOG |

Each phase ends with a test scaffold into a temporary folder and a
`pw-check --run` against it.

## Release

1. Add `plugins/pw-setup-agent` at **0.1.0**.
2. Add its entry to `.claude-plugin/marketplace.json` and bump the marketplace
   `metadata.version` to **0.4.0**.
3. Update the root README's plugin list and the pinning example (`@v0.4.0`).
4. Commit to `main` and push.
