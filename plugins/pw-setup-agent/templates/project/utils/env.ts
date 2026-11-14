/**
 * The one place that reads environment variables.
 *
 * Locally, values come from {{ENV_FILE}} (create it with `{{ENV_INIT_CMD}}`).
 * On CI, they come from GitHub secrets. Variables already set in the shell
 * are not overridden by the file.
 */
import fs from 'node:fs';
import path from 'node:path';

// The project folder: one level up from utils/. Falls back to the working
// directory when the package is an ES module (no __dirname).
export const projectDir = typeof __dirname === 'string' ? path.resolve(__dirname, '..') : process.cwd();
const envFile = path.join(projectDir, '.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/** Returns the variable's value, or throws a message that says how to fix it. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run "{{ENV_INIT_HINT}} and fill in {{ENV_FILE}} ` +
        '(on CI, add it as a GitHub secret).',
    );
  }
  return value;
}

export function optionalEnv(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

/** BASE_URL may contain {ENVIRONMENT}, e.g. https://{ENVIRONMENT}.example.com, filled from ENVIRONMENT. */
function resolveBaseUrl(): string {
  const raw = requireEnv('{{ENV_PREFIX}}BASE_URL');
  if (!raw.includes('{ENVIRONMENT}')) return raw;
  return raw.replaceAll('{ENVIRONMENT}', requireEnv('{{ENV_PREFIX}}ENVIRONMENT'));
}

const environment = optionalEnv('{{ENV_PREFIX}}ENVIRONMENT');

export const env = {
  baseUrl: resolveBaseUrl(),
  testEnv: optionalEnv('{{ENV_PREFIX}}TEST_ENV', environment || 'local'),
{{ENV_EXTRA}}  isCI: !!process.env.CI,
} as const;
