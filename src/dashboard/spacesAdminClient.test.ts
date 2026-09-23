import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminErrorCode } from './adminPort';
import { createSpacesAdminClient } from './spacesAdminClient';

/** La RAIZ del servidor, sin `/admin`: `GET /spaces` no cuelga de ese prefijo. */
const BASE_URL = 'http://localhost:2567';

const SERVED_ROOM = {
  id: 'space-1',
  slug: 'sala-reuniones',
  name: 'Sala de reuniones',
  x: 10,
  y: 4,
  w: 6,
  h: 5,
  capacity: 8,
  kind: 'room',
};

const SERVED_DESK_SPACE = {
  id: 'space-2',
  slug: 'desk-1',
  name: 'Mesa 4',
  x: 6,
  y: 9,
  w: 3,
  h: 3,
  capacity: null,
  kind: 'desk',
};

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
  return createSpacesAdminClient({ baseUrl: BASE_URL, getIdToken }, fetchImpl as typeof fetch);
}

/** El cuerpo JSON que se envio en la peticion numero `call`, ya parseado. */
function sentBody(fetchImpl: ReturnType<typeof fetchWith>, call = 0): unknown {
  return JSON.parse((fetchImpl.mock.calls[call][1]?.body ?? 'null') as string);
}

async function codeOf(promise: Promise<unknown>): Promise<AdminErrorCode | 'no-error'> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof AdminError ? error.code : 'no-error';
  }
}

describe('createSpacesAdminClient: contrato del servidor', () => {
  it('lee la lista de /spaces, que NO cuelga de /admin', async () => {
    // `GET /spaces` no exige ni credencial (spacesRoutes.ts): es la config que
    // lee cada cliente al arrancar. El panel reusa la misma ruta en vez de
    // abrir una segunda consulta que mantener en paralelo.
    const fetchImpl = fetchWith(200, { spaces: [SERVED_ROOM], version: 'v1' });

    await clientWith(fetchImpl).listSpaces();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/spaces');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('desempaqueta la lista y conserva las coordenadas en TILES', async () => {
    const fetchImpl = fetchWith(200, { spaces: [SERVED_ROOM], version: 'v1' });

    const spaces = await clientWith(fetchImpl).listSpaces();

    expect(spaces).toEqual([
      {
        id: 'space-1',
        name: 'Sala de reuniones',
        x: 10,
        y: 4,
        w: 6,
        h: 5,
        capacity: 8,
        kind: 'room',
      },
    ]);
  });

  it('surca el kind de cada fila para distinguir salas de cubiculos de escritorio (#10 + #12)', async () => {
    const fetchImpl = fetchWith(200, {
      spaces: [SERVED_ROOM, SERVED_DESK_SPACE],
      version: 'v1',
    });

    const spaces = await clientWith(fetchImpl).listSpaces();

    expect(spaces.map((space) => space.kind)).toEqual(['room', 'desk']);
  });

  it('una sala sin aforo llega con capacity null, no con el campo ausente', async () => {
    const fetchImpl = fetchWith(200, { spaces: [SERVED_DESK_SPACE], version: 'v1' });

    const [space] = await clientWith(fetchImpl).listSpaces();

    expect(space.capacity).toBeNull();
  });

  it('crea con POST /admin/spaces y solo con lo que el servidor lee', async () => {
    const fetchImpl = fetchWith(201, SERVED_ROOM);

    await clientWith(fetchImpl).createSpace({ name: 'Sala de reuniones', x: 10, y: 4, w: 6, h: 5, capacity: 8 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/spaces');
    expect(init?.method).toBe('POST');
    expect(sentBody(fetchImpl)).toEqual({ name: 'Sala de reuniones', x: 10, y: 4, w: 6, h: 5, capacity: 8 });
  });

  it('crear sin aforo manda capacity null, no un campo ausente', async () => {
    const fetchImpl = fetchWith(201, SERVED_ROOM);

    await clientWith(fetchImpl).createSpace({ name: 'Sala de reuniones', x: 10, y: 4, w: 6, h: 5 });

    expect(sentBody(fetchImpl)).toEqual({
      name: 'Sala de reuniones',
      x: 10,
      y: 4,
      w: 6,
      h: 5,
      capacity: null,
    });
  });

  it('mover y renombrar son dos peticiones distintas, no una con huecos', async () => {
    // Mismo contrato que el servidor: `updateSpace` copia solo las claves
    // PRESENTES (spacesRoutes.ts), asi que mandar x/y al renombrar devolveria
    // la sala a la ultima posicion leida si alguien la movio mientras tanto.
    const fetchImpl = fetchWith(200, SERVED_ROOM);
    const client = clientWith(fetchImpl);

    await client.updateSpace('space-1', { name: 'Sala grande' });
    await client.updateSpace('space-1', { x: 12, y: 3, w: 6, h: 5 });

    expect(sentBody(fetchImpl, 0)).toEqual({ name: 'Sala grande' });
    expect(sentBody(fetchImpl, 1)).toEqual({ x: 12, y: 3, w: 6, h: 5 });
  });

  it('retirar el aforo manda capacity null explicito, no lo omite', async () => {
    // `capacity` distingue "no lo toques" (ausente) de "quitale el limite"
    // (`null` presente), igual que `UpdateSpaceInput` del servidor.
    const fetchImpl = fetchWith(200, SERVED_ROOM);

    await clientWith(fetchImpl).updateSpace('space-1', { capacity: null });

    expect(sentBody(fetchImpl)).toEqual({ capacity: null });
  });

  it('actualiza con POST /admin/spaces/:id y escapa el id', async () => {
    const fetchImpl = fetchWith(200, SERVED_ROOM);

    await clientWith(fetchImpl).updateSpace('space/1', { name: 'Sala grande' });

    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:2567/admin/spaces/space%2F1');
  });

  it('borra con POST /admin/spaces/:id/delete y no con DELETE', async () => {
    // El CORS del servidor anuncia `GET,POST,OPTIONS`: un DELETE moriria en el
    // preflight del navegador antes de llegar a Express.
    const fetchImpl = fetchWith(200, { deleted: true });

    await clientWith(fetchImpl).deleteSpace('space-1');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/spaces/space-1/delete');
    expect(init?.method).toBe('POST');
  });

  it('manda el ID token en cada peticion', async () => {
    const getIdToken = vi.fn(async () => 'id-token');
    const fetchImpl = fetchWith(200, { spaces: [], version: 'v1' });
    const client = clientWith(fetchImpl, getIdToken);

    await client.listSpaces();
    await client.listSpaces();

    expect(getIdToken).toHaveBeenCalledTimes(2);
    const headers = (fetchImpl.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer id-token');
  });
});

describe('createSpacesAdminClient: como cuenta los fallos', () => {
  it('un solape con otra sala es su propio motivo (space-overlap)', async () => {
    const client = clientWith(fetchWith(409, { error: 'space-overlap' }));

    expect(
      await codeOf(client.createSpace({ name: 'Sala', x: 10, y: 4, w: 6, h: 5 })),
    ).toBe('space-overlap');
  });

  it('un nombre repetido es su propio 409 (space-name-taken)', async () => {
    const client = clientWith(fetchWith(409, { error: 'space-name-taken' }));

    expect(
      await codeOf(client.createSpace({ name: 'Sala', x: 10, y: 4, w: 6, h: 5 })),
    ).toBe('space-name-taken');
  });

  it('un espacio que es en realidad el cubiculo de un escritorio se rechaza con su propio 409 (space-owned-by-desk)', async () => {
    const client = clientWith(fetchWith(409, { error: 'space-owned-by-desk' }));

    expect(await codeOf(client.updateSpace('space-2', { name: 'Otro nombre' }))).toBe(
      'space-owned-by-desk',
    );
  });

  it('un 409 cuyo cuerpo trae un motivo que esta ruta no declara cae al primero de la lista', async () => {
    const client = clientWith(fetchWith(409, { error: 'desk-space-overlap' }));

    expect(
      await codeOf(client.createSpace({ name: 'Sala', x: 10, y: 4, w: 6, h: 5 })),
    ).toBe('space-overlap');
  });

  it('un id que ya no existe es un 404 y se cuenta como tal', async () => {
    const client = clientWith(fetchWith(404, {}));

    expect(await codeOf(client.deleteSpace('space-1'))).toBe('not-found');
  });

  it('un despliegue sin directorio responde 503 spaces-not-configured y no es una averia', async () => {
    const client = clientWith(fetchWith(503, { error: 'spaces-not-configured' }));

    expect(await codeOf(client.listSpaces())).toBe('spaces-not-configured');
  });

  it('traduce el resto del contrato a motivos del panel', async () => {
    const casos: Array<[number, AdminErrorCode]> = [
      [400, 'invalid-request'],
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [500, 'unknown'],
    ];

    for (const [status, code] of casos) {
      const client = clientWith(fetchWith(status, {}));
      expect(await codeOf(client.listSpaces())).toBe(code);
    }
  });

  it('sin token no llega a preguntar', async () => {
    const fetchImpl = fetchWith(200, { spaces: [], version: 'v1' });
    const client = clientWith(fetchImpl, async () => null);

    expect(await codeOf(client.listSpaces())).toBe('unauthorized');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('el servidor caido y el que rechaza son fallos distintos', async () => {
    const client = clientWith(
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    );

    expect(await codeOf(client.listSpaces())).toBe('network');
  });

  it('una respuesta sin version legible se rechaza entera, aunque las filas sean validas', async () => {
    // Misma propiedad que `game/spacesConfig.parseSpacesConfig`: la version es
    // un hash de la lista COMPLETA, y publicarla sin poder confiar en el
    // cuerpo dejaria al panel afirmando una lista que no pudo validar entera.
    const client = clientWith(fetchWith(200, { spaces: [SERVED_ROOM] }));

    expect(await codeOf(client.listSpaces())).toBe('unknown');
  });

  it('una lista con una fila ilegible se rechaza entera', async () => {
    const client = clientWith(
      fetchWith(200, { spaces: [SERVED_ROOM, { id: 'space-3' }], version: 'v1' }),
    );

    expect(await codeOf(client.listSpaces())).toBe('unknown');
  });

  it('una fila con kind desconocido se rechaza entera', async () => {
    const client = clientWith(
      fetchWith(200, {
        spaces: [{ ...SERVED_ROOM, kind: 'corridor' }],
        version: 'v1',
      }),
    );

    expect(await codeOf(client.listSpaces())).toBe('unknown');
  });

  it('un 200 que no es JSON no deja la lista vacia y muda', async () => {
    const client = clientWith(
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      })) as unknown as typeof fetch,
    );

    expect(await codeOf(client.listSpaces())).toBe('unknown');
  });
});
