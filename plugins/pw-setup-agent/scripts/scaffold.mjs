#!/usr/bin/env node
/**
 * scaffold.mjs - create the Playwright + TypeScript test project at the
 * repository root, adopting and amending whatever is already there.
 *
 *   node scaffold.mjs [options]            dry run: print what would be written
 *   node scaffold.mjs [options] --write    write the files, then create or sync .env
 *
 * Options:
 *   --base-url URL        application URL (default: the existing Playwright config's
 *                         baseURL, else http://localhost:3000)
 *   --browsers LIST       comma-separated: chromium, firefox, webkit, mobile-chrome, mobile-safari
 *                         (default: chromium)
 *   --roles LIST          comma-separated test account roles (default: user)
 *   --project-name NAME   used for the package name when there is no package.json
 *   --env-prefix PREFIX   prefix the test env keys, e.g. E2E_ -> E2E_BASE_URL. Without it,
 *                         keys the app already has (BASE_URL, ...) are reused.
 *   --auth MODE           password (default): username/password login page
 *                         google-sso: "Sign in with Google" only; adds an auth setup step that
 *                         reuses .auth/<role>.json or runs utils/login-cli.mjs (playwright-cli,
 *                         headed Chrome, sign in by hand) to create it
 *   --me-endpoint PATH    google-sso: the app's "who am I" endpoint (200 signed in, 401 not)
 *   --login-path PATH     google-sso: where the "Sign in with Google" button is (default: /)
 *   --force               overwrite files pw-setup created earlier (never the app's, never .env)
 *   --json                machine-readable output
 *
 * Always the repository root. Modes: standalone (no package.json) or merged (the
 * app's package.json is there). What already exists is kept and amended:
 *   +  create        the file does not exist
 *   ~  merge/amend   package.json, .gitignore, .env.example, tsconfig.json: lines/keys added
 *   =  keep          the file exists; it is used as is
 *   >  skill         code the pw-setup skill amends (Playwright/ESLint config, app files the
 *                    templates import from), listed under AMEND with exactly what to add
 *   !  overwrite     --force, files pw-setup created earlier only
 *
 * Node 18+, no dependencies.
 * Exit codes: 0 ok, 1 blocked or failed, 2 bad arguments.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = join(PLUGIN_ROOT, 'templates', 'project');
/** Files that replace or add to templates/project for each --auth mode. */
const AUTH_DIRS = { password: null, 'google-sso': join(PLUGIN_ROOT, 'templates', 'auth', 'google-sso') };
const PLUGIN_VERSION = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

/**
 * Template files whose published name differs. Dotfiles are not stored as
 * dotfiles, and tsconfig.json is stored as .tmpl so editors don't treat the
 * template folder as a TypeScript project (it has no node_modules).
 */
const RENAMES = { gitignore: '.gitignore', 'env.example': '.env.example', nvmrc: '.nvmrc', 'tsconfig.json.tmpl': 'tsconfig.json' };

/** Plugin scripts copied into the project so it works without the plugin. */
const COPIED_SCRIPTS = {
  'scripts/check_setup.mjs': 'utils/check-setup.mjs',
  'scripts/init_env.mjs': 'utils/init-env.mjs',
};

const ESLINT_CONFIGS = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
];
const PLAYWRIGHT_CONFIGS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((e) => `playwright.config.${e}`);
const LOCKFILES = { 'package-lock.json': 'npm', 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lockb': 'bun', 'bun.lock': 'bun' };
/** Frameworks whose root pages/ folder is the app's routes: page objects go in page-objects/. */
const ROUTER_FRAMEWORKS = { next: 'Next.js', nuxt: 'Nuxt' };
/** Oldest @playwright/test the templates work with (setup projects, storageState, loadEnvFile era). */
const MIN_PLAYWRIGHT = [1, 45];

/** Script names: logical name -> name in package.json, per mode. */
const SCRIPT_NAMES = {
  test: ['test', 'pw:test'],
  smoke: ['test:smoke', 'pw:smoke'],
  headed: ['test:headed', 'pw:headed'],
  ui: ['test:ui', 'pw:ui'],
  report: ['report', 'pw:report'],
  typecheck: ['typecheck', 'pw:typecheck'],
  lint: ['lint', 'pw:lint'],
  check: ['check', 'pw:check'],
  envInit: ['env:init', 'pw:env:init'],
  // google-sso only
  login: ['login', 'pw:login'],
  loginForce: ['login:force', 'pw:login:force'],
  loginCli: ['login:cli', 'pw:login:cli'],
};
const SSO_SCRIPTS = ['login', 'loginForce', 'loginCli'];
/** google-sso: manual sign-in runs through playwright-cli (utils/login-cli.mjs). */
const PLAYWRIGHT_CLI = { name: '@playwright/cli', version: '0.1.24' };

/** Playwright projects: device, and whether a Chrome channel applies. */
const BROWSERS = {
  chromium: { device: 'Desktop Chrome', chrome: true },
  firefox: { device: 'Desktop Firefox', chrome: false },
  webkit: { device: 'Desktop Safari', chrome: false },
  'mobile-chrome': { device: 'Pixel 7', chrome: true },
  'mobile-safari': { device: 'iPhone 15', chrome: false },
};

const USAGE =
  'usage: scaffold.mjs [--base-url URL] [--browsers LIST] [--roles LIST] [--project-name NAME] [--env-prefix PREFIX]\n' +
  '                    [--auth password|google-sso] [--me-endpoint PATH] [--login-path PATH] [--write] [--force] [--json]';

function fail(message, code = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

function parseArgs(argv) {
  const opts = {
    baseUrl: 'http://localhost:3000',
    baseUrlGiven: false,
    browsers: ['chromium'],
    roles: ['user'],
    projectName: basename(process.cwd()),
    envPrefix: '',
    auth: 'password',
    meEndpoint: '',
    loginPath: '/',
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
      case '--base-url': opts.baseUrl = needValue(i); opts.baseUrlGiven = true; i++; break;
      case '--browsers': opts.browsers = list(needValue(i)); i++; break;
      case '--roles': opts.roles = list(needValue(i)); i++; break;
      case '--project-name': opts.projectName = needValue(i); i++; break;
      case '--env-prefix': opts.envPrefix = needValue(i); i++; break;
      case '--auth': opts.auth = needValue(i); i++; break;
      case '--me-endpoint': opts.meEndpoint = needValue(i); i++; break;
      case '--login-path': opts.loginPath = needValue(i); i++; break;
      case '--write': opts.write = true; break;
      case '--dry-run': opts.write = false; break;
      case '--force': opts.force = true; break;
      case '--json': opts.json = true; break;
      case '--root':
        fail('--root was removed in 0.3.0: the project is always created at the repository root. Run from there.', 2);
        break;
      case '--split-configs': case '--reuse-env-keys':
        fail(`${argv[i]} was removed in 0.3.0: existing configs are amended and existing env keys reused automatically.`, 2);
        break;
      case '-h': case '--help': console.log(USAGE); process.exit(0);
      default: fail(`Unknown argument: ${argv[i]}\n${USAGE}`, 2);
    }
  }

  if (!(opts.auth in AUTH_DIRS)) fail(`--auth must be one of: ${Object.keys(AUTH_DIRS).join(', ')} (got "${opts.auth}")`, 2);
  if (opts.auth === 'google-sso') {
    if (!opts.meEndpoint) fail('--auth google-sso needs --me-endpoint: the app endpoint that returns 200 signed in and 401 signed out', 2);
    for (const [flag, value] of [['--me-endpoint', opts.meEndpoint], ['--login-path', opts.loginPath]]) {
      if (!/^\/[^\s'"`\\]*$/.test(value)) fail(`${flag} must be a path starting with / (got "${value}")`, 2);
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
  if (opts.envPrefix && !/^[A-Z][A-Z0-9_]*_$/.test(opts.envPrefix)) {
    fail(`--env-prefix must be uppercase and end with _, e.g. E2E_ (got "${opts.envPrefix}")`, 2);
  }
  opts.projectName = opts.projectName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
  return opts;
}

// ---------------------------------------------------------------- helpers

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const read = (path) => readFileSync(path, 'utf8');
const posix = (p) => p.split('\\').join('/');

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const envKeys = (text) => text.split(/\r?\n/).map((l) => l.match(ENV_LINE)?.[1]).filter(Boolean);

/** Normalise a .gitignore line so "/.auth/", ".auth" and ".auth/" compare equal. */
const ignoreKey = (line) => line.trim().replace(/^\//, '').replace(/\/$/, '');

/** [major, minor] of a version range such as "^1.52.0", or null. */
function versionOf(range) {
  const m = String(range ?? '').match(/(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
const olderThan = (v, min) => !!v && (v[0] < min[0] || (v[0] === min[0] && v[1] < min[1]));

/** How to run things with each package manager. */
function pmCommands(pm) {
  const run = { npm: 'npm run', pnpm: 'pnpm', yarn: 'yarn', bun: 'bun run' }[pm];
  const exec = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }[pm];
  return { install: `${pm} install`, run, exec };
}

/** Names a TS/JS file exports (declarations and export lists). */
function exportsOf(text) {
  const names = new Set();
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of text.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Fixture names registered in a test.extend({...}) file, e.g. homePage, loginPage. */
const fixtureNames = (text) => new Set([...text.matchAll(/^\s*(\w+)\s*:\s*async\s*\(/gm)].map((m) => m[1]));

// ---------------------------------------------------------------- JSONC (tsconfig) reading and in-place editing

/**
 * Parses JSON with comments and trailing commas, keeping source positions so
 * the file can be edited textually (comments and formatting survive).
 */
function parseJsonc(text) {
  let i = 0;
  const err = (msg) => { throw new Error(`${msg} at offset ${i}`); };
  const ws = () => {
    for (;;) {
      if (/\s/.test(text[i] ?? '')) i++;
      else if (text.startsWith('//', i)) { while (i < text.length && text[i] !== '\n') i++; }
      else if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); if (e < 0) err('unclosed comment'); i = e + 2; }
      else break;
    }
  };
  const str = () => {
    if (text[i] !== '"') err('expected a string');
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const value = () => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{' || c === '[') {
      const isObj = c === '{';
      const close = isObj ? '}' : ']';
      i++;
      const members = [];
      ws();
      while (text[i] !== close) {
        let key = null;
        let keyStart = i;
        if (isObj) { key = str(); ws(); if (text[i] !== ':') err('expected :'); i++; }
        const v = value();
        if (!isObj) keyStart = v.start;
        members.push({ key, keyStart, value: v });
        ws();
        if (text[i] === ',') { i++; ws(); } else if (text[i] !== close) err(`expected , or ${close}`);
      }
      i++;
      const js = isObj ? Object.fromEntries(members.map((m) => [m.key, m.value.js])) : members.map((m) => m.value.js);
      return { type: isObj ? 'object' : 'array', start, end: i, members, js };
    }
    if (c === '"') { const s = str(); return { type: 'string', start, end: i, js: s }; }
    const lit = text.slice(i).match(/^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!lit) err('unexpected token');
    i += lit[0].length;
    return { type: 'literal', start, end: i, js: JSON.parse(lit[0]) };
  };
  const root = value();
  ws();
  if (i < text.length) err('unexpected text after the end');
  return root;
}

const member = (node, key) => node?.type === 'object' ? node.members.find((m) => m.key === key)?.value : undefined;

/** The whitespace at the start of the line containing `pos`. */
const lineIndent = (text, pos) => text.slice(text.lastIndexOf('\n', pos - 1) + 1, pos).match(/^[ \t]*/)[0];

/** The file's indent unit (first indented line), default two spaces. */
const indentUnit = (text) => text.match(/\n([ \t]+)\S/)?.[1] ?? '  ';

/**
 * An edit that appends `entries` (already-rendered "key": value or value
 * strings) to a container node, matching its layout.
 */
function appendEdit(text, node, entries) {
  if (!entries.length) return null;
  const closeAt = node.end - 1;
  const singleLine = !text.slice(node.start, node.end).includes('\n');
  if (node.members.length) {
    const last = node.members[node.members.length - 1];
    if (singleLine) return { pos: last.value.end, text: entries.map((e) => `, ${e}`).join('') };
    const ind = lineIndent(text, last.keyStart);
    return { pos: last.value.end, text: entries.map((e) => `,\n${ind}${e}`).join('') };
  }
  const outer = lineIndent(text, node.start);
  const ind = outer + indentUnit(text);
  if (singleLine && node.type === 'array') return { pos: closeAt, text: entries.join(', ') };
  return { pos: closeAt, text: `\n${entries.map((e) => `${ind}${e}`).join(',\n')}\n${outer}` };
}

function applyEdits(text, edits) {
  return edits
    .filter(Boolean)
    .sort((a, b) => b.pos - a.pos)
    .reduce((t, e) => t.slice(0, e.pos) + e.text + t.slice(e.pos), text);
}

/**
 * Reads a tsconfig and its relative `extends` chain. Returns the effective
 * settings the tests depend on, each with the file that defines it.
 */
function effectiveTsconfig(file) {
  const eff = {};
  const seen = new Set();
  let current = file;
  while (current && !seen.has(current) && existsSync(current)) {
    seen.add(current);
    const json = parseJsonc(read(current)).js;
    const co = json.compilerOptions ?? {};
    const dir = dirname(current);
    if (eff.baseUrl === undefined && co.baseUrl !== undefined) eff.baseUrl = resolve(dir, co.baseUrl);
    if (eff.paths === undefined && co.paths) eff.paths = { value: co.paths, file: current, baseUrl: co.baseUrl !== undefined ? resolve(dir, co.baseUrl) : undefined };
    if (eff.types === undefined && co.types) eff.types = { value: co.types, file: current };
    if (eff.moduleResolution === undefined && co.moduleResolution) eff.moduleResolution = co.moduleResolution;
    if (eff.include === undefined && json.include) eff.include = { value: json.include, file: current };
    if (eff.files === undefined && json.files) eff.files = { value: json.files, file: current };
    if (eff.exclude === undefined && json.exclude) eff.exclude = { value: json.exclude, file: current };
    if (eff.strict === undefined && co.strict !== undefined) eff.strict = co.strict;
    if (eff.target === undefined && co.target !== undefined) eff.target = co.target;
    if (eff.lib === undefined && co.lib !== undefined) eff.lib = co.lib;
    const ext = [json.extends].flat().filter((e) => typeof e === 'string' && e.startsWith('.'));
    current = ext.length ? resolve(dir, ext[0].endsWith('.json') ? ext[0] : `${ext[0]}.json`) : null;
  }
  // paths without their own baseUrl resolve against the effective baseUrl, else the defining file's folder
  if (eff.paths && eff.paths.baseUrl === undefined) eff.paths.baseUrl = eff.baseUrl ?? dirname(eff.paths.file);
  return eff;
}

/** A tsconfig path target for `absTarget`, relative to `base`. */
function relTarget(base, absTarget) {
  const rel = posix(relative(base, absTarget)) || '.';
  return rel.startsWith('..') ? rel : `./${rel}`;
}

/** Does an include pattern list already cover a folder at the root? */
function includeCovers(patterns, folder) {
  return patterns.some((p) => {
    const n = posix(p).replace(/^\.\//, '');
    return ['**', '**/*', '**/*.ts', '*', '.', ''].includes(n) || n === folder || n.startsWith(`${folder}/`);
  });
}

// ---------------------------------------------------------------- inspect the repository

function inspect(opts, root) {
  const blockers = [];
  const notes = [];
  const appPkgPath = join(root, 'package.json');
  const mode = existsSync(appPkgPath) ? 'merged' : 'standalone';
  const app = mode === 'merged' ? readJson(appPkgPath) : null;
  if (mode === 'merged' && !app) blockers.push('package.json is not valid JSON. Fix it and run again.');
  const deps = app ? { ...app.dependencies, ...app.devDependencies, ...app.peerDependencies } : {};
  const lockfile = Object.keys(LOCKFILES).find((f) => existsSync(join(root, f)));
  const packageManager = mode === 'merged' && lockfile ? LOCKFILES[lockfile] : 'npm';

  const previous = readJson(join(root, 'pw-setup.json'));
  if (previous && !opts.force) blockers.push('pw-setup.json exists: this project was already set up. Run pw-check instead (or --force to refresh pw-setup\'s own files).');

  // Framework: page objects move out of a routed pages/ folder.
  const framework = Object.keys(ROUTER_FRAMEWORKS).find((f) => deps[f]) ?? null;
  const pagesDir = previous?.folders?.pages ?? (framework ? 'page-objects' : 'pages');
  if (framework && !previous) notes.push(`${ROUTER_FRAMEWORKS[framework]} app: page objects go in page-objects/ (its pages/ folder is routes). The @pages alias points there.`);

  // Existing Playwright config: keep it; specs go in its testDir.
  const pwConfig = PLAYWRIGHT_CONFIGS.find((f) => existsSync(join(root, f))) ?? null;
  const pw = { file: pwConfig };
  let specsDir = previous?.folders?.specs ?? 'tests';
  // Read on every run: a re-run only lists what is still missing from an adopted config.
  if (pwConfig) {
    const text = read(join(root, pwConfig));
    const testDir = text.match(/\btestDir\s*:\s*(['"`])([^'"`]+)\1/)?.[2];
    pw.testDir = testDir ?? null;
    pw.testDirDynamic = !testDir && /\btestDir\s*:/.test(text);
    // The config-wide testMatch; the setup project's own *.setup.ts pattern is expected.
    pw.testMatch = [...text.matchAll(/\btestMatch\s*:\s*([^\n,]+)/g)].map((m) => m[1].trim()).find((v) => !/setup/.test(v)) ?? null;
    pw.baseUrlLiteral = text.match(/\bbaseURL\s*:\s*(['"`])(https?:\/\/[^'"`]+)\1/)?.[2] ?? null;
    pw.baseUrlFromEnv = /\bbaseURL\s*:\s*(?:env\.|process\.env)/.test(text);
    pw.hasTrace = /\btrace\s*:/.test(text);
    pw.hasScreenshot = /\bscreenshot\s*:/.test(text);
    pw.hasVideo = /\bvideo\s*:/.test(text);
    pw.hasBlob = /['"`]blob['"`]/.test(text);
    pw.projects = [...text.matchAll(/\bname\s*:\s*(['"`])([\w-]+)\1/g)].map((m) => m[2]);
    if (testDir && !previous) {
      const norm = posix(testDir).replace(/^\.\//, '').replace(/\/$/, '');
      if (norm && norm !== '.' && !norm.startsWith('..') && !isAbsolute(norm)) specsDir = norm;
    }
    if (pw.baseUrlLiteral && !opts.baseUrlGiven) opts.baseUrl = pw.baseUrlLiteral.replace(/\/+$/, '');
    pw.hasSetupProject = /name\s*:\s*['"`]setup['"`]/.test(text);
    pw.hasStorageState = /\bstorageState\s*:/.test(text);
    pw.importsEnv = /from\s+['"`]\.\/utils\/env['"`]/.test(text);
    pw.importsAuth = /from\s+['"`]\.\/utils\/auth['"`]/.test(text);
  }

  // A 0.1.0/0.2.0 project lives in tests/ with its own manifest: the new specs would land inside it.
  if (!previous && existsSync(join(root, 'tests', 'pw-setup.json'))) {
    blockers.push('tests/ holds an older pw-setup-agent project (tests/pw-setup.json). The specs folder is tests/ now, so move that project to the root first (see "Upgrading" in the README), or keep checking it with check_setup.mjs --root tests.');
  }

  // Unit test runners whose default patterns also match tests/**/*.spec.ts, and unit tests already in the spec folder.
  const unitRunners = ['jest', 'vitest'].filter((r) => deps[r]);
  const unitTests = existsSync(join(root, specsDir)) && statSync(join(root, specsDir)).isDirectory()
    ? walk(join(root, specsDir))
      .filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) && !f.includes('node_modules'))
      .filter((f) => !/from\s+['"]@playwright\/test['"]/.test(read(f)))
      .map((f) => posix(relative(root, f)))
    : [];
  const unitConfig = ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json',
    'vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']
    .find((f) => existsSync(join(root, f))) ?? (deps.jest && app?.jest ? 'package.json' : null);
  if (unitTests.length) {
    notes.push(`${specsDir}/ already has ${unitTests.length} unit test file(s) (e.g. ${unitTests[0]}). Playwright is limited to *.spec.ts files so it doesn't run them; keep unit tests named *.test.*.`);
  }

  const pwDep = deps['@playwright/test'] ?? deps.playwright;
  if (pwDep && olderThan(versionOf(pwDep), MIN_PLAYWRIGHT)) {
    notes.push(`The app has Playwright ${pwDep}; the templates need ${MIN_PLAYWRIGHT.join('.')}+. Kept as is. Upgrade with: ${pmCommands(packageManager).install.replace(' install', '')} add -D @playwright/test@latest (then ${pmCommands(packageManager).exec} playwright install).`);
  }
  if (deps.playwright && !deps['@playwright/test']) {
    notes.push(`The app depends on playwright ${deps.playwright} but not @playwright/test; @playwright/test is added. Keep both on the same version.`);
  }

  const tsconfigPath = join(root, 'tsconfig.json');
  const tsconfig = { exists: existsSync(tsconfigPath), file: 'tsconfig.json' };
  if (tsconfig.exists) {
    try {
      tsconfig.eff = effectiveTsconfig(tsconfigPath);
    } catch (e) {
      blockers.push(`tsconfig.json could not be read (${e.message}). Fix it and run again.`);
    }
  }
  tsconfig.nodenext = /^node(16|next)$/i.test(tsconfig.eff?.moduleResolution ?? '');
  // The templates need ES2017+ library types (async/await, Object.entries, includes).
  const modern = (v) => /^es(20(1[7-9]|[2-9]\d)|next)/i.test(String(v));
  const tsMajorForTarget = versionOf(deps.typescript)?.[0] ?? 6;
  tsconfig.oldTarget = !!tsconfig.eff && (tsconfig.eff.lib
    ? !tsconfig.eff.lib.some(modern)
    : tsconfig.eff.target ? !modern(tsconfig.eff.target) : tsMajorForTarget < 6);
  tsconfig.needsE2e = tsconfig.nodenext || tsconfig.oldTarget;

  const eslintConfig = ESLINT_CONFIGS.find((f) => existsSync(join(root, f))) ?? null;

  const nvmrc = join(root, '.nvmrc');
  if (existsSync(nvmrc)) {
    const pinned = read(nvmrc).trim().replace(/^v/, '');
    const [maj, min = 0] = pinned.split('.').map(Number);
    if (Number.isFinite(maj) && (maj < 20 || (maj === 20 && min < 12))) {
      notes.push(`.nvmrc pins Node ${pinned}; Playwright and the .env loader need Node 20.12+.`);
    }
  }

  const tsMajor = versionOf(deps.typescript)?.[0] ?? 6;
  return {
    mode, app, deps, lockfile: lockfile ?? null, packageManager, previous, framework, pagesDir, specsDir, unitRunners, unitTests, unitConfig,
    pw, tsconfig, eslintConfig, tsMajor, blockers, notes,
  };
}

// ---------------------------------------------------------------- templates

function projectEntries(opts, ctx) {
  if (opts.auth !== 'google-sso') {
    return opts.browsers.map((b) => `    { name: '${b}', use: { ...devices['${BROWSERS[b].device}'] } },`).join('\n');
  }
  const role = opts.roles[0];
  const setup = `    // Signs in once per role and saves .auth/<role>.json (${ctx.specsDir}/auth/auth.setup.ts).\n` +
    "    { name: 'setup', testMatch: /.*\\.setup\\.ts/, timeout: (env.loginTimeoutMinutes + 2) * 60_000 },";
  const browsers = opts.browsers.map((b) => {
    const channel = BROWSERS[b].chrome ? ' channel: env.browserChannel || undefined,' : '';
    return `    {\n      name: '${b}',\n      use: { ...devices['${BROWSERS[b].device}'],${channel} storageState: storageStatePath('${role}') },\n      dependencies: ['setup'],\n    },`;
  });
  return [setup, ...browsers].join('\n');
}

function placeholders(opts, ctx) {
  const p = opts.envPrefix;
  const sso = opts.auth === 'google-sso';
  // google-sso: <ROLE> is the account email; password mode: <ROLE>_USERNAME.
  const envKeysFor = (role) => [`${p}${role.toUpperCase()}${sso ? '' : '_USERNAME'}`, `${p}${role.toUpperCase()}_PASSWORD`];
  return {
    PROJECT_NAME: opts.projectName,
    BASE_URL: opts.baseUrl,
    ENV_PREFIX: p,
    ENV_FILE: '.env',
    ENV_INIT_CMD: ctx.cmd('envInit'),
    ENV_INIT_HINT: `${ctx.cmd('envInit')}"`,
    SPECS_DIR: ctx.specsDir,
    PAGES_DIR: ctx.pagesDir,
    TSCONFIG_LINE: ctx.tsconfigFile !== 'tsconfig.json' ? `  tsconfig: './${ctx.tsconfigFile}',\n` : '',
    // Only Playwright specs when unit tests share the folder (*.test.* stays theirs).
    TESTMATCH_LINE: ctx.specOnly ? "  testMatch: '**/*.spec.ts',\n" : '',
    PROJECTS: projectEntries(opts, ctx),
    AUTH_IMPORT: sso ? "import { storageStatePath } from './utils/auth';\n" : '',
    ENV_EXTRA: sso
      ? `  authMaxAgeMinutes: Number(optionalEnv('${p}AUTH_MAX_AGE_MINUTES', '60')) || 60,\n` +
        `  browserChannel: optionalEnv('${p}AUTH_BROWSER_CHANNEL'),\n` +
        `  loginTimeoutMinutes: Number(optionalEnv('${p}LOGIN_TIMEOUT_MINUTES', '10')) || 10,\n`
      : '',
    ME_ENDPOINT: opts.meEndpoint,
    LOGIN_PATH: opts.loginPath,
    ROLE_LIST: opts.roles.map((r) => `'${r}'`).join(', '),
    LOGIN_CLI_CMD: sso ? ctx.cmd('loginCli') : '',
    ROLE_ENV: opts.roles.map((r) => envKeysFor(r).map((k) => `${k}=`).join('\n')).join('\n'),
    ROLE_ENTRIES: opts.roles
      .map((r) => {
        const [u, pw] = envKeysFor(r);
        if (sso) {
          return `  ${r}: () => ({ email: optionalEnv('${u}'), password: optionalEnv('${pw}'), otp: optionalEnv('${p}OTP') }),`;
        }
        return `  ${r}: () => ({ username: requireEnv('${u}'), password: requireEnv('${pw}') }),`;
      })
      .join('\n'),
    FIRST_ROLE: opts.roles[0],
  };
}

function fill(text, values, source) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, name) => {
    if (!(name in values)) fail(`Template ${source} uses unknown placeholder ${m}`);
    return values[name];
  });
}

/** The test project's folders, for lint and tsconfig include. */
const testFolders = (ctx) => [ctx.specsDir, ctx.pagesDir, 'fixtures', 'test-data', 'utils'];

/** package.json scripts for the mode. */
function scriptsFor(ctx) {
  const n = (k) => ctx.scriptNames[k];
  const lintTargets = ctx.merged ? ` ${[ctx.pwConfigFile, ...testFolders(ctx)].join(' ')}` : ' .';
  return {
    [n('test')]: 'playwright test',
    [n('smoke')]: 'playwright test --grep @smoke',
    [n('headed')]: 'playwright test --headed',
    [n('ui')]: 'playwright test --ui',
    [n('report')]: 'playwright show-report',
    [n('typecheck')]: `tsc --noEmit -p ${ctx.tsconfigFile}`,
    [n('lint')]: `eslint${lintTargets}`,
    [n('check')]: 'node utils/check-setup.mjs',
    [n('envInit')]: 'node utils/init-env.mjs',
    ...(ctx.sso && {
      [n('login')]: 'playwright test --project=setup',
      [n('loginForce')]: 'playwright test --project=setup',
      [n('loginCli')]: 'node utils/login-cli.mjs',
    }),
  };
}

// ---------------------------------------------------------------- merges and amendments

/** Merge our package.json into the app's: add only, keep the app's versions and scripts. */
function mergePackageJson(appText, ours) {
  const app = JSON.parse(appText);
  const indent = appText.match(/\n([ \t]+)"/)?.[1] ?? '  ';
  const changes = [];
  const kept = [];

  app.scripts ??= {};
  const addedScripts = [];
  for (const [name, cmd] of Object.entries(ours.scripts)) {
    if (app.scripts[name] === undefined) {
      app.scripts[name] = cmd;
      addedScripts.push(name);
    } else if (app.scripts[name] !== cmd) {
      kept.push(`script ${name} (already defined)`);
    }
  }
  if (addedScripts.length) changes.push(`scripts: ${addedScripts.join(', ')}`);

  const appDeps = { ...app.dependencies, ...app.devDependencies };
  app.devDependencies ??= {};
  const addedDeps = [];
  for (const [name, version] of Object.entries(ours.devDependencies)) {
    if (appDeps[name] === undefined) {
      app.devDependencies[name] = version;
      addedDeps.push(`${name}@${version}`);
    } else if (appDeps[name] !== version) {
      kept.push(`${name} ${appDeps[name]} (template pins ${version})`);
    }
  }
  if (addedDeps.length) changes.push(`devDependencies: ${addedDeps.join(', ')}`);

  return { content: changes.length ? `${JSON.stringify(app, null, indent)}\n` : null, changes, kept };
}

/** Append the .gitignore entries the app's file does not already have. */
function mergeGitignore(existing, ours) {
  const have = new Set(existing.split(/\r?\n/).map(ignoreKey));
  const hasEnvGlob = have.has('.env*') || have.has('*.env');
  const missing = ours
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .filter((l) => !have.has(ignoreKey(l)) && !(hasEnvGlob && ignoreKey(l).startsWith('.env')));
  if (!missing.length) return { content: null, changes: [] };
  const sep = existing.endsWith('\n') || !existing ? '' : '\n';
  return {
    content: `${existing}${sep}\n# Playwright (pw-setup-agent)\n${missing.join('\n')}\n`,
    changes: [`adds ${missing.join(', ')}`],
  };
}

/** Append the .env.example keys the app's file does not already have; existing keys are reused. */
function mergeEnvExample(existing, ours) {
  const have = new Set(envKeys(existing));
  const reused = envKeys(ours).filter((k) => have.has(k));
  const missing = ours.split(/\r?\n/).filter((l) => ENV_LINE.test(l) && !have.has(l.match(ENV_LINE)[1]));
  const kept = reused.length ? [`${reused.join(', ')} (reused by the tests)`] : [];
  if (!missing.length) return { content: null, changes: [], kept };
  const sep = existing.endsWith('\n') || !existing ? '' : '\n';
  return {
    content:
      `${existing}${sep}\n# Playwright (pw-setup-agent): application under test and test accounts.\n` +
      `# Fill in the empty values in .env only; never commit .env.\n${missing.join('\n')}\n`,
    changes: [`adds ${missing.map((l) => l.match(ENV_LINE)[1]).join(', ')}`],
    kept,
  };
}

/** The path aliases the templates import, as absolute targets. */
function aliasTargets(root, ctx) {
  return {
    '@pages/*': join(root, ctx.pagesDir, '*'),
    '@fixtures': join(root, 'fixtures', 'pages.fixture'),
    '@fixtures/*': join(root, 'fixtures', '*'),
    '@data/*': join(root, 'test-data', '*'),
    '@utils/*': join(root, 'utils', '*'),
  };
}

/**
 * Amends the app's tsconfig.json in place: missing aliases, the test folders
 * in include, node types. Comments and formatting are kept. Never touches
 * strict, target, module or moduleResolution.
 */
function amendTsconfig(root, insp, ctx) {
  const file = join(root, 'tsconfig.json');
  const text = read(file);
  const tree = parseJsonc(text);
  const eff = insp.tsconfig.eff;
  const co = member(tree, 'compilerOptions');
  const unit = indentUnit(text);
  const q = JSON.stringify;
  const edits = [];
  const changes = [];
  const kept = [];
  const coEntries = [];

  // paths: relative to the effective baseUrl, else this file's folder.
  const base = eff.baseUrl ?? root;
  const ours = aliasTargets(root, ctx);
  const ownPaths = member(co, 'paths');
  const inherited = eff.paths && eff.paths.file !== file ? eff.paths : null;
  const existingPaths = eff.paths?.value ?? {};
  const missingAliases = Object.keys(ours).filter((a) => existingPaths[a] === undefined);
  for (const a of Object.keys(ours).filter((x) => existingPaths[x] !== undefined)) {
    const want = relTarget(base, ours[a]);
    const have = [existingPaths[a]].flat()[0];
    const haveAbs = resolve(eff.paths.baseUrl, have);
    if (posix(haveAbs) !== posix(ours[a])) kept.push(`alias ${a} -> ${have} (the app's; the templates expect ${want})`);
  }
  if (missingAliases.length) {
    const entry = (a) => `${q(a)}: [${q(relTarget(base, ours[a]))}]`;
    if (ownPaths) {
      edits.push(appendEdit(text, ownPaths, missingAliases.map(entry)));
    } else {
      // A new paths object replaces inherited ones, so carry those over (rebased to this file).
      const carried = inherited
        ? Object.entries(inherited.value).map(([a, targets]) => `${q(a)}: [${[targets].flat().map((t) => q(relTarget(base, resolve(inherited.baseUrl, t)))).join(', ')}]`)
        : [];
      const all = [...carried, ...missingAliases.map(entry)];
      const coIndent = co ? (co.members.length ? lineIndent(text, co.members[0].keyStart) : lineIndent(text, co.start) + unit) : unit + unit;
      coEntries.push(`"paths": {\n${all.map((e) => `${coIndent}${unit}${e}`).join(',\n')}\n${coIndent}}`);
      if (inherited) changes.push(`copies ${Object.keys(inherited.value).length} inherited alias(es) from ${relative(root, inherited.file)}`);
    }
    changes.push(`aliases ${missingAliases.join(', ')}`);
  }

  // types: add node when a list exists, or on TypeScript 6+ (no automatic @types).
  const ownTypes = member(co, 'types');
  const types = eff.types?.value;
  if (types && !types.includes('node')) {
    if (ownTypes) edits.push(appendEdit(text, ownTypes, [q('node')]));
    else coEntries.push(`"types": [${[...types, 'node'].map(q).join(', ')}]`);
    changes.push('types: node');
  } else if (!types && insp.tsMajor >= 6) {
    coEntries.push('"types": ["node"]');
    changes.push('types: node');
  }

  if (coEntries.length) {
    if (co) edits.push(appendEdit(text, co, coEntries));
    else edits.push(appendEdit(text, tree, [`"compilerOptions": {\n${coEntries.map((e) => `${unit}${unit}${e}`).join(',\n')}\n${unit}}`]));
  }

  // include: add the test folders unless already covered (no include and no files = everything).
  const folders = [ctx.pwConfigFile, ...testFolders(ctx)];
  const ownInclude = member(tree, 'include');
  const inc = eff.include;
  if (inc || eff.files) {
    const incBase = inc ? dirname(inc.file) : root;
    const rebased = (inc?.value ?? []).map((p) => posix(relative(root, resolve(incBase, p))) || '.');
    const missing = folders.filter((f) => !includeCovers(rebased, f));
    if (missing.length) {
      const entries = missing.map((f) => q(f.endsWith('.ts') ? f : `${f}/**/*.ts`));
      if (ownInclude) edits.push(appendEdit(text, ownInclude, entries));
      else edits.push(appendEdit(text, tree, [`"include": [${[...rebased.map(q), ...entries].join(', ')}]`]));
      changes.push(`include: ${missing.join(', ')}`);
      if (!co?.js?.noEmit && (co?.js?.outDir || co?.js?.outFile)) {
        insp.notes.push("tsconfig.json emits files (outDir) and now includes the test folders: the app's tsc build will compile them too. Exclude them from the build step if that matters.");
      } else {
        insp.notes.push("tsconfig.json now includes the test folders, so the app's own tsc type-checks the tests too.");
      }
    }
  }
  const excluded = (eff.exclude?.value ?? []).map((p) => posix(p).replace(/^\.\//, '').replace(/\/(\*\*)?(\/\*)?$/, ''));
  const hidden = folders.filter((f) => excluded.includes(f));
  if (hidden.length) kept.push(`exclude lists ${hidden.join(', ')} (kept; the type check skips them)`);
  if (eff.strict !== true) kept.push('strict is off (kept; pw-check warns)');

  const content = applyEdits(text, edits);
  parseJsonc(content); // the result must still parse
  return { content: content === text ? null : content, changes, kept };
}

/**
 * tsconfig.e2e.json, extending the app's, for apps whose settings the tests
 * can't type-check under: node16/nodenext resolution (template imports have no
 * extensions) or a target/lib older than ES2017. The app's tsconfig.json is
 * left untouched in that case.
 */
function e2eTsconfig(root, insp, ctx) {
  const eff = insp.tsconfig.eff;
  const base = root; // the new file has no baseUrl of its own unless inherited
  const effBase = eff.baseUrl ?? base;
  const ours = aliasTargets(root, ctx);
  const paths = {};
  if (eff.paths) for (const [a, t] of Object.entries(eff.paths.value)) paths[a] = [t].flat().map((x) => relTarget(effBase, resolve(eff.paths.baseUrl, x)));
  for (const [a, abs] of Object.entries(ours)) paths[a] ??= [relTarget(effBase, abs)];
  const t = insp.tsconfig;
  const json = {
    extends: './tsconfig.json',
    compilerOptions: {
      ...(t.oldTarget && { target: 'ES2022', lib: ['ES2022', 'DOM'] }),
      ...(t.nodenext && { module: 'esnext', moduleResolution: 'bundler' }),
      noEmit: true,
      types: ['node'],
      paths,
    },
    include: [ctx.pwConfigFile, ...testFolders(ctx).map((f) => `${f}/**/*.ts`)],
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}

/** What the skill must add to an existing Playwright config. */
function playwrightAmendments(opts, insp, ctx) {
  const pw = insp.pw;
  const items = [];
  const p = opts.envPrefix;
  if (!pw.baseUrlFromEnv) {
    items.push(pw.baseUrlLiteral
      ? `baseURL: replace '${pw.baseUrlLiteral}' with env.baseUrl (the same URL is now the ${p}BASE_URL default in .env.example)`
      : `use.baseURL: env.baseUrl (from ${p}BASE_URL)`);
  }
  if (!pw.hasTrace) items.push("use.trace: 'on-first-retry'");
  if (!pw.hasScreenshot) items.push("use.screenshot: 'only-on-failure'");
  if (!pw.hasVideo) items.push("use.video: 'retain-on-failure'");
  if (!pw.hasBlob) items.push("reporter: env.isCI ? [['blob'], ['github']] : <keep the current reporters>");
  if ((!pw.baseUrlFromEnv || !pw.hasBlob) && !pw.importsEnv) items.push("import { env } from './utils/env';");
  if (ctx.tsconfigFile !== 'tsconfig.json') items.push(`tsconfig: './${ctx.tsconfigFile}' (the tests' own tsconfig; see the note)`);
  if (pw.testDirDynamic) items.push(`testDir is computed in code: make sure it resolves to ./${ctx.specsDir}, where the new specs go`);
  else if (!pw.testDir) items.push(`no testDir: Playwright looks everywhere; the new specs go in ${ctx.specsDir}/ (setting testDir: './${ctx.specsDir}' is optional)`);
  if (pw.testMatch) items.push(`testMatch is ${pw.testMatch}: make sure it collects *.spec.ts${ctx.sso ? ' (and the setup project matches *.setup.ts)' : ''}`);
  else if (ctx.specOnly) items.push(`testMatch: '**/*.spec.ts' (${ctx.specsDir}/ also holds unit tests; Playwright must not run them)`);
  if (ctx.sso) {
    if (!pw.importsAuth) items.push("import { storageStatePath } from './utils/auth';");
    if (!pw.hasSetupProject) items.push("projects: add { name: 'setup', testMatch: /.*\\.setup\\.ts/, timeout: (env.loginTimeoutMinutes + 2) * 60_000 } first");
    if (!pw.hasStorageState) {
      const browsers = (pw.projects ?? []).filter((n) => n !== 'setup');
      items.push(`projects: on each browser project (${browsers.join(', ') || 'none found'}) add dependencies: ['setup'] and use.storageState: storageStatePath('${opts.roles[0]}')`);
    }
  }
  return items;
}

/** What the skill must add to an existing ESLint config, with the block to add. */
function eslintAmendment(insp, ctx) {
  const file = insp.eslintConfig;
  const specGlob = `${ctx.specsDir}/**/*.ts`;
  const setupGlob = `${ctx.specsDir}/**/*.setup.ts`;
  const rules = {
    'playwright/no-wait-for-timeout': 'error',
    'playwright/no-focused-test': 'error',
    'playwright/no-page-pause': 'error',
    'playwright/prefer-web-first-assertions': 'error',
    'playwright/no-element-handle': 'error',
    'playwright/no-eval': 'error',
  };
  const legacy = file.startsWith('.eslintrc');
  const snippet = legacy
    ? JSON.stringify({ overrides: [
        { files: [specGlob], extends: ['plugin:playwright/recommended'], rules },
        { files: [setupGlob], rules: { 'playwright/no-conditional-in-test': 'off' } },
      ] }, null, 2)
    : [
        "import playwright from 'eslint-plugin-playwright';",
        '// ...in the exported array:',
        '{',
        `  files: ['${specGlob}'],`,
        "  ...playwright.configs['flat/recommended'],",
        `  rules: { ...playwright.configs['flat/recommended'].rules, ${Object.entries(rules).map(([k, v]) => `'${k}': '${v}'`).join(', ')} },`,
        '},',
        `{ files: ['${setupGlob}'], rules: { 'playwright/no-conditional-in-test': 'off' } },`,
      ].join('\n');
  return {
    items: [
      `${legacy ? 'an overrides entry' : 'a config block'} applying eslint-plugin-playwright's recommended rules to ${specGlob}`,
      `${setupGlob}: playwright/no-conditional-in-test off`,
      `the test folders (${testFolders(ctx).slice(1).join(', ')}) must parse as TypeScript: if the config has no TypeScript parser for them, add typescript-eslint's recommended config scoped to those folders`,
    ],
    snippet,
  };
}

// ---------------------------------------------------------------- the plan

function plan(opts, root) {
  const insp = inspect(opts, root);
  const merged = insp.mode === 'merged';
  const sso = opts.auth === 'google-sso';
  const scriptNames = Object.fromEntries(
    Object.entries(SCRIPT_NAMES)
      .filter(([k]) => sso || !SSO_SCRIPTS.includes(k))
      .map(([k, [plain, prefixed]]) => [k, merged ? prefixed : plain]),
  );
  const pm = pmCommands(insp.packageManager);
  const cmd = (k) => (k === 'test' && insp.packageManager === 'npm' && !merged ? 'npm test' : `${pm.run} ${scriptNames[k]}`);
  const tsconfigFile = insp.tsconfig.exists && insp.tsconfig.needsE2e ? 'tsconfig.e2e.json' : 'tsconfig.json';
  const ctx = {
    merged, sso, scriptNames, cmd, tsconfigFile,
    specsDir: insp.specsDir, pagesDir: insp.pagesDir, specOnly: insp.unitTests.length > 0,
    pwConfigFile: insp.pw.file ?? 'playwright.config.ts',
  };
  const values = placeholders(opts, ctx);

  // templates/project, with the --auth mode's files replacing or adding to it.
  const sources = new Map(walk(TEMPLATE_DIR).map((src) => [posix(relative(TEMPLATE_DIR, src)), src]));
  const authDir = AUTH_DIRS[opts.auth];
  if (authDir) for (const src of walk(authDir)) sources.set(posix(relative(authDir, src)), src);

  const rendered = [];
  for (const [templateRel, src] of sources) {
    let rel = templateRel;
    const name = basename(rel);
    if (RENAMES[name]) rel = posix(join(dirname(rel), RENAMES[name]));
    if (rel.startsWith('tests/')) rel = `${ctx.specsDir}/${rel.slice(6)}`;
    if (rel.startsWith('pages/')) rel = `${ctx.pagesDir}/${rel.slice(6)}`;
    let content = fill(read(src), values, relative(PLUGIN_ROOT, src));
    if (rel === 'package.json') {
      const pkg = JSON.parse(content);
      pkg.scripts = scriptsFor(ctx);
      if (sso) pkg.devDependencies[PLAYWRIGHT_CLI.name] = PLAYWRIGHT_CLI.version;
      content = `${JSON.stringify(pkg, null, 2)}\n`;
    }
    rendered.push({ path: rel, content, template: src });
  }
  for (const [src, dest] of Object.entries(COPIED_SCRIPTS)) {
    rendered.push({ path: dest, content: read(join(PLUGIN_ROOT, src)), template: join(PLUGIN_ROOT, src) });
  }
  const ourPkg = JSON.parse(rendered.find((f) => f.path === 'package.json').content);

  const previousCreated = new Set(insp.previous?.created ?? []);
  const amendments = [];
  const files = [];
  for (const f of rendered) {
    const abs = join(root, f.path);
    const entry = { path: f.path, content: f.content, template: f.template, changes: [], kept: [] };
    if (!existsSync(abs)) { files.push({ ...entry, status: 'create' }); continue; }
    const current = read(abs);
    const adopt = (changes = ['exists, kept']) => files.push({ ...entry, status: 'keep', changes });

    // Shared files: merged add-only.
    let merge = null;
    if (f.path === 'package.json' && merged) {
      try { merge = mergePackageJson(current, ourPkg); } catch { adopt(['not valid JSON; see the blocker']); continue; }
    } else if (f.path === '.gitignore') merge = mergeGitignore(current, f.content);
    else if (f.path === '.env.example') merge = mergeEnvExample(current, f.content);
    else if (f.path === 'tsconfig.json' && !previousCreated.has('tsconfig.json')) {
      if (insp.tsconfig.needsE2e) { adopt(['kept; the tests use tsconfig.e2e.json (see the note)']); continue; }
      try { merge = amendTsconfig(root, insp, ctx); } catch (e) { insp.blockers.push(`tsconfig.json could not be amended: ${e.message}`); adopt(['see the blocker']); continue; }
    }
    if (merge) {
      if (merge.content === null) files.push({ ...entry, status: 'keep', changes: ['already has everything'], kept: merge.kept ?? [] });
      else files.push({ ...entry, status: 'merge', content: merge.content, changes: merge.changes, kept: merge.kept ?? [] });
      continue;
    }

    if (opts.force && previousCreated.has(f.path)) { files.push({ ...entry, status: 'overwrite' }); continue; }

    // An existing .ts file the other templates import from: list what it lacks for the skill.
    if (/\.ts$/.test(f.path) && !f.path.startsWith(`${ctx.specsDir}/`)) {
      const missing = [...exportsOf(f.content)].filter((n) => !exportsOf(current).has(n));
      if (f.path === 'fixtures/pages.fixture.ts') {
        const fx = [...fixtureNames(f.content)].filter((n) => !fixtureNames(current).has(n));
        if (fx.length) missing.push(...fx.map((n) => `fixture ${n}`));
      }
      if (missing.length) {
        files.push({ ...entry, status: 'skill', changes: [`kept; needs ${missing.join(', ')}`] });
        amendments.push({ file: f.path, items: [`add ${missing.join(', ')} (as in the template; keep everything already there)`], template: f.template });
        continue;
      }
    }
    adopt();
  }

  // nodenext apps: a small tsconfig for the tests that extends theirs.
  if (ctx.tsconfigFile === 'tsconfig.e2e.json') {
    const abs = join(root, 'tsconfig.e2e.json');
    files.push({
      path: 'tsconfig.e2e.json', content: e2eTsconfig(root, insp, ctx), changes: [], kept: [],
      status: existsSync(abs) ? (opts.force && previousCreated.has('tsconfig.e2e.json') ? 'overwrite' : 'keep') : 'create',
    });
    const why = [
      insp.tsconfig.nodenext && `moduleResolution ${insp.tsconfig.eff.moduleResolution} (imports need file extensions)`,
      insp.tsconfig.oldTarget && 'a target/lib older than ES2017',
    ].filter(Boolean).join(' and ');
    insp.notes.push(`tsconfig.json uses ${why}, so the tests get tsconfig.e2e.json, which extends it with settings they type-check under. tsconfig.json is not changed.`);
  }

  // Existing Playwright config: kept; the skill amends it. Our template config is not written.
  if (insp.pw.file && insp.pw.file !== 'playwright.config.ts') {
    const i = files.findIndex((f) => f.path === 'playwright.config.ts');
    if (i >= 0) files.splice(i, 1);
  }
  if (insp.pw.file && !previousCreated.has(insp.pw.file)) {
    const i = files.findIndex((f) => f.path === insp.pw.file);
    const items = playwrightAmendments(opts, insp, ctx);
    const entry = { path: insp.pw.file, content: null, changes: [items.length ? 'kept; the skill amends it' : 'kept'], kept: [] };
    if (i >= 0) files[i] = { ...files[i], ...entry, status: items.length ? 'skill' : 'keep' };
    else files.push({ ...entry, status: items.length ? 'skill' : 'keep' });
    if (items.length) amendments.push({ file: insp.pw.file, items, template: join(TEMPLATE_DIR, 'playwright.config.ts') });
  }

  // Existing ESLint config: kept; the skill amends it. Our template config is not written.
  if (insp.eslintConfig && !previousCreated.has(insp.eslintConfig)) {
    const i = files.findIndex((f) => f.path === 'eslint.config.mjs');
    const { items, snippet } = eslintAmendment(insp, ctx);
    const entry = { path: insp.eslintConfig, content: null, changes: ['kept; the skill amends it'], kept: [], status: 'skill' };
    if (insp.eslintConfig === 'eslint.config.mjs' && i >= 0) files[i] = { ...files[i], ...entry };
    else {
      if (i >= 0) files.splice(i, 1);
      files.push(entry);
    }
    amendments.push({ file: insp.eslintConfig, items, snippet });
  }

  // Jest and Vitest also match *.spec.ts by default: keep them out of the Playwright specs.
  for (const runner of insp.unitRunners) {
    const glob = `${ctx.specsDir}/**/*.spec.ts`;
    const isVitest = runner === 'vitest';
    const configFile = insp.unitConfig && (isVitest ? /vite/.test(insp.unitConfig) : /jest|package\.json/.test(insp.unitConfig))
      ? insp.unitConfig
      : isVitest ? 'vitest.config.ts (create it if there is no Vite/Vitest config)' : 'jest.config.js, or a "jest" key in package.json (create it if there is none)';
    amendments.push({
      file: configFile,
      items: [
        isVitest
          ? `test.exclude: keep the current entries (default: configDefaults.exclude) and add '${glob}'`
          : `testPathIgnorePatterns: keep the current entries (default: '/node_modules/') and add '<rootDir>/${ctx.specsDir}/.*\\.spec\\.ts$'`,
        `${runner} would otherwise pick up the Playwright specs in ${ctx.specsDir}/ and fail on them`,
      ],
      snippet: isVitest
        ? `import { configDefaults } from 'vitest/config';\n// in defineConfig({ test: { ... } }):\nexclude: [...configDefaults.exclude, '${glob}'],`
        : `testPathIgnorePatterns: ['/node_modules/', '<rootDir>/${ctx.specsDir}/.*\\.spec\\.ts$'],`,
    });
  }

  // Reused env keys mean the app's BASE_URL value stays; don't override it in .env.
  const exampleFile = files.find((f) => f.path === '.env.example');
  const reusesBaseUrl = exampleFile?.kept?.some((k) => k.split(/[ ,]+/).includes(`${opts.envPrefix}BASE_URL`)) ?? false;

  const adopted = files.filter((f) => ['keep', 'skill', 'merge'].includes(f.status)).map((f) => f.path);

  // Files already in the test folders: the app's own tests and helpers. pw-check reports their
  // convention findings as warnings, not failures, and the skill never rewrites them.
  const preexisting = insp.previous?.preexisting ?? [ctx.specsDir, ctx.pagesDir, 'fixtures', 'test-data', 'utils']
    .flatMap((d) => (existsSync(join(root, d)) && statSync(join(root, d)).isDirectory() ? walk(join(root, d)) : []))
    .map((p) => posix(relative(root, p)))
    .filter((p) => !p.includes('node_modules/'));
  const keptPages = files.filter((f) => f.status === 'keep' && f.path.startsWith(`${ctx.pagesDir}/`) && f.path.endsWith('.ts')).map((f) => f.path);
  if (keptPages.length) {
    insp.notes.push(`The app's own ${keptPages.join(', ')} ${keptPages.length === 1 ? 'is' : 'are'} kept. The example specs were written for the template versions: adapt the new specs to the app's page objects (or drop the example spec), never the other way round.`);
  }
  const created = [...new Set([
    ...files.filter((f) => ['create', 'overwrite'].includes(f.status)).map((f) => f.path),
    ...(insp.previous?.created ?? []),
  ])].filter((p) => p !== 'pw-setup.json');

  const manifest = {
    plugin: 'pw-setup-agent',
    pluginVersion: PLUGIN_VERSION,
    createdAt: insp.previous?.createdAt ?? new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString().slice(0, 10),
    root: '.',
    mode: insp.mode,
    packageManager: insp.packageManager,
    browsers: opts.browsers,
    roles: opts.roles,
    playwrightVersion: insp.deps['@playwright/test'] ?? ourPkg.devDependencies['@playwright/test'],
    scripts: scriptNames,
    folders: { specs: ctx.specsDir, pages: ctx.pagesDir, fixtures: 'fixtures', testData: 'test-data', utils: 'utils' },
    configs: {
      playwright: ctx.pwConfigFile,
      testDir: insp.pw.file ? (insp.pw.testDir ?? null) : `./${ctx.specsDir}`,
      tsconfig: ctx.tsconfigFile,
      eslint: insp.eslintConfig ?? 'eslint.config.mjs',
    },
    env: { prefix: opts.envPrefix },
    auth: sso ? { mode: 'google-sso', meEndpoint: opts.meEndpoint, loginPath: opts.loginPath } : { mode: 'password' },
    adopted,
    preexisting,
    created,
  };
  const manifestStatus = existsSync(join(root, 'pw-setup.json')) ? 'overwrite' : 'create';
  files.push({ path: 'pw-setup.json', content: `${JSON.stringify(manifest, null, 2)}\n`, changes: [], kept: [], status: manifestStatus });
  files.sort((a, b) => a.path.localeCompare(b.path));

  return { ...insp, files, manifest, ctx, pm, amendments, reusesBaseUrl };
}

// ---------------------------------------------------------------- main

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const gitRoot = repoRoot();
  if (gitRoot && resolve(gitRoot) !== resolve(root)) {
    fail(`Run from the repository root (${gitRoot}). The project is always created there.`, 2);
  }

  const previous = readJson(join(root, 'pw-setup.json'));
  if (previous && !opts.envPrefix) opts.envPrefix = previous.env?.prefix ?? '';

  const p = plan(opts, root);
  const counts = { create: 0, merge: 0, keep: 0, skill: 0, overwrite: 0 };
  for (const f of p.files) counts[f.status]++;
  const ready = p.blockers.length === 0;
  const browsersToInstall = [...new Set(opts.browsers.map((b) => (BROWSERS[b].chrome ? 'chromium' : b.includes('safari') ? 'webkit' : b)))];
  const next = {
    amend: p.amendments.length ? 'Apply the AMEND items (the pw-setup skill does this, showing each change first).' : null,
    install: `${p.pm.install} && ${p.pm.exec} playwright install ${browsersToInstall.join(' ')}`,
    verify: ['typecheck', 'lint', 'check'].map(p.ctx.cmd).concat(`${p.pm.exec} playwright test --list`),
  };

  const result = {
    action: opts.write ? 'write' : 'dry-run',
    root,
    mode: p.mode,
    packageManager: p.packageManager,
    folders: p.manifest.folders,
    configs: p.manifest.configs,
    options: {
      baseUrl: opts.baseUrl, browsers: opts.browsers, roles: opts.roles, projectName: opts.projectName,
      envPrefix: opts.envPrefix, auth: opts.auth, meEndpoint: opts.meEndpoint, loginPath: opts.loginPath,
    },
    files: p.files.map(({ path, status, changes, kept }) => ({ path, status, changes, kept })),
    amendments: p.amendments.map(({ file, items, snippet, template }) => ({ file, items, snippet, template })),
    counts,
    blockers: p.blockers,
    notes: p.notes,
    ready,
    next,
    manifest: p.manifest,
    env: null,
  };

  if (opts.write && ready) {
    for (const f of p.files) {
      if (!['create', 'overwrite', 'merge'].includes(f.status)) continue;
      const abs = join(root, f.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
    }
    // Create (or sync) .env last, once .gitignore, .env.example and the manifest exist. Never forced.
    const envArgs = ['--root', root, '--json'];
    if (!p.reusesBaseUrl) envArgs.push('--base-url', opts.baseUrl);
    if (existsSync(join(root, '.env'))) envArgs.push('--sync');
    try {
      const out = execFileSync(process.execPath, [join(PLUGIN_ROOT, 'scripts', 'init_env.mjs'), ...envArgs], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      result.env = JSON.parse(out);
    } catch (err) {
      result.env = { error: (err.stderr || err.message || '').toString().trim() };
    }
  }

  const exitCode = p.blockers.length || result.env?.error ? 1 : 0;

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(exitCode);
  }

  const wrote = opts.write && ready;
  const icon = { create: '+', merge: '~', keep: '=', skill: '>', overwrite: '!' };
  console.log(`${wrote ? 'Scaffolded' : 'Dry run for'} ${root}`);
  console.log(
    `  mode: ${p.mode} · package manager: ${p.packageManager} · specs in ${p.ctx.specsDir}/ · page objects in ${p.ctx.pagesDir}/` +
      `${opts.envPrefix ? ` · env prefix ${opts.envPrefix}` : ''}${opts.auth === 'google-sso' ? ` · Google sign-in (who-am-I ${opts.meEndpoint})` : ''}`,
  );
  console.log(`  base URL: ${opts.baseUrl} · browsers: ${opts.browsers.join(', ')} · roles: ${opts.roles.join(', ')}`);
  console.log('');
  for (const f of p.files) {
    console.log(`  ${icon[f.status]} ${f.path}${f.changes.length ? `  (${f.changes.join('; ')})` : ''}`);
    for (const k of f.kept) console.log(`      keeps ${k}`);
  }
  console.log('');
  console.log(
    `  ${counts.create} to create, ${counts.merge} to amend, ${counts.skill} for the skill to amend, ` +
      `${counts.keep} kept as is${counts.overwrite ? `, ${counts.overwrite} to overwrite` : ''}`,
  );

  for (const a of p.amendments) {
    console.log(`\nAMEND ${a.file} (by the pw-setup skill, shown first):`);
    for (const item of a.items) console.log(`  - ${item}`);
    if (a.snippet) console.log(`  block to add:\n${a.snippet.replace(/^/gm, '    ')}`);
    if (a.template) console.log(`  template: ${a.template}`);
  }
  for (const b of p.blockers) console.log(`\nBLOCKED: ${b}`);
  for (const n of p.notes) console.log(`\nNOTE: ${n}`);

  if (!wrote) {
    console.log(ready ? '\nNothing written. Re-run with --write to apply this plan.' : '\nNothing written: fix the blockers above first.');
    process.exit(exitCode);
  }
  if (result.env?.error) {
    console.log(`\n.env was not created: ${result.env.error}`);
    process.exit(1);
  }
  const env = result.env;
  console.log(`\n.env: ${env.action}.${env.empty.length ? ` Empty: ${env.empty.join(', ')}` : ''}`);
  console.log(`\nNext:${next.amend ? `\n  ${next.amend}` : ''}\n  ${next.install}\n  ${next.verify.join('\n  ')}`);
}

main();
