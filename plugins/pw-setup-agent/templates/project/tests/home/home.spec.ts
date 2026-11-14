import { test, expect } from '@fixtures';

test.describe('Home page', () => {
  test('loads', { tag: '@smoke' }, async ({ homePage, page }) => {
    await homePage.goto();

    await expect(page).toHaveTitle(/.+/);
    await expect(homePage.main).toBeVisible();
  });
});
