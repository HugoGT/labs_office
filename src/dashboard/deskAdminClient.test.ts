import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminErrorCode } from './adminPort';
import { createDeskAdminClient } from './deskAdminClient';

/** La RAIZ del servidor, sin `/admin`: `GET /desks` no cuelga de ese prefijo. */
const BASE_URL = 'http://localhost:2567';

const SERVED_DESK = {
  id: 'desk-1',
  label: 'Mesa 4',
  x: 6,
  y: 9,
  w: 3,
  h: 3,
  occupant: null,
  mine: false,
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
  return createDeskAdminClient({ baseUrl: BASE_URL, getIdToken }, fetchImpl as typeof fetch);
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

describe('createDeskAdminClient: contrato del servidor', () => {
  it('lee la lista de /desks, que NO cuelga de /admin', async () => {
    // Es la unica lectura que el servidor ofrece: no hay `GET /admin/desks`.
    // Cuelga de la raiz porque la lee cada cliente al arrancar, no solo el
    // panel, y de ahi que la base de este adaptador sea la raiz.
    const fetchImpl = fetchWith(200, { desks: [SERVED_DESK] });

    await clientWith(fetchImpl).listDesks();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/desks');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('desempaqueta la lista y conserva las coordenadas en TILES', async () => {
    // El servidor guarda y sirve tiles, y quien administra escribe tiles en el
    // formulario. Convertir a pixeles aqui -- como hace `game/desksClient.ts`
    // para la escena -- obligaria a deshacer la conversion antes de guardar.
    const fetchImpl = fetchWith(200, { desks: [SERVED_DESK] });

    const desks = await clientWith(fetchImpl).listDesks();

    expect(desks).toEqual([
      { id: 'desk-1', label: 'Mesa 4', x: 6, y: 9, w: 3, h: 3, occupant: null },
    ]);
  });

  it('un escritorio ocupado llega con quien lo ocupa', async () => {
    const fetchImpl = fetchWith(200, {
      desks: [
        {
          ...SERVED_DESK,
          occupant: { id: 'user-7', displayName: 'Ana', items: [{ id: 'item-1', slot: 0 }] },
        },
      ],
    });

    const [desk] = await clientWith(fetchImpl).listDesks();

    // La decoracion del ocupante llega en la respuesta y NO se propaga: el
    // panel decide cuantos escritorios hay y donde, no que hay encima de
    // ellos. Un campo que nadie pinta seria una promesa que este panel no
    // cumple.
    expect(desk.occupant).toEqual({ id: 'user-7', displayName: 'Ana' });
  });

  it('crea con POST /admin/desks y solo con lo que el servidor lee', async () => {
    const fetchImpl = fetchWith(201, SERVED_DESK);

    await clientWith(fetchImpl).createDesk({ label: 'Mesa 4', x: 6, y: 9 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/desks');
    expect(init?.method).toBe('POST');
    // Ni `id` ni `occupantId`: el id lo genera la base de datos y quien se
    // sienta lo decide esa persona. Quien administra no reparte sitios.
    expect(sentBody(fetchImpl)).toEqual({ label: 'Mesa 4', x: 6, y: 9 });
  });

  it('mover y renombrar son dos peticiones distintas, no una con huecos', async () => {
    // El servidor copia solo las claves PRESENTES. Mandar `label: undefined`
    // al renombrar desaparece al serializar, pero mandar `x`/`y` con lo ultimo
    // que se leyo devolveria el escritorio a esa posicion si alguien lo movio
    // mientras tanto.
    const fetchImpl = fetchWith(200, SERVED_DESK);
    const client = clientWith(fetchImpl);

    await client.updateDesk('desk-1', { label: 'Mesa 5' });
    await client.updateDesk('desk-1', { x: 12, y: 3 });

    expect(sentBody(fetchImpl, 0)).toEqual({ label: 'Mesa 5' });
    expect(sentBody(fetchImpl, 1)).toEqual({ x: 12, y: 3 });
  });

  it('actualiza con POST /admin/desks/:id y escapa el id', async () => {
    const fetchImpl = fetchWith(200, SERVED_DESK);

    await clientWith(fetchImpl).updateDesk('desk/1', { label: 'Mesa 5' });

    // Un id con barra inventaria un segmento de ruta que el servidor no tiene.
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:2567/admin/desks/desk%2F1');
  });

  it('borra con POST /admin/desks/:id/delete y no con DELETE', async () => {
    // El CORS del servidor anuncia `GET,POST,OPTIONS`: un DELETE moriria en el
    // preflight del navegador antes de llegar a Express.
    const fetchImpl = fetchWith(200, { deleted: true });

    await clientWith(fetchImpl).deleteDesk('desk-1');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:2567/admin/desks/desk-1/delete');
    expect(init?.method).toBe('POST');
  });

  it('manda el ID token en cada peticion', async () => {
    const getIdToken = vi.fn(async () => 'id-token');
    const fetchImpl = fetchWith(200, { desks: [] });
    const client = clientWith(fetchImpl, getIdToken);

    await client.listDesks();
    await client.listDesks();

    // Se pide otra vez y no se guarda: el ID token caduca cada hora, y una
    // copia dejaria de valer a mitad de una sesion del panel.
    expect(getIdToken).toHaveBeenCalledTimes(2);
    const headers = (fetchImpl.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer id-token');
  });
});

describe('createDeskAdminClient: como cuenta los fallos', () => {
  it('un solape es su propio motivo, no un conflicto cualquiera', async () => {
    // El 409 de mover un escritorio encima de otro se arregla escribiendo
    // otras coordenadas. Contarlo como `conflict` le daria a quien administra
    // la frase de un correo repetido.
    const client = clientWith(fetchWith(409, { error: 'desk-overlap' }));

    expect(await codeOf(client.createDesk({ label: 'Mesa 4', x: 6, y: 9 }))).toBe('desk-overlap');
  });

  it('un id que ya no existe es un 404 y se cuenta como tal', async () => {
    const client = clientWith(fetchWith(404, {}));

    expect(await codeOf(client.deleteDesk('desk-1'))).toBe('not-found');
  });

  it('un despliegue sin directorio responde 503 y no es una averia', async () => {
    // Sin `DATABASE_URL` el servidor contesta `desks-not-configured` a TODAS
    // estas rutas. El panel tiene que poder esconderse en vez de pintar un
    // formulario roto, asi que el motivo no puede diluirse en "algo fallo".
    const client = clientWith(fetchWith(503, { error: 'desks-not-configured' }));

    expect(await codeOf(client.listDesks())).toBe('desks-not-configured');
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
      expect(await codeOf(client.listDesks())).toBe(code);
    }
  });

  it('sin token no llega a preguntar', async () => {
    const fetchImpl = fetchWith(200, { desks: [] });
    const client = clientWith(fetchImpl, async () => null);

    expect(await codeOf(client.listDesks())).toBe('unauthorized');
    // La peticion solo podria acabar en 401: ahorrarla deja el mismo motivo.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('el servidor caido y el que rechaza son fallos distintos', async () => {
    const client = clientWith(
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    );

    expect(await codeOf(client.listDesks())).toBe('network');
  });

  it('un 200 que no es JSON no deja la lista vacia y muda', async () => {
    // Es el sintoma exacto de una ruta sin bloque propio en el proxy: devuelve
    // el index.html del SPA con un 200. Tragarlo pintaria una oficina sin
    // escritorios y sin explicacion.
    const client = clientWith(
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      })) as unknown as typeof fetch,
    );

    expect(await codeOf(client.listDesks())).toBe('unknown');
  });

  it('una lista con una fila ilegible se rechaza entera', async () => {
    // Media verdad sobre donde hay sitio es peor que ninguna: quedarse con las
    // filas buenas ofreceria mover un escritorio a unas coordenadas que ya
    // ocupa otro que nunca llego a pintarse, y el 409 seria inexplicable.
    const client = clientWith(fetchWith(200, { desks: [SERVED_DESK, { id: 'desk-2' }] }));

    expect(await codeOf(client.listDesks())).toBe('unknown');
  });
});
