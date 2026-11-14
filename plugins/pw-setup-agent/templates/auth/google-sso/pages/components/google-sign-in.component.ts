import type { Locator, Page } from '@playwright/test';
import type { GoogleAccount } from '@data/types';

const SCREEN_TIMEOUT_MS = 60_000;
const MAX_STEPS = 10;

type Screen = 'closed' | 'blocked' | 'account' | 'useAnother' | 'email' | 'password' | 'code' | 'consent';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first promise to fulfil; rejects only when all reject (Promise.any, without needing ES2021). */
function firstFulfilled<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let pending = promises.length;
    for (const p of promises) {
      p.then(resolve, () => {
        if (--pending === 0) reject(new Error('none fulfilled'));
      });
    }
  });
}

/**
 * The "Sign in with Google" popup (Google Identity Services).
 *
 * Google's screens vary: account chooser or email box, password, a 2-Step
 * code, a consent "Continue". signIn() handles whichever appears, in any
 * order, until the popup closes. It is best-effort: callers must let the user
 * finish by hand when it throws.
 *
 * No assertions here (component rule): it only waits for elements.
 */
export class GoogleSignInComponent {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly codeInput: Locator;
  readonly nextButton: Locator;
  readonly consentButton: Locator;
  readonly useAnotherAccount: Locator;
  /** Shown when Google refuses the browser. Matches several nodes, hence first(). */
  readonly blockedMessage: Locator;

  constructor(readonly popup: Page) {
    this.emailInput = popup.getByRole('textbox', { name: /email or phone/i });
    this.passwordInput = popup.getByLabel(/enter your password/i);
    this.codeInput = popup.getByRole('textbox', { name: /code|otp|pin/i });
    this.nextButton = popup.getByRole('button', { name: /^next$/i });
    this.consentButton = popup.getByRole('button', { name: /^(continue|allow)$/i });
    this.useAnotherAccount = popup.getByRole('link', { name: /use another account/i });
    this.blockedMessage = popup.getByText(/browser or app may not be secure/i).first();
  }

  /** The account-chooser entry for this email. */
  accountEntry(email: string): Locator {
    return this.popup.getByRole('link', { name: new RegExp(escapeRegex(email), 'i') }).first();
  }

  /** Signs in as `account`, handling Google's screens until the popup closes. */
  async signIn(account: GoogleAccount): Promise<void> {
    const closed = this.popup.isClosed()
      ? Promise.resolve<Screen>('closed')
      : this.popup.waitForEvent('close', { timeout: 0 }).then((): Screen => 'closed');

    for (let step = 0; step < MAX_STEPS; step++) {
      const screen = await Promise.race([closed, this.nextScreen(account)]);
      const url = screen === 'closed' ? '' : this.popup.url();
      switch (screen) {
        case 'closed':
          return;
        case 'blocked':
          throw new Error(
            'Google blocked the sign-in: "This browser or app may not be secure". ' +
              'Sign in through the Chrome window opened from the setup step (npm run login), not a Playwright-launched browser.',
          );
        case 'account':
          await this.accountEntry(account.email).click();
          await this.gone(this.accountEntry(account.email), url);
          break;
        case 'useAnother':
          await this.useAnotherAccount.click();
          await this.gone(this.useAnotherAccount, url);
          break;
        case 'email':
          await this.emailInput.fill(account.email);
          await this.nextButton.click();
          await this.gone(this.emailInput, url);
          break;
        case 'password':
          if (!account.password) throw new Error('No password set for this account.');
          await this.passwordInput.fill(account.password);
          await this.nextButton.click();
          await this.gone(this.passwordInput, url);
          break;
        case 'code':
          if (!account.otp) throw new Error('Google asked for a verification code and OTP is not set.');
          await this.codeInput.fill(account.otp);
          await this.nextButton.click();
          await this.gone(this.codeInput, url);
          break;
        case 'consent':
          await this.consentButton.click();
          await this.gone(this.consentButton, url);
          break;
      }
    }
    throw new Error(`Google sign-in did not finish within ${MAX_STEPS} screens.`);
  }

  /** Waits for the first known screen to appear. */
  private async nextScreen(account: GoogleAccount): Promise<Screen> {
    const visible = (locator: Locator, screen: Screen) =>
      locator.waitFor({ state: 'visible', timeout: SCREEN_TIMEOUT_MS }).then(() => screen);

    const candidates: Promise<Screen>[] = [
      visible(this.blockedMessage, 'blocked'),
      visible(this.emailInput, 'email'),
      visible(this.passwordInput, 'password'),
      visible(this.codeInput, 'code'),
      visible(this.consentButton, 'consent'),
    ];
    if (account.email) {
      // Account chooser: our account is listed, or only others are.
      candidates.push(visible(this.accountEntry(account.email), 'account'));
      candidates.push(
        visible(this.useAnotherAccount, 'useAnother').then(async (screen) =>
          (await this.accountEntry(account.email).isVisible()) ? 'account' : screen,
        ),
      );
    }
    let screen: Screen;
    try {
      screen = await firstFulfilled(candidates);
    } catch {
      throw new Error(`No known Google sign-in screen appeared within ${SCREEN_TIMEOUT_MS / 1000}s.`);
    }
    // Later screens can still show the email as a link; an input on screen wins.
    if (screen === 'account' || screen === 'useAnother') {
      if (await this.passwordInput.isVisible()) return 'password';
      if (await this.codeInput.isVisible()) return 'code';
      if (await this.emailInput.isVisible()) return 'email';
    }
    return screen;
  }

  /**
   * Waits until the screen has moved on (its element is gone or the URL
   * changed), so the next loop sees the next screen.
   */
  private async gone(locator: Locator, urlBefore: string): Promise<void> {
    await Promise.race([
      locator.waitFor({ state: 'hidden', timeout: 15_000 }),
      this.popup.waitForURL((url) => url.toString() !== urlBefore, { timeout: 15_000 }),
    ]).catch(() => {});
  }
}
