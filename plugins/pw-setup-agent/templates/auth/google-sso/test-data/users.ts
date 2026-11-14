import { optionalEnv } from '@utils/env';
import type { GoogleAccount } from './types';

/**
 * Google accounts per role, read from env only. All values are optional:
 * whatever is missing, the user finishes by hand in the Chrome window the
 * setup step opens.
 *
 * To add a role: add an entry here and its keys to .env.example. Each role
 * gets its own saved session (.auth/<role>.json) and Chrome profile.
 */
export const users = {
{{ROLE_ENTRIES}}
} satisfies Record<string, () => GoogleAccount>;

export type Role = keyof typeof users;
