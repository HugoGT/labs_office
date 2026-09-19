/**
 * El catalogo colocable y el escritorio PROPIO, leidos y guardados (#7, slice
 * 6). Puro y con `fetch` inyectado, mismo espiritu que `desksClient.test.ts`:
 * sin Vite, sin red y sin servidor.
 *
 * Dos propiedades sostienen este fichero, y ninguna es una comprobacion de
 * forma:
 *
 *   1. **Una lectura fallida NO es un escritorio vacio.** `POST /me/desk`
 *      reemplaza el escritorio entero, asi que confundir "no pude leer" con
 *      "no tienes nada" y luego guardar le borraria a alguien su decoracion
 *      sin que hubiese pedido nada de eso. Por eso la lectura del escritorio
 *      contesta `null` y no una lista vacia.
 *   2. **El selector no ofrece lo que el servidor rechaza.** Una pieza que no
 *      admite escritorio es un 400 garantizado; ofrecerla seria ofrecer un
 *      error.
 */

import { describe, expect, it, vi } from 'vitest';
import { fetchDeskCatalog, fetchMyDeskItems, saveMyDesk } from './deskDecorClient';
import { NO_DESK_ASSETS } from './deskDecorPort';

const TOKEN = async () => 'id-token';

/** Una fila tal cual la sirve `GET /assets`. */
function servedAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'id-planta',
    slug: 'planta',
    name: 'Planta',
    kind: 'plant',
    textureKey: 'plant-small',
    w: 1,
    h: 1,
    placeableOnDesk: true,
    archivedAt: null,
    ...overrides,
  };
}

/** Una fila tal cual la sirve `GET /me/desk`. */
function servedItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'id-item',
    assetId: 'id-planta',
    slot: 4,
    rotation: 90,
    textureKey: 'plant-small',
    w: 1,
    h: 1,
    name: 'Planta',
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

describe('fetchDeskCatalog', () => {
  it('pide /assets con la credencial de quien mira', async () => {
    // `/assets` y no `/admin/assets`: quien decora su escritorio no administra
    // nada, y la ruta de administracion le responderia 403.
    const fetchImpl = vi.fn(respondWith({ assets: [] }));

    await fetchDeskCatalog({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://x/assets',
      expect.objectContaining({ headers: { Authorization: 'Bearer id-token' } }),
    );
  });

  it('convierte las filas servidas en piezas del selector', async () => {
    const fetchImpl = respondWith({ assets: [servedAsset()] });

    const catalog = await fetchDeskCatalog({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl });

    expect(catalog).toEqual([
      { id: 'id-planta', name: 'Planta', kind: 'plant', textureKey: 'plant-small' },
    ]);
  });

  it('deja fuera lo que no admite escritorio', async () => {
    // El servidor lo rechaza con un 400 (`assertPlaceableOnDesk`). Ofrecerlo
    // en el selector seria ofrecer un error.
    const fetchImpl = respondWith({
      assets: [servedAsset(), servedAsset({ id: 'id-sofa', placeableOnDesk: false })],
    });

    const catalog = await fetchDeskCatalog({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl });

    expect(catalog.map((asset) => asset.id)).toEqual(['id-planta']);
  });

  it('una fila mal formada tumba la respuesta entera', async () => {
    // Mismo criterio que `parseOfficeDesks`: media lista es media verdad sobre
    // que se puede colocar, y una pieza que falta se lee igual que una que
    // nunca existio.
    const fetchImpl = respondWith({ assets: [servedAsset(), { id: 'id-roto' }] });

    expect(await fetchDeskCatalog({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl })).toBe(
      NO_DESK_ASSETS,
    );
  });

  it('un 503 sin almacen deja el catalogo vacio y no lanza', async () => {
    // Un despliegue sin `DATABASE_URL` no es una averia que gritar: la oficina
    // sigue igual, simplemente sin nada que colocar.
    const fetchImpl = respondWith({ error: 'decor-not-configured' }, 503);

    expect(await fetchDeskCatalog({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl })).toBe(
      NO_DESK_ASSETS,
    );
  });

  it('la red caida deja el catalogo vacio y no lanza', async () => {
    expect(
      await fetchDeskCatalog({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl: REJECTS }),
    ).toBe(NO_DESK_ASSETS);
  });

  it('sin token no se pide nada', async () => {
    const fetchImpl = vi.fn(respondWith({ assets: [servedAsset()] }));

    const catalog = await fetchDeskCatalog({
      baseUrl: 'http://x',
      getIdToken: async () => null,
      fetchImpl,
    });

    expect(catalog).toBe(NO_DESK_ASSETS);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('fetchMyDeskItems', () => {
  it('pide /me/desk con la credencial de quien mira', async () => {
    // Sin id en la ruta: el servidor sirve el escritorio de la identidad
    // verificada de quien llama, y un id ajeno bastaria para leer el de otra
    // persona.
    const fetchImpl = vi.fn(respondWith({ items: [] }));

    await fetchMyDeskItems({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://x/me/desk',
      expect.objectContaining({ headers: { Authorization: 'Bearer id-token' } }),
    );
  });

  it('convierte las filas servidas en piezas colocadas', async () => {
    const fetchImpl = respondWith({ items: [servedItem()] });

    const items = await fetchMyDeskItems({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl });

    expect(items).toEqual([
      {
        id: 'id-item',
        assetId: 'id-planta',
        slot: 4,
        rotation: 90,
        textureKey: 'plant-small',
        name: 'Planta',
      },
    ]);
  });

  it('conserva una pieza que ya no esta en el catalogo (D1b)', async () => {
    // Una pieza retirada sigue puesta y se puede quitar: el servidor la sirve
    // con su `textureKey` resuelto aunque el selector ya no la ofrezca. Si
    // esta lectura la descartase por no encontrarla en el catalogo, guardar
    // cualquier otro cambio se la borraria a quien la tenia.
    const fetchImpl = respondWith({ items: [servedItem({ assetId: 'id-retirada' })] });

    const items = await fetchMyDeskItems({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl });

    expect(items?.map((item) => item.assetId)).toEqual(['id-retirada']);
  });

  it('un escritorio pelado es una lista vacia, no un fallo', async () => {
    const fetchImpl = respondWith({ items: [] });

    expect(await fetchMyDeskItems({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl })).toEqual(
      [],
    );
  });

  it('una lectura que no llego es null y NUNCA una lista vacia', async () => {
    // LA propiedad de esta funcion. `POST /me/desk` reemplaza el escritorio
    // entero: tomar un 503 o una red caida por "no tienes nada" y guardar
    // despues le borraria la decoracion a quien si la tenia.
    const sinAlmacen = respondWith({ error: 'decor-not-configured' }, 503);

    expect(await fetchMyDeskItems({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl: REJECTS })).toBe(
      null,
    );
    expect(
      await fetchMyDeskItems({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl: sinAlmacen }),
    ).toBe(null);
  });

  it('una fila mal formada tumba la respuesta entera', async () => {
    const fetchImpl = respondWith({ items: [servedItem(), { id: 'id-roto' }] });

    expect(await fetchMyDeskItems({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl })).toBe(null);
  });

  it('un slot fuera de las nueve cajas tumba la respuesta entera', async () => {
    // No cabe en el escritorio: pintarlo lo dejaria flotando fuera de su sitio
    // y guardarlo seria un 400.
    const fetchImpl = respondWith({ items: [servedItem({ slot: 9 })] });

    expect(await fetchMyDeskItems({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl })).toBe(null);
  });

  it('una rotacion que el servidor no acepta tumba la respuesta entera', async () => {
    const fetchImpl = respondWith({ items: [servedItem({ rotation: 45 })] });

    expect(await fetchMyDeskItems({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl })).toBe(null);
  });
});

describe('saveMyDesk', () => {
  it('manda el escritorio entero a /me/desk, sin userId', async () => {
    // El ocupante es la identidad verificada de quien llama. Un `userId` en el
    // cuerpo no se lee siquiera, y mandarlo sugeriria que si.
    const fetchImpl = vi.fn(respondWith({ items: [] }));
    const items = [{ assetId: 'id-planta', slot: 4, rotation: 90 } as const];

    await saveMyDesk({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl, items });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://x/me/desk',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ items }) }),
    );
  });

  it('un 200 es guardado', async () => {
    const fetchImpl = respondWith({ items: [] });

    expect(
      await saveMyDesk({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl, items: [] }),
    ).toBe('saved');
  });

  it('un 400 se cuenta como rechazado y no como averia', async () => {
    // Es el unico final que quien guarda puede arreglar: una pieza retirada
    // que se intento anadir, un slot repetido. Contarlo como averia le diria
    // que vuelva a intentarlo cuando lo que hay que hacer es cambiar algo.
    const fetchImpl = respondWith({ error: 'invalid-request' }, 400);

    expect(
      await saveMyDesk({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl, items: [] }),
    ).toBe('rejected');
  });

  it('un 503 o la red caida es un fallo, y nunca un guardado', async () => {
    // Decir "guardado" cuando no se guardo dejaria la pantalla contando una
    // decoracion que el servidor no tiene.
    const sinAlmacen = respondWith({ error: 'decor-not-configured' }, 503);

    expect(
      await saveMyDesk({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl: sinAlmacen, items: [] }),
    ).toBe('failed');
    expect(
      await saveMyDesk({ baseUrl: 'http://x', getIdToken: TOKEN, fetchImpl: REJECTS, items: [] }),
    ).toBe('failed');
  });

  it('sin token no se manda nada', async () => {
    const fetchImpl = vi.fn(respondWith({ items: [] }));

    const outcome = await saveMyDesk({
      baseUrl: 'http://x',
      getIdToken: async () => null,
      fetchImpl,
      items: [],
    });

    expect(outcome).toBe('failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
