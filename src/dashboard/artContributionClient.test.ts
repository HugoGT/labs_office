import { describe, expect, it, vi } from 'vitest';
import { AdminError } from './adminPort';
import { createArtContributionClient } from './artContributionClient';
import type { ContributionInput } from './artContributionPort';
import { createArtReviewClient } from './artReviewClient';

const BASE_URL = 'http://localhost:2567';

function fakeResponse(status: number, body: unknown, bytes?: Uint8Array): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer,
  } as Response;
}

function fetchWith(status: number, body: unknown = {}, bytes?: Uint8Array) {
  return vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => fakeResponse(status, body, bytes));
}

const options = { baseUrl: BASE_URL, getIdToken: async () => 'id-token' };

async function failure(promise: Promise<unknown>): Promise<AdminError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AdminError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

const SERVER_CONTRIBUTION = {
  id: 'character-upload-0123456789abcdef',
  kind: 'character',
  name: 'Lucía',
  author: 'Ana',
  status: 'rejected',
  reviewNote: 'Tiene fondo',
  submittedAt: '2026-10-01T10:00:00.000Z',
  reviewedAt: '2026-10-01T11:00:00.000Z',
  retiredAt: null,
  licenseAcceptedAt: '2026-10-01T10:00:00.000Z',
  piece: {
    id: 'character-upload-0123456789abcdef',
    files: [
      { role: 'walk', path: `${'a'.repeat(64)}.png`, sha256: 'a'.repeat(64) },
      { role: 'seated', path: `${'b'.repeat(64)}.png`, sha256: 'b'.repeat(64) },
    ],
  },
};

const PARSED = {
  id: 'character-upload-0123456789abcdef',
  kind: 'character',
  name: 'Lucía',
  author: 'Ana',
  status: 'rejected',
  reviewNote: 'Tiene fondo',
  submittedAt: '2026-10-01T10:00:00.000Z',
  retiredAt: null,
  files: [
    { role: 'walk', path: `${'a'.repeat(64)}.png` },
    { role: 'seated', path: `${'b'.repeat(64)}.png` },
  ],
  uploadedBy: null,
};

const INPUT: ContributionInput = {
  kind: 'character',
  name: 'Lucía',
  author: 'Ana',
  rightsAccepted: true,
  files: { walk: 'iVBORw0KGgo=', seated: 'iVBORw0KGgo=' },
};

describe('createArtContributionClient (#122)', () => {
  it('posts the contribution authenticated to /me/art/contributions and reads it back', async () => {
    const fetchImpl = fetchWith(201, { contribution: { ...SERVER_CONTRIBUTION, status: 'pending', reviewNote: null } });

    const created = await createArtContributionClient(options, fetchImpl as unknown as typeof fetch).submit(INPUT);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/me/art/contributions`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(INPUT);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
    expect(created).toEqual({ ...PARSED, status: 'pending', reviewNote: null });
  });

  it('lists the own contributions with the reason of a rejection and the usage', async () => {
    const usage = { pending: 1, lastHour: 3, maxPending: 5, maxPerHour: 10 };
    const fetchImpl = fetchWith(200, { contributions: [SERVER_CONTRIBUTION], usage });

    expect(await createArtContributionClient(options, fetchImpl as unknown as typeof fetch).listMine()).toEqual({ contributions: [PARSED], usage });
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE_URL}/me/art/contributions`);
  });

  it('the two limits and the missing rights each keep their own code', async () => {
    const client = (status: number, body: unknown) => createArtContributionClient(options, fetchWith(status, body) as unknown as typeof fetch);

    expect((await failure(client(429, { error: 'too-many-pending' }).submit(INPUT))).code).toBe('too-many-pending');
    expect((await failure(client(429, { error: 'hourly-limit' }).submit(INPUT))).code).toBe('hourly-limit');
    expect((await failure(client(429, { error: 'other' }).submit(INPUT))).code).toBe('unknown');
    const rights = await failure(client(400, { error: 'rights-not-accepted', field: 'rightsAccepted' }).submit(INPUT));
    expect([rights.code, rights.field]).toEqual(['rights-not-accepted', 'rightsAccepted']);
    expect((await failure(client(409, { error: 'asset-already-uploaded' }).submit(INPUT))).code).toBe('asset-already-uploaded');
  });

  it('reads a private file with the token and answers a PNG data URL', async () => {
    const fetchImpl = fetchWith(200, {}, new Uint8Array([137, 80, 78, 71]));

    const url = await createArtContributionClient(options, fetchImpl as unknown as typeof fetch).fileDataUrl(`${'a'.repeat(64)}.png`);

    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE_URL}/me/art/files/${'a'.repeat(64)}.png`);
    expect((fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
    expect(url).toBe('data:image/png;base64,iVBORw==');
    expect((await failure(createArtContributionClient(options, fetchWith(404) as unknown as typeof fetch).fileDataUrl('x.png'))).code).toBe('not-found');
  });
});

describe('createArtReviewClient (#122)', () => {
  it('lists the queue by status, with who uploaded each piece', async () => {
    const uploadedBy = { id: 'id-ana', name: 'Ana', email: 'ana@example.com' };
    const fetchImpl = fetchWith(200, { contributions: [{ ...SERVER_CONTRIBUTION, uploadedBy }] });

    const list = await createArtReviewClient(options, fetchImpl as unknown as typeof fetch).list('pending');

    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE_URL}/admin/art/contributions?status=pending`);
    expect(list).toEqual([{ ...PARSED, uploadedBy }]);
  });

  it('approves, rejects with a reason and retires through their routes', async () => {
    const fetchImpl = fetchWith(200, { contribution: SERVER_CONTRIBUTION, usersReset: 2 });
    const client = createArtReviewClient(options, fetchImpl as unknown as typeof fetch);
    const id = SERVER_CONTRIBUTION.id;

    await client.approve(id);
    await client.reject(id, 'Tiene fondo');
    const retired = await client.retire(id);

    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [`${BASE_URL}/admin/art/contributions/${id}/approve`, 'POST', JSON.stringify({})],
      [`${BASE_URL}/admin/art/contributions/${id}/reject`, 'POST', JSON.stringify({ reason: 'Tiene fondo' })],
      [`${BASE_URL}/admin/art/pieces/${id}/retire`, 'POST', JSON.stringify({})],
    ]);
    expect(retired.usersReset).toBe(2);
  });

  it('a decision already taken and a reason left empty keep their codes', async () => {
    const client = (status: number, body: unknown) => createArtReviewClient(options, fetchWith(status, body) as unknown as typeof fetch);

    expect((await failure(client(409, { error: 'already-reviewed' }).approve('x'))).code).toBe('already-reviewed');
    expect((await failure(client(409, { error: 'not-retirable' }).retire('x'))).code).toBe('not-retirable');
    expect((await failure(client(400, { error: 'invalid-review-note', field: 'reason' }).reject('x', ''))).code).toBe('invalid-review-note');
  });

  it('reads previews through the same private route', async () => {
    const fetchImpl = fetchWith(200, {}, new Uint8Array([1, 2, 3]));
    await createArtReviewClient(options, fetchImpl as unknown as typeof fetch).fileDataUrl('f.png');
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE_URL}/me/art/files/f.png`);
  });
});
