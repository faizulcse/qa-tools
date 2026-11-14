#!/usr/bin/env node
/**
 * detect_env.mjs - inspect the current repository before scaffolding.
 *
 *   node detect_env.mjs [--root tests] [--json]
 *
 * Run from the repository root. Reports the Node and npm versions, the
 * package manager the repo uses, whether it is a git repo, and anything that
 * would clash with a scaffold into --root: an existing Playwright install or
 * config, a non-empty target folder, or an earlier pw-setup manifest.
 *
 * Exit codes: 0 ready, 1 blocked (Node too old), 2 bad arguments.
 * Warnings (existing files) still exit 0; pw-setup decides what to do.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const MIN_NODE = [20, 12]; // Playwright needs 20+; process.loadEnvFile needs 20.12+

function parseArgs(argv) {
  const opts = { root: 'tests', json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') opts.root = argv[++i];
    else if (argv[i] === '--json') opts.json = true;
    else {
      console.error(`Unknown argument: ${argv[i]}\nusage: detect_env.mjs [--root DIR] [--json]`);
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

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'test-results', 'playwright-report']);

/** Find files matching `test` up to `depth` levels below `dir`. */
function findFiles(dir, test, depth, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0 && !SKIP_DIRS.has(e.name)) findFiles(p, test, depth - 1, out);
    } else if (test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const target = resolve(opts.root);
  const report = { cwd, target, blockers: [], warnings: [] };

  const [major, minor] = process.versions.node.split('.').map(Number);
  report.node = { version: process.version, ok: major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]) };
  if (!report.node.ok) {
    report.blockers.push(`Node ${process.version} is too old. Install Node ${MIN_NODE.join('.')}+ (LTS recommended).`);
  }
  report.npm = tryRun('npm', ['--version'], cwd);
  if (!report.npm) report.blockers.push('npm was not found on PATH.');

  const lockfiles = {
    'package-lock.json': 'npm',
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'bun.lockb': 'bun',
    'bun.lock': 'bun',
  };
  report.repoPackageManager = Object.entries(lockfiles).find(([f]) => existsSync(join(cwd, f)))?.[1] ?? null;
  if (report.repoPackageManager && report.repoPackageManager !== 'npm') {
    report.warnings.push(
      `The repo uses ${report.repoPackageManager}. The test project in ${opts.root}/ has its own package.json and uses npm.`,
    );
  }

  const gitRoot = tryRun('git', ['rev-parse', '--show-toplevel'], cwd);
  report.git = { isRepo: !!gitRoot, root: gitRoot };
  if (!gitRoot) report.warnings.push('Not a git repository. .gitignore rules cannot be verified with git.');

  const configs = findFiles(cwd, (n) => /^playwright\.config\.(ts|js|mjs|cjs|mts|cts)$/.test(n), 3);
  report.existingConfigs = configs.map((p) => relative(cwd, p));
  for (const c of report.existingConfigs) {
    report.warnings.push(`Existing Playwright config: ${c}`);
  }

  const pkgFiles = findFiles(cwd, (n) => n === 'package.json', 2);
  report.playwrightDependencies = [];
  for (const p of pkgFiles) {
    const pkg = readJson(p);
    const version = pkg && ({ ...pkg.dependencies, ...pkg.devDependencies })['@playwright/test'];
    if (version) report.playwrightDependencies.push({ file: relative(cwd, p), version });
  }
  for (const d of report.playwrightDependencies) {
    report.warnings.push(`@playwright/test ${d.version} is already a dependency in ${d.file}`);
  }

  report.targetExists = existsSync(target);
  report.targetFiles = [];
  if (report.targetExists) {
    if (!statSync(target).isDirectory()) {
      report.blockers.push(`${opts.root} exists and is not a folder.`);
    } else {
      report.targetFiles = findFiles(target, () => true, 4).map((p) => relative(target, p)).slice(0, 50);
      if (report.targetFiles.length) {
        report.warnings.push(
          `${opts.root}/ already has ${report.targetFiles.length}${report.targetFiles.length === 50 ? '+' : ''} file(s). Scaffold will skip existing files unless --force.`,
        );
      }
    }
  }
  const manifest = readJson(join(target, 'pw-setup.json'));
  report.manifest = manifest;
  if (manifest) {
    report.warnings.push(
      `${opts.root}/ was already set up by pw-setup-agent ${manifest.pluginVersion} on ${manifest.createdAt}. Use pw-check instead of scaffolding again.`,
    );
  }

  report.ready = report.blockers.length === 0;

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Repository:       ${cwd}`);
    console.log(`Target folder:    ${target}${report.targetExists ? '' : ' (will be created)'}`);
    console.log(`Node:             ${process.version} ${report.node.ok ? 'ok' : 'TOO OLD'}`);
    console.log(`npm:              ${report.npm ?? 'not found'}`);
    console.log(`Repo pkg manager: ${report.repoPackageManager ?? 'none detected'}`);
    console.log(`Git repository:   ${gitRoot ?? 'no'}`);
    for (const b of report.blockers) console.log(`BLOCKER: ${b}`);
    for (const w of report.warnings) console.log(`WARNING: ${w}`);
    console.log(report.ready ? 'Ready to scaffold.' : 'Not ready: fix the blockers first.');
  }
  process.exit(report.ready ? 0 : 1);
}

main();
