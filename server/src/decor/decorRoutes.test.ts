/**
 * Las rutas del catalogo de decoracion (#7, slice 4), probadas como funciones
 * puras y sin montar Express, igual que `spacesRoutes.test.ts`.
 *
 * Hay dos propiedades que este fichero existe para fijar, y ninguna de las dos
 * es una comprobacion de forma:
 *
 *   1. **El escritorio es SOLO el propio.** El `userId` sale del token
 *      verificado y NUNCA del cuerpo. Sin el test de abajo, "cada quien edita
 *      su escritorio" seria una costumbre del cliente, y bastaria un curl con
 *      un `userId` ajeno para redecorarle el sitio a otra persona.
 *   2. **El ORDEN de las guardas.** Mismo argumento que en
 *      `adminRoutes.test.ts`: un 400 antes que el 401 le contaria a quien
 *      sondea que su cuerpo iba bien.
 */

import { describe, expect, it } from 'vitest';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import type { Asset, DecorCatalog } from './decorPort.ts';
import { createMemoryDecor } from './memoryDecor.ts';
import {
  handleArchiveAsset,
  handleCreateAsset,
  handleGetDeskConfig,
  handleListAssets,
  handleReplaceDeskConfig,
  type DecorDeps,
} from './decorRoutes.ts';

const NOW = new Date('2026-01-15T12:00:00.000Z');

function user(overrides: Partial<DirectoryUser> & Pick<DirectoryUser, 'id' | 'uid'>): DirectoryUser {
  return {
    email: `${overrides.id}@example.com`,
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
    ...overrides,
  };
}

const ADMIN = user({ id: 'id-admin', uid: 'uid-admin', role: 'admin' });
const EMPLEADO = user({ id: 'id-empleado', uid: 'uid-empleado', role: 'employee' });
const OTRA = user({ id: 'id-otra', uid: 'uid-otra', role: 'employee' });
const CADUCADO = user({
  id: 'id-caducado',
  uid: 'uid-caducado',
  role: 'guest',
  expiresAt: new Date('2026-01-01T00:00:00.000Z'),
});

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valido-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: `${uid}@example.com`, name: null };
  },
};

const BEARER_ADMIN = 'Bearer valido-uid-admin';
const BEARER_EMPLEADO = 'Bearer valido-uid-empleado';
const BEARER_CADUCADO = 'Bearer valido-uid-caducado';

function seedAsset(overrides: Partial<Asset> & Pick<Asset, 'id'>): Asset {
  return {
    slug: overrides.id,
    name: overrides.id,
    kind: 'decor',
    textureKey: `${overrides.id}-tex`,
    w: 1,
    h: 1,
    placeableOnDesk: true,
    archivedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

const PLANTA = seedAsset({ id: 'asset-planta', slug: 'planta', name: 'Planta', kind: 'plant' });
const SOFA = seedAsset({ id: 'asset-sofa', slug: 'sofa', name: 'Sofa', placeableOnDesk: false });

interface Harness {
  deps: DecorDeps;
  decor: DecorCatalog;
}

function harness(seed: readonly Asset[] = [PLANTA, SOFA]): Harness {
  const decor = createMemoryDecor({ seed, now: () => NOW });
  return {
    decor,
    deps: {
      directory: createMemoryDirectory({
        now: () => NOW,
        seed: [ADMIN, EMPLEADO, OTRA, CADUCADO],
      }),
      decor,
      auth: verifier,
      now: () => NOW,
      log: () => {},
    },
  };
}

function assetBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Planta Grande',
    kind: 'plant',
    textureKey: 'plant-large',
    w: 1,
    h: 1,
    placeableOnDesk: true,
    ...overrides,
  };
}

describe('handleListAssets', () => {
  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleListAssets(undefined, deps)).status).toBe(401);
  });

  it('un empleado con token valido responde 403', async () => {
    const { deps } = harness();

    expect((await handleListAssets(BEARER_EMPLEADO, deps)).status).toBe(403);
  });

  it('un admin recibe 200 con el catalogo', async () => {
    const { deps } = harness();

    const result = await handleListAssets(BEARER_ADMIN, deps);

    expect(result.status).toBe(200);
    expect((result.body.assets as unknown[]).length).toBe(2);
  });

  it('filtra los archivados (D1b)', async () => {
    const { deps, decor } = harness();
    await decor.archiveAsset(PLANTA.id);

    const result = await handleListAssets(BEARER_ADMIN, deps);

    expect((result.body.assets as { id: string }[]).map((a) => a.id)).toEqual([SOFA.id]);
  });

  it('publica los campos del catalogo con las fechas en ISO', async () => {
    const { deps } = harness([PLANTA]);

    const result = await handleListAssets(BEARER_ADMIN, deps);

    expect((result.body.assets as Record<string, unknown>[])[0]).toEqual({
      id: PLANTA.id,
      slug: 'planta',
      name: 'Planta',
      kind: 'plant',
      textureKey: PLANTA.textureKey,
      w: 1,
      h: 1,
      placeableOnDesk: true,
      archivedAt: null,
    });
  });
});

describe('handleCreateAsset', () => {
  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleCreateAsset(undefined, assetBody(), deps)).status).toBe(401);
  });

  it('un empleado responde 403', async () => {
    const { deps } = harness();

    expect((await handleCreateAsset(BEARER_EMPLEADO, assetBody(), deps)).status).toBe(403);
  });

  it('el 401 va ANTES que la validacion del cuerpo', async () => {
    const { deps } = harness();

    expect((await handleCreateAsset(undefined, assetBody({ kind: 'rug' }), deps)).status).toBe(401);
  });

  it('el 403 va ANTES que la validacion del cuerpo', async () => {
    const { deps } = harness();

    expect((await handleCreateAsset(BEARER_EMPLEADO, assetBody({ w: 0 }), deps)).status).toBe(403);
  });

  it('un admin crea el asset y recibe 201 con el slug derivado', async () => {
    const { deps } = harness();

    const result = await handleCreateAsset(BEARER_ADMIN, assetBody(), deps);

    expect(result.status).toBe(201);
    expect(result.body.slug).toBe('planta-grande');
  });

  it('un cuerpo que no es un objeto responde 400', async () => {
    const { deps } = harness();

    expect((await handleCreateAsset(BEARER_ADMIN, 'no soy un objeto', deps)).status).toBe(400);
  });

  it('un tipo invalido responde 400 y no crea nada', async () => {
    const { deps, decor } = harness([]);

    const result = await handleCreateAsset(BEARER_ADMIN, assetBody({ kind: 'rug' }), deps);

    expect(result.status).toBe(400);
    expect(await decor.listAssets()).toEqual([]);
  });

  it('un tamano invalido responde 400', async () => {
    const { deps } = harness();

    expect((await handleCreateAsset(BEARER_ADMIN, assetBody({ w: 0 }), deps)).status).toBe(400);
  });

  it('una clave de textura vacia responde 400', async () => {
    const { deps } = harness();

    expect((await handleCreateAsset(BEARER_ADMIN, assetBody({ textureKey: '' }), deps)).status).toBe(
      400,
    );
  });

  it('ignora un id, un slug y un archivedAt puestos a mano en el cuerpo', async () => {
    // El slug se DERIVA del nombre y el archivado es una decision del
    // servidor: dejar que el cuerpo los fije seria dejar que quien llama
    // eligiese la identidad de la fila y su estado de retirada.
    const { deps } = harness();

    const result = await handleCreateAsset(
      BEARER_ADMIN,
      assetBody({ id: 'id-a-mano', slug: 'slug-a-mano', archivedAt: NOW.toISOString() }),
      deps,
    );

    expect(result.body.id).not.toBe('id-a-mano');
    expect(result.body.slug).toBe('planta-grande');
    expect(result.body.archivedAt).toBeNull();
  });

  it('un nombre repetido que solo difiere en mayusculas responde 409 y no 500', async () => {
    // `assets_slug_unique` esta sobre `lower(slug)` y el slug se DERIVA del
    // nombre: dar de alta una pieza que ya existe es una equivocacion corriente
    // del administrador, no una averia del servidor.
    const { deps } = harness();

    const result = await handleCreateAsset(BEARER_ADMIN, assetBody({ name: 'PLANTA' }), deps);

    expect(result).toEqual({ status: 409, body: { error: 'asset-name-taken' } });
  });

  it('el 409 de nombre repetido NO recicla el cuerpo de los otros 409 del servidor', async () => {
    // El codigo del cuerpo es lo unico que le dice al panel que arreglar, y ya
    // hay tres 409 distintos (`space-overlap`, `desk-overlap`, `desk-taken`).
    // Reciclar uno haria que el panel ofreciese la correccion equivocada.
    const { deps } = harness();

    const result = await handleCreateAsset(BEARER_ADMIN, assetBody({ name: 'Planta' }), deps);

    expect(result.body).not.toEqual({ error: 'space-overlap' });
    expect(result.body).not.toEqual({ error: 'desk-taken' });
    expect(result.body).toEqual({ error: 'asset-name-taken' });
  });

  it('un error desconocido del almacen se relanza para que el cableado conteste 500', async () => {
    // Tragarselo como 400 le diria al administrador que se equivoco el,
    // cuando el que se rompio fue el servidor.
    const { deps } = harness();
    const roto: DecorDeps = {
      ...deps,
      decor: {
        ...deps.decor,
        async createAsset() {
          throw new Error('connection terminated');
        },
      },
    };

    await expect(handleCreateAsset(BEARER_ADMIN, assetBody(), roto)).rejects.toThrow(
      'connection terminated',
    );
  });
});

describe('handleArchiveAsset', () => {
  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleArchiveAsset(undefined, PLANTA.id, deps)).status).toBe(401);
  });

  it('un empleado responde 403', async () => {
    const { deps } = harness();

    expect((await handleArchiveAsset(BEARER_EMPLEADO, PLANTA.id, deps)).status).toBe(403);
  });

  it('el 403 va ANTES que la busqueda del id: un empleado no aprende que assets existen', async () => {
    const { deps } = harness();

    expect((await handleArchiveAsset(BEARER_EMPLEADO, 'no-existe', deps)).status).toBe(403);
  });

  it('un admin archiva y recibe 200 con archivedAt puesto', async () => {
    const { deps } = harness();

    const result = await handleArchiveAsset(BEARER_ADMIN, PLANTA.id, deps);

    expect(result.status).toBe(200);
    expect(result.body.archivedAt).toBe(NOW.toISOString());
  });

  it('un id que no existe responde 404', async () => {
    const { deps } = harness();

    expect((await handleArchiveAsset(BEARER_ADMIN, 'no-existe', deps)).status).toBe(404);
  });

  it('un id que no es una cadena responde 400', async () => {
    const { deps } = harness();

    expect((await handleArchiveAsset(BEARER_ADMIN, 7, deps)).status).toBe(400);
  });

  it('archivar no borra la pieza del escritorio de quien ya la tenia (D1b)', async () => {
    const { deps, decor } = harness();
    await decor.replaceDeskConfig(EMPLEADO.id, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);

    await handleArchiveAsset(BEARER_ADMIN, PLANTA.id, deps);

    const desk = await handleGetDeskConfig(BEARER_EMPLEADO, deps);
    expect((desk.body.items as unknown[]).length).toBe(1);
  });
});

describe('handleGetDeskConfig', () => {
  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleGetDeskConfig(undefined, deps)).status).toBe(401);
  });

  it('NO exige rol de administracion: un empleado lee su escritorio', async () => {
    // Es lo contrario que las tres rutas de `/admin/assets`: el catalogo lo
    // cura un administrador, pero el escritorio es de quien lo usa.
    const { deps } = harness();

    expect((await handleGetDeskConfig(BEARER_EMPLEADO, deps)).status).toBe(200);
  });

  it('una cuenta que la oficina ya no admite responde 401', async () => {
    // El paso 2 de `authorize` sigue corriendo aunque el 3 no: un invitado
    // caducado no tiene escritorio que leer.
    const { deps } = harness();

    expect((await handleGetDeskConfig(BEARER_CADUCADO, deps)).status).toBe(401);
  });

  it('devuelve el escritorio de quien llama, resuelto para pintar', async () => {
    const { deps, decor } = harness();
    await decor.replaceDeskConfig(EMPLEADO.id, [{ assetId: PLANTA.id, slot: 3, rotation: 90 }]);

    const result = await handleGetDeskConfig(BEARER_EMPLEADO, deps);

    expect(result.body.items).toEqual([
      {
        id: expect.any(String),
        assetId: PLANTA.id,
        slot: 3,
        rotation: 90,
        textureKey: PLANTA.textureKey,
        w: 1,
        h: 1,
        name: 'Planta',
      },
    ]);
  });

  it('el escritorio de otra persona no se ve nunca', async () => {
    const { deps, decor } = harness();
    await decor.replaceDeskConfig(OTRA.id, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);

    const result = await handleGetDeskConfig(BEARER_EMPLEADO, deps);

    expect(result.body.items).toEqual([]);
  });
});

describe('handleReplaceDeskConfig', () => {
  const items = [{ assetId: PLANTA.id, slot: 0, rotation: 90 }];

  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleReplaceDeskConfig(undefined, { items }, deps)).status).toBe(401);
  });

  it('NO exige rol de administracion: un empleado monta su escritorio', async () => {
    const { deps } = harness();

    expect((await handleReplaceDeskConfig(BEARER_EMPLEADO, { items }, deps)).status).toBe(200);
  });

  it('una cuenta que la oficina ya no admite responde 401', async () => {
    const { deps } = harness();

    expect((await handleReplaceDeskConfig(BEARER_CADUCADO, { items }, deps)).status).toBe(401);
  });

  it('el 401 va ANTES que la validacion del cuerpo', async () => {
    const { deps } = harness();

    const result = await handleReplaceDeskConfig(
      undefined,
      { items: [{ assetId: PLANTA.id, slot: 99, rotation: 0 }] },
      deps,
    );

    expect(result.status).toBe(401);
  });

  it('un userId ajeno en el cuerpo NO escribe el escritorio de esa persona', async () => {
    // ESTA es la propiedad de la slice. El escritorio propio no puede ser una
    // costumbre del cliente: si el cuerpo pudiera elegir a quien pertenece la
    // escritura, cualquiera con un token valido redecoraria el sitio de quien
    // quisiera con un curl, sin pasar por ninguna pantalla.
    const { deps, decor } = harness();

    const result = await handleReplaceDeskConfig(
      BEARER_EMPLEADO,
      { userId: OTRA.id, items },
      deps,
    );

    expect(result.status).toBe(200);
    expect(await decor.getDeskConfig(OTRA.id)).toEqual([]);
    expect(await decor.getDeskConfig(EMPLEADO.id)).toHaveLength(1);
  });

  it('el escritorio escrito es el del token aunque el cuerpo diga otra cosa', async () => {
    const { deps } = harness();

    await handleReplaceDeskConfig(BEARER_EMPLEADO, { userId: OTRA.id, items }, deps);

    const propio = await handleGetDeskConfig(BEARER_EMPLEADO, deps);
    const ajeno = await handleGetDeskConfig('Bearer valido-uid-otra', deps);
    expect((propio.body.items as unknown[]).length).toBe(1);
    expect(ajeno.body.items).toEqual([]);
  });

  it('guarda los items y los devuelve ya resueltos', async () => {
    const { deps } = harness();

    const result = await handleReplaceDeskConfig(BEARER_EMPLEADO, { items }, deps);

    expect(result.status).toBe(200);
    expect((result.body.items as { textureKey: string }[])[0].textureKey).toBe(PLANTA.textureKey);
  });

  it('una lista vacia deja el escritorio pelado', async () => {
    const { deps } = harness();
    await handleReplaceDeskConfig(BEARER_EMPLEADO, { items }, deps);

    const result = await handleReplaceDeskConfig(BEARER_EMPLEADO, { items: [] }, deps);

    expect(result.body.items).toEqual([]);
  });

  it('un cuerpo que no es un objeto responde 400', async () => {
    const { deps } = harness();

    expect((await handleReplaceDeskConfig(BEARER_EMPLEADO, 'nope', deps)).status).toBe(400);
  });

  it('items que no es un array responde 400', async () => {
    const { deps } = harness();

    expect((await handleReplaceDeskConfig(BEARER_EMPLEADO, { items: 'nope' }, deps)).status).toBe(
      400,
    );
  });

  it('un slot fuera de rango responde 400', async () => {
    const { deps } = harness();

    const result = await handleReplaceDeskConfig(
      BEARER_EMPLEADO,
      { items: [{ assetId: PLANTA.id, slot: 9, rotation: 0 }] },
      deps,
    );

    expect(result.status).toBe(400);
  });

  it('dos items en el mismo slot responden 400', async () => {
    const { deps } = harness();

    const result = await handleReplaceDeskConfig(
      BEARER_EMPLEADO,
      {
        items: [
          { assetId: PLANTA.id, slot: 1, rotation: 0 },
          { assetId: PLANTA.id, slot: 1, rotation: 90 },
        ],
      },
      deps,
    );

    expect(result.status).toBe(400);
  });

  it('una rotacion que la base de datos no admite responde 400', async () => {
    const { deps } = harness();

    const result = await handleReplaceDeskConfig(
      BEARER_EMPLEADO,
      { items: [{ assetId: PLANTA.id, slot: 0, rotation: 45 }] },
      deps,
    );

    expect(result.status).toBe(400);
  });

  it('un asset que no es colocable en un escritorio responde 400', async () => {
    const { deps } = harness();

    const result = await handleReplaceDeskConfig(
      BEARER_EMPLEADO,
      { items: [{ assetId: SOFA.id, slot: 0, rotation: 0 }] },
      deps,
    );

    expect(result.status).toBe(400);
  });

  it('un assetId que no existe responde 400', async () => {
    const { deps } = harness();

    const result = await handleReplaceDeskConfig(
      BEARER_EMPLEADO,
      { items: [{ assetId: 'no-existe', slot: 0, rotation: 0 }] },
      deps,
    );

    expect(result.status).toBe(400);
  });

  it('un rechazo no deja el escritorio a medias', async () => {
    const { deps } = harness();
    await handleReplaceDeskConfig(BEARER_EMPLEADO, { items }, deps);

    await handleReplaceDeskConfig(
      BEARER_EMPLEADO,
      { items: [{ assetId: SOFA.id, slot: 2, rotation: 0 }] },
      deps,
    );

    const result = await handleGetDeskConfig(BEARER_EMPLEADO, deps);
    expect((result.body.items as { slot: number }[]).map((item) => item.slot)).toEqual([0]);
  });

  /**
   * D1b sobre HTTP. El puerto ya distingue conservar de re-anadir; lo que
   * falta por comprobar es que la ruta traduce ese rechazo a 400 y no lo deja
   * escapar como 500 -- es un cuerpo que el cliente puede corregir, no una
   * averia del servidor.
   */
  it('conservar una pieza retirada que ya estaba puesta responde 200', async () => {
    const { deps, decor } = harness();
    await handleReplaceDeskConfig(BEARER_EMPLEADO, { items }, deps);
    await decor.archiveAsset(PLANTA.id);

    const result = await handleReplaceDeskConfig(BEARER_EMPLEADO, { items }, deps);

    expect(result.status).toBe(200);
    expect((result.body.items as unknown[]).length).toBe(1);
  });

  it('anadir una pieza retirada que no estaba puesta responde 400, no 500', async () => {
    const { deps, decor } = harness();
    await decor.archiveAsset(PLANTA.id);

    const result = await handleReplaceDeskConfig(BEARER_EMPLEADO, { items }, deps);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'invalid-request' });
  });

  it('mover de slot una pieza retirada retenida responde 200', async () => {
    const { deps, decor } = harness();
    await handleReplaceDeskConfig(BEARER_EMPLEADO, { items }, deps);
    await decor.archiveAsset(PLANTA.id);

    const result = await handleReplaceDeskConfig(
      BEARER_EMPLEADO,
      { items: [{ assetId: PLANTA.id, slot: 4, rotation: 180 }] },
      deps,
    );

    expect(result.status).toBe(200);
    expect((result.body.items as { slot: number }[])[0].slot).toBe(4);
  });

  it('el escritorio de otra persona no sirve para retener una pieza retirada', async () => {
    // La retencion la gana el escritorio propio: si valiese el de cualquiera,
    // bastaria con que una sola persona tuviese la pieza para que el catalogo
    // retirado siguiese repartiendose.
    const { deps, decor } = harness();
    await decor.replaceDeskConfig(OTRA.id, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);
    await decor.archiveAsset(PLANTA.id);

    const result = await handleReplaceDeskConfig(BEARER_EMPLEADO, { items }, deps);

    expect(result.status).toBe(400);
  });

  it('un error desconocido del almacen se relanza para que el cableado conteste 500', async () => {
    const { deps } = harness();
    const roto: DecorDeps = {
      ...deps,
      decor: {
        ...deps.decor,
        async replaceDeskConfig() {
          throw new Error('connection terminated');
        },
      },
    };

    await expect(handleReplaceDeskConfig(BEARER_EMPLEADO, { items }, roto)).rejects.toThrow(
      'connection terminated',
    );
  });
});
