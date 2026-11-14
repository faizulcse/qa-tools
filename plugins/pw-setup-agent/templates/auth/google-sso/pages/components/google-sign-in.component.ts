import type { Locator, Page } from '@playwright/test';

/**
 * The "Sign in with Google" popup (Google Identity Services), as the specs
 * see it. Signing in itself happens by hand through utils/login-cli.mjs;
 * this component only exposes the popup so specs can check it opens.
 *
 * No assertions here (component rule).
 */
export class GoogleSignInComponent {
  readonly emailInput: Locator;
  /** Shown when Google refuses the browser. Matches several nodes, hence first(). */
  readonly blockedMessage: Locator;

  constructor(readonly popup: Page) {
    this.emailInput = popup.getByRole('textbox', { name: /email or phone/i });
    this.blockedMessage = popup.getByText(/browser or app may not be secure/i).first();
  }
}
