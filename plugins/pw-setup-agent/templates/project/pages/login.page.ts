import { expect, type Locator, type Page } from '@playwright/test';
import type { Credentials } from '@data/types';
import { BasePage } from './base.page';

/**
 * Example page object. Adjust the path, labels and button name to match
 * your application's login page.
 */
export class LoginPage extends BasePage {
  readonly path = '/login';

  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.getByLabel('Username');
    this.passwordInput = page.getByLabel('Password');
    this.signInButton = page.getByRole('button', { name: 'Sign in' });
    this.errorMessage = page.getByRole('alert');
  }

  async waitForReady(): Promise<void> {
    await expect(this.signInButton).toBeVisible();
  }

  async login({ username, password }: Credentials): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }
}
