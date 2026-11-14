#!/usr/bin/env node
/**
 * login-chrome.mjs - manual fallback for saving a Google sign-in session.
 *
 * Use it when the setup step cannot open Chrome itself. Start Chrome yourself
 * with remote debugging on a dedicated profile, sign in to the app there, then
 * run this script. It connects to that Chrome, checks that the who-am-I
 * endpoint returns 200, and saves .auth/<role>.json.
 *
 *   1. Start Chrome (macOS shown; use your Chrome path elsewhere):
 *      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *        --remote-debugging-port=9222 --user-data-dir=.auth/chrome-profile/<role> <app URL>
 *   2. Sign in to the app in that window.
 *   3. {{LOGIN_CHROME_CMD}} [role] [--port 9222]
 *
 * The role defaults to the first one in test-data/users.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROLES = [{{ROLE_LIST}}];
const ME_ENDPOINT = '{{ME_ENDPOINT}}';
const P = '{{ENV_PREFIX}}';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(projectDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 9222;
const role = args.find((a, i) => !a.startsWith('--') && i !== portIndex + 1) ?? ROLES[0];
if (!ROLES.includes(role)) {
  console.error(`Unknown role "${role}". Roles: ${ROLES.join(', ')}`);
  process.exit(2);
}

let baseUrl = process.env[`${P}BASE_URL`];
if (!baseUrl) {
  console.error(`${P}BASE_URL is not set in .env.`);
  process.exit(1);
}
baseUrl = baseUrl.replaceAll('{ENVIRONMENT}', process.env[`${P}ENVIRONMENT`] ?? '');

let browser;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
} catch {
  console.error(`No Chrome with remote debugging on port ${port}. Start it as shown at the top of this file.`);
  process.exit(1);
}

try {
  const context = browser.contexts()[0];
  const response = await context.request.get(new URL(ME_ENDPOINT, baseUrl).toString(), { failOnStatusCode: false, maxRedirects: 0 });
  if (response.status() !== 200) {
    console.error(`${ME_ENDPOINT} returned ${response.status()}, not 200. Sign in to the app in that Chrome window first.`);
    process.exitCode = 1;
  } else {
    const file = path.join(projectDir, '.auth', `${role}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await context.storageState({ path: `${file}.tmp` });
    fs.renameSync(`${file}.tmp`, file);
    console.log(`Saved ${path.relative(process.cwd(), file)}. You can close that Chrome window.`);
  }
} finally {
  await browser.close(); // only disconnects; your Chrome stays open
}
