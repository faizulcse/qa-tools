#!/usr/bin/env node
/**
 * init_env.mjs - create or update the local .env from .env.example.
 *
 *   node init_env.mjs --root tests                    create .env if missing
 *   node init_env.mjs --root tests --base-url <url>   ...and set BASE_URL
 *   node init_env.mjs --root tests --sync             add keys missing from .env
 *   node init_env.mjs --root tests --force            recreate (old file -> .env.bak)
 *   add --json for machine-readable output
 *
 * Copied into projects as tests/utils/init-env.mjs and run with
 * `npm run env:init`. Node 18+, no dependencies.
 *
 * Rules:
 * - Never overwrites an existing .env unless --force (which backs it up).
 * - Refuses to write unless .env is gitignored.
 * - Never fills secrets: keys copy the value from .env.example, which leaves
 *   credentials empty for the user to fill in.
 * - Prints key names only, never values.
 *
 * Exit codes: 0 ok, 1 refused or failed, 2 bad arguments.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const USAGE = 'usage: init_env.mjs [--root DIR] [--base-url URL] [--sync | --force] [--json]';

function parseArgs(argv) {
  const opts = { root: '.', baseUrl: null, sync: false, force: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') opts.root = argv[++i];
    else if (arg === '--base-url') opts.baseUrl = argv[++i];
    else if (arg === '--sync') opts.sync = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}\n${USAGE}`);
      process.exit(2);
    }
  }
  if (!opts.root) fail(`--root needs a value\n${USAGE}`, 2);
  if (opts.sync && opts.force) fail('Use either --sync or --force, not both.', 2);
  if (opts.baseUrl !== null && !/^https?:\/\/\S+$/.test(opts.baseUrl || '')) {
    fail(`--base-url must start with http:// or https:// (got "${opts.baseUrl}")`, 2);
  }
  return opts;
}

function fail(message, code = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** Parse dotenv text into ordered entries; keeps comments and blanks. */
function parseEnv(text) {
  return text.split(/\r?\n/).map((line) => {
    const m = line.match(KEY_LINE);
    return m ? { key: m[1], value: m[2].trim(), line } : { key: null, line };
  });
}

function keysOf(entries) {
  return entries.filter((e) => e.key).map((e) => e.key);
}

function valueOf(entries, key) {
  const e = entries.find((x) => x.key === key);
  return e ? e.value : undefined;
}

/** Is `<root>/.env` ignored by git? Falls back to reading .gitignore. */
function isIgnored(root) {
  try {
    execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch (err) {
    // status 1 = not ignored; 128 = not a git repo / git missing -> fall back
    if (err.status === 1) return false;
  }
  const gi = join(root, '.gitignore');
  if (!existsSync(gi)) return false;
  return readFileSync(gi, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => l === '.env' || l === '/.env' || l === '.env*' || l === '*.env');
}

function render(exampleEntries, overrides) {
  return exampleEntries
    .map((e) => (e.key ? `${e.key}=${overrides[e.key] ?? e.value}` : e.line))
    .join('\n')
    .replace(/\n*$/, '\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = resolve(opts.root);
  const examplePath = join(root, '.env.example');
  const envPath = join(root, '.env');
  const result = { root, action: null, added: [], empty: [], backup: null };

  if (!existsSync(examplePath)) fail(`${examplePath} not found. Is --root the test project folder?`);
  if (!isIgnored(root)) {
    fail(`.env is not gitignored in ${root}. Add ".env" to ${join(root, '.gitignore')} first.`);
  }

  const example = parseEnv(readFileSync(examplePath, 'utf8'));
  const overrides = {};
  if (opts.baseUrl) overrides.BASE_URL = opts.baseUrl;

  if (!existsSync(envPath) || opts.force) {
    if (existsSync(envPath)) {
      result.backup = `${envPath}.bak`;
      copyFileSync(envPath, result.backup);
    }
    writeFileSync(envPath, render(example, overrides), { mode: 0o600 });
    result.action = result.backup ? 'recreated' : 'created';
  } else if (opts.sync) {
    const current = readFileSync(envPath, 'utf8');
    const have = new Set(keysOf(parseEnv(current)));
    const missing = keysOf(example).filter((k) => !have.has(k));
    if (missing.length) {
      const stamp = new Date().toISOString().slice(0, 10);
      const lines = missing.map((k) => `${k}=${overrides[k] ?? valueOf(example, k)}`);
      const sep = current.endsWith('\n') ? '' : '\n';
      writeFileSync(envPath, `${current}${sep}\n# Added by env:init --sync on ${stamp}\n${lines.join('\n')}\n`);
    }
    result.added = missing;
    result.action = missing.length ? 'synced' : 'unchanged';
  } else {
    result.action = 'exists';
  }

  const finalEntries = parseEnv(readFileSync(envPath, 'utf8'));
  const finalKeys = new Set(keysOf(finalEntries));
  result.missing = keysOf(example).filter((k) => !finalKeys.has(k));
  result.empty = keysOf(finalEntries).filter((k) => valueOf(finalEntries, k) === '');

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const rel = relative(process.cwd(), envPath) || '.env';
  const messages = {
    created: `Created ${rel} from .env.example.`,
    recreated: `Recreated ${rel}. The old file is at ${rel}.bak.`,
    synced: `Added ${result.added.length} key(s) to ${rel}: ${result.added.join(', ')}.`,
    unchanged: `${rel} already has every key in .env.example. Nothing changed.`,
    exists: `${rel} already exists and was left unchanged.`,
  };
  console.log(messages[result.action]);
  if (result.action === 'exists' && result.missing.length) {
    console.log(`It is missing ${result.missing.join(', ')}. Run again with --sync to add them.`);
  }
  if (result.empty.length) {
    console.log(`Fill in these values in ${rel}: ${result.empty.join(', ')}`);
  }
}

main();
