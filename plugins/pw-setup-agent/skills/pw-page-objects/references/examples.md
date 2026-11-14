# Worked example: a Settings page

A settings page with a profile form, a shared navigation bar and a save
confirmation.

## pages/components/nav.component.ts

```ts
import type { Locator, Page } from '@playwright/test';

export class NavComponent {
  readonly root: Locator;
  readonly settingsLink: Locator;
  readonly signOutButton: Locator;

  constructor(page: Page) {
    this.root = page.getByRole('navigation', { name: 'Main' });
    this.settingsLink = this.root.getByRole('link', { name: 'Settings' });
    this.signOutButton = this.root.getByRole('button', { name: 'Sign out' });
  }

  async openSettings(): Promise<void> {
    await this.settingsLink.click();
  }
}
```

## pages/settings.page.ts

```ts
import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page';
import { NavComponent } from './components/nav.component';

export interface Profile {
  displayName: string;
  timezone: string;
}

export class SettingsPage extends BasePage {
  readonly path = '/settings';

  readonly nav: NavComponent;
  readonly heading: Locator;
  readonly displayNameInput: Locator;
  readonly timezoneSelect: Locator;
  readonly saveButton: Locator;
  readonly savedMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.nav = new NavComponent(page);
    this.heading = page.getByRole('heading', { name: 'Settings', level: 1 });
    this.displayNameInput = page.getByLabel('Display name');
    this.timezoneSelect = page.getByLabel('Time zone');
    this.saveButton = page.getByRole('button', { name: 'Save changes' });
    this.savedMessage = page.getByRole('status');
  }

  async waitForReady(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async updateProfile({ displayName, timezone }: Profile): Promise<void> {
    await this.displayNameInput.fill(displayName);
    await this.timezoneSelect.selectOption(timezone);
    await this.saveButton.click();
  }
}
```

## fixtures/pages.fixture.ts (added lines)

```ts
import { SettingsPage } from '@pages/settings.page';

type Pages = {
  // ...existing pages
  settingsPage: SettingsPage;
};

export const test = base.extend<Pages>({
  // ...existing fixtures
  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
});
```

## specs/settings/settings.spec.ts

```ts
import { test, expect } from '@fixtures';

test.describe('Settings', () => {
  test.beforeEach(async ({ settingsPage }) => {
    await settingsPage.goto();
  });

  test('saves a new display name', { tag: '@smoke' }, async ({ settingsPage }) => {
    await settingsPage.updateProfile({ displayName: 'QA Tester', timezone: 'UTC' });

    await expect(settingsPage.savedMessage).toHaveText('Settings saved');
    await expect(settingsPage.displayNameInput).toHaveValue('QA Tester');
  });

  test('keeps the save button disabled until something changes', async ({ settingsPage }) => {
    await expect(settingsPage.saveButton).toBeDisabled();
  });
});
```

## What not to write

```ts
// ❌ Assertion about behaviour inside the page object
async updateProfile(profile: Profile) {
  // ...
  await expect(this.savedMessage).toHaveText('Settings saved');
}

// ❌ Spec creates the page itself and imports from @playwright/test
import { test } from '@playwright/test';
test('...', async ({ page }) => {
  const settings = new SettingsPage(page);
});

// ❌ Boolean helper that hides the assertion
async isSaved(): Promise<boolean> {
  return this.savedMessage.isVisible();
}
// spec: expect(await settingsPage.isSaved()).toBe(true);  // no retry, flaky
```
