import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page';
import { HeaderComponent } from './components/header.component';

/**
 * Example page object that uses a shared component. Adjust the path and the
 * ready check to match your application's home page.
 */
export class HomePage extends BasePage {
  readonly path = '/';

  readonly header: HeaderComponent;
  readonly main: Locator;

  constructor(page: Page) {
    super(page);
    this.header = new HeaderComponent(page);
    this.main = page.getByRole('main');
  }

  async waitForReady(): Promise<void> {
    await expect(this.main).toBeVisible();
  }
}
