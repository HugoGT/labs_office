import { describe, expect, it, vi } from 'vitest';
import { LivekitTokenError, fetchLivekitToken } from './livekitTokenClient';

const TOKEN_URL = 'http://localhost:2567/livekit/token';

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function okFetch() {
  return vi.fn(
    async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      fakeResponse(200, {
        token: 'jwt',
        url: 'ws://localhost:7880',
        identity: 'abc',
        room: 'office-livekit',
      }),
  );
}

/** Lo enviado en el cuerpo, ya decodificado. */
function sentBody(fetchImpl: ReturnType<typeof okFetch>): unknown {
  return JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
}

describe('fetchLivekitToken', () => {
  it('hace POST con el cuerpo { sessionId } y devuelve la respuesta decodificada', async () => {
    const fetchImpl = okFetch();

    const result = await fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'abc' }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(init?.method).toBe('POST');
    expect(sentBody(fetchImpl)).toEqual({ sessionId: 'abc' });
    expect(result).toEqual({
      token: 'jwt',
      url: 'ws://localhost:7880',
      identity: 'abc',
      room: 'office-livekit',
    });
  });

  it('con sesion manda { sessionId, token }, que es lo que el servidor verifica', async () => {
    const fetchImpl = okFetch();

    await fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'abc', token: 'id-token' }, fetchImpl);

    expect(sentBody(fetchImpl)).toEqual({ sessionId: 'abc', token: 'id-token' });
  });

  it('sin sesion el token simplemente no esta en el cuerpo', async () => {
    const fetchImpl = okFetch();

    await fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'abc', token: null }, fetchImpl);

    // `token: null` en el cuerpo seria un intento de autenticacion con un
    // valor invalido; la ausencia es lo que el servidor lee como "auth
    // apagada" y sigue atendiendo igual que antes de #8.
    expect(sentBody(fetchImpl)).toEqual({ sessionId: 'abc' });
    expect(sentBody(fetchImpl)).not.toHaveProperty('token');
  });

  it('un 401 (token invalido o ausente) rechaza sin filtrar el motivo a la consola', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(401, { error: 'unauthorized' }));

    await expect(
      fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'abc' }, fetchImpl),
    ).rejects.toThrow();
  });

  it('un 403 (sesion desconocida) rechaza en vez de devolver un valor silencioso', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(403, { error: 'unknown-session' }));

    await expect(
      fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'ghost' }, fetchImpl),
    ).rejects.toThrow();
  });

  it('un 403 (sesion de otro) rechaza igual: no es un caso degradado, es un no', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(403, { error: 'forbidden-session' }));

    await expect(
      fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'de-otra', token: 'jwt' }, fetchImpl),
    ).rejects.toThrow();
  });

  it('un 503 (LiveKit no configurado) rechaza en vez de devolver un valor silencioso', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(503, { error: 'livekit-not-configured' }));

    await expect(
      fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'abc' }, fetchImpl),
    ).rejects.toThrow();
  });

  it('spaceId presente se manda en el cuerpo, junto a sessionId y token', async () => {
    const fetchImpl = okFetch();

    await fetchLivekitToken(
      { tokenUrl: TOKEN_URL, sessionId: 'abc', token: 'id-token', spaceId: 's1' },
      fetchImpl,
    );

    expect(sentBody(fetchImpl)).toEqual({ sessionId: 'abc', token: 'id-token', spaceId: 's1' });
  });

  it('spaceId ausente o null no viaja en el cuerpo: pedirlo asi es lo que hoy manda el corredor', async () => {
    const fetchImpl = okFetch();

    await fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'abc' }, fetchImpl);
    expect(sentBody(fetchImpl)).not.toHaveProperty('spaceId');

    const fetchImpl2 = okFetch();
    await fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'abc', spaceId: null }, fetchImpl2);
    expect(sentBody(fetchImpl2)).not.toHaveProperty('spaceId');
  });

  it('el rechazo trae LivekitTokenError con el status y el codigo del cuerpo de error', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(403, { error: 'forbidden-space' }));

    await fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'abc', spaceId: 's1' }, fetchImpl).catch(
      (err: unknown) => {
        expect(err).toBeInstanceOf(LivekitTokenError);
        expect((err as LivekitTokenError).status).toBe(403);
        expect((err as LivekitTokenError).code).toBe('forbidden-space');
      },
    );
  });

  it('un cuerpo de error sin JSON valido igual rechaza con LivekitTokenError, codigo "unknown"', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('not json');
      },
    }) as unknown as Response);

    const rejection = fetchLivekitToken({ tokenUrl: TOKEN_URL, sessionId: 'abc' }, fetchImpl);

    await rejection.catch((err: unknown) => {
      expect(err).toBeInstanceOf(LivekitTokenError);
      const tokenError = err as LivekitTokenError;
      expect(tokenError.status).toBe(503);
      expect(tokenError.code).toBe('unknown');
    });
  });
});
