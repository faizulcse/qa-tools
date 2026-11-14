import { test, expect } from '@fixtures';
import { meUrl } from '@utils/auth';

// Signed in: the project loads the session saved by {{SPECS_DIR}}/auth/auth.setup.ts.
test.describe('Home', () => {
  test('loads without the sign-in button', { tag: '@smoke' }, async ({ homePage }) => {
    await homePage.goto();

    await expect(homePage.main).toBeVisible();
    await expect(homePage.googleButton).toBeHidden();
  });

  test('who-am-I returns 200', async ({ page }) => {
    const response = await page.request.get(meUrl(), { failOnStatusCode: false });

    expect(response.status()).toBe(200);
  });
});
