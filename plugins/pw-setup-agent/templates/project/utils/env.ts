/**
 * The one place that reads environment variables.
 *
 * Locally, values come from tests/.env (create it with `npm run env:init`).
 * On CI, they come from GitHub secrets. Variables already set in the shell
 * are not overridden by the file.
 */
import fs from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/** Returns the variable's value, or throws a message that says how to fix it. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run "npm run env:init" in tests/ and fill in tests/.env ` +
        '(on CI, add it as a GitHub secret).',
    );
  }
  return value;
}

export function optionalEnv(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

export const env = {
  baseUrl: requireEnv('BASE_URL'),
  testEnv: optionalEnv('TEST_ENV', 'local'),
  isCI: !!process.env.CI,
} as const;
