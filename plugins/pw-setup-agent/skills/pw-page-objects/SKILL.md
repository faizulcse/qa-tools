---
name: pw-page-objects
description: >
  This skill should be used when the user wants to add or change a page object
  or a spec in a Playwright project - "create a page object", "add a page",
  "add a component", "write a spec for this page", "add a test for this
  feature", "register a fixture", "refactor this test to use page objects",
  or when a pw-check finding points at pages, fixtures or specs. Defines how
  page objects, components, fixtures and specs are written in the
  pw-setup-agent project.
metadata:
  version: "0.1.0"
---

# Page Objects, Components, Fixtures and Specs

A page object describes **what is on a page and what a user can do there**. A
spec describes **what should happen**. Keep those apart and specs read like
test cases, while locator changes stay in one file.

`references/examples.md` has a full worked example (page, component, fixture,
spec) to copy from.

## Where things go

| What | Where | Name |
|---|---|---|
| Page object | `pages/` | `settings.page.ts` → `class SettingsPage extends BasePage` |
| Component (shared UI) | `pages/components/` | `nav.component.ts` → `class NavComponent` |
| Fixture registration | `fixtures/pages.fixture.ts` | `settingsPage` |
| Spec | `specs/<feature>/` | `settings.spec.ts` |

## Page object rules

1. **Extend `BasePage`** and set `readonly path` (relative to `baseURL`).
2. **Implement `waitForReady()`** with one assertion on an element that only
   this page has. It is the only place a page object may use `expect`.
3. **Locators are `readonly` fields** assigned in the constructor, chosen by the
   `pw-locators` priority (role, label, text, test id).
4. **Methods are user actions**, named in the user's words: `login()`,
   `addToCart()`, `search()`. They return `Promise<void>` or a value the spec
   asserts on; never a boolean that hides an assertion.
5. **No assertions about behaviour.** `expect(...)` belongs in the spec.
6. **No test data and no credentials.** Methods take data as arguments; specs
   get it from `test-data/`.
7. **One page object per page.** Repeated UI (header, nav, table, modal) becomes
   a component used by several pages.

## Component rules

- Take a `Page` (or a parent `Locator`) and scope every locator to a `root`
  locator, so the same component works wherever it appears.
- No `expect` at all.
- Expose it as a field on each page that shows it: `readonly header: HeaderComponent`.

## Register every page as a fixture

In `fixtures/pages.fixture.ts`, add the type and the fixture:

```ts
type Pages = {
  homePage: HomePage;
  loginPage: LoginPage;
  settingsPage: SettingsPage;
};

export const test = base.extend<Pages>({
  // ...
  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
});
```

pw-check fails if a page object is not created in `fixtures/`, or if a spec
creates one with `new`.

## Spec rules

- `import { test, expect } from '@fixtures';` - never from `@playwright/test`.
- Ask for pages by name in the test arguments: `async ({ settingsPage }) => {}`.
- Test names say the expected behaviour: `'shows an error for a wrong password'`,
  not `'test login 2'`.
- Arrange, act, assert, separated by blank lines. One behaviour per test.
- Assert with web-first assertions: `await expect(locator).toBeVisible()`,
  `toHaveText()`, `toHaveURL()`. Never `expect(await locator.isVisible()).toBe(true)`.
- Tests are independent: no order dependencies, no shared state between tests.
  Use `test.beforeEach` for shared navigation.
- Tag fast, critical tests `{ tag: '@smoke' }`; `npm run test:smoke` runs them.
- Credentials come from `test-data/users.ts` (`users.admin()`), never literals.

## After adding a page or spec

```bash
npm run typecheck && npm run lint && npm run check
npx playwright test specs/<feature> --project=chromium
```
