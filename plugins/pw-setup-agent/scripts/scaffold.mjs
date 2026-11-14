#!/usr/bin/env node
/**
 * scaffold.mjs - create the Playwright + TypeScript test project.
 *
 *   node scaffold.mjs [options]            dry run: print what would be written
 *   node scaffold.mjs [options] --write    write the files, then create .env
 *
 * Options:
 *   --root DIR            target folder, relative to the current directory (default: . = repo root)
 *   --base-url URL        application URL for .env.example and .env (default: http://localhost:3000)
 *   --browsers LIST       comma-separated: chromium, firefox, webkit, mobile-chrome, mobile-safari
 *                         (default: chromium)
 *   --roles LIST          comma-separated test account roles (default: user)
 *   --project-name NAME   used for the package name (default: current folder name)
 *   --split-configs       write tsconfig.e2e.json and eslint.e2e.config.mjs instead of
 *                         tsconfig.json and eslint.config.mjs (needed when the app has its own)
 *   --env-prefix PREFIX   prefix the test env keys, e.g. E2E_ -> E2E_BASE_URL (for key clashes)
 *   --reuse-env-keys      use env keys the app's .env.example already has (for key clashes)
 *   --auth MODE           password (default): username/password login page
 *                         google-sso: "Sign in with Google" only; adds an auth setup step that
 *                         signs in through real Chrome and saves .auth/<role>.json
 *   --me-endpoint PATH    google-sso: the app's "who am I" endpoint (200 signed in, 401 not)
 *   --login-path PATH     google-sso: where the "Sign in with Google" button is (default: /)
 *   --force               overwrite existing pw-setup files (never .env, never the app's files)
 *   --json                machine-readable output
 *
 * Modes, picked from what is at --root:
 *   subfolder   --root is a sub-folder (e.g. tests): a self-contained project, as in 0.1.0
 *   standalone  --root is the repo root and it has no package.json: files written at the root
 *   merged      --root is the repo root and it has the app's package.json: shared files are
 *               merged add-only; anything that would change the app's own files is a decision
 *               (?) or a blocker, and --write refuses until it is resolved
 *
 * Run from the repository root. Node 18+, no dependencies.
 * Exit codes: 0 ok, 1 failed / blocked / unresolved decisions on --write, 2 bad arguments.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = join(PLUGIN_ROOT, 'templates', 'project');
/** Files that replace or add to templates/project for each --auth mode. */
const AUTH_DIRS = { password: null, 'google-sso': join(PLUGIN_ROOT, 'templates', 'auth', 'google-sso') };
const PLUGIN_VERSION = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

/** Template files whose published name differs (dotfiles are not stored as dotfiles). */
const RENAMES = { gitignore: '.gitignore', 'env.example': '.env.example', nvmrc: '.nvmrc' };

/** Plugin scripts copied into the project so it works without the plugin. */
const COPIED_SCRIPTS = {
  'scripts/check_setup.mjs': 'utils/check-setup.mjs',
  'scripts/init_env.mjs': 'utils/init-env.mjs',
};

/** Folders the project owns. In merged mode none of them may already hold app code. */
const PROJECT_DIRS = ['specs', 'pages', 'fixtures', 'test-data', 'utils'];

const SPLIT_NAMES = { 'tsconfig.json': 'tsconfig.e2e.json', 'eslint.config.mjs': 'eslint.e2e.config.mjs' };

const ESLINT_CONFIGS = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
];
const PLAYWRIGHT_CONFIGS = ['ts', 'js', 'mjs', 'cjs', 'mts', 'cts'].map((e) => `playwright.config.${e}`);
const LOCKFILES = { 'package-lock.json': 'npm', 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lockb': 'bun', 'bun.lock': 'bun' };
/** Frameworks that turn a root pages/ folder into app routes. */
const ROUTER_FRAMEWORKS = ['next', 'nuxt'];

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
  loginChrome: ['login:chrome', 'pw:login:chrome'],
};
const SSO_SCRIPTS = ['login', 'loginForce', 'loginChrome'];

/** Playwright projects: device, and whether a Chrome channel applies. */
const BROWSERS = {
  chromium: { device: 'Desktop Chrome', chrome: true },
  firefox: { device: 'Desktop Firefox', chrome: false },
  webkit: { device: 'Desktop Safari', chrome: false },
  'mobile-chrome': { device: 'Pixel 7', chrome: true },
  'mobile-safari': { device: 'iPhone 15', chrome: false },
};

function projectEntries(opts) {
  if (opts.auth !== 'google-sso') {
    return opts.browsers.map((b) => `    { name: '${b}', use: { ...devices['${BROWSERS[b].device}'] } },`).join('\n');
  }
  const role = opts.roles[0];
  const setup = '    // Signs in once per role and saves .auth/<role>.json (specs/auth/auth.setup.ts).\n' +
    "    { name: 'setup', testMatch: /.*\\.setup\\.ts/, timeout: 5 * 60_000 },";
  const browsers = opts.browsers.map((b) => {
    const channel = BROWSERS[b].chrome ? ' channel: env.browserChannel || undefined,' : '';
    return `    {\n      name: '${b}',\n      use: { ...devices['${BROWSERS[b].device}'],${channel} storageState: storageStatePath('${role}') },\n      dependencies: ['setup'],\n    },`;
  });
  return [setup, ...browsers].join('\n');
}

const USAGE =
  'usage: scaffold.mjs [--root DIR] [--base-url URL] [--browsers LIST] [--roles LIST] [--project-name NAME]\n' +
  '                    [--split-configs] [--env-prefix PREFIX | --reuse-env-keys]\n' +
  '                    [--auth password|google-sso] [--me-endpoint PATH] [--login-path PATH] [--write] [--force] [--json]';

function fail(message, code = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

function parseArgs(argv) {
  const opts = {
    root: '.',
    baseUrl: 'http://localhost:3000',
    browsers: ['chromium'],
    roles: ['user'],
    projectName: basename(process.cwd()),
    splitConfigs: false,
    envPrefix: '',
    reuseEnvKeys: false,
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
      case '--root': opts.root = needValue(i); i++; break;
      case '--base-url': opts.baseUrl = needValue(i); i++; break;
      case '--browsers': opts.browsers = list(needValue(i)); i++; break;
      case '--roles': opts.roles = list(needValue(i)); i++; break;
      case '--project-name': opts.projectName = needValue(i); i++; break;
      case '--split-configs': opts.splitConfigs = true; break;
      case '--env-prefix': opts.envPrefix = needValue(i); i++; break;
      case '--reuse-env-keys': opts.reuseEnvKeys = true; break;
      case '--auth': opts.auth = needValue(i); i++; break;
      case '--me-endpoint': opts.meEndpoint = needValue(i); i++; break;
      case '--login-path': opts.loginPath = needValue(i); i++; break;
      case '--write': opts.write = true; break;
      case '--dry-run': opts.write = false; break;
      case '--force': opts.force = true; break;
      case '--json': opts.json = true; break;
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
  if (opts.envPrefix && opts.reuseEnvKeys) fail('Use either --env-prefix or --reuse-env-keys, not both.', 2);
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

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const envKeys = (text) => text.split(/\r?\n/).map((l) => l.match(ENV_LINE)?.[1]).filter(Boolean);

/** Normalise a .gitignore line so "/.auth/", ".auth" and ".auth/" compare equal. */
const ignoreKey = (line) => line.trim().replace(/^\//, '').replace(/\/$/, '');

const major = (range) => Number(String(range).match(/\d+/)?.[0] ?? NaN);

function isNonEmptyDir(path) {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

/** How to run things with each package manager. */
function pmCommands(pm) {
  const run = { npm: 'npm run', pnpm: 'pnpm', yarn: 'yarn', bun: 'bun run' }[pm];
  const exec = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }[pm];
  return { install: `${pm} install`, run, exec };
}

// ---------------------------------------------------------------- inspect the target

function inspect(opts, target) {
  const isRoot = target === process.cwd();
  const appPkgPath = join(target, 'package.json');
  const mode = !isRoot ? 'subfolder' : existsSync(appPkgPath) ? 'merged' : 'standalone';
  const app = mode === 'merged' ? readJson(appPkgPath) : null;
  const deps = app ? { ...app.dependencies, ...app.devDependencies, ...app.peerDependencies } : {};
  const lockfile = Object.keys(LOCKFILES).find((f) => existsSync(join(target, f)));
  const packageManager = mode === 'merged' && lockfile ? LOCKFILES[lockfile] : 'npm';

  const facts = {
    mode,
    packageManager,
    lockfile: lockfile ?? null,
    appTsconfig: mode === 'merged' && existsSync(join(target, 'tsconfig.json')) ? 'tsconfig.json' : null,
    appEslintConfig: mode === 'merged' ? ESLINT_CONFIGS.find((f) => existsSync(join(target, f))) ?? null : null,
  };
  const blockers = [];
  const decisions = [];
  const notes = [];

  if (mode === 'merged' && !app) blockers.push('package.json at the root is not valid JSON. Fix it, or use --root tests.');

  // Already set up by pw-setup: the config and folders are ours, so only the manifest matters.
  // --force refreshes our files; the app's files are still never overwritten.
  const ours = existsSync(join(target, 'pw-setup.json'));
  if (ours && !opts.force) {
    blockers.push(`${relative(process.cwd(), join(target, 'pw-setup.json')) || 'pw-setup.json'} exists: this project was already set up. Run pw-check instead.`);
  }

  if (isRoot && !ours) {
    const pwConfig = PLAYWRIGHT_CONFIGS.find((f) => existsSync(join(target, f)));
    if (pwConfig) blockers.push(`The repo already has ${pwConfig}. Set up in a sub-folder with --root tests, or stop.`);
    else if (deps['@playwright/test']) {
      blockers.push(`package.json already depends on @playwright/test ${deps['@playwright/test']}. Set up in a sub-folder with --root tests, or stop.`);
    }
  }

  if (mode === 'merged') {
    const router = ROUTER_FRAMEWORKS.find((f) => deps[f]);
    if (router) {
      blockers.push(`This is a ${router === 'next' ? 'Next.js' : 'Nuxt'} app: a root pages/ folder becomes app routes, so test page objects cannot live at the root. Use --root tests.`);
    }
    const clashes = ours ? [] : PROJECT_DIRS.filter((d) => isNonEmptyDir(join(target, d)));
    if (clashes.length) {
      blockers.push(`These folders already exist with files in them: ${clashes.map((d) => `${d}/`).join(', ')}. The test project needs them, so use --root tests.`);
    }
    if ((facts.appTsconfig || facts.appEslintConfig) && !opts.splitConfigs && !ours) {
      const own = [facts.appTsconfig, facts.appEslintConfig].filter(Boolean).join(' and ');
      decisions.push({
        id: 'split-configs',
        question: `The app has its own ${own}. Write tsconfig.e2e.json and eslint.e2e.config.mjs for the tests instead (playwright.config.ts points at the tsconfig)?`,
        resolve: '--split-configs (recommended), or --root tests',
      });
    }
    if (major(deps.eslint) < 9) notes.push(`Kept the app's eslint ${deps.eslint}; the test lint config needs ESLint 9.22+.`);
    if (major(deps.typescript) < 5) notes.push(`Kept the app's typescript ${deps.typescript}; the test tsconfig needs TypeScript 5+.`);
    if (facts.appTsconfig) {
      notes.push('If the app tsconfig.json includes every .ts file, add the test folders to its "exclude" so the app build does not compile specs.');
    }
    if (facts.appEslintConfig) {
      notes.push(`If ${facts.appEslintConfig} lints the whole repo, add the test folders to its ignores; the tests have their own lint config.`);
    }
  }

  const nvmrc = join(target, '.nvmrc');
  if (existsSync(nvmrc)) {
    const pinned = readFileSync(nvmrc, 'utf8').trim().replace(/^v/, '');
    const [maj, min = 0] = pinned.split('.').map(Number);
    if (Number.isFinite(maj) && (maj < 20 || (maj === 20 && min < 12))) {
      notes.push(`.nvmrc pins Node ${pinned}; Playwright and the .env loader need Node 20.12+.`);
    }
  }

  const split = opts.splitConfigs;
  return { facts, blockers, decisions, notes, split, ours };
}

// ---------------------------------------------------------------- build the file plan

function placeholders(opts, ctx) {
  const p = opts.envPrefix;
  const sso = opts.auth === 'google-sso';
  // google-sso: <ROLE> is the account email; password mode: <ROLE>_USERNAME.
  const envKeysFor = (role) => [`${p}${role.toUpperCase()}${sso ? '' : '_USERNAME'}`, `${p}${role.toUpperCase()}_PASSWORD`];
  const rootRel = relative(process.cwd(), resolve(opts.root));
  return {
    PROJECT_NAME: opts.projectName,
    BASE_URL: opts.baseUrl,
    ENV_PREFIX: p,
    ENV_FILE: rootRel ? `${rootRel}/.env` : '.env',
    ENV_INIT_CMD: ctx.cmd('envInit'),
    ENV_INIT_HINT: `${ctx.cmd('envInit')}"${rootRel ? ` in ${rootRel}/` : ''}`,
    TSCONFIG_LINE: ctx.split ? "  tsconfig: './tsconfig.e2e.json',\n" : '',
    PROJECTS: projectEntries(opts),
    AUTH_IMPORT: sso ? "import { storageStatePath } from './utils/auth';\n" : '',
    ENV_EXTRA: sso
      ? `  authMaxAgeMinutes: Number(optionalEnv('${p}AUTH_MAX_AGE_MINUTES', '60')) || 60,\n` +
        `  browserChannel: optionalEnv('${p}AUTH_BROWSER_CHANNEL'),\n`
      : '',
    ME_ENDPOINT: opts.meEndpoint,
    LOGIN_PATH: opts.loginPath,
    ROLE_LIST: opts.roles.map((r) => `'${r}'`).join(', '),
    LOGIN_CHROME_CMD: sso ? ctx.cmd('loginChrome') : '',
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

/** package.json scripts for the mode. */
function scriptsFor(ctx) {
  const n = (k) => ctx.scriptNames[k];
  const tsconfig = ctx.split ? 'tsconfig.e2e.json' : 'tsconfig.json';
  const lintTargets = ctx.merged ? ' playwright.config.ts specs pages fixtures test-data utils' : ' .';
  return {
    [n('test')]: 'playwright test',
    [n('smoke')]: 'playwright test --grep @smoke',
    [n('headed')]: 'playwright test --headed',
    [n('ui')]: 'playwright test --ui',
    [n('report')]: 'playwright show-report',
    [n('typecheck')]: ctx.split ? `tsc -p ${tsconfig}` : 'tsc --noEmit',
    [n('lint')]: `eslint${ctx.split ? ' -c eslint.e2e.config.mjs' : ''}${lintTargets}`,
    [n('check')]: 'node utils/check-setup.mjs --root .',
    [n('envInit')]: 'node utils/init-env.mjs --root .',
    ...(ctx.sso && {
      [n('login')]: 'playwright test --project=setup --headed',
      [n('loginForce')]: 'playwright test --project=setup --headed',
      [n('loginChrome')]: 'node utils/login-chrome.mjs',
    }),
  };
}

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

/** Append the .env.example keys the app's file does not already have. */
function mergeEnvExample(existing, ours) {
  const have = new Set(envKeys(existing));
  const missing = ours.split(/\r?\n/).filter((l) => ENV_LINE.test(l) && !have.has(l.match(ENV_LINE)[1]));
  if (!missing.length) return { content: null, changes: [] };
  const sep = existing.endsWith('\n') || !existing ? '' : '\n';
  return {
    content:
      `${existing}${sep}\n# Playwright (pw-setup-agent): application under test and test accounts.\n` +
      `# Fill in the empty values in .env only; never commit .env.\n${missing.join('\n')}\n`,
    changes: [`adds ${missing.map((l) => l.match(ENV_LINE)[1]).join(', ')}`],
  };
}

function plan(opts, target) {
  const insp = inspect(opts, target);
  const { facts, split } = insp;
  const merged = facts.mode === 'merged';
  const sso = opts.auth === 'google-sso';
  const scriptNames = Object.fromEntries(
    Object.entries(SCRIPT_NAMES)
      .filter(([k]) => sso || !SSO_SCRIPTS.includes(k))
      .map(([k, [plain, prefixed]]) => [k, merged ? prefixed : plain]),
  );
  const pm = pmCommands(facts.packageManager);
  const cmd = (k) => (k === 'test' && facts.packageManager === 'npm' && !merged ? 'npm test' : `${pm.run} ${scriptNames[k]}`);
  const ctx = { split, merged, sso, scriptNames, cmd };
  const values = placeholders(opts, ctx);

  // templates/project, with the --auth mode's files replacing or adding to it.
  const sources = new Map(walk(TEMPLATE_DIR).map((src) => [relative(TEMPLATE_DIR, src), src]));
  const authDir = AUTH_DIRS[opts.auth];
  if (authDir) for (const src of walk(authDir)) sources.set(relative(authDir, src), src);

  const rendered = [];
  for (const [templateRel, src] of sources) {
    let rel = templateRel;
    const name = basename(rel);
    if (RENAMES[name]) rel = join(dirname(rel), RENAMES[name]);
    if (split && SPLIT_NAMES[rel]) rel = SPLIT_NAMES[rel];
    let content = fill(readFileSync(src, 'utf8'), values, relative(PLUGIN_ROOT, src));
    if (rel === 'package.json') {
      const pkg = JSON.parse(content);
      pkg.scripts = scriptsFor(ctx);
      content = `${JSON.stringify(pkg, null, 2)}\n`;
    }
    rendered.push({ path: rel, content });
  }
  for (const [src, dest] of Object.entries(COPIED_SCRIPTS)) {
    rendered.push({ path: dest, content: readFileSync(join(PLUGIN_ROOT, src), 'utf8') });
  }

  // Env key clashes with an existing .env.example (usually the app's BASE_URL).
  const examplePath = join(target, '.env.example');
  const ourExample = rendered.find((f) => f.path === '.env.example').content;
  const alreadySetUp = existsSync(join(target, 'pw-setup.json'));
  if (existsSync(examplePath) && !opts.reuseEnvKeys && !alreadySetUp) {
    const clash = envKeys(ourExample).filter((k) => envKeys(readFileSync(examplePath, 'utf8')).includes(k));
    if (clash.length) {
      insp.decisions.push({
        id: 'env-keys',
        question: `.env.example already has ${clash.join(', ')}. Use the existing keys for the tests, or prefix the test keys?`,
        resolve: '--env-prefix E2E_ (separate keys), or --reuse-env-keys (same values as the app)',
      });
    }
  }

  const ourPkg = JSON.parse(rendered.find((f) => f.path === 'package.json').content);
  const manifest = {
    plugin: 'pw-setup-agent',
    pluginVersion: PLUGIN_VERSION,
    createdAt: new Date().toISOString().slice(0, 10),
    root: relative(process.cwd(), target) || '.',
    mode: facts.mode,
    packageManager: facts.packageManager,
    browsers: opts.browsers,
    roles: opts.roles,
    playwrightVersion: ourPkg.devDependencies['@playwright/test'],
    scripts: scriptNames,
    configs: {
      tsconfig: split ? 'tsconfig.e2e.json' : 'tsconfig.json',
      eslint: split ? 'eslint.e2e.config.mjs' : 'eslint.config.mjs',
    },
    env: { prefix: opts.envPrefix },
    auth: sso ? { mode: 'google-sso', meEndpoint: opts.meEndpoint, loginPath: opts.loginPath } : { mode: 'password' },
  };
  rendered.push({ path: 'pw-setup.json', content: `${JSON.stringify(manifest, null, 2)}\n` });

  const files = rendered.map((f) => {
    const abs = join(target, f.path);
    const exists = existsSync(abs);
    const entry = { ...f, changes: [], kept: [] };
    if (!exists) return { ...entry, status: 'create' };

    const current = readFileSync(abs, 'utf8');
    let merge = null;
    if (f.path === 'package.json' && merged) {
      try {
        merge = mergePackageJson(current, ourPkg);
      } catch {
        return { ...entry, status: 'skip', changes: ['not valid JSON; see the blocker below'] };
      }
    }
    else if (f.path === '.gitignore') merge = mergeGitignore(current, f.content);
    else if (f.path === '.env.example') merge = mergeEnvExample(current, f.content);
    if (merge) {
      return merge.content === null
        ? { ...entry, status: 'skip', changes: ['already has everything'] }
        : { ...entry, status: 'merge', content: merge.content, changes: merge.changes, kept: merge.kept ?? [] };
    }

    if (f.path === '.nvmrc') return { ...entry, status: 'skip', changes: ["keeps the existing file"] };
    // The app's own tsconfig / eslint config in merged mode: never overwritten, even with --force.
    if (merged && !insp.ours && (f.path === 'tsconfig.json' || f.path === 'eslint.config.mjs')) {
      return { ...entry, status: 'decide', changes: ['the app has its own; see the decision below'] };
    }
    return { ...entry, status: opts.force ? 'overwrite' : 'skip' };
  });
  files.sort((a, b) => a.path.localeCompare(b.path));

  return { ...insp, files, manifest, ctx, pm };
}

// ---------------------------------------------------------------- main

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = resolve(opts.root);
  if (existsSync(target) && !statSync(target).isDirectory()) fail(`${opts.root} exists and is not a folder.`, 2);

  // Re-running in a project pw-setup made: keep its env prefix and config split unless given.
  const previous = readJson(join(target, 'pw-setup.json'));
  if (previous) {
    if (!opts.envPrefix && !opts.reuseEnvKeys) opts.envPrefix = previous.env?.prefix ?? '';
    if (!opts.splitConfigs) opts.splitConfigs = previous.configs?.tsconfig === 'tsconfig.e2e.json';
  }

  const p = plan(opts, target);
  const counts = { create: 0, merge: 0, overwrite: 0, skip: 0, decide: 0 };
  for (const f of p.files) counts[f.status]++;
  const ready = p.blockers.length === 0 && p.decisions.length === 0;
  const browsersToInstall = [...new Set(opts.browsers.map((b) => (b.includes('chrome') || b === 'chromium' ? 'chromium' : b.includes('safari') ? 'webkit' : b)))];
  const runIn = relative(process.cwd(), target);
  const next = {
    install: `${runIn ? `cd ${runIn} && ` : ''}${p.pm.install} && ${p.pm.exec} playwright install ${browsersToInstall.join(' ')}`,
    verify: ['typecheck', 'lint', 'check'].map(p.ctx.cmd).concat(`${p.pm.exec} playwright test --list`),
  };

  const result = {
    action: opts.write ? 'write' : 'dry-run',
    target,
    mode: p.facts.mode,
    packageManager: p.facts.packageManager,
    facts: p.facts,
    options: {
      baseUrl: opts.baseUrl, browsers: opts.browsers, roles: opts.roles, projectName: opts.projectName,
      splitConfigs: p.split, envPrefix: opts.envPrefix, reuseEnvKeys: opts.reuseEnvKeys,
      auth: opts.auth, meEndpoint: opts.meEndpoint, loginPath: opts.loginPath,
    },
    files: p.files.map(({ path, status, changes, kept }) => ({ path, status, changes, kept })),
    counts,
    blockers: p.blockers,
    decisions: p.decisions,
    notes: p.notes,
    ready,
    next,
    manifest: p.manifest,
    env: null,
  };

  if (opts.write && ready) {
    for (const f of p.files) {
      if (!['create', 'overwrite', 'merge'].includes(f.status)) continue;
      const abs = join(target, f.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
    }
    // Create (or sync) .env last, once .gitignore, .env.example and the manifest exist. Never forced.
    const envArgs = ['--root', target, '--base-url', opts.baseUrl, '--json'];
    if (existsSync(join(target, '.env'))) envArgs.push('--sync');
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

  const exitCode = p.blockers.length || (opts.write && !ready) || result.env?.error ? 1 : 0;

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(exitCode);
  }

  const wrote = opts.write && ready;
  const icon = { create: '+', merge: '~', overwrite: '!', skip: '=', decide: '?' };
  console.log(`${wrote ? 'Scaffolded' : 'Dry run for'} ${target}`);
  console.log(`  mode: ${p.facts.mode} · package manager: ${p.facts.packageManager}${p.split ? ' · split configs' : ''}${opts.envPrefix ? ` · env prefix ${opts.envPrefix}` : ''}${opts.auth === 'google-sso' ? ` · Google sign-in (who-am-I ${opts.meEndpoint})` : ''}`);
  console.log(`  base URL: ${opts.baseUrl} · browsers: ${opts.browsers.join(', ')} · roles: ${opts.roles.join(', ')}`);
  console.log('');
  for (const f of p.files) {
    const suffix = f.status === 'skip' && !f.changes.length ? '  (exists, skipped)' : f.changes.length ? `  (${f.changes.join('; ')})` : '';
    console.log(`  ${icon[f.status]} ${f.path}${suffix}`);
    for (const k of f.kept) console.log(`      keeps ${k}`);
  }
  console.log('');
  console.log(
    `  ${counts.create} to create, ${counts.merge} to merge, ${counts.overwrite} to overwrite, ` +
      `${counts.skip} skipped${counts.decide ? `, ${counts.decide} need a decision` : ''}`,
  );

  for (const b of p.blockers) console.log(`\nBLOCKED: ${b}`);
  for (const d of p.decisions) console.log(`\nDECISION (${d.id}): ${d.question}\n  re-run with: ${d.resolve}`);
  for (const n of p.notes) console.log(`\nNOTE: ${n}`);

  if (!wrote) {
    if (opts.write) console.log('\nNothing written: resolve the blockers and decisions above first.');
    else if (ready) console.log('\nNothing written. Re-run with --write to apply this plan.');
    else console.log('\nNothing written. Resolve the blockers and decisions above, then re-run.');
    process.exit(exitCode);
  }
  if (result.env?.error) {
    console.log(`\n.env was not created: ${result.env.error}`);
    process.exit(1);
  }
  const env = result.env;
  console.log(`\n.env: ${env.action}.${env.empty.length ? ` Fill in: ${env.empty.join(', ')}` : ''}`);
  console.log(`\nNext:\n  ${next.install}\n  ${next.verify.join('\n  ')}`);
}

main();
