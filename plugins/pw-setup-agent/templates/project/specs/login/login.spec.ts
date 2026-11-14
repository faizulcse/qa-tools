import { test, expect } from '@fixtures';
import { invalidPassword, users } from '@data/users';

test.describe('Login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.goto();
  });

  test('signs in with valid credentials', async ({ loginPage, homePage }) => {
    await loginPage.login(users.{{FIRST_ROLE}}());

    await homePage.waitForReady();
    await expect(homePage.header.accountMenu).toBeVisible();
  });

  test('shows an error for a wrong password', async ({ loginPage }) => {
    const { username } = users.{{FIRST_ROLE}}();

    await loginPage.login({ username, password: invalidPassword });

    await expect(loginPage.errorMessage).toBeVisible();
    await expect(loginPage.signInButton).toBeVisible();
  });
});
