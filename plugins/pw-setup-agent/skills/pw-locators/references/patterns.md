# Locator patterns for hard cases

## Tables

```ts
const table = page.getByRole('table', { name: 'Invoices' });
const row = table.getByRole('row').filter({ hasText: 'INV-1042' });

await row.getByRole('button', { name: 'Edit' }).click();
await expect(row.getByRole('cell').nth(3)).toHaveText('Paid'); // column order is the point here

// Row count (header row included)
await expect(table.getByRole('row')).toHaveCount(11);
```

If cells have no accessible structure (`div` grids), ask for `role="grid"` /
`role="row"` or `data-testid` on rows.

## Lists and cards

```ts
const plans = page.getByRole('list', { name: 'Plans' }).getByRole('listitem');
const pro = plans.filter({ has: page.getByRole('heading', { name: 'Pro' }) });
await pro.getByRole('button', { name: 'Choose' }).click();

await expect(plans).toHaveCount(3);
await expect(plans).toHaveText(['Free', 'Pro', 'Team'], { useInnerText: true }); // order matters here
```

## Dialogs and menus

```ts
const dialog = page.getByRole('dialog', { name: 'Delete project' });
await expect(dialog).toBeVisible();
await dialog.getByRole('button', { name: 'Delete' }).click();
await expect(dialog).toBeHidden();

await page.getByRole('button', { name: 'More actions' }).click();
await page.getByRole('menuitem', { name: 'Duplicate' }).click();
```

Native browser dialogs (`alert`, `confirm`) are not elements:

```ts
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'Reset' }).click();
```

## Form controls

```ts
await page.getByLabel('Country').selectOption('Bangladesh');           // <select>
await page.getByRole('checkbox', { name: 'I agree' }).check();
await page.getByRole('radio', { name: 'Monthly' }).check();
await page.getByLabel('Upload invoice').setInputFiles('test-data/files/invoice.pdf');

// Custom combobox
await page.getByRole('combobox', { name: 'Assignee' }).click();
await page.getByRole('option', { name: 'Jane Doe' }).click();
```

## Iframes

```ts
const payment = page.frameLocator('iframe[title="Secure payment"]');
await payment.getByLabel('Card number').fill('4242 4242 4242 4242');
```

Prefer selecting the iframe by `title` or `name`; that CSS is acceptable.

## Shadow DOM

`getBy*` and CSS locators pierce open shadow roots automatically. No special
syntax is needed. Closed shadow roots cannot be reached; ask for test hooks.

## Dynamic text and numbers

```ts
await expect(page.getByRole('status')).toHaveText(/Saved at \d{2}:\d{2}/);
await expect(page.getByTestId('cart-count')).toHaveText('3');
page.getByRole('button', { name: /^Delete / }); // name starts with "Delete "
```

## Elements that appear later or disappear

```ts
await expect(page.getByRole('progressbar')).toBeHidden();      // spinner gone
await expect(page.getByRole('alert')).toContainText('Invalid'); // toast shown

// Optional element (cookie banner): check, don't fail
const banner = page.getByRole('dialog', { name: 'Cookies' });
if (await banner.isVisible()) await banner.getByRole('button', { name: 'Accept' }).click();
```

For a banner that appears at random times, register a handler once per test
instead: `page.addLocatorHandler(banner, () => banner.getByRole('button', { name: 'Accept' }).click())`.

## Text vs. role

`getByText('Save')` matches any element with that text, including a heading or
a hidden tooltip. For anything clickable, use `getByRole` with the name.
