import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test, expect, request } from '@playwright/test';
import { roles } from '@data/users';
import { env, projectDir } from '@utils/env';
import { forceLogin, meStatus, sessionAgeMinutes, storageStatePath } from '@utils/auth';

/**
 * Makes sure every role has a valid saved session, .auth/<role>.json, which
 * the test projects load.
 *
 * - Reuses the file while it is younger than AUTH_MAX_AGE_MINUTES and the
 *   who-am-I endpoint returns 200 with it (no browser opens).
 * - Otherwise runs utils/login-cli.mjs: a headed Chrome opens through
 *   playwright-cli on a persistent profile, you sign in by hand, and the
 *   session is saved when who-am-I returns 200 (LOGIN_TIMEOUT_MINUTES).
 * - FORCE_LOGIN=1 or `login:force` skips the reuse check.
 *
 * Self-contained on purpose: it does not use the page objects, so it keeps
 * working when the app has page objects of its own.
 */
for (const role of roles) {
  test(`sign in as ${role}`, async () => {
    const file = storageStatePath(role);
    const status = async () => {
      const api = await request.newContext({ storageState: file });
      try {
        return await meStatus(api);
      } finally {
        await api.dispose();
      }
    };

    const age = sessionAgeMinutes(file);
    if (age !== null && age < env.authMaxAgeMinutes && !forceLogin() && (await status()) === 200) {
      console.log(`[auth] ${role}: reusing ${path.basename(file)} (${Math.round(age)} min old)`);
      return;
    }

    if (env.isCI) {
      throw new Error(
        `[auth] ${role}: no valid session in ${file}. CI cannot sign in through Google: ` +
          'restore the session JSON from a secret before the tests run, or use a test-login endpoint.',
      );
    }

    // Interactive: a browser window opens and waits for you to sign in.
    try {
      execFileSync(process.execPath, [path.join(projectDir, 'utils', 'login-cli.mjs'), role], {
        cwd: projectDir,
        stdio: 'inherit',
      });
    } catch {
      throw new Error(
        `[auth] ${role}: sign-in did not finish (see the [login-cli] lines above). ` +
          'Run the login script again, or raise LOGIN_TIMEOUT_MINUTES in .env.',
      );
    }

    expect(await status(), `${role} is not signed in: the who-am-I endpoint did not return 200`).toBe(200);
  });
}
