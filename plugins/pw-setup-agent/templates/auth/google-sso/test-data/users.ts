/**
 * Roles that sign in with Google. Each gets its own saved session
 * (.auth/<role>.json) and browser profile (.auth/cli-profile/<role>/).
 * Sign-in is by hand in the window utils/login-cli.mjs opens, so no
 * credentials are stored anywhere.
 *
 * To add a role: add it here and to ROLES in utils/login-cli.mjs.
 */
export const roles = [/*{{ROLE_LIST}}*/] as const;

export type Role = (typeof roles)[number];
