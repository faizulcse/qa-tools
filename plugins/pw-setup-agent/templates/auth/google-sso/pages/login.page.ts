import { expect, type Locator, type Page } from '@playwright/test';
import { LOGIN_PATH } from '@utils/auth';
import { GoogleSignInComponent } from './components/google-sign-in.component';
import { BasePage } from './base.page';

/**
 * The application's sign-in screen, where the only option is
 * "Sign in with Google". Adjust the heading and button name if yours differ.
 *
 * If the button is Google's own rendered button (an iframe from
 * accounts.google.com/gsi), locate it with
 * page.frameLocator('iframe[src*="accounts.google.com/gsi"]').getByRole('button').
 */
export class LoginPage extends BasePage {
  readonly path = LOGIN_PATH;

  readonly heading: Locator;
  readonly googleButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading').first();
    this.googleButton = page.getByRole('button', { name: /sign in with google/i });
  }

  async waitForReady(): Promise<void> {
    await expect(this.googleButton).toBeVisible();
  }

  /** Clicks "Sign in with Google" and returns the Google popup. */
  async openGoogleSignIn(): Promise<GoogleSignInComponent> {
    const popup = this.page.waitForEvent('popup');
    await this.googleButton.click();
    return new GoogleSignInComponent(await popup);
  }
}
