/**
 * Opens real Google Chrome on a dedicated profile and connects Playwright to
 * it over CDP. Used only by the auth setup step, to create or refresh the
 * saved session JSON. Tests never open this profile.
 *
 * Why not a Playwright-launched browser: Google refuses sign-in in any browser
 * Playwright launches ("This browser or app may not be secure"), while a
 * normal Chrome process that Playwright only connects to is accepted. Do not
 * add flags to get around Google's checks.
 *
 * Why a plain child process, not launchPersistentContext: Playwright starts
 * Chrome with a mock keychain on macOS, so Chrome cannot decrypt the cookies
 * of a profile that real Chrome created.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { optionalEnv } from './env';

const PORT_TIMEOUT_MS = 20_000;

export interface ChromeSession {
  browser: Browser;
  context: BrowserContext;
  /** The tab showing the application. */
  page: Page;
  /** Disconnects Playwright and quits Chrome. */
  close(): Promise<void>;
}

/** CHROME_PATH, or where Google Chrome installs by default on this OS. */
export function chromeExecutable(): string {
  const fromEnv = optionalEnv('{{ENV_PREFIX}}CHROME_PATH');
  if (fromEnv) return fromEnv;
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    return path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
  }
  return 'google-chrome';
}

const missingChrome = (exe: string) =>
  new Error(`Google Chrome was not found at "${exe}". Install Chrome, or set {{ENV_PREFIX}}CHROME_PATH in .env to its executable.`);

/**
 * True while the profile is open in a running Chrome. A lock left behind by a
 * Chrome that is no longer running is stale, and Chrome itself ignores it.
 */
function profileInUse(profileDir: string): boolean {
  const lock = path.join(profileDir, 'SingletonLock');
  if (process.platform === 'win32') {
    // A plain file Chrome holds open: it can be deleted only when stale.
    if (!fs.existsSync(lock)) return false;
    try {
      fs.rmSync(lock);
      return false;
    } catch {
      return true;
    }
  }
  let target: string;
  try {
    target = fs.readlinkSync(lock); // "<hostname>-<pid>"
  } catch {
    return false;
  }
  const match = target.match(/^(.*)-(\d+)$/);
  if (!match || match[1] !== os.hostname()) return true; // another machine, or unknown: assume open
  try {
    process.kill(Number(match[2]), 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'; // ESRCH: no such process, stale
  }
}

async function waitForDebugPort(profileDir: string, child: ChildProcess): Promise<number> {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + PORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited (code ${child.exitCode}) before it was ready. Is ${profileDir} open in another Chrome window?`);
    }
    if (fs.existsSync(portFile)) {
      const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Chrome did not open a debugging port within ${PORT_TIMEOUT_MS / 1000}s.`);
}

/** The tab that shows `url`'s origin, waiting briefly for Chrome to open it. */
async function appPage(context: BrowserContext, url: string): Promise<Page> {
  const origin = new URL(url).origin;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = context.pages().find((p) => p.url().startsWith(origin));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 250));
  }
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  return page;
}

/**
 * Starts Chrome on `profileDir` showing `url`, and connects to it.
 * The profile keeps the Google session between runs, so later sign-ins are
 * usually a single click or none.
 */
export async function openChromeProfile(url: string, profileDir: string): Promise<ChromeSession> {
  fs.mkdirSync(profileDir, { recursive: true });
  if (profileInUse(profileDir)) {
    throw new Error(`The Chrome profile ${profileDir} is already open. Close that Chrome window and run again.`);
  }

  const exe = chromeExecutable();
  if (path.isAbsolute(exe) && !fs.existsSync(exe)) throw missingChrome(exe);

  fs.rmSync(path.join(profileDir, 'DevToolsActivePort'), { force: true });
  const child = spawn(
    exe,
    [`--user-data-dir=${profileDir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', url],
    { stdio: 'ignore' },
  );
  const spawnError = new Promise<never>((_, reject) => {
    child.once('error', (err: NodeJS.ErrnoException) => reject(err.code === 'ENOENT' ? missingChrome(exe) : err));
  });

  const exited = new Promise((r) => child.once('exit', r));
  const waitForExit = (ms: number) => Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
  /** Quits Chrome: gracefully over CDP when connected (so it releases the profile lock), else kill. */
  const quit = async (browser?: Browser) => {
    if (child.exitCode !== null) return;
    if (browser) {
      try {
        const cdp = await browser.newBrowserCDPSession();
        await cdp.send('Browser.close');
      } catch {
        /* fall through to kill */
      }
      if (await waitForExit(5_000)) return;
    }
    child.kill();
    await waitForExit(5_000);
  };

  try {
    const port = await Promise.race([waitForDebugPort(profileDir, child), spawnError]);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await appPage(context, url);
    return {
      browser,
      context,
      page,
      async close() {
        await quit(browser);
        await browser.close().catch(() => {}); // over CDP this only disconnects
      },
    };
  } catch (err) {
    await quit();
    throw err;
  }
}
