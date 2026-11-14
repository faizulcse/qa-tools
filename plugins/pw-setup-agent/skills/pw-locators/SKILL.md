---
name: pw-locators
description: >
  This skill should be used when the user needs to choose or fix a Playwright
  locator - "which locator should I use", "fix this flaky selector", "the test
  can't find the element", "strict mode violation", "replace XPath", "add a
  data-testid", "locator for a table row", "wait for an element", or when
  adapting example page objects to a real application, or when a pw-check
  finding mentions XPath, element handles, CSS locators or waits. Gives the
  locator priority order, patterns for hard cases and how to wait correctly.
metadata:
  version: "0.1.0"
---

# Locator Strategy

Choose locators the way a user finds things on the page: by role and name,
by label, by visible text. These survive layout and styling changes. CSS
classes and XPath break when the markup changes, even if the user sees no
difference.

`references/patterns.md` has patterns for tables, lists, dialogs, iframes,
shadow DOM and dynamic content.

## Priority order

Use the first one that identifies the element uniquely:

| # | Locator | Use for | Example |
|---|---|---|---|
| 1 | `getByRole(role, { name })` | Buttons, links, headings, checkboxes, menus, dialogs, rows | `page.getByRole('button', { name: 'Save' })` |
| 2 | `getByLabel(text)` | Form fields with a `<label>` or `aria-label` | `page.getByLabel('Email')` |
| 3 | `getByPlaceholder(text)` | Fields with no label (ask the developers to add one) | `page.getByPlaceholder('Search')` |
| 4 | `getByText(text)` | Non-interactive text: messages, paragraphs | `page.getByText('No results found')` |
| 5 | `getByAltText` / `getByTitle` | Images, icons with a title | `page.getByAltText('Company logo')` |
| 6 | `getByTestId(id)` | When nothing above is stable or unique | `page.getByTestId('order-total')` |
| 7 | `locator(css)` | Last resort; explain why in a comment | `page.locator('[data-state="open"]')` |
| ✗ | XPath, `page.$`, `nth-child` chains | Never | pw-check fails on XPath and `page.$` |

The project sets `testIdAttribute: 'data-testid'`. If the app uses another
attribute, change it in `playwright.config.ts` instead of using CSS.

## Find the right locator on a live page

Ask the user for the page URL, then look at the accessibility tree instead of
the HTML:

- **playwright-cli** (if installed): `playwright-cli open <url>` then
  `playwright-cli snapshot`. The snapshot lists roles and accessible names,
  which map directly to `getByRole`.
- **Codegen:** `cd tests && npx playwright codegen <url>`. Click the element;
  Codegen suggests a role-based locator. Review it against the priority
  table, do not paste it blindly.
- **Check uniqueness** before writing it into a page object:
  `await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(1)`.

## Making a locator unique

When a locator matches several elements (a "strict mode violation"), narrow it
by its context. Do not use `.first()` or `.nth()` unless the order is what the
test is about.

```ts
// Scope to a region
page.getByRole('dialog', { name: 'Delete item' }).getByRole('button', { name: 'Delete' });

// Filter by content
page.getByRole('row').filter({ hasText: 'INV-1042' }).getByRole('button', { name: 'Edit' });

// Filter by a child element
page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Pro plan' }) });

// Exact name when one name contains another ("Save" vs "Save as draft")
page.getByRole('button', { name: 'Save', exact: true });
```

## Waiting

Playwright waits automatically before actions (`click`, `fill`) and retries
web-first assertions. Almost every explicit wait is unnecessary.

| Instead of | Use |
|---|---|
| `page.waitForTimeout(2000)` | `await expect(locator).toBeVisible()` (pw-check fails on `waitForTimeout`) |
| `page.waitForSelector('.spinner', { state: 'hidden' })` | `await expect(spinner).toBeHidden()` |
| `waitForLoadState('networkidle')` | An assertion on what the user waits for: `await expect(table).toContainText('INV-1042')` |
| `expect(await locator.isVisible()).toBe(true)` | `await expect(locator).toBeVisible()` (retries; the first does not) |
| `expect(await locator.textContent()).toBe('x')` | `await expect(locator).toHaveText('x')` |

To wait for a network response, wait for it alongside the action:

```ts
const saved = page.waitForResponse((r) => r.url().includes('/api/profile') && r.ok());
await settingsPage.saveButton.click();
await saved;
```

## Where locators live

- In page objects and components, as `readonly` fields. Specs use those fields
  (`loginPage.signInButton`) and rarely build their own.
- Scope component locators to the component's `root`.
- If a stable locator is impossible without changing the app, ask the
  developers for a `data-testid` or a proper label, and note the request in a
  comment next to the temporary CSS locator.
