import fs from 'node:fs';
import path from 'node:path';
import { test, expect, request } from '@playwright/test';
import { LoginPage } from '@pages/login.page';
import { users, type Role } from '@data/users';
import { env } from '@utils/env';
import { openChromeProfile } from '@utils/chrome-profile';
import { LOGIN_PATH, chromeProfilePath, forceLogin, meStatus, sessionAgeMinutes, storageStatePath } from '@utils/auth';

/**
 * Signs in once per role and saves the session to .auth/<role>.json, which
 * the test projects load.
 *
 * - Reuses the file while it is younger than AUTH_MAX_AGE_MINUTES and the
 *   who-am-I endpoint returns 200 with it (no browser opens).
 * - Otherwise opens real Chrome on .auth/chrome-profile/<role>/ (Google blocks
 *   Playwright-launched browsers), tries to sign in from env, and waits up to
 *   4 minutes for the user to finish by hand.
 * - FORCE_LOGIN=1 or `login:force` skips the reuse check.
 */
for (const role of Object.keys(users) as Role[]) {
  test(`sign in as ${role}`, async () => {
    const file = storageStatePath(role);

    const age = sessionAgeMinutes(file);
    if (age !== null && age < env.authMaxAgeMinutes && !forceLogin()) {
      const api = await request.newContext({ storageState: file });
      const status = await meStatus(api);
      await api.dispose();
      if (status === 200) {
        console.log(`[auth] ${role}: reusing ${path.basename(file)} (${Math.round(age)} min old)`);
        return;
      }
    }

    if (env.isCI) {
      throw new Error(
        `[auth] ${role}: no valid session in ${file}. CI cannot sign in through Google: ` +
          'restore the session JSON from a secret before the tests run, or use a test-login endpoint.',
      );
    }

    console.log(`[auth] ${role}: opening Chrome to sign in (finish by hand if asked, up to 4 min)`);
    const chrome = await openChromeProfile(new URL(LOGIN_PATH, env.baseUrl).toString(), chromeProfilePath(role));
    try {
      const { page, context } = chrome;

      if ((await meStatus(page.request)) !== 200) {
        try {
          const loginPage = new LoginPage(page);
          await loginPage.googleButton.waitFor({ timeout: 30_000 });
          const google = await loginPage.openGoogleSignIn();
          const account = users[role]();
          if (!account.email) throw new Error('no account email in .env');
          await google.signIn(account);
        } catch (err) {
          console.log(`[auth] ${role}: automatic sign-in stopped (${(err as Error).message.split('\n')[0]}).`);
          console.log(`[auth] ${role}: finish signing in by hand in the Chrome window.`);
        }
      }

      await expect
        .poll(() => meStatus(page.request), {
          message: `${role} is not signed in: the who-am-I endpoint did not return 200`,
          timeout: 4 * 60_000,
          intervals: [2_000],
        })
        .toBe(200);

      // Write to a temp file and rename, so an interrupted run never leaves half a JSON.
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await context.storageState({ path: tmp });
      fs.renameSync(tmp, file);
      console.log(`[auth] ${role}: saved ${path.basename(file)}`);
    } finally {
      await chrome.close();
    }
  });
}
