#!/usr/bin/env node
/**
 * Manual Google sign-in through playwright-cli.
 *
 *   node utils/login-cli.mjs [role]        ({{LOGIN_CLI_CMD}})
 *
 * Opens a headed Chrome (playwright-cli, persistent profile in
 * .auth/cli-profile/<role>/) on the app's sign-in page. You sign in by hand,
 * including any verification Google asks for. The script polls the
 * who-am-I endpoint and, once it returns 200, saves the session to
 * .auth/<role>.json and closes the browser. The profile remembers the Google
 * account, so later sign-ins are usually a click or none.
 *
 * The setup step ({{SPECS_DIR}}/auth/auth.setup.ts) runs this when there is
 * no valid session, so `npx playwright test` also works.
 *
 * Env: {{ENV_PREFIX}}LOGIN_TIMEOUT_MINUTES (default 10).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(projectDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

// Keep in sync with utils/auth.ts.
const ME_ENDPOINT = '{{ME_ENDPOINT}}';
const LOGIN_PATH = '{{LOGIN_PATH}}';
const ROLES = [/*{{ROLE_LIST}}*/];
const P = '{{ENV_PREFIX}}';

const role = process.argv[2] || ROLES[0];
if (!ROLES.includes(role)) fail(`Unknown role "${role}". Roles: ${ROLES.join(', ')}`);
const session = `auth-${role}`;
const authDir = path.join(projectDir, '.auth');
const stateFile = path.join(authDir, `${role}.json`);
const profileDir = path.join(authDir, 'cli-profile', role);
const timeoutMs = Number(process.env[`${P}LOGIN_TIMEOUT_MINUTES`] || 10) * 60_000;

function baseUrl() {
  const raw = process.env[`${P}BASE_URL`];
  if (!raw) fail(`${P}BASE_URL is not set in .env.`);
  if (!raw.includes('{ENVIRONMENT}')) return raw;
  if (!process.env[`${P}ENVIRONMENT`]) fail(`${P}BASE_URL contains {ENVIRONMENT} but ${P}ENVIRONMENT is not set in .env.`);
  return raw.split('{ENVIRONMENT}').join(process.env[`${P}ENVIRONMENT`]);
}

function fail(message) {
  console.error(`[login-cli] ${message}`);
  process.exit(1);
}

// The project's own playwright-cli (dev dependency) first, then a global one.
const localBin = path.join(projectDir, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright-cli.cmd' : 'playwright-cli');
const bin = fs.existsSync(localBin) ? localBin : 'playwright-cli';
const run = (args, stdio) => execFileSync(bin, args, { cwd: projectDir, encoding: 'utf8', stdio, shell: process.platform === 'win32' });

function cli(args, { quiet = true } = {}) {
  return run([`-s=${session}`, ...args], quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit');
}

/** Who-am-I status as seen by the open page (0 if the page can't answer yet). */
function meStatus() {
  try {
    const out = cli(['--raw', 'eval', `async () => (await fetch('${ME_ENDPOINT}', { credentials: 'include' })).status`]);
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  run(['--version'], 'ignore');
} catch {
  fail('playwright-cli is not installed. Run the project install (it is a dev dependency), or npm install -g @playwright/cli.');
}

const loginUrl = new URL(LOGIN_PATH, baseUrl()).toString();
fs.mkdirSync(profileDir, { recursive: true });

console.log(`[login-cli] ${role}: opening ${loginUrl}`);
cli(['open', loginUrl, '--browser', 'chrome', '--headed', '--persistent', '--profile', profileDir]);

try {
  if (meStatus() !== 200) {
    console.log(`[login-cli] ${role}: sign in by hand in the browser window (click "Sign in with Google",`);
    console.log(`[login-cli] ${role}: complete the verification). Waiting up to ${timeoutMs / 60_000} minutes...`);
    const deadline = Date.now() + timeoutMs;
    while (meStatus() !== 200) {
      if (Date.now() > deadline) throw new Error(`${role}: not signed in after ${timeoutMs / 60_000} minutes.`);
      await sleep(3_000);
    }
  }

  fs.mkdirSync(authDir, { recursive: true });
  const tmp = `${stateFile}.tmp.json`;
  cli(['state-save', tmp]);
  fs.renameSync(tmp, stateFile);
  console.log(`[login-cli] ${role}: signed in, saved ${path.relative(projectDir, stateFile)}`);
} catch (err) {
  console.error(`[login-cli] ${err.message}`);
  process.exitCode = 1;
} finally {
  try {
    cli(['close']);
  } catch {
    // already closed
  }
}
