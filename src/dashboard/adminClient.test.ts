import { describe, expect, it, vi } from 'vitest';
import { createAdminClient, resolveAdminBaseUrl } from './adminClient';
import { AdminError, type AdminErrorCode } from './adminPort';

const BASE_URL = 'http://localhost:2567/admin';

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function fetchWith(status: number, body: unknown = {}) {
  return vi.fn(
    async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      fakeResponse(status, body),
  );
}

function clientWith(
  fetchImpl: ReturnType<typeof fetchWith> | typeof fetch,
  getIdToken: () => Promise<string | null> = async () => 'id-token',
) {
  return createAdminClient({ baseUrl: BASE_URL, getIdToken }, fetchImpl as typeof fetch);
}

/** Las cabeceras de la peticion numero `call`, ya normalizadas. */
function sentHeaders(fetchImpl: ReturnType<typeof fetchWith>, call = 0): Record<string, string> {
  return (fetchImpl.mock.calls[call][1]?.headers ?? {}) as Record<string, string>;
}

async function codeOf(promise: Promise<unknown>): Promise<AdminErrorCode | 'no-error'> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof AdminError ? error.code : 'no-error';
  }
}

describe('resolveAdminBaseUrl', () => {
  it('sin servidor de oficina no hay panel que consultar', () => {
    expect(resolveAdminBaseUrl({ officeEndpoint: null })).toBeNull();
    expect(resolveAdminBaseUrl({})).toBeNull();
  });

  it('deriva de ws:// a http:// + /admin', () => {
    expect(resolveAdminBaseUrl({ officeEndpoint: 'ws://localhost:2567' })).toBe(
      'http://localhost:2567/admin',
    );
  });

  it('deriva de wss:// a https:// + /admin', () => {
    expect(resolveAdminBaseUrl({ officeEndpoint: 'wss://oficina.example.com' })).toBe(
      'https://oficina.example.com/admin',
    );
  });
});

describe('createAdminClient: contrato del servidor', () => {
  it('GET /admin/session devuelve la sesion administrativa', async () => {
    const fetchImpl = fetchWith(200, {
      role: 'admin',
      email: 'ana@example.com',
      displayName: 'Ana',
      expiresAt: null,
    });

    const session = await clientWith(fetchImpl).session();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/session');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(session).toEqual({
      role: 'admin',
      email: 'ana@example.com',
      displayName: 'Ana',
      expiresAt: null,
    });
  });

  it('GET /admin/invitations desenvuelve la lista', async () => {
    const invitation = {
      id: 'inv-1',
      email: 'invitado@example.com',
      role: 'guest',
      status: 'active',
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-08T00:00:00.000Z',
      daysLeft: 7,
      invitedByEmail: 'ana@example.com',
    };
    const fetchImpl = fetchWith(200, { invitations: [invitation] });

    const invitations = await clientWith(fetchImpl).listInvitations();

    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:2567/admin/invitations');
    expect(invitations).toEqual([invitation]);
  });

  it('POST /admin/invitations manda { email, days } y devuelve la credencial', async () => {
    const fetchImpl = fetchWith(201, {
      id: 'inv-1',
      email: 'invitado@example.com',
      password: 'generada',
      expiresAt: '2026-09-08T00:00:00.000Z',
    });

    const created = await clientWith(fetchImpl).createInvitation('invitado@example.com', 7);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/invitations');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'invitado@example.com', days: 7 });
    expect(created.password).toBe('generada');
  });

  it('POST /admin/users manda { email, role } y devuelve la credencial', async () => {
    const fetchImpl = fetchWith(201, {
      id: 'user-1',
      email: 'nueva@example.com',
      role: 'employee',
      password: 'generada',
    });

    const created = await clientWith(fetchImpl).createUser('nueva@example.com', 'employee');

    const [url, init] = fetchImpl.mock.calls[0];
    // Ruta propia y no `/admin/invitations`: lo que se crea aqui no es una
    // invitacion y no aparecera nunca en esa lista.
    expect(url).toBe('http://localhost:2567/admin/users');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      email: 'nueva@example.com',
      role: 'employee',
    });
    expect(created).toEqual({
      id: 'user-1',
      email: 'nueva@example.com',
      role: 'employee',
      password: 'generada',
    });
  });

  it('POST /admin/users manda el ID token como Bearer, igual que el resto', async () => {
    const fetchImpl = fetchWith(201, {});

    await clientWith(fetchImpl).createUser('nueva@example.com', 'admin');

    expect(sentHeaders(fetchImpl).Authorization).toBe('Bearer id-token');
  });

  it('un 403 al crear un admin llega como AdminError(forbidden)', async () => {
    // Es la respuesta del servidor cuando un admin intenta crear otro admin. La
    // pantalla esconde esa opcion, pero eso es cosmetico: el endpoint es
    // publico y la traduccion del 403 tiene que existir igual.
    const fetchImpl = fetchWith(403, { error: 'forbidden' });

    const code = await codeOf(clientWith(fetchImpl).createUser('nueva@example.com', 'admin'));

    expect(code).toBe('forbidden');
  });

  it('POST /admin/invitations/{id}/revoke escapa el identificador', async () => {
    const fetchImpl = fetchWith(200, { id: 'inv/1', status: 'revoked' });

    await clientWith(fetchImpl).revoke('inv/1');

    const [url, init] = fetchImpl.mock.calls[0];
    // Sin escapar, un id con barra inventaria una ruta que el servidor no
    // tiene y el fallo llegaria como un 404 desconcertante.
    expect(url).toBe('http://localhost:2567/admin/invitations/inv%2F1/revoke');
    expect(init?.method).toBe('POST');
  });
});

describe('createAdminClient: autorizacion', () => {
  it('manda el ID token como Bearer en cada peticion', async () => {
    const fetchImpl = fetchWith(200, { invitations: [] });

    await clientWith(fetchImpl).listInvitations();

    expect(sentHeaders(fetchImpl).Authorization).toBe('Bearer id-token');
  });

  it('pide un token fresco en CADA peticion, nunca uno cacheado', async () => {
    const fetchImpl = fetchWith(200, { invitations: [] });
    const getIdToken = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce('token-1')
      .mockResolvedValueOnce('token-2');
    const client = clientWith(fetchImpl, getIdToken);

    await client.listInvitations();
    await client.listInvitations();

    // El token caduca cada hora (ver `AuthGate`): una copia dejaria de valer
    // sin que nada avisase.
    expect(getIdToken).toHaveBeenCalledTimes(2);
    expect(sentHeaders(fetchImpl, 0).Authorization).toBe('Bearer token-1');
    expect(sentHeaders(fetchImpl, 1).Authorization).toBe('Bearer token-2');
  });

  it('sin token no sale ninguna peticion: es un no autenticado de cliente', async () => {
    const fetchImpl = fetchWith(200, { invitations: [] });
    const client = clientWith(fetchImpl, async () => null);

    expect(await codeOf(client.listInvitations())).toBe('unauthorized');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('createAdminClient: traduccion de estados', () => {
  const cases: [number, AdminErrorCode][] = [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [400, 'invalid-request'],
    [409, 'conflict'],
    [503, 'identity-admin-not-configured'],
    [404, 'unknown'],
    [500, 'unknown'],
  ];

  for (const [status, code] of cases) {
    it(`${status} se traduce a '${code}'`, async () => {
      const client = clientWith(fetchWith(status, { error: 'lo que sea' }));

      expect(await codeOf(client.session())).toBe(code);
    });
  }

  it('las tres operaciones traducen igual, no solo la sesion', async () => {
    const client = clientWith(fetchWith(403, {}));

    expect(await codeOf(client.listInvitations())).toBe('forbidden');
    expect(await codeOf(client.createInvitation('a@example.com', 7))).toBe('forbidden');
    expect(await codeOf(client.revoke('inv-1'))).toBe('forbidden');
  });

  it('un fallo de red es otra cosa que un rechazo del servidor', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(await codeOf(clientWith(fetchImpl as unknown as typeof fetch).session())).toBe('network');
  });

  it('una respuesta que dice ser JSON y no lo es no se traga', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    })) as unknown as typeof fetch;

    // Es el sintoma exacto de #24 punto 3: sin bloque propio en el Caddyfile,
    // `/admin/...` devuelve el index.html del SPA con un 200 alegre.
    expect(await codeOf(clientWith(fetchImpl).session())).toBe('unknown');
  });

  it('el error lleva el codigo y sigue siendo un Error de verdad', async () => {
    const client = clientWith(fetchWith(403, {}));

    await expect(client.session()).rejects.toBeInstanceOf(AdminError);
    await expect(client.session()).rejects.toBeInstanceOf(Error);
  });
});
