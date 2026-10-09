/**
 * Session tokens of the local auth mode (`localAuthConfig.ts`): signed by this
 * server with HS256 and `LOCAL_AUTH_SECRET`, checked by an `IdTokenVerifier`
 * with the same contract as the Firebase one (`../verifyIdToken.ts`), so
 * `OfficeRoom.onAuth` and every HTTP route take them without knowing the mode.
 *
 * ## Lifetime
 *
 * There is no refresh: the token IS the session, unlike Firebase, whose SDK
 * swaps its one-hour ID token for a fresh one in the background. A one-hour
 * token here would log everybody out every hour. So the session age cap is
 * enforced the same way as for Firebase, from `auth_time` and
 * `MAX_SESSION_AGE_DAYS`, and `exp` is only a backstop one day past that cap:
 * during that day a too-old login is still told apart as `SESSION_EXPIRED`
 * (the client signs out and asks for the password), after it the token is
 * simply invalid. Rotating `LOCAL_AUTH_SECRET` invalidates every token at once,
 * and removing an account from `LOCAL_AUTH_USERS` invalidates its tokens on
 * the next restart, because the verifier checks the email is still configured.
 *
 * ## Same rules as the Firebase verifier
 *
 * Algorithm whitelist (HS256 only, so no `alg` juggling), own issuer and
 * audience, `iat` and `auth_time` not in the future, and every rejection but
 * `SESSION_EXPIRED` collapses into `null`: the client is never told why. The
 * log gets the error name only, never the token.
 */

import { SignJWT, jwtVerify } from 'jose';
import {
  MAX_SESSION_AGE_DAYS,
  SESSION_EXPIRED,
  type IdTokenVerifier,
  type VerifyFailureLogger,
} from '../verifyIdToken.ts';
import type { LocalAuthConfig } from './localAuthConfig.ts';

/** Issuer and audience of every local token; no Firebase project uses it. */
export const LOCAL_AUTH_ISSUER = 'office-local';

const DAY_SECONDS = 24 * 60 * 60;
const MAX_SESSION_AGE_SECONDS = MAX_SESSION_AGE_DAYS * DAY_SECONDS;

/** The session cap plus one day of grace, see "Lifetime" above. */
export const LOCAL_TOKEN_LIFETIME_SECONDS = MAX_SESSION_AGE_SECONDS + DAY_SECONDS;

const ALGORITHM = 'HS256';

/**
 * Stable uid of a local account. The prefix keeps it apart from any Firebase
 * uid a directory may already hold, so switching a database from one mode to
 * the other never hands one person's row to another.
 */
export function localUidFor(email: string): string {
  return `local:${email.trim().toLowerCase()}`;
}

function keyOf(config: LocalAuthConfig): Uint8Array {
  return new TextEncoder().encode(config.secret);
}

export interface LocalTokenIssuer {
  /** Signs a fresh session for an email the caller already authenticated. */
  issue(email: string): Promise<string>;
}

export function createLocalTokenIssuer(config: LocalAuthConfig): LocalTokenIssuer {
  const key = keyOf(config);
  return {
    async issue(email) {
      const normalized = email.trim().toLowerCase();
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ email: normalized, auth_time: now })
        .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
        .setSubject(localUidFor(normalized))
        .setIssuer(LOCAL_AUTH_ISSUER)
        .setAudience(LOCAL_AUTH_ISSUER)
        .setIssuedAt(now)
        .setExpirationTime(now + LOCAL_TOKEN_LIFETIME_SECONDS)
        .sign(key);
    },
  };
}

function isNotInTheFuture(seconds: unknown, now: number): boolean {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds <= now;
}

export function createLocalIdTokenVerifier(
  config: LocalAuthConfig,
  logFailure: VerifyFailureLogger = (errorName) =>
    console.warn(`[auth] local token rejected: ${errorName}`),
): IdTokenVerifier {
  const key = keyOf(config);

  return {
    async verify(token) {
      if (typeof token !== 'string' || token.length === 0) return null;

      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: [ALGORITHM],
          issuer: LOCAL_AUTH_ISSUER,
          audience: LOCAL_AUTH_ISSUER,
          requiredClaims: ['exp', 'iat', 'sub'],
        });

        const now = Math.floor(Date.now() / 1000);
        if (!isNotInTheFuture(payload.iat, now)) return null;
        if (payload.auth_time !== undefined && !isNotInTheFuture(payload.auth_time, now)) return null;

        const email = typeof payload.email === 'string' ? payload.email : null;
        if (email === null || payload.sub !== localUidFor(email)) return null;
        // Removed from LOCAL_AUTH_USERS since it was signed: out, like a
        // disabled Identity Platform account.
        if (!config.users.has(email)) return null;

        // Named only now, with signature and claims checked (see the header
        // of `verifyIdToken.ts`). No `auth_time` fails closed the same way.
        const authTime = payload.auth_time;
        if (typeof authTime !== 'number' || now - authTime > MAX_SESSION_AGE_SECONDS) {
          logFailure('SessionExpired');
          return SESSION_EXPIRED;
        }

        return { uid: payload.sub, email, name: null };
      } catch (error) {
        logFailure(error instanceof Error ? error.name : 'UnknownError');
        return null;
      }
    },
  };
}
