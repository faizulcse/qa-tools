#!/usr/bin/env node
/**
 * scaffold.mjs - create the Playwright + TypeScript test project.
 *
 *   node scaffold.mjs [options]            dry run: print what would be written
 *   node scaffold.mjs [options] --write    write the files, then create .env
 *
 * Options:
 *   --root DIR            target folder, relative to the current directory (default: tests)
 *   --base-url URL        application URL for .env.example and .env (default: http://localhost:3000)
 *   --browsers LIST       comma-separated: chromium, firefox, webkit, mobile-chrome, mobile-safari
 *                         (default: chromium)
 *   --roles LIST          comma-separated test account roles (default: user)
 *   --project-name NAME   used for the package name (default: current folder name)
 *   --force               overwrite existing files (never .env; use init_env --force for that)
 *   --json                machine-readable output
 *
 * Run from the repository root. Node 18+, no dependencies.
 * Exit codes: 0 ok, 1 failed, 2 bad arguments.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = join(PLUGIN_ROOT, 'templates', 'project');
const PLUGIN_VERSION = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

/** Template files whose published name differs (dotfiles are not stored as dotfiles). */
const RENAMES = { gitignore: '.gitignore', 'env.example': '.env.example', nvmrc: '.nvmrc' };

/** Plugin scripts copied into the project so it works without the plugin. */
const COPIED_SCRIPTS = {
  'scripts/check_setup.mjs': 'utils/check-setup.mjs',
  'scripts/init_env.mjs': 'utils/init-env.mjs',
};

const BROWSERS = {
  chromium: "{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }",
  firefox: "{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }",
  webkit: "{ name: 'webkit', use: { ...devices['Desktop Safari'] } }",
  'mobile-chrome': "{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }",
  'mobile-safari': "{ name: 'mobile-safari', use: { ...devices['iPhone 15'] } }",
};

const USAGE = 'usage: scaffold.mjs [--root DIR] [--base-url URL] [--browsers LIST] [--roles LIST] [--project-name NAME] [--write] [--force] [--json]';

function fail(message, code = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

function parseArgs(argv) {
  const opts = {
    root: 'tests',
    baseUrl: 'http://localhost:3000',
    browsers: ['chromium'],
    roles: ['user'],
    projectName: basename(process.cwd()),
    write: false,
    force: false,
    json: false,
  };
  const needValue = (i) => {
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) fail(`${argv[i]} needs a value\n${USAGE}`, 2);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--root': opts.root = needValue(i); i++; break;
      case '--base-url': opts.baseUrl = needValue(i); i++; break;
      case '--browsers': opts.browsers = list(needValue(i)); i++; break;
      case '--roles': opts.roles = list(needValue(i)); i++; break;
      case '--project-name': opts.projectName = needValue(i); i++; break;
      case '--write': opts.write = true; break;
      case '--dry-run': opts.write = false; break;
      case '--force': opts.force = true; break;
      case '--json': opts.json = true; break;
      case '-h': case '--help': console.log(USAGE); process.exit(0);
      default: fail(`Unknown argument: ${argv[i]}\n${USAGE}`, 2);
    }
  }

  if (!/^https?:\/\/\S+$/.test(opts.baseUrl)) fail(`--base-url must start with http:// or https:// (got "${opts.baseUrl}")`, 2);
  opts.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const badBrowser = opts.browsers.find((b) => !BROWSERS[b]);
  if (badBrowser) fail(`Unknown browser "${badBrowser}". Choose from: ${Object.keys(BROWSERS).join(', ')}`, 2);
  if (!opts.browsers.length) fail('--browsers needs at least one browser', 2);
  opts.browsers = [...new Set(opts.browsers)];
  const badRole = opts.roles.find((r) => !/^[a-z][a-z0-9_]*$/.test(r));
  if (badRole) fail(`Role "${badRole}" must be lowercase letters, digits and _ and start with a letter`, 2);
  if (!opts.roles.length) fail('--roles needs at least one role', 2);
  opts.roles = [...new Set(opts.roles)];
  opts.projectName = opts.projectName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
  return opts;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function placeholders(opts) {
  const envKeys = (role) => [`${role.toUpperCase()}_USERNAME`, `${role.toUpperCase()}_PASSWORD`];
  return {
    PROJECT_NAME: opts.projectName,
    BASE_URL: opts.baseUrl,
    PROJECTS: opts.browsers.map((b) => `    ${BROWSERS[b]},`).join('\n'),
    ROLE_ENV: opts.roles.map((r) => envKeys(r).map((k) => `${k}=`).join('\n')).join('\n'),
    ROLE_ENTRIES: opts.roles
      .map((r) => {
        const [u, p] = envKeys(r);
        return `  ${r}: () => ({ username: requireEnv('${u}'), password: requireEnv('${p}') }),`;
      })
      .join('\n'),
    FIRST_ROLE: opts.roles[0],
  };
}

function fill(text, values, source) {
  const out = text.replace(/\{\{([A-Z_]+)\}\}/g, (m, name) => {
    if (!(name in values)) fail(`Template ${source} uses unknown placeholder ${m}`);
    return values[name];
  });
  return out;
}

function plan(opts, target) {
  const values = placeholders(opts);
  const files = [];

  for (const src of walk(TEMPLATE_DIR)) {
    let rel = relative(TEMPLATE_DIR, src);
    const name = basename(rel);
    if (RENAMES[name]) rel = join(dirname(rel), RENAMES[name]);
    files.push({ path: rel, content: fill(readFileSync(src, 'utf8'), values, relative(PLUGIN_ROOT, src)) });
  }
  for (const [src, dest] of Object.entries(COPIED_SCRIPTS)) {
    files.push({ path: dest, content: readFileSync(join(PLUGIN_ROOT, src), 'utf8') });
  }

  const pkg = JSON.parse(files.find((f) => f.path === 'package.json').content);
  const manifest = {
    plugin: 'pw-setup-agent',
    pluginVersion: PLUGIN_VERSION,
    createdAt: new Date().toISOString().slice(0, 10),
    root: opts.root,
    browsers: opts.browsers,
    roles: opts.roles,
    playwrightVersion: pkg.devDependencies['@playwright/test'],
  };
  files.push({ path: 'pw-setup.json', content: `${JSON.stringify(manifest, null, 2)}\n` });

  for (const f of files) {
    const abs = join(target, f.path);
    f.status = !existsSync(abs) ? 'create' : opts.force ? 'overwrite' : 'skip';
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, manifest };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = resolve(opts.root);
  if (target === process.cwd()) fail('--root must be a sub-folder (e.g. tests), not the repository root.', 2);

  const { files, manifest } = plan(opts, target);
  const counts = { create: 0, overwrite: 0, skip: 0 };
  for (const f of files) counts[f.status]++;

  const result = {
    mode: opts.write ? 'write' : 'dry-run',
    target,
    options: { baseUrl: opts.baseUrl, browsers: opts.browsers, roles: opts.roles, projectName: opts.projectName },
    files: files.map(({ path, status }) => ({ path, status })),
    counts,
    manifest,
    env: null,
  };

  if (opts.write) {
    for (const f of files) {
      if (f.status === 'skip') continue;
      const abs = join(target, f.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
    }
    // Create .env last, once .gitignore and .env.example exist. Never forced.
    try {
      const out = execFileSync(
        process.execPath,
        [join(PLUGIN_ROOT, 'scripts', 'init_env.mjs'), '--root', target, '--base-url', opts.baseUrl, '--json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      result.env = JSON.parse(out);
    } catch (err) {
      result.env = { error: (err.stderr || err.message || '').toString().trim() };
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.env?.error ? 1 : 0);
  }

  const icon = { create: '+', overwrite: '!', skip: '=' };
  console.log(`${opts.write ? 'Scaffolded' : 'Dry run for'} ${target}`);
  console.log(`  base URL: ${opts.baseUrl} · browsers: ${opts.browsers.join(', ')} · roles: ${opts.roles.join(', ')}`);
  console.log('');
  for (const f of files) console.log(`  ${icon[f.status]} ${f.path}${f.status === 'skip' ? '  (exists, skipped)' : ''}`);
  console.log('');
  console.log(`  ${counts.create} to create, ${counts.overwrite} to overwrite, ${counts.skip} skipped (exists)`);
  if (!opts.write) {
    console.log('\nNothing written. Re-run with --write to create these files.');
    return;
  }
  if (result.env?.error) {
    console.log(`\n.env was not created: ${result.env.error}`);
    process.exit(1);
  }
  const env = result.env;
  console.log(`\n.env: ${env.action}.${env.empty.length ? ` Fill in: ${env.empty.join(', ')}` : ''}`);
}

main();
