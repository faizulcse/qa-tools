import type { Page } from '@playwright/test';

/**
 * Base class for every page object.
 *
 * - `path` is relative to `baseURL` in playwright.config.ts.
 * - `waitForReady()` resolves when the page can be used. It is the only
 *   place in a page object where `expect` is allowed.
 * - Assertions about behaviour belong in specs, not here.
 */
export abstract class BasePage {
  abstract readonly path: string;

  constructor(protected readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(this.path);
    await this.waitForReady();
  }

  abstract waitForReady(): Promise<void>;
}
