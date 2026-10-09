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
