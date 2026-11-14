#!/usr/bin/env node
/**
 * detect_env.mjs - inspect the repository before scaffolding.
 *
 *   node detect_env.mjs [--json]
 *
 * Run from the repository root (the project is always created there).
 * Reports the Node and npm versions, the package manager, whether it is a git
 * repo, the mode scaffold will use (standalone or merged), and what already
 * exists that setup will adopt and amend: a Playwright config and its
 * testDir, Playwright dependencies, the app's tsconfig and ESLint config,
 * project folders that already hold files, Next.js/Nuxt (page objects then go
 * in page-objects/), env keys the tests will reuse, and an earlier pw-setup
 * manifest (here, or in tests/ from 0.1.0/0.2.0). scaffold.mjs makes the
 * detailed plan.
 *
 * Exit codes: 0 ready, 1 blocked (Node too old, npm missing, not the repo
 * root, invalid package.json), 2 bad arguments.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIN_NODE = [20, 12]; // Playwright needs 20+; process.loadEnvFile needs 20.12+
const ESLINT_CONFIGS = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
];
const LOCKFILES = { 'package-lock.json': 'npm', 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lockb': 'bun', 'bun.lock': 'bun' };

function parseArgs(argv) {
  const opts = { json: false };
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--root') {
      console.error('--root was removed in 0.3.0: the project is always created at the repository root. Run from there.');
      process.exit(2);
    } else {
      console.error(`Unknown argument: ${arg}\nusage: detect_env.mjs [--json]`);
      process.exit(2);
    }
  }
  return opts;
}

function tryRun(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const nonEmptyDir = (p) => {
  try {
    return statSync(p).isDirectory() && readdirSync(p).length > 0;
  } catch {
    return false;
  }
};

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const report = { cwd, blockers: [], adopts: [], notes: [] };

  const [major, minor] = process.versions.node.split('.').map(Number);
  report.node = { version: process.version, ok: major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]) };
  if (!report.node.ok) report.blockers.push(`Node ${process.version} is too old. Install Node ${MIN_NODE.join('.')}+ (LTS recommended).`);
  report.npm = tryRun('npm', ['--version'], cwd);
  if (!report.npm) report.blockers.push('npm was not found on PATH.');

  const gitRoot = tryRun('git', ['rev-parse', '--show-toplevel'], cwd);
  report.git = { isRepo: !!gitRoot, root: gitRoot };
  if (gitRoot && resolve(gitRoot) !== resolve(cwd)) report.blockers.push(`Run from the repository root: ${gitRoot}`);
  if (!gitRoot) report.notes.push('Not a git repository. .gitignore rules cannot be verified with git.');

  const pkgPath = join(cwd, 'package.json');
  const app = existsSync(pkgPath) ? readJson(pkgPath) : null;
  if (existsSync(pkgPath) && !app) report.blockers.push('package.json is not valid JSON.');
  report.mode = existsSync(pkgPath) ? 'merged' : 'standalone';
  const lockfile = Object.keys(LOCKFILES).find((f) => existsSync(join(cwd, f)));
  report.packageManager = report.mode === 'merged' && lockfile ? LOCKFILES[lockfile] : 'npm';
  const deps = app ? { ...app.dependencies, ...app.devDependencies, ...app.peerDependencies } : {};

  const framework = deps.next ? 'Next.js' : deps.nuxt ? 'Nuxt' : null;
  report.pagesDir = framework ? 'page-objects' : 'pages';
  if (framework) report.notes.push(`${framework} app: page objects go in page-objects/ (pages/ is the app's routes).`);

  const pwConfig = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((e) => `playwright.config.${e}`).find((f) => existsSync(join(cwd, f)));
  report.specsDir = 'specs';
  if (pwConfig) {
    const testDir = readFileSync(join(cwd, pwConfig), 'utf8').match(/\btestDir\s*:\s*(['"`])([^'"`]+)\1/)?.[2];
    const norm = testDir?.replace(/^\.\//, '').replace(/\/$/, '');
    if (norm && norm !== '.' && !norm.startsWith('..')) report.specsDir = norm;
    report.adopts.push(`${pwConfig} (kept; the skill adds what is missing)${testDir ? `, testDir ${testDir}: new specs go there` : ''}`);
  }
  for (const dep of ['@playwright/test', 'playwright']) {
    if (deps[dep]) report.adopts.push(`${dep} ${deps[dep]} (kept)`);
  }
  if (existsSync(join(cwd, 'tsconfig.json'))) report.adopts.push('tsconfig.json (amended in place: aliases, include, types)');
  const eslint = ESLINT_CONFIGS.find((f) => existsSync(join(cwd, f)));
  if (eslint) report.adopts.push(`${eslint} (the skill adds a Playwright rules block)`);
  for (const d of [report.specsDir, report.pagesDir, 'fixtures', 'test-data', 'utils']) {
    if (nonEmptyDir(join(cwd, d))) report.adopts.push(`${d}/ (used; existing files kept)`);
  }
  const example = existsSync(join(cwd, '.env.example')) ? readFileSync(join(cwd, '.env.example'), 'utf8') : '';
  const reused = ['BASE_URL', 'TEST_ENV', 'ENVIRONMENT'].filter((k) => new RegExp(`^\\s*${k}\\s*=`, 'm').test(example));
  if (reused.length) report.adopts.push(`.env.example keys ${reused.join(', ')} (reused by the tests; --env-prefix E2E_ for separate keys)`);

  report.manifest = readJson(join(cwd, 'pw-setup.json'));
  if (report.manifest) {
    report.notes.push(`Already set up by pw-setup-agent ${report.manifest.pluginVersion} on ${report.manifest.createdAt}. Use pw-check instead of scaffolding again.`);
  }
  const legacy = readJson(join(cwd, 'tests', 'pw-setup.json'));
  if (legacy) {
    report.legacy = 'tests';
    report.notes.push(`tests/ holds a pw-setup-agent ${legacy.pluginVersion} project (sub-folder layout). It keeps working: check it with check_setup.mjs --root tests.`);
  }

  report.ready = report.blockers.length === 0;

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Repository:       ${cwd}`);
    console.log(`Node:             ${process.version} ${report.node.ok ? 'ok' : 'TOO OLD'}`);
    console.log(`npm:              ${report.npm ?? 'not found'}`);
    console.log(`Git repository:   ${gitRoot ?? 'no'}`);
    console.log(`Mode:             ${report.mode} (installs with ${report.packageManager})`);
    console.log(`Specs folder:     ${report.specsDir}/ · page objects: ${report.pagesDir}/`);
    for (const a of report.adopts) console.log(`ADOPTS: ${a}`);
    for (const n of report.notes) console.log(`NOTE: ${n}`);
    for (const b of report.blockers) console.log(`BLOCKER: ${b}`);
    console.log(report.ready ? 'Ready to scaffold.' : 'Not ready: fix the blockers first.');
  }
  process.exit(report.ready ? 0 : 1);
}

main();
