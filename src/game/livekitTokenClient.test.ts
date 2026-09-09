import { describe, expect, it, vi } from 'vitest';
import { fetchLivekitToken } from './livekitTokenClient';

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('fetchLivekitToken', () => {
  it('hace POST con el cuerpo { sessionId } y devuelve la respuesta decodificada', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        fakeResponse(200, {
          token: 'jwt',
          url: 'ws://localhost:7880',
          identity: 'abc',
          room: 'office-livekit',
        }),
    );

    const result = await fetchLivekitToken('http://localhost:2567/livekit/token', 'abc', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/livekit/token');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ sessionId: 'abc' });
    expect(result).toEqual({ token: 'jwt', url: 'ws://localhost:7880', identity: 'abc', room: 'office-livekit' });
  });

  it('un 403 (sesion desconocida) rechaza en vez de devolver un valor silencioso', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(403, { error: 'unknown-session' }));

    await expect(fetchLivekitToken('http://localhost:2567/livekit/token', 'ghost', fetchImpl)).rejects.toThrow();
  });

  it('un 503 (LiveKit no configurado) rechaza en vez de devolver un valor silencioso', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(503, { error: 'livekit-not-configured' }));

    await expect(fetchLivekitToken('http://localhost:2567/livekit/token', 'abc', fetchImpl)).rejects.toThrow();
  });
});
