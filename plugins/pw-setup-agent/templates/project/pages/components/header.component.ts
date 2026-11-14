import type { Locator, Page } from '@playwright/test';

/**
 * A part of the UI shared by several pages. Components scope their locators
 * to a root element, so the same component works wherever it appears.
 */
export class HeaderComponent {
  readonly root: Locator;
  readonly accountMenu: Locator;
  readonly signOutItem: Locator;

  constructor(page: Page) {
    this.root = page.getByRole('banner');
    this.accountMenu = this.root.getByRole('button', { name: /account/i });
    this.signOutItem = page.getByRole('menuitem', { name: 'Sign out' });
  }

  async signOut(): Promise<void> {
    await this.accountMenu.click();
    await this.signOutItem.click();
  }
}
