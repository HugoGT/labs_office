import { describe, expect, it, vi } from 'vitest';
import { AdminError } from './adminPort';
import { createArtUploadClient } from './artUploadClient';
import type { ArtUploadInput } from './artUploadPort';

const BASE_URL = 'http://localhost:2567';

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function fetchWith(status: number, body: unknown = {}) {
  return vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => fakeResponse(status, body));
}

function clientWith(fetchImpl: ReturnType<typeof fetchWith>) {
  return createArtUploadClient({ baseUrl: BASE_URL, getIdToken: async () => 'id-token' }, fetchImpl as unknown as typeof fetch);
}

const INPUT: ArtUploadInput = {
  kind: 'plant',
  name: 'Helecho',
  author: 'Equipo de arte',
  license: 'proprietary-internal',
  material: 'helecho',
  files: { sheet: 'iVBORw0KGgo=' },
};

async function failure(promise: Promise<unknown>): Promise<AdminError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AdminError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

describe('createArtUploadClient (#121)', () => {
  it('posts the piece as JSON with the files in base64, authenticated, and answers what was registered', async () => {
    const fetchImpl = fetchWith(201, { piece: { id: 'plant-upload-0123456789abcdef', kind: 'plant', name: 'Helecho' }, asset: { id: 'a1' } });

    const uploaded = await clientWith(fetchImpl).upload(INPUT);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/admin/assets/upload`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(INPUT);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
    expect(uploaded).toEqual({ id: 'plant-upload-0123456789abcdef', kind: 'plant', name: 'Helecho', decor: true });
  });

  it('a refused file keeps its code and names the file or field', async () => {
    const error = await failure(clientWith(fetchWith(400, { error: 'invalid-dimensions', field: 'walk' })).upload(INPUT));
    expect(error.code).toBe('invalid-dimensions');
    expect(error.field).toBe('walk');

    expect((await failure(clientWith(fetchWith(400, { error: 'not-png', field: 'sheet' })).upload(INPUT))).code).toBe('not-png');
    expect((await failure(clientWith(fetchWith(400, { error: 'something-else' })).upload(INPUT))).code).toBe('invalid-request');
  });

  it('a body over the limit, a missing bucket and the two conflicts each keep their code', async () => {
    expect((await failure(clientWith(fetchWith(413, { error: 'too-large' })).upload(INPUT))).code).toBe('too-large');
    expect((await failure(clientWith(fetchWith(503, { error: 'asset-upload-not-configured' })).upload(INPUT))).code).toBe('asset-upload-not-configured');
    expect((await failure(clientWith(fetchWith(409, { error: 'asset-already-uploaded' })).upload(INPUT))).code).toBe('asset-already-uploaded');
    expect((await failure(clientWith(fetchWith(409, { error: 'asset-name-taken' })).upload(INPUT))).code).toBe('asset-name-taken');
  });
});
