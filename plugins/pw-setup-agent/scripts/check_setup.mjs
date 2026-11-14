#!/usr/bin/env node
/**
 * check_setup.mjs - verify a Playwright test project follows the
 * pw-setup-agent conventions.
 *
 *   node check_setup.mjs --root tests          levels 1-2 (read-only)
 *   node check_setup.mjs --root tests --json   machine-readable output
 *
 * Level 1 - structure: folders, config, tsconfig, .gitignore, env files, manifest.
 * Level 2 - conventions: page objects, fixtures, imports, locators, waits,
 *           secrets, artifact settings.
 *
 * Read-only: it never changes files and never prints .env values.
 * Copied into projects as tests/utils/check-setup.mjs (`npm run check`), so
 * CI can run it without the plugin. Node 18+, no dependencies.
 *
 * Exit codes: 0 no failures (warnings allowed), 1 at least one failure,
 * 2 bad arguments or the root folder does not exist.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const USAGE = 'usage: check_setup.mjs [--root DIR] [--json]';

function parseArgs(argv) {
  const opts = { root: '.', json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') opts.root = argv[++i];
    else if (arg === '--json') opts.json = true;
    else if (arg === '--run' || arg === '--smoke') {
      console.error(`${arg} (level 3: running the project) is not available in this version yet.`);
      process.exit(2);
    } else if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}\n${USAGE}`);
      process.exit(2);
    }
  }
  if (!opts.root) {
    console.error(`--root needs a value\n${USAGE}`);
    process.exit(2);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const ROOT = resolve(opts.root);
if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) {
  console.error(`ERROR: ${ROOT} is not a folder. Pass the test project folder with --root.`);
  process.exit(2);
}

// ---------------------------------------------------------------- helpers

const results = [];

/**
 * Record one check.
 * status: pass | warn | fail | info | skip
 */
function report(level, title, status, { detail = '', hint = '', skill = '', locations = [] } = {}) {
  results.push({ level, title, status, detail, hint, skill, locations });
}

const abs = (rel) => join(ROOT, rel);
const has = (rel) => existsSync(abs(rel));
const read = (rel) => readFileSync(abs(rel), 'utf8');

function listFiles(dir, test = () => true, out = []) {
  const base = abs(dir);
  if (!existsSync(base)) return out;
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const rel = join(dir, e.name);
    if (e.isDirectory()) listFiles(rel, test, out);
    else if (test(e.name)) out.push(rel);
  }
  return out;
}

/** Remove comments but keep line numbers, so findings point at real lines. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** All matches of `regex` (must be /g) in a file, as "file:line". */
function findAll(rel, text, regex) {
  const out = [];
  for (const m of text.matchAll(regex)) out.push(`${rel}:${lineAt(text, m.index)}`);
  return out;
}

/** Text with the body of `methodName(...) { ... }` blanked out (lines kept). */
function withoutMethod(text, methodName) {
  const start = text.search(new RegExp(`\\b${methodName}\\s*\\([^)]*\\)[^{]*\\{`));
  if (start < 0) return text;
  let i = text.indexOf('{', start);
  let depth = 0;
  const from = i;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) break;
  }
  return text.slice(0, from) + text.slice(from, i + 1).replace(/[^\n]/g, ' ') + text.slice(i + 1);
}

function git(args) {
  try {
    const stdout = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { status: 0, stdout };
  } catch (err) {
    return { status: typeof err.status === 'number' ? err.status : 128, stdout: (err.stdout || '').toString() };
  }
}

const isGitRepo = git(['rev-parse', '--is-inside-work-tree']).status === 0;

/** Parse JSON with comments and trailing commas (tsconfig style), string-aware. */
function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const envKeys = (text) => text.split(/\r?\n/).map((l) => l.match(ENV_LINE)?.[1]).filter(Boolean);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- level 1: structure

const L1 = 'Structure';

{
  const required = ['specs', 'pages', 'fixtures', 'test-data', 'utils'];
  const missing = required.filter((d) => !has(d) || !statSync(abs(d)).isDirectory());
  if (missing.length) {
    report(L1, 'Folders', 'fail', {
      detail: `missing: ${missing.join(', ')}`,
      hint: 'Create the missing folders, or re-run pw-setup to add them.',
      skill: 'pw-setup',
    });
  } else {
    report(L1, 'Folders', 'pass', { detail: required.join(', ') });
  }
}

const configFile = ['playwright.config.ts', 'playwright.config.mts'].find(has);
const config = configFile ? stripComments(read(configFile)) : null;

if (!configFile) {
  report(L1, 'Config file', 'fail', {
    detail: 'playwright.config.ts not found',
    hint: 'Run pw-setup, or create playwright.config.ts in the project root.',
    skill: 'pw-core-config',
  });
} else {
  report(L1, 'Config file', 'pass', { detail: configFile });

  if (/testDir\s*:\s*['"`]\.?\/?specs\/?['"`]/.test(config)) {
    report(L1, 'Config: testDir', 'pass', { detail: "'./specs'" });
  } else {
    report(L1, 'Config: testDir', 'fail', {
      detail: 'testDir is not ./specs',
      hint: "Set testDir: './specs' so only specs are collected.",
      skill: 'pw-core-config',
    });
  }

  if (/baseURL\s*:\s*(env\.|process\.env)/.test(config)) {
    report(L1, 'Config: baseURL', 'pass', { detail: 'read from env' });
  } else if (/baseURL\s*:\s*['"`]/.test(config)) {
    report(L1, 'Config: baseURL', 'fail', {
      detail: 'baseURL is hard-coded',
      hint: 'Use baseURL: env.baseUrl and set BASE_URL in .env, so each environment can point elsewhere.',
      skill: 'pw-core-config',
    });
  } else {
    report(L1, 'Config: baseURL', 'warn', {
      detail: 'no baseURL in use',
      hint: 'Set use.baseURL from env so specs and page objects can use relative paths.',
      skill: 'pw-core-config',
    });
  }
}

if (!has('tsconfig.json')) {
  report(L1, 'TypeScript config', 'fail', {
    detail: 'tsconfig.json not found',
    hint: 'Re-run pw-setup to add tsconfig.json.',
    skill: 'pw-core-config',
  });
} else {
  let ts = null;
  try {
    ts = parseJsonc(read('tsconfig.json'));
  } catch (err) {
    report(L1, 'TypeScript config', 'fail', { detail: `tsconfig.json is not valid JSON: ${err.message}` });
  }
  if (ts) {
    const co = ts.compilerOptions || {};
    if (co.strict === true) report(L1, 'TypeScript: strict', 'pass');
    else {
      report(L1, 'TypeScript: strict', 'fail', {
        detail: 'compilerOptions.strict is not true',
        hint: 'Set "strict": true. Type errors are cheaper to find than test failures.',
        skill: 'pw-core-config',
      });
    }

    const paths = co.paths || {};
    const expected = ['@pages/*', '@fixtures', '@data/*', '@utils/*'];
    const missingAliases = expected.filter((a) => !paths[a]);
    const broken = [];
    for (const [alias, targets] of Object.entries(paths)) {
      for (const t of targets) {
        const base = t.replace(/\/\*$/, '');
        const candidates = [base, `${base}.ts`, join(base, 'index.ts')];
        if (!candidates.some((c) => has(c))) broken.push(`${alias} -> ${t}`);
      }
    }
    if (broken.length) {
      report(L1, 'TypeScript: path aliases', 'fail', {
        detail: `aliases point at missing files: ${broken.join('; ')}`,
        hint: 'Fix the paths in tsconfig.json or restore the missing folder.',
        skill: 'pw-core-config',
      });
    } else if (missingAliases.length) {
      report(L1, 'TypeScript: path aliases', 'warn', {
        detail: `missing aliases: ${missingAliases.join(', ')}`,
        hint: 'Add them to compilerOptions.paths so imports stay short and stable.',
        skill: 'pw-core-config',
      });
    } else {
      report(L1, 'TypeScript: path aliases', 'pass', { detail: expected.join(', ') });
    }
  }
}

{
  const samples = { '.env': '.env', '.auth/': '.auth/user.json', 'test-results/': 'test-results/x', 'playwright-report/': 'playwright-report/index.html' };
  let notIgnored = [];
  if (isGitRepo) {
    const r = git(['check-ignore', '--no-index', ...Object.values(samples)]);
    const ignored = new Set(r.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
    notIgnored = Object.entries(samples).filter(([, p]) => !ignored.has(p)).map(([name]) => name);
  } else {
    const lines = has('.gitignore') ? read('.gitignore').split(/\r?\n/).map((l) => l.trim().replace(/^\//, '')) : [];
    notIgnored = Object.keys(samples).filter((name) => !lines.includes(name) && !lines.includes(name.replace(/\/$/, '')));
  }
  if (notIgnored.length) {
    report(L1, 'Gitignore', 'fail', {
      detail: `not ignored: ${notIgnored.join(', ')}`,
      hint: 'Add them to .gitignore. .env and .auth/ hold credentials and session cookies.',
      skill: 'pw-setup',
    });
  } else {
    report(L1, 'Gitignore', 'pass', { detail: Object.keys(samples).join(', ') });
  }
}

const exampleKeys = has('.env.example') ? envKeys(read('.env.example')) : null;
{
  const sources = [
    ...(configFile ? [configFile] : []),
    ...listFiles('utils', (n) => n.endsWith('.ts')),
    ...listFiles('test-data', (n) => n.endsWith('.ts')),
    ...listFiles('fixtures', (n) => n.endsWith('.ts')),
    ...listFiles('pages', (n) => n.endsWith('.ts')),
    ...listFiles('specs', (n) => n.endsWith('.ts')),
  ];
  const used = new Map();
  const patterns = [
    /\b(?:requireEnv|optionalEnv)\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g,
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g,
  ];
  const IGNORED_VARS = new Set(['CI', 'NODE_ENV', 'DEBUG', 'PWDEBUG', 'HOME', 'PATH']);
  for (const rel of sources) {
    const text = stripComments(read(rel));
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        if (!IGNORED_VARS.has(m[1]) && !used.has(m[1])) used.set(m[1], `${rel}:${lineAt(text, m.index)}`);
      }
    }
  }

  if (!exampleKeys) {
    report(L1, 'Env example', 'fail', {
      detail: '.env.example not found',
      hint: 'Create .env.example listing every variable the tests read, with secrets left empty.',
      skill: 'pw-setup',
    });
  } else {
    const missing = [...used.keys()].filter((k) => !exampleKeys.includes(k));
    if (missing.length) {
      report(L1, 'Env example', 'fail', {
        detail: `read by the code but not in .env.example: ${missing.join(', ')}`,
        hint: 'Add each key to .env.example (secrets with an empty value).',
        skill: 'pw-setup',
        locations: missing.map((k) => used.get(k)),
      });
    } else {
      report(L1, 'Env example', 'pass', { detail: `${plural(used.size, 'variable')} used, all listed` });
    }
  }
}

{
  const tracked = isGitRepo && git(['ls-files', '--error-unmatch', '.env']).status === 0;
  if (tracked) {
    report(L1, '.env file', 'fail', {
      detail: '.env is committed to git',
      hint: 'Run `git rm --cached .env`, commit, and rotate any credentials it held.',
      skill: 'pw-setup',
    });
  } else if (process.env.CI) {
    report(L1, '.env file', 'skip', { detail: 'CI: values come from secrets' });
  } else if (!has('.env')) {
    report(L1, '.env file', 'warn', {
      detail: '.env not found',
      hint: 'Run `npm run env:init`, then fill in the empty values.',
      skill: 'pw-setup',
    });
  } else {
    const missing = exampleKeys ? exampleKeys.filter((k) => !envKeys(read('.env')).includes(k)) : [];
    if (missing.length) {
      report(L1, '.env file', 'warn', {
        detail: `missing keys: ${missing.join(', ')}`,
        hint: 'Run `npm run env:init -- --sync` to add them.',
        skill: 'pw-setup',
      });
    } else {
      report(L1, '.env file', 'pass', { detail: 'present, has every key in .env.example' });
    }
  }
}

if (has('pw-setup.json')) {
  let manifest = null;
  try {
    manifest = JSON.parse(read('pw-setup.json'));
  } catch {
    /* reported below */
  }
  if (manifest) report(L1, 'Setup manifest', 'pass', { detail: `pw-setup-agent ${manifest.pluginVersion}, ${manifest.createdAt}` });
  else report(L1, 'Setup manifest', 'warn', { detail: 'pw-setup.json is not valid JSON' });
} else {
  report(L1, 'Setup manifest', 'warn', {
    detail: 'pw-setup.json not found',
    hint: 'The project was not created by pw-setup, so some checks may not apply.',
    skill: 'pw-setup',
  });
}

// ---------------------------------------------------------------- level 2: conventions

const L2 = 'Conventions';

const pageFiles = listFiles('pages', (n) => n.endsWith('.page.ts')).filter((f) => !f.endsWith('base.page.ts'));
const componentFiles = listFiles('pages', (n) => n.endsWith('.component.ts'));
const specFiles = listFiles('specs', (n) => /\.(spec|test)\.ts$/.test(n));
const setupFiles = listFiles('specs', (n) => n.endsWith('.setup.ts'));
const fixtureFiles = listFiles('fixtures', (n) => n.endsWith('.ts'));
const code = (rel) => stripComments(read(rel));

{
  if (!pageFiles.length) {
    report(L2, 'Page objects', 'warn', {
      detail: 'no *.page.ts files in pages/',
      hint: 'Put each page in pages/<name>.page.ts, extending BasePage.',
      skill: 'pw-page-objects',
    });
  } else {
    const notExtending = pageFiles.filter((f) => !/\bextends\s+BasePage\b/.test(code(f)));
    if (notExtending.length) {
      report(L2, 'Page objects extend BasePage', 'fail', {
        detail: `${plural(notExtending.length, 'page object')} not extending BasePage`,
        hint: 'Extend BasePage and implement path and waitForReady().',
        skill: 'pw-page-objects',
        locations: notExtending,
      });
    } else {
      report(L2, 'Page objects extend BasePage', 'pass', { detail: plural(pageFiles.length, 'page object') });
    }

    const asserting = [];
    for (const f of pageFiles) asserting.push(...findAll(f, withoutMethod(code(f), 'waitForReady'), /\bexpect\s*[.(]/g));
    for (const f of componentFiles) asserting.push(...findAll(f, code(f), /\bexpect\s*[.(]/g));
    if (asserting.length) {
      report(L2, 'No assertions in page objects', 'fail', {
        detail: `${plural(asserting.length, 'expect')} outside waitForReady()`,
        hint: 'Return locators or values from the page object and assert in the spec.',
        skill: 'pw-page-objects',
        locations: asserting,
      });
    } else {
      report(L2, 'No assertions in page objects', 'pass');
    }
  }
}

{
  const fixtureText = fixtureFiles.map(code).join('\n');
  const classes = [];
  for (const f of pageFiles) {
    for (const m of code(f).matchAll(/export\s+class\s+(\w+)\s+extends\s+BasePage/g)) classes.push({ name: m[1], file: f });
  }
  const unregistered = classes.filter((c) => !new RegExp(`new\\s+${c.name}\\s*\\(`).test(fixtureText));
  if (unregistered.length) {
    report(L2, 'Page objects registered as fixtures', 'fail', {
      detail: `not in fixtures/: ${unregistered.map((c) => c.name).join(', ')}`,
      hint: 'Add each one to fixtures/pages.fixture.ts so specs can ask for it by name.',
      skill: 'pw-page-objects',
      locations: unregistered.map((c) => c.file),
    });
  } else if (classes.length) {
    report(L2, 'Page objects registered as fixtures', 'pass', { detail: classes.map((c) => c.name).join(', ') });
  }

  const constructed = [];
  for (const f of specFiles) constructed.push(...findAll(f, code(f), /\bnew\s+\w+(?:Page|Component)\s*\(/g));
  if (constructed.length) {
    report(L2, 'Specs use page fixtures', 'fail', {
      detail: `${plural(constructed.length, 'page object')} created with new in specs`,
      hint: 'Ask for the page in the test arguments instead, e.g. async ({ loginPage }) => ...',
      skill: 'pw-page-objects',
      locations: constructed,
    });
  } else if (specFiles.length) {
    report(L2, 'Specs use page fixtures', 'pass');
  }
}

{
  const direct = [];
  for (const f of specFiles) direct.push(...findAll(f, code(f), /from\s+['"]@playwright\/test['"]/g));
  if (direct.length) {
    report(L2, 'Specs import from @fixtures', 'fail', {
      detail: `${plural(direct.length, 'spec file')} importing test from @playwright/test`,
      hint: "Use import { test, expect } from '@fixtures' so page fixtures are available.",
      skill: 'pw-page-objects',
      locations: direct,
    });
  } else if (specFiles.length) {
    report(L2, 'Specs import from @fixtures', 'pass', { detail: plural(specFiles.length, 'spec file') });
  } else {
    report(L2, 'Specs import from @fixtures', 'warn', { detail: 'no spec files in specs/', skill: 'pw-page-objects' });
  }
}

const locatorFiles = [...pageFiles, ...componentFiles, ...specFiles, ...setupFiles, ...fixtureFiles];
{
  const xpath = [];
  const handles = [];
  const css = [];
  for (const f of locatorFiles) {
    const t = code(f);
    xpath.push(...findAll(f, t, /\.locator\(\s*['"`](?:xpath=|\(?\/\/)/g));
    handles.push(...findAll(f, t, /\.\$\$?(?:eval)?\s*\(/g));
    css.push(...findAll(f, t, /\.locator\(\s*['"`](?!xpath=|\(?\/\/|internal:)/g));
  }
  if (xpath.length) {
    report(L2, 'Locators: no XPath', 'fail', {
      detail: `${plural(xpath.length, 'XPath locator')}`,
      hint: 'Use getByRole, getByLabel or getByTestId. XPath breaks when the layout changes.',
      skill: 'pw-locators',
      locations: xpath,
    });
  } else {
    report(L2, 'Locators: no XPath', 'pass');
  }
  if (handles.length) {
    report(L2, 'Locators: no element handles', 'fail', {
      detail: `${plural(handles.length, 'use')} of page.$ / $$ / $eval`,
      hint: 'Use locators. Element handles do not auto-wait or retry.',
      skill: 'pw-locators',
      locations: handles,
    });
  } else {
    report(L2, 'Locators: no element handles', 'pass');
  }
  report(L2, 'Locators: CSS count', 'info', {
    detail: css.length ? `${plural(css.length, 'CSS locator')}; prefer role, label or test id where possible` : 'no CSS locators',
    skill: css.length ? 'pw-locators' : '',
    locations: css,
  });
}

{
  const sleeps = [];
  const only = [];
  const fragile = [];
  for (const f of locatorFiles) {
    const t = code(f);
    sleeps.push(...findAll(f, t, /\.waitForTimeout\s*\(/g));
    only.push(...findAll(f, t, /\b(?:test|describe|it)(?:\.describe)?\.only\s*\(/g));
    fragile.push(...findAll(f, t, /\.waitForSelector\s*\(|waitForLoadState\(\s*['"`]networkidle['"`]/g));
  }
  if (sleeps.length) {
    report(L2, 'Waits: no fixed sleeps', 'fail', {
      detail: `${plural(sleeps.length, 'waitForTimeout call')}`,
      hint: 'Wait for a condition instead: await expect(locator).toBeVisible().',
      skill: 'pw-locators',
      locations: sleeps,
    });
  } else {
    report(L2, 'Waits: no fixed sleeps', 'pass');
  }
  if (fragile.length) {
    report(L2, 'Waits: web-first', 'warn', {
      detail: `${plural(fragile.length, 'waitForSelector / networkidle wait')}`,
      hint: 'Prefer web-first assertions on locators; they retry until the condition holds.',
      skill: 'pw-locators',
      locations: fragile,
    });
  }
  if (only.length) {
    report(L2, 'No focused tests', 'fail', {
      detail: `${plural(only.length, '.only')} left in`,
      hint: 'Remove .only. On CI, forbidOnly fails the whole run.',
      skill: 'pw-core-config',
      locations: only,
    });
  } else {
    report(L2, 'No focused tests', 'pass');
  }
}

{
  const secretRe = /\b(?:password|passwd|pwd|token|secret|api[_-]?key)\b['"`]?\s*[:=]\s*(['"`])[^'"`\s][^'"`]*\1/gi;
  const leaks = [];
  for (const f of [...pageFiles, ...componentFiles, ...specFiles, ...setupFiles, ...fixtureFiles]) {
    leaks.push(...findAll(f, code(f), secretRe));
  }
  if (leaks.length) {
    report(L2, 'No hard-coded secrets', 'fail', {
      detail: `${plural(leaks.length, 'literal')} assigned to a password, token or key`,
      hint: 'Read credentials from test-data/users.ts, which reads them from env.',
      skill: 'pw-page-objects',
      locations: leaks,
    });
  } else {
    report(L2, 'No hard-coded secrets', 'pass');
  }
}

if (config) {
  const expected = {
    trace: ['on-first-retry', 'retain-on-failure'],
    screenshot: ['only-on-failure'],
    video: ['retain-on-failure', 'on-first-retry', 'off'],
  };
  const off = [];
  for (const [key, allowed] of Object.entries(expected)) {
    const m = config.match(new RegExp(`\\b${key}\\s*:\\s*['"\`]([\\w-]+)['"\`]`));
    if (!m) off.push(`${key} not set`);
    else if (!allowed.includes(m[1])) off.push(`${key}: '${m[1]}' (recommended: '${allowed[0]}')`);
  }
  if (!/process\.env\.CI|env\.isCI/.test(config) || !/['"`]blob['"`]/.test(config)) {
    off.push('no blob reporter on CI');
  }
  if (off.length) {
    report(L2, 'Artifact settings', 'warn', {
      detail: off.join('; '),
      hint: 'Keep traces, screenshots and videos only for failures, so runs stay fast and reports small.',
      skill: 'pw-core-config',
    });
  } else {
    report(L2, 'Artifact settings', 'pass', { detail: 'trace, screenshot, video and CI reporter as recommended' });
  }
}

// ---------------------------------------------------------------- output

const counts = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 };
for (const r of results) counts[r.status]++;

if (opts.json) {
  console.log(JSON.stringify({ root: ROOT, counts, ok: counts.fail === 0, results }, null, 2));
} else {
  const ICON = { pass: '✅', warn: '⚠️ ', fail: '❌', info: 'ℹ️ ', skip: '⏭️ ' };
  const MAX_LOCATIONS = 10;
  console.log(`pw-check: ${ROOT}`);
  let level = null;
  for (const r of results) {
    if (r.level !== level) {
      level = r.level;
      console.log(`\n${level === L1 ? 'Level 1' : 'Level 2'} · ${level}`);
    }
    console.log(`  ${ICON[r.status]} ${r.title}${r.detail ? ` - ${r.detail}` : ''}`);
    for (const loc of r.locations.slice(0, MAX_LOCATIONS)) console.log(`       ${relative(process.cwd(), join(ROOT, loc))}`);
    if (r.locations.length > MAX_LOCATIONS) console.log(`       ... and ${r.locations.length - MAX_LOCATIONS} more`);
    if (r.hint && (r.status === 'fail' || r.status === 'warn')) {
      console.log(`       fix: ${r.hint}${r.skill ? ` (see ${r.skill})` : ''}`);
    }
  }
  console.log(
    `\nSummary: ${counts.pass} passed, ${plural(counts.warn, 'warning')}, ${counts.fail} failed` +
      `${counts.info ? `, ${counts.info} info` : ''}${counts.skip ? `, ${counts.skip} skipped` : ''}`,
  );
}

process.exit(counts.fail ? 1 : 0);
