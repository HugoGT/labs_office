import { describe, expect, it, vi } from 'vitest';
import { describeAuthError, describePasswordResetError, isWrongCredentials } from './authErrors';
import type { AuthUser } from './authPort';
import { LOCAL_AUTH_TOKEN_KEY, createLocalAuthAdapter } from './localAuthAdapter';
import type { StorageLike } from './lastDisplayNameStore';

const NOW_MS = Date.UTC(2026, 9, 9, 12, 0, 0);
const NOW = NOW_MS / 1000;

/** An unsigned JWT-shaped token: the adapter only decodes, the server verifies. */
function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.signature`;
}

const ANA_TOKEN = token({ sub: 'local:ana@local.test', email: 'ana@local.test', exp: NOW + 3600 });

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  };
}

function setup({
  stored,
  fetchImpl = vi.fn(async () => Response.json({ token: ANA_TOKEN })),
  storage,
}: {
  stored?: string;
  fetchImpl?: typeof fetch;
  storage?: StorageLike & { removeItem(key: string): void };
} = {}) {
  const memory = memoryStorage(stored ? { [LOCAL_AUTH_TOKEN_KEY]: stored } : {});
  const adapter = createLocalAuthAdapter({
    baseUrl: 'http://localhost:2567',
    fetchImpl,
    storage: storage ?? memory.storage,
    now: () => NOW_MS,
  });
  const seen: (AuthUser | null)[] = [];
  return { adapter, memory, seen, listen: () => adapter.onChange((user) => seen.push(user)), fetchImpl };
}

const ANA: AuthUser = { uid: 'local:ana@local.test', email: 'ana@local.test', displayName: 'ana' };

describe('createLocalAuthAdapter', () => {
  it('reports null on subscribe when nobody signed in', () => {
    const { listen, seen } = setup();
    listen();
    expect(seen).toEqual([null]);
  });

  it('replays the stored session on subscribe, deriving the display name from the email', async () => {
    const { adapter, listen, seen } = setup({ stored: ANA_TOKEN });
    listen();
    expect(seen).toEqual([ANA]);
    await expect(adapter.getIdToken()).resolves.toBe(ANA_TOKEN);
  });

  it.each([
    ['expired', token({ sub: 'local:ana@local.test', email: 'ana@local.test', exp: NOW - 1 })],
    ['without exp', token({ sub: 'local:ana@local.test', email: 'ana@local.test' })],
    ['without sub', token({ email: 'ana@local.test', exp: NOW + 60 })],
    ['garbage', 'not-a-token'],
  ])('drops a stored token that is %s', async (_label, stored) => {
    const { adapter, listen, seen, memory } = setup({ stored });
    listen();
    expect(seen).toEqual([null]);
    await expect(adapter.getIdToken()).resolves.toBeNull();
    expect(memory.data.has(LOCAL_AUTH_TOKEN_KEY)).toBe(false);
  });

  it('signs in against the server route, stores the token and notifies listeners', async () => {
    const { adapter, listen, seen, memory, fetchImpl } = setup();
    listen();

    await adapter.signIn('ana@local.test', 'otra');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:2567/auth/local/sign-in',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ana@local.test', password: 'otra' }),
      }),
    );
    expect(seen).toEqual([null, ANA]);
    expect(memory.data.get(LOCAL_AUTH_TOKEN_KEY)).toBe(ANA_TOKEN);
    await expect(adapter.getIdToken()).resolves.toBe(ANA_TOKEN);
  });

  it('a 401 rejects with the wrong-credentials message, and offers the reset like Firebase does', async () => {
    const { adapter } = setup({
      fetchImpl: vi.fn(async () => Response.json({ error: 'invalid-credentials' }, { status: 401 })),
    });
    const error = await adapter.signIn('ana@local.test', 'nope').catch((cause: unknown) => cause);
    expect(describeAuthError(error)).toBe('Correo o contraseña incorrectos.');
    expect(isWrongCredentials(error)).toBe(true);
  });

  it('a network failure rejects with the cannot-reach-the-server message', async () => {
    const { adapter } = setup({
      fetchImpl: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    const error = await adapter.signIn('ana@local.test', 'otra').catch((cause: unknown) => cause);
    expect(describeAuthError(error)).toBe('No se pudo contactar con el servidor de autenticación.');
  });

  it.each([
    ['a 404 (local auth off on the server)', () => new Response('Not Found', { status: 404 })],
    ['a 200 without a token', () => Response.json({})],
  ])('%s rejects with the generic message and keeps nobody signed in', async (_label, respond) => {
    const { adapter, listen, seen } = setup({ fetchImpl: vi.fn(async () => respond()) });
    listen();
    const error = await adapter.signIn('ana@local.test', 'otra').catch((cause: unknown) => cause);
    expect(describeAuthError(error)).toBe('No se pudo iniciar sesión.');
    expect(seen).toEqual([null]);
  });

  it('signs out: clears the token and notifies null', async () => {
    const { adapter, listen, seen, memory } = setup({ stored: ANA_TOKEN });
    listen();
    await adapter.signOut();
    expect(seen).toEqual([ANA, null]);
    expect(memory.data.has(LOCAL_AUTH_TOKEN_KEY)).toBe(false);
    await expect(adapter.getIdToken()).resolves.toBeNull();
  });

  it('stops notifying a listener after it unsubscribes', async () => {
    const { adapter, listen, seen } = setup();
    const unsubscribe = listen();
    unsubscribe();
    await adapter.signIn('ana@local.test', 'otra');
    expect(seen).toEqual([null]);
  });

  it('keeps the session for this page when the storage throws', async () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const { adapter, listen, seen } = setup({ storage: broken });
    listen();
    await adapter.signIn('ana@local.test', 'otra');
    expect(seen).toEqual([null, ANA]);
    await expect(adapter.getIdToken()).resolves.toBe(ANA_TOKEN);
    await adapter.signOut();
    await expect(adapter.getIdToken()).resolves.toBeNull();
  });

  it('getIdToken drops a token that expired while the page was open', async () => {
    let now = NOW_MS;
    const memory = memoryStorage({ [LOCAL_AUTH_TOKEN_KEY]: ANA_TOKEN });
    const adapter = createLocalAuthAdapter({
      baseUrl: 'http://localhost:2567',
      fetchImpl: vi.fn(),
      storage: memory.storage,
      now: () => now,
    });
    now = NOW_MS + 3601 * 1000;
    await expect(adapter.getIdToken()).resolves.toBeNull();
  });

  it('password reset rejects with a message that local accounts have none', async () => {
    const { adapter } = setup();
    const error = await adapter.sendPasswordReset('ana@local.test').catch((cause: unknown) => cause);
    expect(describePasswordResetError(error)).toMatch(/cuentas locales/);
  });
});
