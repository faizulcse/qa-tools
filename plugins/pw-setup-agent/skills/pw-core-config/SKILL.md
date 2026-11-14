---
name: pw-core-config
description: >
  This skill should be used when the user wants to change how Playwright runs -
  "configure playwright.config", "add a browser", "add a project", "run against
  staging", "change the timeout", "set retries", "run in parallel", "add a
  reporter", "set the base URL", "add mobile testing", "add a path alias", or
  when a pw-check finding points at the config or tsconfig. Explains each
  setting in the pw-setup-agent playwright.config.ts and tsconfig.json and how
  to change it safely.
metadata:
  version: "0.1.0"
---

# Playwright Core Configuration

The project's runtime settings live at the repository root in the Playwright
config and `tsconfig.json`. `pw-setup.json` names them under `configs`: the
config may be the app's own (`playwright.config.js`, with its own `testDir`
such as `./e2e`), and the tsconfig may be the app's, amended with the test
aliases. Environment values come from `utils/env.ts`, the one place that reads
`process.env`. Env keys may carry a prefix (`E2E_BASE_URL`), listed under
`env.prefix`.

When the config or tsconfig was the app's before setup (listed under
`adopted`), change only what the request needs and keep the app's other
settings. In an app on `nodenext` resolution or a target older than ES2017,
the tests have `tsconfig.e2e.json` (extends the app's) and the config has
`tsconfig: './tsconfig.e2e.json'`; put test aliases there.

Before changing anything, read the current `playwright.config.ts`. After
changing it, run `npx playwright test --list` and the `check` script
(`pw:check` in merged mode).

## The settings and why

| Setting | Value | Why |
|---|---|---|
| `testDir` | `./specs` (or the adopted config's, e.g. `./e2e`) | Only specs are collected; pages and fixtures are never run as tests. pw-check requires it to match `folders.specs`. |
| `outputDir` | `./test-results` | Traces, screenshots and videos for failed tests. Gitignored. |
| `fullyParallel` | `true` | Tests in one file run in parallel too. Requires independent tests. |
| `forbidOnly` | `env.isCI` | A forgotten `.only` fails CI instead of silently skipping the rest. |
| `retries` | `2` on CI, `0` locally | Retries hide flakiness locally; on CI they give a trace on the first retry. |
| `workers` | `2` on CI, default locally | CI runners are small. Raise it once the suite is stable. |
| `timeout` | `30_000` | Per test. Raise per test with `test.setTimeout()` instead of globally. |
| `expect.timeout` | `5_000` | How long web-first assertions retry. |
| `reporter` | `list` + `html` locally; `blob` + `github` on CI | Blob reports merge across shards; `github` annotates the PR. |
| `use.baseURL` | `env.baseUrl` | Specs and page objects use relative paths, so one suite runs against any environment. Never hard-code it. |
| `use.testIdAttribute` | `data-testid` | Change it if the app uses another attribute, e.g. `data-test`. |
| `use.trace` | `on-first-retry` | Full trace only when a test failed once. |
| `use.screenshot` | `only-on-failure` | |
| `use.video` | `retain-on-failure` | |
| `actionTimeout` / `navigationTimeout` | `10_000` / `15_000` | Fail fast on a missing element instead of using the whole test timeout. |

## Common changes

**Run against another environment.** Do not add config branches. Change
`BASE_URL` in `.env` (or set it in the shell: `BASE_URL=https://staging.example.com npx playwright test`).
`TEST_ENV` is a label shown in the report metadata.

**Add a browser or device.** Add a project:

```ts
{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
```

Then install the browser (`npx playwright install webkit`). Run one project
with `--project=webkit`.

**A new environment variable.** Read it in `utils/env.ts` with `requireEnv`
(must be set) or `optionalEnv` (has a default), add the key to `.env.example`,
and run the `env:init` script with `--sync` (`npm run env:init -- --sync`, or
`pw:env:init` in merged mode) to add it to your `.env`. Use the project's env
prefix, if it has one. pw-check fails
if the code reads a variable that `.env.example` does not list.

**A slow test.** Use `test.slow()` or `test.setTimeout(60_000)` in that test.
Do not raise the global timeout for one test.

**A new path alias.** Add it to `compilerOptions.paths` in `tsconfig.json`
(or `tsconfig.e2e.json` where the project has one): `"@api/*": ["./api/*"]`,
relative to `baseUrl` if the tsconfig sets one. Playwright reads tsconfig
paths, so no other change is needed.

## tsconfig.json (or tsconfig.e2e.json)

- `strict: true` is required by pw-check (a warning only when the tsconfig is
  the app's own).
- `types: ["node"]` is needed because TypeScript 6 no longer includes all
  `@types` packages automatically.
- `typescript` is pinned to 6.0.x because `typescript-eslint` does not yet
  support TypeScript 7. Upgrade both together.

## Do not

- Hard-code URLs, credentials or environment names in the config.
- Set `trace: 'on'` or `video: 'on'` for normal runs; reports get large and
  slow. Turn them on for a single debug run with `--trace on`.
- Use `globalSetup` for login. Authentication uses a setup project and saved
  storage state (see below; the username/password version comes with the
  `pw-auth` skill in a later version).

## Google sign-in projects (`auth.mode: google-sso` in pw-setup.json)

```ts
projects: [
  { name: 'setup', testMatch: /.*\.setup\.ts/, timeout: 5 * 60_000 },
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], channel: env.browserChannel || undefined, storageState: storageStatePath('admin') },
    dependencies: ['setup'],
  },
],
```

- `setup` runs `<specs>/auth/auth.setup.ts` once before the browser projects. It
  gets 5 minutes because the first sign-in may wait for the user.
- Every browser project needs `dependencies: ['setup']` and a `storageState`.
  Add both when you add a browser. To run a project as another role, point
  its `storageState` at that role's file.
- `channel` comes from `AUTH_BROWSER_CHANNEL` (e.g. `chrome`); empty uses
  bundled Chromium. It only changes the browser the **tests** run in. Sign-in
  always happens in real Chrome over CDP, because Google blocks browsers
  Playwright launches; no channel or flag changes that.
- Session reuse is set in `.env`: `AUTH_MAX_AGE_MINUTES` (default 60) and
  `FORCE_LOGIN=1`. Don't raise the age past what the app's own session
  allows.
