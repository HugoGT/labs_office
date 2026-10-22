import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminErrorCode } from '../dashboard/adminPort';
import { createOfficeDecorClient } from './officeDecorClient';
import type { DecorEdit } from './officeDecor';

const BASE_URL = 'http://localhost:2567';

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function fetchWith(status: number, body: unknown = { updated: 1 }) {
  return vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => fakeResponse(status, body));
}

function clientWith(scope: 'office' | 'desk', fetchImpl: ReturnType<typeof fetchWith>, getIdToken: () => Promise<string | null> = async () => 'id-token') {
  return createOfficeDecorClient({ baseUrl: BASE_URL, getIdToken, scope }, fetchImpl as unknown as typeof fetch);
}

async function codeOf(promise: Promise<unknown>): Promise<AdminErrorCode | 'no-error'> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof AdminError ? error.code : 'unknown';
  }
}

const EDITS: DecorEdit[] = [
  { index: 7, item: { piece: 'chair-wood', rotation: 270 } },
  { index: 8, item: null },
];

describe('createOfficeDecorClient', () => {
  it('posts a whole batch to /admin/decor for the office, authenticated', async () => {
    const fetchImpl = fetchWith(200);
    await clientWith('office', fetchImpl).setDecor(EDITS);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/admin/decor`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ edits: EDITS });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
  });

  it('posts to /me/decor for one\'s own desk', async () => {
    const fetchImpl = fetchWith(200);
    await clientWith('desk', fetchImpl).setDecor(EDITS);
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE_URL}/me/decor`);
  });

  it('tells a placement refusal, a missing store and a lost session apart', async () => {
    expect(await codeOf(clientWith('office', fetchWith(409, { error: 'terrain-under-placement' })).setDecor(EDITS))).toBe('terrain-under-placement');
    expect(await codeOf(clientWith('office', fetchWith(503)).setDecor(EDITS))).toBe('terrain-not-configured');
    expect(await codeOf(clientWith('office', fetchWith(400, { error: 'invalid-request' })).setDecor(EDITS))).toBe('invalid-request');
    expect(await codeOf(clientWith('office', fetchWith(401)).setDecor(EDITS))).toBe('unauthorized');
    expect(await codeOf(clientWith('office', fetchWith(200), async () => null).setDecor(EDITS))).toBe('unauthorized');
  });

  it('reads why /me/decor refused: no desk any more, or an edit outside it', async () => {
    expect(await codeOf(clientWith('desk', fetchWith(403, { error: 'no-desk' })).setDecor(EDITS))).toBe('no-desk');
    expect(await codeOf(clientWith('desk', fetchWith(403, { error: 'outside-desk' })).setDecor(EDITS))).toBe('outside-desk');
    // Any other 403 (an admin route without the role) stays a plain refusal.
    expect(await codeOf(clientWith('office', fetchWith(403, { error: 'forbidden' })).setDecor(EDITS))).toBe('forbidden');
    expect(await codeOf(clientWith('desk', fetchWith(403, 'nope')).setDecor(EDITS))).toBe('forbidden');
  });
});
