import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminErrorCode } from './adminPort';
import { createCollisionAdminClient } from './collisionAdminClient';

const BASE_URL = 'http://localhost:2567';

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function fetchWith(status: number, body: unknown = {}) {
  return vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => fakeResponse(status, body));
}

function clientWith(fetchImpl: ReturnType<typeof fetchWith>, getIdToken: () => Promise<string | null> = async () => 'id-token') {
  return createCollisionAdminClient({ baseUrl: BASE_URL, getIdToken }, fetchImpl as unknown as typeof fetch);
}

async function codeOf(promise: Promise<unknown>): Promise<AdminErrorCode | 'no-error'> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof AdminError ? error.code : 'unknown';
  }
}

describe('createCollisionAdminClient', () => {
  it('posts the rectangles of one piece, authenticated', async () => {
    const fetchImpl = fetchWith(200, { pieceId: 'tree-oak', rects: [] });

    await clientWith(fetchImpl).saveRects('tree-oak', [{ x: -8, y: -12, w: 16, h: 12 }]);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/admin/collisions/tree-oak`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ rects: [{ x: -8, y: -12, w: 16, h: 12 }] });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
  });

  it('resets a piece through its own route', async () => {
    const fetchImpl = fetchWith(200, { pieceId: 'plant-upload-0123456789abcdef', rects: null });

    await clientWith(fetchImpl).reset('plant-upload-0123456789abcdef');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/admin/collisions/plant-upload-0123456789abcdef/reset`);
    expect(init?.method).toBe('POST');
  });

  it('maps the contract like the other admin clients', async () => {
    expect(await codeOf(clientWith(fetchWith(409, { error: 'collision-under-player' })).saveRects('tree-oak', []))).toBe('collision-under-player');
    expect(await codeOf(clientWith(fetchWith(503)).saveRects('tree-oak', []))).toBe('collisions-not-configured');
    expect(await codeOf(clientWith(fetchWith(404)).reset('plant-x'))).toBe('not-found');
    expect(await codeOf(clientWith(fetchWith(400, { error: 'invalid-request' })).saveRects('tree-oak', []))).toBe('invalid-request');
    expect(await codeOf(clientWith(fetchWith(200), async () => null).saveRects('tree-oak', []))).toBe('unauthorized');
  });
});
