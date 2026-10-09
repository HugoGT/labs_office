/**
 * Local auth mode: accounts and token key come from environment variables
 * instead of Firebase / Identity Platform, so the local Docker stack can log in
 * without any GCP project. LOCAL AND TEST USE ONLY: the deployed compose
 * (`infra/gcp/docker-compose.yml`) never passes these variables, and the
 * server refuses to start with them next to `FIREBASE_PROJECT_ID`
 * (`resolveServerAuthConfig` in `../authConfig.ts`).
 *
 * - `LOCAL_AUTH_USERS`: comma-separated `email:password` pairs. Everything
 *   after the first `:` is the password, so a password may contain `:` but
 *   not `,`. Emails are trimmed and lowercased; passwords are trimmed.
 * - `LOCAL_AUTH_SECRET`: the HMAC key that signs the session tokens
 *   (`localAuthToken.ts`), at least `LOCAL_AUTH_MIN_SECRET_LENGTH` characters.
 *
 * Every mistake is a startup error, never a silent "auth off": a typo in the
 * user list that dropped auth would let anyone into the office.
 */

import { AuthConfigError } from '../authConfigError.ts';

/** 32 characters: what `openssl rand -hex 16` prints, 128 bits of key. */
export const LOCAL_AUTH_MIN_SECRET_LENGTH = 32;

export interface LocalAuthConfig {
  /** Lowercased email to password. */
  users: ReadonlyMap<string, string>;
  secret: string;
}

export interface LocalAuthEnv {
  LOCAL_AUTH_USERS?: string;
  LOCAL_AUTH_SECRET?: string;
}

/** Something on both sides of one `@`; the directory normalizes the rest. */
function looksLikeEmail(email: string): boolean {
  const at = email.indexOf('@');
  return at > 0 && at === email.lastIndexOf('@') && at < email.length - 1;
}

export function parseLocalAuthUsers(raw: string): Map<string, string> {
  const users = new Map<string, string>();
  const entries = raw.split(',').map((entry) => entry.trim());

  entries.forEach((entry, index) => {
    if (entry === '') return;
    // Positions and emails only in the messages: the password never reaches
    // the log, even when the entry is the broken one.
    const position = `LOCAL_AUTH_USERS entry ${index + 1}`;
    const colon = entry.indexOf(':');
    if (colon === -1) throw new AuthConfigError(`${position} is not email:password`);

    const email = entry.slice(0, colon).trim().toLowerCase();
    const password = entry.slice(colon + 1).trim();
    if (!looksLikeEmail(email)) throw new AuthConfigError(`${position} has no valid email`);
    if (password === '') throw new AuthConfigError(`${position} (${email}) has an empty password`);
    if (users.has(email)) throw new AuthConfigError(`${position}: duplicate email ${email}`);

    users.set(email, password);
  });

  if (users.size === 0) throw new AuthConfigError('LOCAL_AUTH_USERS has no email:password entry');
  return users;
}

/**
 * `null` when neither variable is set (blank counts as unset, like
 * `FIREBASE_PROJECT_ID=` in a `.env`): local auth is off.
 */
export function resolveLocalAuthConfig(env: LocalAuthEnv): LocalAuthConfig | null {
  const rawUsers = env.LOCAL_AUTH_USERS?.trim() ?? '';
  const secret = env.LOCAL_AUTH_SECRET?.trim() ?? '';
  if (rawUsers === '' && secret === '') return null;

  // A secret alone is half a configuration, and the other half missing would
  // mean "no auth at all". Refusing makes the mistake visible.
  if (rawUsers === '') {
    throw new AuthConfigError('LOCAL_AUTH_SECRET is set but LOCAL_AUTH_USERS is not');
  }
  if (secret === '') {
    throw new AuthConfigError('LOCAL_AUTH_USERS is set but LOCAL_AUTH_SECRET is not');
  }
  if (secret.length < LOCAL_AUTH_MIN_SECRET_LENGTH) {
    throw new AuthConfigError(
      `LOCAL_AUTH_SECRET must be at least ${LOCAL_AUTH_MIN_SECRET_LENGTH} characters (openssl rand -hex 32)`,
    );
  }

  return { users: parseLocalAuthUsers(rawUsers), secret };
}
