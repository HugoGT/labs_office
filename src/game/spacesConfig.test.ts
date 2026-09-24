/**
 * La lectura de la config de espacios servida (#7, slice 3). Puro y con
 * `fetch` inyectado, en el mismo espiritu que `livekitEndpoint.ts` y
 * `livekitTokenClient.ts`: sin Vite, sin red y sin servidor.
 *
 * Lo que de verdad se afirma aqui es el FALLBACK. Este modulo corre antes de
 * que exista la oficina, asi que no tiene a quien reportarle un error: si algo
 * va mal, la unica salida util es comportarse como se comportaba el cliente
 * antes de esta slice.
 */

import { describe, expect, it } from 'vitest';
import { BUILT_IN_SPACES, BUILT_IN_SPACES_VERSION, TILE } from './mapData';
import {
  BUILT_IN_SPACES_CONFIG,
  createStaleSpacesVersionTracker,
  deriveSpacesUrl,
  fetchSpacesConfig,
} from './spacesConfig';

/** Una fila tal cual la sirve `GET /spaces`: en TILES, sin campos de dibujo. */
function servedSpace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'id-sala',
    slug: 'sala',
    name: 'Sala',
    x: 50,
    y: 2,
    w: 13,
    h: 14,
    capacity: null,
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

describe('deriveSpacesUrl', () => {
  it('cambia el esquema del endpoint de Colyseus y cuelga /spaces', () => {
    // El mismo `http.Server` sirve WebSocket y HTTP, igual que asume
    // `livekitEndpoint.deriveTokenUrl`.
    expect(deriveSpacesUrl('ws://localhost:2567')).toBe('http://localhost:2567/spaces');
    expect(deriveSpacesUrl('wss://oficina.example.com')).toBe('https://oficina.example.com/spaces');
  });
});

describe('fetchSpacesConfig', () => {
  it('convierte de tiles a pixeles: la base de datos guarda tiles y la escena usa pixeles', async () => {
    const config = await fetchSpacesConfig({
      url: 'http://x/spaces',
      fetchImpl: respondWith({ spaces: [servedSpace()], version: 'abc123' }),
    });

    expect(config.spaces[0]).toMatchObject({
      id: 'id-sala',
      name: 'Sala',
      x: 50 * TILE,
      y: 2 * TILE,
      w: 13 * TILE,
      h: 14 * TILE,
    });
  });

  it('publica la version tal cual la manda el servidor, sin recalcularla', async () => {
    // El cliente NUNCA hashea (D4): `crypto.subtle.digest` es asincrono y
    // `proximityTick` es sincrono. La version es un valor opaco que se copia.
    const config = await fetchSpacesConfig({
      url: 'http://x/spaces',
      fetchImpl: respondWith({ spaces: [servedSpace()], version: 'version-del-servidor' }),
    });

    expect(config.version).toBe('version-del-servidor');
  });

  it('una lista vacia servida es una respuesta valida, no un fallback', async () => {
    // Un despliegue puede tener la tabla vacia legitimamente. Caer al fallback
    // aqui haria que el cliente derivase pertenencia de dos salas que el
    // servidor no tiene.
    const config = await fetchSpacesConfig({
      url: 'http://x/spaces',
      fetchImpl: respondWith({ spaces: [], version: 'vacio' }),
    });

    expect(config).toEqual({ spaces: [], version: 'vacio' });
  });

  it('un 503 cae al fallback incorporado', async () => {
    // Es el despliegue sin DATABASE_URL: `/spaces` responde 503 y todos los
    // clientes caen al mismo fallback, asi que coinciden en version y se
    // siguen oyendo entre ellos.
    const config = await fetchSpacesConfig({
      url: 'http://x/spaces',
      fetchImpl: respondWith({ error: 'spaces-not-configured' }, 503),
    });

    expect(config).toBe(BUILT_IN_SPACES_CONFIG);
  });

  it('un fetch que rechaza cae al fallback en vez de propagar', async () => {
    const config = await fetchSpacesConfig({
      url: 'http://x/spaces',
      fetchImpl: (async () => {
        throw new Error('red caida');
      }) as unknown as typeof fetch,
    });

    expect(config).toBe(BUILT_IN_SPACES_CONFIG);
  });

  it('un cuerpo que no es la forma esperada cae al fallback', async () => {
    const config = await fetchSpacesConfig({
      url: 'http://x/spaces',
      fetchImpl: respondWith({ cualquier: 'cosa' }),
    });

    expect(config).toBe(BUILT_IN_SPACES_CONFIG);
  });

  it('una version vacia cae al fallback: publicarla igualaria a clientes que no coinciden', async () => {
    const config = await fetchSpacesConfig({
      url: 'http://x/spaces',
      fetchImpl: respondWith({ spaces: [servedSpace()], version: '' }),
    });

    expect(config).toBe(BUILT_IN_SPACES_CONFIG);
  });

  it('UNA sola fila mal formada descarta la lista ENTERA', async () => {
    // Es la propiedad mas importante de este modulo. La version es un hash de
    // la lista COMPLETA del servidor. Quedarse con las filas buenas y publicar
    // aun asi esa version dejaria a este cliente afirmando una config que no
    // tiene: coincidiria en `spacesVersion` con otro que si la tiene entera, el
    // predicado mutuo de `proximityAudio.ts` los daria por acordes, y los dos
    // derivarian pertenencias distintas. Seria justo la audibilidad de un solo
    // sentido que ese predicado existe para impedir, pero enmascarada.
    const config = await fetchSpacesConfig({
      url: 'http://x/spaces',
      fetchImpl: respondWith({
        spaces: [servedSpace(), servedSpace({ id: 'id-malo', x: 'no soy un numero' })],
        version: 'abc123',
      }),
    });

    expect(config).toBe(BUILT_IN_SPACES_CONFIG);
  });

  it('una fila sin id cae al fallback: el id es la clave de pertenencia', async () => {
    const sinId = servedSpace();
    delete sinId.id;

    const config = await fetchSpacesConfig({
      url: 'http://x/spaces',
      fetchImpl: respondWith({ spaces: [sinId], version: 'abc123' }),
    });

    expect(config).toBe(BUILT_IN_SPACES_CONFIG);
  });

  it('un servidor que no contesta cae al fallback al agotarse el plazo', async () => {
    // Sin plazo, un servidor colgado dejaria la oficina sin arrancar para
    // siempre: este modulo corre ANTES de que exista la escena.
    const config = await fetchSpacesConfig({
      url: 'http://x/spaces',
      timeoutMs: 5,
      fetchImpl: ((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('abortado')));
        })) as unknown as typeof fetch,
    });

    expect(config).toBe(BUILT_IN_SPACES_CONFIG);
  });

  it('el fallback incorporado son los espacios y la version que ya usaba el cliente', () => {
    expect(BUILT_IN_SPACES_CONFIG.spaces).toBe(BUILT_IN_SPACES);
    expect(BUILT_IN_SPACES_CONFIG.version).toBe(BUILT_IN_SPACES_VERSION);
  });
});

describe('createStaleSpacesVersionTracker (#74)', () => {
  it('una version de un par distinta de la mia es obsoleta', () => {
    const isStale = createStaleSpacesVersionTracker();
    expect(isStale('version-nueva', 'version-mia')).toBe(true);
  });

  it('la misma version que la mia nunca es obsoleta', () => {
    const isStale = createStaleSpacesVersionTracker();
    expect(isStale('version-mia', 'version-mia')).toBe(false);
  });

  it('la version incorporada nunca es obsoleta: nadie tiene a quien pedirle una mejor', () => {
    const isStale = createStaleSpacesVersionTracker();
    expect(isStale(BUILT_IN_SPACES_VERSION, 'version-mia')).toBe(false);
  });

  it('una version ya vista no vuelve a marcarse obsoleta', () => {
    const isStale = createStaleSpacesVersionTracker();
    expect(isStale('version-nueva', 'version-mia')).toBe(true);
    expect(isStale('version-nueva', 'version-mia')).toBe(false);
  });

  it('un peer distinto reportando la MISMA version ya vista tampoco vuelve a marcarla', () => {
    const isStale = createStaleSpacesVersionTracker();
    expect(isStale('version-nueva', 'version-mia')).toBe(true);
    // Simula un segundo par reportando la misma version: acotado a UN refetch
    // por version distinta, no por par.
    expect(isStale('version-nueva', 'version-mia')).toBe(false);
  });

  it('versiones distintas se marcan cada una la primera vez', () => {
    const isStale = createStaleSpacesVersionTracker();
    expect(isStale('version-a', 'version-mia')).toBe(true);
    expect(isStale('version-b', 'version-mia')).toBe(true);
  });
});
