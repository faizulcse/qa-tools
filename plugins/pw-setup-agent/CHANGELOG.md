# Changelog

## 0.2.0 - unreleased

The project is now created at the **repository root** by default.

- **Three modes**, recorded in `pw-setup.json`: *standalone* (root without a
  `package.json`), *merged* (root with the app's `package.json`) and
  *subfolder* (`--root tests`, the 0.1.0 layout).
- **Merged mode** adds to the app's files and never replaces them:
  - `package.json` gets `pw:`-prefixed scripts (`pw:test`, `pw:lint`,
    `pw:check`...) and missing dev dependencies; app scripts and dependency
    versions are kept.
  - `.gitignore` and `.env.example` get a `# Playwright (pw-setup-agent)` block
    with only the missing entries; `.env` only gets missing keys.
  - Installs use the repo's package manager (npm, pnpm, yarn or bun).
- **New scaffold flags:** `--split-configs` writes `tsconfig.e2e.json` and
  `eslint.e2e.config.mjs` when the app has its own configs (and points
  `playwright.config.ts` at the tsconfig); `--env-prefix E2E_` or
  `--reuse-env-keys` settle a `BASE_URL` the app already uses.
- **Blockers and decisions:** the dry run marks merges `~` and open questions
  `?`; `--write` refuses until they are settled. The root is refused for an
  existing Playwright setup, Next.js/Nuxt apps (root `pages/` is routed) and
  project folders that already hold files.
- **Re-runs:** a project with `pw-setup.json` is reported once ("run pw-check
  instead"); `--force` refreshes pw-setup's own files and keeps the env prefix
  and config split from the manifest.
- `detect_env`, `init_env` and `check_setup` default to `--root .`.
  `check_setup` reads the manifest for the tsconfig name, script names and
  package manager, and checks the `tsconfig` line in split mode. `init_env`
  applies the env prefix to `--base-url`.
- Templates: root-anchored `.gitignore` entries; the tsconfig includes only
  the test folders; `utils/env.ts` also works when the package is an ES module.
- Skills and README updated for the root layout; `pw-setup` gains the mode
  step, the decision questions and an optional step to exclude the test
  folders from the app's own configs.

### Google sign-in (`--auth google-sso`)

For apps whose only login is "Sign in with Google". Google blocks sign-in in
browsers Playwright launches, so sign-in happens in real Chrome that
Playwright connects to over CDP, and the tests load the saved session.

- `specs/auth/auth.setup.ts` (project `setup`, every browser project depends
  on it): reuses `.auth/<role>.json` while it is under
  `AUTH_MAX_AGE_MINUTES` (60) old and the app's who-am-I endpoint returns 200;
  otherwise opens Chrome on `.auth/chrome-profile/<role>/`, tries the account
  from `.env`, and waits up to 4 minutes for the user to finish by hand. On CI
  it fails with advice instead of opening Chrome.
- `utils/chrome-profile.ts`: starts Chrome as a child process on the profile,
  connects over CDP, quits it gracefully (so the profile lock is released),
  and ignores stale profile locks.
- `pages/components/google-sign-in.component.ts`: handles Google's screens in
  any order: account chooser or email box, password, 2-Step code, consent;
  clear error on "This browser or app may not be secure".
- Google versions of the login and home pages and specs (signed out: sign-in
  screen, popup to accounts.google.com, who-am-I 401; signed in: app loads,
  who-am-I 200).
- Scripts `login`, `login:force` and `login:chrome` (manual fallback,
  `utils/login-chrome.mjs`).
- New env keys: `<ROLE>`, `<ROLE>_PASSWORD`, `OTP`, `AUTH_MAX_AGE_MINUTES`,
  `FORCE_LOGIN`, `CHROME_PATH`, `AUTH_BROWSER_CHANNEL`.
- Scaffold flags `--auth google-sso`, `--me-endpoint` and `--login-path`;
  `pw-setup` checks the login page and finds the who-am-I endpoint.

### Both sign-in modes

- `BASE_URL` may contain `{ENVIRONMENT}`, filled from the new `ENVIRONMENT`
  key.
- ESLint turns off `playwright/no-conditional-in-test` for
  `specs/**/*.setup.ts`.
- pw-check no longer asks for OS and npm variables (`ProgramFiles`,
  `npm_lifecycle_event`) in `.env.example`.

## 0.1.0 - 2026-11-14

First release (Phase 1 of the plan in `docs/plans/pw-setup-agent.md`).

- Skills: `pw-setup`, `pw-check`, `pw-core-config`, `pw-locators`, `pw-page-objects`.
- Scripts: `detect_env.mjs`, `scaffold.mjs` (dry run by default, `--write` to
  create files), `init_env.mjs` (creates `.env` from `.env.example`, never
  overwrites without `--force`), `check_setup.mjs` (structure and convention checks).
- Project templates: Playwright config, strict TypeScript with path aliases,
  ESLint with `eslint-plugin-playwright`, page objects, fixtures, typed test
  data, and `@smoke` home and login specs.
