import { requireEnv } from '@utils/env';
import type { Credentials } from './types';

/**
 * Test accounts per role. Each entry reads its credentials from the
 * environment only when a test calls it, so `playwright test --list` works
 * before the credentials are filled in.
 *
 * To add a role: add an entry here and its two keys to .env.example.
 */
export const users = {
{{ROLE_ENTRIES}}
} satisfies Record<string, () => Credentials>;

export type Role = keyof typeof users;

/** A password that is never valid, for negative login tests. */
export const invalidPassword = 'not-a-valid-password';
