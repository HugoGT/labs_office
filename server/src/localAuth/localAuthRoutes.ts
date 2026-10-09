/**
 * `POST /auth/local/sign-in` `{ email, password }`: the login of the local
 * auth mode (`localAuthConfig.ts`). 200 `{ token }` or 401
 * `{ error: 'invalid-credentials' }`. `createOfficeServer.ts` registers it only
 * while local auth is on; otherwise the path does not exist (404).
 *
 * Local only on purpose: `infra/gcp/Caddyfile` has no `handle /auth/*` and must
 * not get one, so even a misconfigured deployment would never route it.
 *
 * Same anti-enumeration rule as `describeAuthError` on the client: an unknown
 * email and a wrong password get the same answer, and the comparison takes
 * the same time for both (see `createLocalCredentialCheck`). There is no rate
 * limit: this mode is for a developer's machine and test environments.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { LocalTokenIssuer } from './localAuthToken.ts';

export interface LocalSignInResult {
  status: number;
  body: unknown;
}

export const INVALID_CREDENTIALS_BODY = { error: 'invalid-credentials' } as const;
const INVALID_REQUEST: LocalSignInResult = { status: 400, body: { error: 'invalid-request' } };

/** Normalized email of the account, or `null` when the pair does not match. */
export type LocalCredentialCheck = (email: string, password: string) => string | null;

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/**
 * Compares SHA-256 digests with `timingSafeEqual`: equal lengths always, so
 * neither the length of the password nor how many leading characters match
 * leaks through the time taken. An unknown email is compared against a dummy
 * digest, so it costs the same as a known one.
 */
export function createLocalCredentialCheck(users: ReadonlyMap<string, string>): LocalCredentialCheck {
  const digests = new Map([...users].map(([email, password]) => [email, digest(password)]));
  const dummy = digest('local-auth-unknown-account');

  return (email, password) => {
    const normalized = email.trim().toLowerCase();
    const expected = digests.get(normalized);
    const matches = timingSafeEqual(digest(password), expected ?? dummy);
    return matches && expected !== undefined ? normalized : null;
  };
}

export interface LocalSignInDeps {
  checkCredentials: LocalCredentialCheck;
  issuer: LocalTokenIssuer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function handleLocalSignIn(body: unknown, deps: LocalSignInDeps): Promise<LocalSignInResult> {
  if (!isRecord(body) || typeof body.email !== 'string' || typeof body.password !== 'string') {
    return INVALID_REQUEST;
  }

  const email = deps.checkCredentials(body.email, body.password);
  if (email === null) return { status: 401, body: INVALID_CREDENTIALS_BODY };

  return { status: 200, body: { token: await deps.issuer.issue(email) } };
}
