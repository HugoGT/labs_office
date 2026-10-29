import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminErrorCode } from './adminPort';
import { createTerrainAdminClient } from './terrainAdminClient';

const BASE_URL = 'http://localhost:2567';

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function fetchWith(status: number, body: unknown = {}) {
  return vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => fakeResponse(status, body));
}

function clientWith(fetchImpl: ReturnType<typeof fetchWith>, getIdToken: () => Promise<string | null> = async () => 'id-token') {
  return createTerrainAdminClient({ baseUrl: BASE_URL, getIdToken }, fetchImpl as unknown as typeof fetch);
}

async function codeOf(promise: Promise<unknown>): Promise<AdminErrorCode | 'no-error'> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof AdminError ? error.code : 'unknown';
  }
}

describe('createTerrainAdminClient', () => {
  it('sends an authenticated atomic batch and maps stale preview conflicts', async () => {
    const fetchImpl = fetchWith(200);
    const edits = [{ index: 0, material: 'grass' as const }];
    await clientWith(fetchImpl).setBlocks(edits, 'water,wood');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/admin/terrain/blocks`);
    expect(JSON.parse(init?.body as string)).toEqual({ edits, expected: 'water,wood' });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
    expect(await codeOf(clientWith(fetchWith(409, { error: 'terrain-stale' })).setBlocks(edits, 'old'))).toBe('terrain-stale');
  });
  it('posts the material of one block, authenticated', async () => {
    const fetchImpl = fetchWith(200, { index: 35, material: 'water' });

    await clientWith(fetchImpl).setBlock(35, 'water');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/admin/terrain/blocks/35`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ material: 'water' });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
  });

  it('posts the color of a painted carpet block with its material (#222)', async () => {
    const fetchImpl = fetchWith(200);

    await clientWith(fetchImpl).setBlock(35, 'carpet', '#c0392b');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/admin/terrain/blocks/35`);
    expect(JSON.parse(init?.body as string)).toEqual({ material: 'carpet', color: '#c0392b' });
  });

  it('carries each edit color of a batch as given (#222)', async () => {
    const fetchImpl = fetchWith(200);
    const edits = [{ index: 0, material: 'carpet' as const, color: '#3c6ac8' }, { index: 1, material: 'grass' as const }];

    await clientWith(fetchImpl).setBlocks(edits, 'water,wood');

    expect(JSON.parse(fetchImpl.mock.calls[0]![1]?.body as string)).toEqual({ edits, expected: 'water,wood' });
  });

  it('posts the uploaded floor of a wood block with its material, and leaves the field out otherwise (S13)', async () => {
    const piece = 'floor-upload-0123456789abcdef';
    const withFloor = fetchWith(200);
    const without = fetchWith(200);
    const withColor = fetchWith(200);

    await clientWith(withFloor).setBlock(35, 'wood', undefined, piece);
    await clientWith(without).setBlock(35, 'wood');
    await clientWith(withColor).setBlock(35, 'carpet', '#c0392b');

    expect(withFloor.mock.calls[0]![1]?.body).toBe(JSON.stringify({ material: 'wood', floor: piece }));
    // Previous bodies, byte for byte.
    expect(without.mock.calls[0]![1]?.body).toBe(JSON.stringify({ material: 'wood' }));
    expect(withColor.mock.calls[0]![1]?.body).toBe(JSON.stringify({ material: 'carpet', color: '#c0392b' }));
  });

  it('carries each edit floor of a batch as given (S13)', async () => {
    const fetchImpl = fetchWith(200);
    const edits = [{ index: 0, material: 'wood' as const, floor: 'floor-upload-0123456789abcdef' }, { index: 1, material: 'grass' as const }];

    await clientWith(fetchImpl).setBlocks(edits, 'water,wood');

    expect(JSON.parse(fetchImpl.mock.calls[0]![1]?.body as string)).toEqual({ edits, expected: 'water,wood' });
  });

  it('tells a placement refusal from a stale preview', async () => {
    expect(await codeOf(clientWith(fetchWith(409, { error: 'terrain-under-placement' })).setBlock(1, 'water'))).toBe(
      'terrain-under-placement',
    );
    expect(await codeOf(clientWith(fetchWith(409, { error: 'terrain-stale' })).setBlock(1, 'water'))).toBe(
      'terrain-stale',
    );
  });

  it('maps the rest of the contract like the other admin clients', async () => {
    expect(await codeOf(clientWith(fetchWith(503)).setBlock(1, 'sand'))).toBe('terrain-not-configured');
    expect(await codeOf(clientWith(fetchWith(403)).setBlock(1, 'sand'))).toBe('forbidden');
    expect(await codeOf(clientWith(fetchWith(400, { error: 'invalid-request' })).setBlock(1, 'sand'))).toBe('invalid-request');
    expect(await codeOf(clientWith(fetchWith(200), async () => null).setBlock(1, 'sand'))).toBe('unauthorized');
  });

  it('posts a whole wall batch to one route, authenticated, and maps its refusals', async () => {
    const fetchImpl = fetchWith(200, { updated: 2 });
    const edits = [{ index: 3, piece: 'wall-brick' as const }, { index: 4, piece: null }];

    await clientWith(fetchImpl).setWalls(edits);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/admin/terrain/walls`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ edits });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
    expect(await codeOf(clientWith(fetchWith(409, { error: 'terrain-under-placement' })).setWalls(edits))).toBe('terrain-under-placement');
    expect(await codeOf(clientWith(fetchWith(503)).setWalls(edits))).toBe('terrain-not-configured');
  });
});
