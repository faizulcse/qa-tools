import { test, expect } from '@fixtures';
import { meUrl } from '@utils/auth';

// Signed out: these tests start without the saved session.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Sign-in', () => {
  test('shows the sign-in screen', { tag: '@smoke' }, async ({ loginPage }) => {
    await loginPage.goto();

    await expect(loginPage.googleButton).toBeVisible();
  });

  test('the Google button opens the Google sign-in popup', async ({ loginPage }) => {
    await loginPage.goto();

    const google = await loginPage.openGoogleSignIn();

    await expect(google.popup).toHaveURL(/accounts\.google\.com/);
    await google.popup.close();
  });

  test('who-am-I returns 401 when signed out', async ({ page }) => {
    const response = await page.request.get(meUrl(), { failOnStatusCode: false });

    expect(response.status()).toBe(401);
  });
});
