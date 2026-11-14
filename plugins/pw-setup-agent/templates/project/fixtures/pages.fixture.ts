import { test as base } from '@playwright/test';
import { HomePage } from '@pages/home.page';
import { LoginPage } from '@pages/login.page';

/**
 * Page objects as fixtures. Specs ask for a page by name, for example
 * `async ({ loginPage }) => { ... }`, instead of creating it themselves.
 *
 * Register every new page object here.
 */
type Pages = {
  homePage: HomePage;
  loginPage: LoginPage;
};

export const test = base.extend<Pages>({
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
});

export { expect } from '@playwright/test';
