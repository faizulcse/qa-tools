import { defineConfig, devices } from '@playwright/test';
import { env } from './utils/env';

/**
 * Playwright configuration. See the pw-core-config skill for what each
 * setting does and when to change it.
 */
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',

  fullyParallel: true,
  forbidOnly: env.isCI,
  retries: env.isCI ? 2 : 0,
  workers: env.isCI ? 2 : undefined,

  timeout: 30_000,
  expect: { timeout: 5_000 },

  reporter: env.isCI
    ? [['blob'], ['github']]
    : [['list'], ['html', { open: 'never' }]],

  metadata: { testEnv: env.testEnv },

  use: {
    baseURL: env.baseUrl,
    testIdAttribute: 'data-testid',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
{{PROJECTS}}
  ],
});
