/**
 * qa-setup.mjs - cross-platform workspace setup for browser test execution.
 * Runs on Windows, macOS, and Linux with no bash. (qa-setup.sh does the same
 * on macOS/Linux.)
 *
 *   node "%CLAUDE_PLUGIN_ROOT%/scripts/qa-setup.mjs" ./qa-workspace     (Windows)
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/qa-setup.mjs" ./qa-workspace      (mac/Linux)
 *
 * Installs playwright-cli (the browser CLI the qa-test-ui skill drives), its
 * official skill files, the Playwright test runner for promoted specs, and
 * downloads Chromium. Safe to re-run; skips work that is already done.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WS = resolve(process.argv[2] || './qa-workspace');

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`ERROR: Node 18+ required (found ${process.version}).`);
  console.error('Install from https://nodejs.org and re-run.');
  process.exit(1);
}

mkdirSync(join(WS, 'tests'), { recursive: true });
mkdirSync(join(WS, 'qa-results'), { recursive: true });

const pkg = join(WS, 'package.json');
if (!existsSync(pkg)) {
  writeFileSync(pkg, JSON.stringify({
    name: 'qa-workspace', private: true, type: 'module',
  }, null, 2) + '\n');
}

const run = (cmd, opts = {}) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: WS, stdio: 'inherit', ...opts });
};
const quiet = (cmd) => {
  try {
    execSync(cmd, { cwd: WS, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

// --- playwright-cli: the tool qa-test-ui drives -----------------------------
let cliCmd = 'playwright-cli';
if (!quiet('playwright-cli --help')) {
  console.log('Installing playwright-cli...');
  if (!quiet('npm install -g @playwright/cli@latest')) {
    console.log('Global install unavailable (permissions?) - installing into the workspace.');
    run('npm install -D @playwright/cli@latest');
    cliCmd = 'npx playwright-cli';
  }
}

console.log('Installing the official playwright-cli skills...');
try {
  run(`${cliCmd} install --skills`);
} catch {
  console.warn(`Skill install failed. Run "${cliCmd} install --skills" manually once available.`);
}

// --- test runner, for cases promoted to spec files --------------------------
if (!existsSync(join(WS, 'node_modules', '@playwright', 'test'))) {
  console.log('Installing the Playwright test runner...');
  run('npm install -D @playwright/test@latest dotenv@latest');
}

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  console.log('Downloading Chromium (first run only, ~150MB)...');
  try {
    run('npx --yes playwright install chromium');
  } catch {
    console.warn('\nBrowser download failed. Behind a proxy, set HTTPS_PROXY and re-run,');
    console.warn('or point playwright-cli at an existing Chrome with --browser=chrome.');
  }
} else {
  console.log(`Using pre-installed browsers at ${process.env.PLAYWRIGHT_BROWSERS_PATH}`);
}

const envExample = join(WS, '.env.example');
if (!existsSync(envExample)) {
  writeFileSync(envExample, `# Copy to .env and fill in. Never commit .env.
QA_BASE_URL=https://staging.example.com
QA_OUT_DIR=./qa-results

# Test accounts, one per role under test
QA_ADMIN_USER=
QA_ADMIN_PASS=
QA_USER_USER=
QA_USER_PASS=

# API testing (qa-test-api)
QA_API_URL=
QA_TOKEN=

# Jira (qa-jira) - or connect the Atlassian connector instead
JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_API_TOKEN=
`);
}

const gitignore = join(WS, '.gitignore');
if (!existsSync(gitignore)) {
  writeFileSync(gitignore, 'node_modules/\nqa-results/\n.env\n');
}

console.log(`
Workspace ready: ${WS}
  tests/       spec files for cases promoted to automation
  qa-results/  screenshots, logs, result.json per case
  .env.example copy to .env and fill in the environment URL and accounts

Check the CLI:   ${cliCmd} --help
Drive a page:    ${cliCmd} -s=qa open ${process.env.QA_BASE_URL || 'https://example.com'}
Run promoted specs: npx playwright test
`);
