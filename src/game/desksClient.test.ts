/**
 * La lectura de los escritorios asignables servidos por `GET /desks` y las dos
 * escrituras que los reparten (#7, slice 5). Puro y con `fetch` inyectado, en
 * el mismo espiritu que `spacesConfig.test.ts`: sin Vite, sin red y sin
 * servidor.
 *
 * Lo que de verdad se afirma aqui es la DEGRADACION. Un despliegue sin
 * directorio responde `503 desks-not-configured` a todas estas rutas, y la
 * unica salida util entonces es la oficina de siempre: sin escritorios
 * asignables y sin nada que pedirle al servidor.
 */

import { describe, expect, it, vi } from 'vitest';
import { claimDesk, deriveDesksBaseUrl, fetchOfficeDesks, releaseDesk } from './desksClient';
import { NO_DESKS } from './desksPort';
import { TILE } from './mapData';

const TOKEN = async () => 'id-token';

/** Una fila tal cual la sirve `GET /desks`: en TILES, con el ocupante resuelto. */
function servedDesk(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'id-mesa',
    label: 'Mesa 4',
    x: 10,
    y: 12,
    w: 3,
    h: 3,
    occupant: null,
    mine: false,
    ...overrides,
  };
}

function servedOccupant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'id-persona',
    displayName: 'Ana Torres',
    items: [
      {
        id: 'id-item',
        assetId: 'id-asset',
        slot: 4,
        rotation: 90,
        textureKey: 'plant-small',
        name: 'Planta',
        w: 1,
        h: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function respondWith(body: unknown, status = 200): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return body;
      },
    }) as unknown as Response) as unknown as typeof fetch;
}

const REJECTS = (async () => {
  throw new Error('red caida');
}) as unknown as typeof fetch;

describe('deriveDesksBaseUrl', () => {
  it('cambia el esquema del endpoint de Colyseus y se queda en la raiz', () => {
    // Las rutas de escritorio cuelgan de la raiz (`/desks`, `/me/desk/release`)
    // y no de un prefijo propio, asi que la base es la raiz.
    expect(deriveDesksBaseUrl('ws://localhost:2567')).toBe('http://localhost:2567');
    expect(deriveDesksBaseUrl('wss://oficina.example.com')).toBe('https://oficina.example.com');
  });
});

describe('fetchOfficeDesks', () => {
  it('pide /desks con la credencial de quien mira', async () => {
    // `GET /desks` exige token, a diferencia de `GET /spaces`: quien se sienta
    // donde es informacion del directorio sobre personas reales.
    const fetchImpl = vi.fn(respondWith({ desks: [] }));

    await fetchOfficeDesks({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://x/desks',
      expect.objectContaining({ headers: { Authorization: 'Bearer id-token' } }),
    );
  });

  it('convierte de tiles a pixeles: el servidor guarda tiles y la escena usa pixeles', async () => {
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ desks: [servedDesk()] }),
    });

    expect(desks[0]).toMatchObject({
      id: 'id-mesa',
      label: 'Mesa 4',
      x: 10 * TILE,
      y: 12 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
    });
  });

  it('resuelve al ocupante con su decoracion, que le sigue de escritorio en escritorio', async () => {
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ desks: [servedDesk({ occupant: servedOccupant() })] }),
    });

    expect(desks[0].occupant).toEqual({
      id: 'id-persona',
      displayName: 'Ana Torres',
      items: [
        { id: 'id-item', slot: 4, rotation: 90, textureKey: 'plant-small', aboveAvatars: false },
      ],
    });
  });

  it('carries the render layer of each piece (#71)', async () => {
    const [item] = servedOccupant().items as Record<string, unknown>[];
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({
        desks: [servedDesk({ occupant: servedOccupant({ items: [{ ...item, aboveAvatars: true }] }) })],
      }),
    });

    expect(desks[0].occupant?.items[0].aboveAvatars).toBe(true);
  });

  it('a missing or malformed aboveAvatars is a normal piece, not a broken list (#71)', async () => {
    // Older servers do not send the field. It only picks a render layer, so
    // anything but `true` degrades to the safe default instead of blanking the
    // office like a malformed slot does.
    const [item] = servedOccupant().items as Record<string, unknown>[];
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({
        desks: [
          servedDesk({ occupant: servedOccupant({ items: [{ ...item, aboveAvatars: 'si' }] }) }),
        ],
      }),
    });

    expect(desks[0].occupant?.items[0].aboveAvatars).toBe(false);
  });

  it('un escritorio libre llega con ocupante nulo, no ausente', async () => {
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ desks: [servedDesk()] }),
    });

    expect(desks[0].occupant).toBeNull();
  });

  it('copia el `mine` que calculo el servidor en vez de deducirlo', async () => {
    // Cual es el propio lo contesta quien sabe quien pregunta. Aqui no hay
    // nada que deducir: `occupantId` no viaja, y el unico cruce que quedaria
    // seria el nombre visible -- que es justo lo que la slice 1 de esta issue
    // retiro de `proximityAudio.ts`, donde un renombrado cambiaba en silencio
    // quien oye a quien.
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({
        desks: [servedDesk({ occupant: servedOccupant(), mine: true })],
      }),
    });

    expect(desks[0].mine).toBe(true);
  });

  it('una fila sin `mine` descarta la lista entera', async () => {
    // Darlo por `false` dejaria a quien mira sin su propio escritorio y sin
    // saber por que, que es la degradacion silenciosa que este campo existe
    // para quitar de en medio.
    const sinMine = servedDesk();
    delete sinMine.mine;

    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ desks: [sinMine] }),
    });

    expect(desks).toBe(NO_DESKS);
  });

  it('una lista vacia servida es una respuesta valida, no un fallo', async () => {
    // Una oficina que todavia no ha colocado ningun escritorio es un estado
    // legitimo: nadie los siembra.
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ desks: [] }),
    });

    expect(desks).toEqual([]);
  });

  it('un 503 deja la oficina sin escritorios asignables', async () => {
    // Es el despliegue sin directorio configurado: la oficina sigue siendo la
    // de siempre y no ofrece donde sentarse, que es exactamente lo que hay.
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ error: 'desks-not-configured' }, 503),
    });

    expect(desks).toBe(NO_DESKS);
  });

  it('un fetch que rechaza no propaga: la oficina tiene que arrancar igual', async () => {
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: REJECTS,
    });

    expect(desks).toBe(NO_DESKS);
  });

  it('sin token no se llega a pedir nada', async () => {
    // Sin credencial el servidor solo puede contestar 401: la peticion no
    // aporta nada que no sepamos ya.
    const fetchImpl = vi.fn(respondWith({ desks: [servedDesk()] }));

    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: async () => null,
      fetchImpl,
    });

    expect(desks).toBe(NO_DESKS);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('UNA sola fila mal formada descarta la lista ENTERA', async () => {
    // Un directorio que solo se puede leer a medias es media verdad sobre
    // quien se sienta donde: pintar el resto mostraria sitio libre justo
    // encima de un escritorio que el servidor si tiene, y ese escritorio no
    // seria clicable porque su id nunca llego. La degradacion segura ya
    // existe y es una sola -- no dibujar ninguno.
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({
        desks: [servedDesk(), servedDesk({ id: 'id-malo', x: 'no soy un numero' })],
      }),
    });

    expect(desks).toBe(NO_DESKS);
  });

  it('una fila sin id descarta la lista: el id es con lo que se pide el sitio', async () => {
    const sinId = servedDesk();
    delete sinId.id;

    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ desks: [sinId] }),
    });

    expect(desks).toBe(NO_DESKS);
  });

  it('un ocupante mal formado descarta la lista entera', async () => {
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({
        desks: [servedDesk({ occupant: servedOccupant({ id: 42 }) })],
      }),
    });

    expect(desks).toBe(NO_DESKS);
  });

  it('un item con slot fuera del area de 3x3 descarta la lista entera', async () => {
    // Nueve cajas, de la 0 a la 8. Un slot de 9 no cabe en el escritorio y
    // pintarlo dejaria decoracion flotando fuera de su sitio.
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({
        desks: [
          servedDesk({
            occupant: servedOccupant({
              items: [{ id: 'i', slot: 9, rotation: 0, textureKey: 'x' }],
            }),
          }),
        ],
      }),
    });

    expect(desks).toBe(NO_DESKS);
  });

  it('un cuerpo que no es la forma esperada deja la oficina sin escritorios', async () => {
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ cualquier: 'cosa' }),
    });

    expect(desks).toBe(NO_DESKS);
  });

  it('un servidor que no contesta cae a sin escritorios al agotarse el plazo', async () => {
    // Sin plazo, un servidor colgado dejaria la peticion en vuelo para
    // siempre y el enganche nunca entregaria nada.
    const desks = await fetchOfficeDesks({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      timeoutMs: 5,
      fetchImpl: ((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('abortado')));
        })) as unknown as typeof fetch,
    });

    expect(desks).toBe(NO_DESKS);
  });
});

describe('claimDesk', () => {
  it('pide el sitio por su id, sin cuerpo: el ocupante es quien llama', async () => {
    // El servidor no lee cuerpo aqui a proposito. Mandarle uno seria inventar
    // una superficie que no existe.
    const fetchImpl = vi.fn(respondWith({ id: 'id-mesa' }));

    await claimDesk({ baseUrl: 'http://x', deskId: 'id mesa/rara', getIdToken: TOKEN, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://x/desks/id%20mesa%2Frara/claim',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer id-token' } }),
    );
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('un 200 es el sitio conseguido', async () => {
    const outcome = await claimDesk({
      baseUrl: 'http://x',
      deskId: 'id-mesa',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ id: 'id-mesa' }),
    });

    expect(outcome).toBe('claimed');
  });

  it('un 409 desk-taken se distingue de cualquier otro fallo', async () => {
    // Es lo que hay que poder contarle a quien mira: alguien se te adelanto, y
    // tu vista ya no vale. Tragarlo dejaria el escritorio pintado como tuyo.
    const outcome = await claimDesk({
      baseUrl: 'http://x',
      deskId: 'id-mesa',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ error: 'desk-taken' }, 409),
    });

    expect(outcome).toBe('taken');
  });

  it('un 503 sin directorio configurado es un fallo, no un sitio conseguido', async () => {
    const outcome = await claimDesk({
      baseUrl: 'http://x',
      deskId: 'id-mesa',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ error: 'desks-not-configured' }, 503),
    });

    expect(outcome).toBe('failed');
  });

  it('un fetch que rechaza es un fallo y no propaga', async () => {
    const outcome = await claimDesk({
      baseUrl: 'http://x',
      deskId: 'id-mesa',
      getIdToken: TOKEN,
      fetchImpl: REJECTS,
    });

    expect(outcome).toBe('failed');
  });

  it('sin token no se llega a pedir nada', async () => {
    const fetchImpl = vi.fn(respondWith({ id: 'id-mesa' }));

    const outcome = await claimDesk({
      baseUrl: 'http://x',
      deskId: 'id-mesa',
      getIdToken: async () => null,
      fetchImpl,
    });

    expect(outcome).toBe('failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('releaseDesk', () => {
  it('suelta el propio, sin id: un id ajeno bastaria para echar a alguien', async () => {
    const fetchImpl = vi.fn(respondWith({ released: true }));

    await releaseDesk({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://x/me/desk/release',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer id-token' } }),
    );
  });

  it('un 200 es el sitio soltado', async () => {
    const outcome = await releaseDesk({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: respondWith({ released: true }),
    });

    expect(outcome).toBe('released');
  });

  it('un fetch que rechaza es un fallo y no propaga', async () => {
    const outcome = await releaseDesk({
      baseUrl: 'http://x',
      getIdToken: TOKEN,
      fetchImpl: REJECTS,
    });

    expect(outcome).toBe('failed');
  });

  it('sin token no se llega a pedir nada', async () => {
    const fetchImpl = vi.fn(respondWith({ released: true }));

    const outcome = await releaseDesk({
      baseUrl: 'http://x',
      getIdToken: async () => null,
      fetchImpl,
    });

    expect(outcome).toBe('failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
