/**
 * `AuthPort` of the local auth mode (`VITE_AUTH_MODE=local`, local and test use
 * only): signs in with `POST /auth/local/sign-in` on the office server, whose
 * accounts come from `LOCAL_AUTH_USERS` (`server/src/localAuth/`). No Firebase
 * here, so this mode works without any GCP project.
 *
 * The token is the whole session: the server signs it for the session's full
 * lifetime (`server/src/localAuth/localAuthToken.ts`), so there is no refresh.
 * It is kept in `localStorage` to survive a reload, and in memory too, so a
 * storage that throws (Safari private mode, blocked site data) still keeps the
 * session for this page. Its payload is decoded WITHOUT verifying it, only to
 * show who is signed in and to drop it once expired; the server verifies every
 * use.
 *
 * Failures reject with a Firebase-shaped `code`, so `describeAuthError` and
 * `isWrongCredentials` treat them exactly like the Firebase ones.
 */

import { LOCAL_PASSWORD_RESET_UNAVAILABLE } from './authErrors';
import { deriveDisplayName, type AuthPort, type AuthUser } from './authPort';
import type { StorageLike } from './lastDisplayNameStore';

export const LOCAL_AUTH_TOKEN_KEY = 'oficina.localAuthToken';

const SIGN_IN_TIMEOUT_MS = 10_000;

export interface LocalAuthStorage extends StorageLike {
  removeItem(key: string): void;
}

export interface LocalAuthAdapterOptions {
  /** The office server's http(s) base, without a trailing slash. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  storage?: LocalAuthStorage;
  now?: () => number;
}

/** Same shape as a `FirebaseError` as far as `authErrors.ts` reads it. */
class LocalAuthError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Local auth failed (${code})`);
    this.code = code;
    this.name = 'LocalAuthError';
  }
}

interface Session {
  token: string;
  user: AuthUser;
  expiresAtMs: number;
}

function decodePayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
    const payload: unknown = JSON.parse(json);
    return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `null` for anything that cannot be a live session: the server would refuse it anyway. */
function sessionOf(token: string | null, nowMs: number): Session | null {
  if (!token) return null;
  const payload = decodePayload(token);
  if (payload === null) return null;
  const { sub, email, exp } = payload;
  if (typeof sub !== 'string' || sub === '' || typeof exp !== 'number') return null;
  const expiresAtMs = exp * 1000;
  if (expiresAtMs <= nowMs) return null;
  const mail = typeof email === 'string' ? email : null;
  return { token, expiresAtMs, user: { uid: sub, email: mail, displayName: deriveDisplayName({ email: mail }) } };
}

function browserStorage(): LocalAuthStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createLocalAuthAdapter({
  baseUrl,
  fetchImpl = (input, init) => fetch(input, init),
  storage = browserStorage() ?? undefined,
  now = () => Date.now(),
}: LocalAuthAdapterOptions): AuthPort {
  const listeners = new Set<(user: AuthUser | null) => void>();

  function store(token: string | null): void {
    try {
      if (token === null) storage?.removeItem(LOCAL_AUTH_TOKEN_KEY);
      else storage?.setItem(LOCAL_AUTH_TOKEN_KEY, token);
    } catch {
      // The in-memory session still works for this page.
    }
  }

  let session: Session | null = null;
  try {
    const stored = storage?.getItem(LOCAL_AUTH_TOKEN_KEY) ?? null;
    session = sessionOf(stored, now());
    if (stored !== null && session === null) store(null);
  } catch {
    session = null;
  }

  /** The current session, dropped (and reported) once it expired. */
  function current(): Session | null {
    if (session !== null && session.expiresAtMs <= now()) setSession(null);
    return session;
  }

  function setSession(next: Session | null): void {
    session = next;
    store(next === null ? null : next.token);
    for (const listener of [...listeners]) listener(next === null ? null : next.user);
  }

  return {
    onChange(listener) {
      // Read first: dropping an expired session must not notify this listener twice.
      const user = current()?.user ?? null;
      listeners.add(listener);
      listener(user);
      return () => {
        listeners.delete(listener);
      };
    },

    async signIn(email, password) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SIGN_IN_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/auth/local/sign-in`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          signal: controller.signal,
        });
      } catch {
        throw new LocalAuthError('auth/network-request-failed');
      } finally {
        clearTimeout(timer);
      }

      // Same code as Firebase's for a wrong password or an unknown account:
      // one message for both, see `WRONG_CREDENTIALS_MESSAGE`.
      if (response.status === 401) throw new LocalAuthError('auth/invalid-credential');
      if (!response.ok) throw new LocalAuthError('auth/local-sign-in-failed');

      let token: unknown = null;
      try {
        token = ((await response.json()) as { token?: unknown } | null)?.token ?? null;
      } catch {
        token = null;
      }
      const next = typeof token === 'string' ? sessionOf(token, now()) : null;
      if (next === null) throw new LocalAuthError('auth/local-sign-in-failed');
      setSession(next);
    },

    async signOut() {
      setSession(null);
    },

    async getIdToken() {
      return current()?.token ?? null;
    },

    async sendPasswordReset() {
      throw new LocalAuthError(LOCAL_PASSWORD_RESET_UNAVAILABLE);
    },
  };
}
