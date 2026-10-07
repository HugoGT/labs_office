/**
 * HTTP client of `GET|POST /me/avatar` and of the pack catalog (art
 * migration, step 5), with `fetch` injected like `displayNameClient.test.ts`.
 * What matters is the complete translation of HTTP statuses into closed
 * outcomes, and that the catalog comes from the same manifest the office
 * loads.
 */

import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { createCharacterClient } from './characterClient';

const TOKEN = async () => 'id-token';
const MANIFEST = JSON.parse(exportedManifest);

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  } as unknown as Response;
}

function respondWith(body: unknown, status = 200) {
  return vi.fn(async () => fakeResponse(body, status)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const REJECTS = (async () => {
  throw new Error('network down');
}) as unknown as typeof fetch;

function client(fetchImpl: typeof fetch, getIdToken: () => Promise<string | null> = TOKEN) {
  return createCharacterClient(
    { baseUrl: 'http://server', getIdToken, manifestUrl: 'assets/pack/manifest.json' },
    fetchImpl,
  );
}

describe('createCharacterClient: read', () => {
  it('200 is ok with the stored character and whether it was chosen', async () => {
    const fetchImpl = respondWith({ avatarId: 'character-p02-beige-blazer', chosen: true });

    await expect(client(fetchImpl).read()).resolves.toEqual({
      outcome: 'ok',
      avatarId: 'character-p02-beige-blazer',
      chosen: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://server/me/avatar',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer id-token' } }),
    );
  });

  it('503 is unavailable: no directory or no catalog', async () => {
    await expect(client(respondWith({ error: 'decor-not-configured' }, 503)).read()).resolves.toEqual({
      outcome: 'unavailable',
    });
  });

  it.each([
    ['a malformed body', respondWith({ avatarId: 7, chosen: 'yes' })],
    ['a network failure', REJECTS],
  ])('%s is failed', async (_label, fetchImpl) => {
    await expect(client(fetchImpl).read()).resolves.toEqual({ outcome: 'failed' });
  });

  it('without a token it fails without calling the server', async () => {
    const fetchImpl = respondWith({});

    await expect(client(fetchImpl, async () => null).read()).resolves.toEqual({ outcome: 'failed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('character entrance HTTP denials', () => {
  it.each(['expired', 'revoked', 'not-provisioned', 'session-expired', undefined, 'unknown'])(
    'preserves %s on reads and saves', async (reason) => {
      const port = client(respondWith({ error: 'unauthorized', reason }, 401));
      const expected = { outcome: 'denied', reason: reason === undefined || reason === 'unknown' ? 'unauthorized' : reason };
      await expect(port.read()).resolves.toEqual(expected);
      await expect(port.save('character-x')).resolves.toEqual(expected);
    },
  );
});

describe('createCharacterClient: save', () => {
  it('posts only the avatarId and answers ok with what the server stored', async () => {
    const fetchImpl = respondWith({ avatarId: 'character-p03-forest-suit', chosen: true });

    await expect(client(fetchImpl).save('character-p03-forest-suit')).resolves.toEqual({
      outcome: 'ok',
      avatarId: 'character-p03-forest-suit',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://server/me/avatar',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ avatarId: 'character-p03-forest-suit' }) }),
    );
  });

  it.each(['unknown-piece', 'retired-piece'] as const)('400 %s is invalid with that reason', async (reason) => {
    const fetchImpl = respondWith({ error: 'invalid-character', reason }, 400);

    await expect(client(fetchImpl).save('character-x')).resolves.toEqual({ outcome: 'invalid', reason });
  });

  it('a 400 with an unexpected reason is still invalid, as unknown-piece', async () => {
    const fetchImpl = respondWith({ error: 'invalid-character', reason: 'invalid-color' }, 400);

    await expect(client(fetchImpl).save('character-x')).resolves.toEqual({ outcome: 'invalid', reason: 'unknown-piece' });
  });

  it('503 is unavailable, anything else is failed', async () => {
    await expect(client(respondWith({}, 503)).save('character-x')).resolves.toEqual({ outcome: 'unavailable' });
    await expect(client(respondWith({}, 500)).save('character-x')).resolves.toEqual({ outcome: 'failed' });
    await expect(client(REJECTS).save('character-x')).resolves.toEqual({ outcome: 'failed' });
  });
});

describe('createCharacterClient: catalog', () => {
  it('lists the 18 characters of the pack with their sheets, in pack order, and the default', async () => {
    const fetchImpl = respondWith(MANIFEST);

    const catalog = await client(fetchImpl).catalog();

    expect(catalog?.options).toHaveLength(18);
    expect(catalog?.defaultId).toBe('character-p01-burgundy-suit');
    expect(catalog?.options[0]).toEqual({
      id: 'character-p01-burgundy-suit',
      name: 'Mateo',
      walkUrl: 'assets/pack/character/p01-burgundy-suit-walk.png',
      seatedUrl: 'assets/pack/character/p01-burgundy-suit-seated.png',
      // Pack characters carry no credit line: only contributed pieces do (#122).
      author: null,
    });
    // The manifest is static: no credential travels with it.
    expect(fetchImpl).toHaveBeenCalledWith('assets/pack/manifest.json', expect.not.objectContaining({ headers: expect.anything() }));
  });

  it('a character without both sheets is not offered', async () => {
    const [first, ...rest] = MANIFEST.pieces;
    const broken = { ...first, files: first.files.filter((file: { role: string }) => file.role === 'walk') };
    const catalog = await client(respondWith({ ...MANIFEST, pieces: [broken, ...rest] })).catalog();

    expect(catalog?.options.map((option) => option.id)).not.toContain(first.id);
  });

  it.each([
    ['a manifest it cannot read', respondWith({ format: 'other' })],
    ['a 404', respondWith({}, 404)],
    ['a network failure', REJECTS],
    ['a pack without characters', respondWith({ ...MANIFEST, pieces: MANIFEST.pieces.filter((piece: { kind: string }) => piece.kind !== 'character') })],
  ])('%s gives no catalog', async (_label, fetchImpl) => {
    await expect(client(fetchImpl).catalog()).resolves.toBeNull();
  });
});

describe('createCharacterClient: uploaded characters (#121)', () => {
  const UPLOADS_URL = 'http://server/assets/files/manifest.json';
  const [mateo] = MANIFEST.pieces;
  const UPLOADED = {
    ...mateo,
    id: 'character-upload-0123456789abcdef',
    name: 'Lucía',
    author: 'Ana',
    files: mateo.files.map((file: { role: string }) => ({ ...file, path: `${file.role === 'walk' ? 'a' : 'b'}.png` })),
  };
  const UPLOADS = { ...MANIFEST, pieces: [UPLOADED] };

  function byUrl(responses: Record<string, Response | Error>) {
    return vi.fn(async (url: string) => {
      const response = responses[url];
      if (response === undefined || response instanceof Error) throw response ?? new Error(`unexpected ${url}`);
      return response;
    }) as unknown as typeof fetch;
  }

  function uploadsClient(fetchImpl: typeof fetch) {
    return createCharacterClient(
      { baseUrl: 'http://server', getIdToken: TOKEN, manifestUrl: 'assets/pack/manifest.json', uploadsManifestUrl: UPLOADS_URL },
      fetchImpl,
    );
  }

  it('offers the uploads after the pack, their sheets served next to the uploads manifest', async () => {
    const catalog = await uploadsClient(
      byUrl({ 'assets/pack/manifest.json': fakeResponse(MANIFEST), [UPLOADS_URL]: fakeResponse(UPLOADS) }),
    ).catalog();

    expect(catalog?.options).toHaveLength(19);
    expect(catalog?.options.at(-1)).toEqual({
      id: UPLOADED.id,
      name: 'Lucía',
      walkUrl: 'http://server/assets/files/a.png',
      seatedUrl: 'http://server/assets/files/b.png',
      author: 'Ana',
    });
    expect(catalog?.defaultId).toBe('character-p01-burgundy-suit');
  });

  it('without the uploads (no catalog on the server, or offline) it is the pack alone', async () => {
    for (const uploads of [fakeResponse({ error: 'decor-not-configured' }, 503), new Error('offline')]) {
      const catalog = await uploadsClient(byUrl({ 'assets/pack/manifest.json': fakeResponse(MANIFEST), [UPLOADS_URL]: uploads })).catalog();
      expect(catalog?.options).toHaveLength(18);
    }
  });
});
