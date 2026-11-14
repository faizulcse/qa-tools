import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page';
import { HeaderComponent } from './components/header.component';

/**
 * The first screen after signing in. Adjust the path and the ready check to
 * match your application.
 */
export class HomePage extends BasePage {
  readonly path = '/';

  readonly header: HeaderComponent;
  readonly main: Locator;
  readonly loadingText: Locator;
  readonly googleButton: Locator;

  constructor(page: Page) {
    super(page);
    this.header = new HeaderComponent(page);
    this.main = page.getByRole('main');
    this.loadingText = page.getByText(/loading/i).first();
    this.googleButton = page.getByRole('button', { name: /sign in with google/i });
  }

  async waitForReady(): Promise<void> {
    await expect(this.main).toBeVisible();
    await expect(this.loadingText).toBeHidden();
    await expect(this.googleButton).toBeHidden();
  }
}
