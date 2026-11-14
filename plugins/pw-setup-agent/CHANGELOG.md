# Changelog

## 0.1.0 - 2026-11-14

First release (Phase 1 of the plan in `docs/plans/pw-setup-agent.md`).

- Skills: `pw-setup`, `pw-check`, `pw-core-config`, `pw-locators`, `pw-page-objects`.
- Scripts: `detect_env.mjs`, `scaffold.mjs` (dry run by default, `--write` to
  create files), `init_env.mjs` (creates `.env` from `.env.example`, never
  overwrites without `--force`), `check_setup.mjs` (structure and convention checks).
- Project templates: Playwright config, strict TypeScript with path aliases,
  ESLint with `eslint-plugin-playwright`, page objects, fixtures, typed test
  data, and `@smoke` home and login specs.
