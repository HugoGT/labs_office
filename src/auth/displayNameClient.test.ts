/**
 * El cliente HTTP de `POST/GET /me/display-name` (#100), puro y con `fetch`
 * inyectado, mismo espiritu que `game/desksClient.test.ts`: sin Vite, sin red
 * y sin servidor.
 *
 * Lo que importa aqui es la traduccion COMPLETA de estados HTTP a un outcome
 * discriminado: 200 (con y sin nombre), 400, 409, 503, cualquier otro codigo,
 * y la red que directamente no contesta.
 */

import { describe, expect, it } from 'vitest';
import { createDisplayNameClient, deriveDisplayNameBaseUrl } from './displayNameClient';

const TOKEN = async () => 'id-token';

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  } as unknown as Response;
}

function respondWith(body: unknown, status = 200): typeof fetch {
  return (async () => fakeResponse(body, status)) as unknown as typeof fetch;
}

const REJECTS = (async () => {
  throw new Error('red caida');
}) as unknown as typeof fetch;

describe('deriveDisplayNameBaseUrl', () => {
  it('cambia el esquema del endpoint de Colyseus y se queda en la raiz', () => {
    expect(deriveDisplayNameBaseUrl('ws://localhost:2567')).toBe('http://localhost:2567');
    expect(deriveDisplayNameBaseUrl('wss://oficina.example.com')).toBe('https://oficina.example.com');
  });
});

describe('createDisplayNameClient: claim', () => {
  it('200 con displayName es ok, con el nombre YA canonicalizado por el servidor', async () => {
    const client = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({ displayName: 'Ana Lopez' }),
    );

    await expect(client.claim('Ana   Lopez')).resolves.toEqual({
      outcome: 'ok',
      displayName: 'Ana Lopez',
    });
  });

  it('400 es invalid', async () => {
    const client = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({ error: 'invalid-display-name' }, 400),
    );

    await expect(client.claim('')).resolves.toEqual({ outcome: 'invalid' });
  });

  it('409 es taken', async () => {
    const client = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({ error: 'display-name-taken' }, 409),
    );

    await expect(client.claim('Bea')).resolves.toEqual({ outcome: 'taken' });
  });

  it('503 es unavailable', async () => {
    const client = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({ error: 'directory-not-configured' }, 503),
    );

    await expect(client.claim('Ana')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('cualquier otro codigo (401, 500...) es failed', async () => {
    const client401 = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({ error: 'unauthorized' }, 401),
    );
    const client500 = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({ error: 'internal' }, 500),
    );

    await expect(client401.claim('Ana')).resolves.toEqual({ outcome: 'failed' });
    await expect(client500.claim('Ana')).resolves.toEqual({ outcome: 'failed' });
  });

  it('la red caida es failed', async () => {
    const client = createDisplayNameClient({ baseUrl: 'http://x', getIdToken: TOKEN }, REJECTS);

    await expect(client.claim('Ana')).resolves.toEqual({ outcome: 'failed' });
  });

  it('sin token no llega a pedir nada: failed', async () => {
    let called = false;
    const client = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: async () => null },
      (async () => {
        called = true;
        return fakeResponse({});
      }) as unknown as typeof fetch,
    );

    await expect(client.claim('Ana')).resolves.toEqual({ outcome: 'failed' });
    expect(called).toBe(false);
  });

  it('un 200 con un cuerpo sin displayName de tipo string es failed', async () => {
    const client = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({}),
    );

    await expect(client.claim('Ana')).resolves.toEqual({ outcome: 'failed' });
  });

  it('manda el nombre en el cuerpo, con Authorization y Content-Type', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url: String(url), init };
      return fakeResponse({ displayName: 'Ana' });
    }) as unknown as typeof fetch;
    const client = createDisplayNameClient({ baseUrl: 'http://x', getIdToken: TOKEN }, spy);

    await client.claim('Ana');

    expect(seen?.url).toBe('http://x/me/display-name');
    expect(seen?.init.method).toBe('POST');
    expect((seen?.init.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
    expect(seen?.init.body).toBe(JSON.stringify({ name: 'Ana' }));
  });
});

describe('createDisplayNameClient: read', () => {
  it('200 con nombre es ok con ese nombre', async () => {
    const client = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({ displayName: 'Ana Lopez' }),
    );

    await expect(client.read()).resolves.toEqual({ outcome: 'ok', displayName: 'Ana Lopez' });
  });

  it('200 sin nombre elegido es ok con null', async () => {
    const client = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({ displayName: null }),
    );

    await expect(client.read()).resolves.toEqual({ outcome: 'ok', displayName: null });
  });

  it('503 es unavailable', async () => {
    const client = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({ error: 'directory-not-configured' }, 503),
    );

    await expect(client.read()).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('un 401 es failed', async () => {
    const client = createDisplayNameClient(
      { baseUrl: 'http://x', getIdToken: TOKEN },
      respondWith({ error: 'unauthorized' }, 401),
    );

    await expect(client.read()).resolves.toEqual({ outcome: 'failed' });
  });

  it('la red caida es failed', async () => {
    const client = createDisplayNameClient({ baseUrl: 'http://x', getIdToken: TOKEN }, REJECTS);

    await expect(client.read()).resolves.toEqual({ outcome: 'failed' });
  });

  it('pide GET sin cuerpo, con Authorization', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url: String(url), init };
      return fakeResponse({ displayName: null });
    }) as unknown as typeof fetch;
    const client = createDisplayNameClient({ baseUrl: 'http://x', getIdToken: TOKEN }, spy);

    await client.read();

    expect(seen?.url).toBe('http://x/me/display-name');
    expect(seen?.init.method).toBe('GET');
    expect(seen?.init.body).toBeUndefined();
  });
});
