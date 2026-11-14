/**
 * Saved sign-in sessions.
 *
 * Each role's session is a Playwright storage-state JSON file,
 * .auth/<role>.json, which the test projects load. The setup step
 * ({{SPECS_DIR}}/auth/auth.setup.ts) reuses it while it is younger than
 * AUTH_MAX_AGE_MINUTES and the who-am-I endpoint still answers 200 with it;
 * otherwise it signs in again through utils/login-cli.mjs (playwright-cli,
 * headed Chrome) and rewrites it.
 * Everything under .auth/ is gitignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { env, optionalEnv, projectDir } from './env';

/** The app endpoint that returns 200 when signed in and 401 when not. Keep in sync with utils/login-cli.mjs. */
export const ME_ENDPOINT = '{{ME_ENDPOINT}}';

/** Where the browser is opened for signing in. Keep in sync with utils/login-cli.mjs. */
export const LOGIN_PATH = '{{LOGIN_PATH}}';

export const authDir = path.join(projectDir, '.auth');

export const storageStatePath = (role: string): string => path.join(authDir, `${role}.json`);

/** One persistent browser profile per role (used by login-cli.mjs), so each keeps its own Google account. */
export const cliProfilePath = (role: string): string => path.join(authDir, 'cli-profile', role);

/** FORCE_LOGIN=1, or running the login:force script, signs in again even with a valid session. */
export function forceLogin(): boolean {
  return /^(1|true|yes)$/i.test(optionalEnv('{{ENV_PREFIX}}FORCE_LOGIN')) || !!process.env.npm_lifecycle_event?.endsWith('login:force');
}

/** Minutes since the session file was written, or null if there is none. */
export function sessionAgeMinutes(file: string): number | null {
  try {
    return (Date.now() - fs.statSync(file).mtimeMs) / 60_000;
  } catch {
    return null;
  }
}

/** Absolute URL of the who-am-I endpoint (works without a baseURL). */
export const meUrl = (): string => new URL(ME_ENDPOINT, env.baseUrl).toString();

/** HTTP status of the who-am-I endpoint for this request context's cookies. */
export async function meStatus(request: APIRequestContext): Promise<number> {
  try {
    const response = await request.get(meUrl(), { failOnStatusCode: false, maxRedirects: 0 });
    return response.status();
  } catch {
    return 0; // network error: not signed in as far as we can tell
  }
}
