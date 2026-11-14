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

The project's runtime settings live in two files: `tests/playwright.config.ts`
and `tests/tsconfig.json`. Environment values come from `tests/utils/env.ts`,
the one place that reads `process.env`.

Before changing anything, read the current `playwright.config.ts`. After
changing it, run `npx playwright test --list` and `npm run check`.

## The settings and why

| Setting | Value | Why |
|---|---|---|
| `testDir` | `./specs` | Only specs are collected; pages and fixtures are never run as tests. pw-check requires it. |
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
and run `npm run env:init -- --sync` to add it to your `.env`. pw-check fails
if the code reads a variable that `.env.example` does not list.

**A slow test.** Use `test.slow()` or `test.setTimeout(60_000)` in that test.
Do not raise the global timeout for one test.

**A new path alias.** Add it to `compilerOptions.paths` in `tsconfig.json`
(`"@api/*": ["./api/*"]`). Playwright reads tsconfig paths, so no other change
is needed.

## tsconfig.json

- `strict: true` is required by pw-check.
- `types: ["node"]` is needed because TypeScript 6 no longer includes all
  `@types` packages automatically.
- `typescript` is pinned to 6.0.x because `typescript-eslint` does not yet
  support TypeScript 7. Upgrade both together.

## Do not

- Hard-code URLs, credentials or environment names in the config.
- Set `trace: 'on'` or `video: 'on'` for normal runs; reports get large and
  slow. Turn them on for a single debug run with `--trace on`.
- Use `globalSetup` for login. Authentication uses a setup project and saved
  storage state (covered by the `pw-auth` skill in a later version).
