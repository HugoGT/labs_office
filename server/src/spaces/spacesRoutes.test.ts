/**
 * Las rutas de espacios (#7, slice 3), probadas como funciones puras y sin
 * montar Express, igual que `adminRoutes.test.ts` y `handleLivekitToken`.
 *
 * El ORDEN de las guardas es lo que mas importa aqui, por la misma razon que en
 * `adminRoutes.test.ts`: el panel puede esconder el formulario de espacios a
 * quien no administra, pero eso no protege nada -- cualquiera con un ID token
 * valido puede llamar a estas rutas a mano. Un 400 antes que el 401 le contaria
 * a quien sondea que su cuerpo iba bien, y un 409 antes que el 403 le confirmaria
 * donde hay un espacio.
 */

import { describe, expect, it } from 'vitest';
import { readArtPackManifest } from '../decor/artPackFile.ts';
import { createMemoryDecor } from '../decor/memoryDecor.ts';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import { createMemorySpaces } from './memorySpaces.ts';
import { SpaceOwnedByDeskError, hashSpaces } from './spaceRules.ts';
import type { Space, SpacesDirectory } from './spacesPort.ts';
import {
  handleCreateSpace,
  handleDeleteSpace,
  handleGetSpacesConfig,
  handleUpdateSpace,
  type SpacesDeps,
} from './spacesRoutes.ts';

const NOW = new Date('2026-01-15T12:00:00.000Z');

function user(overrides: Partial<DirectoryUser> & Pick<DirectoryUser, 'id' | 'uid'>): DirectoryUser {
  return {
    email: `${overrides.id}@example.com`,
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
    ...overrides,
  };
}

const ADMIN = user({ id: 'id-admin', uid: 'uid-admin', role: 'admin' });
const EMPLEADO = user({ id: 'id-empleado', uid: 'uid-empleado', role: 'employee' });

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valido-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: `${uid}@example.com`, name: null };
  },
};

const BEARER_ADMIN = 'Bearer valido-uid-admin';
const BEARER_EMPLEADO = 'Bearer valido-uid-empleado';

interface Harness {
  deps: SpacesDeps;
  spaces: ReturnType<typeof createMemorySpaces>;
}

function harness(): Harness {
  const spaces = createMemorySpaces({ now: () => NOW });
  return {
    spaces,
    deps: {
      directory: createMemoryDirectory({ now: () => NOW, seed: [ADMIN, EMPLEADO] }),
      spaces,
      auth: verifier,
      now: () => NOW,
      log: () => {},
    },
  };
}

/** Rectangulo valido y libre, para que cada test escriba solo lo que le importa. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'Sala Nueva', x: 1, y: 1, w: 6, h: 6, capacity: null, ...overrides };
}

describe('handleGetSpacesConfig', () => {
  it('hashes the fetched mixed room/cubicle snapshot even when the store changes immediately afterwards', async () => {
    const { deps, spaces } = harness();
    const room = await spaces.createSpace({ name: 'Room', x: 1, y: 1, w: 6, h: 6, capacity: null });
    const desk = { ...room, id: 'cubicle', slug: 'desk-cubicle', name: 'Desk', x: 10, deskId: 'desk' };
    const snapshot = [room, desk];
    let current = snapshot;
    const changingStore: SpacesDirectory = {
      ...spaces,
      async listSpaces() {
        const fetched = current;
        current = [{ ...room, x: 20 }];
        return fetched;
      },
      async version() { return hashSpaces(current); },
    };

    const result = await handleGetSpacesConfig({ ...deps, spaces: changingStore });
    expect(result.body.version).toBe(hashSpaces(snapshot));
    expect((result.body.spaces as Record<string, unknown>[]).map((space) => space.kind)).toEqual(['room', 'desk']);
    expect(result.body.version).not.toBe(await changingStore.version());
  });

  it('serves the floor of each space, which the version hash leaves out (art step 4)', async () => {
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Sala', x: 1, y: 1, w: 6, h: 6, capacity: null, floor: { materialId: 'floor-plain', color: '#2c3e50' } });
    const versionBefore = await spaces.version();

    const result = await handleGetSpacesConfig(deps);

    expect(result.body.spaces).toEqual([
      expect.objectContaining({ name: 'Sala', floorMaterialId: 'floor-plain', floorColor: '#2c3e50' }),
    ]);
    expect(result.body.version).toBe(versionBefore);
  });

  it('no exige autenticacion: la sirve tambien sin cabecera', async () => {
    // Es deliberado y no un descuido. Hoy los rectangulos viajan DENTRO del
    // bundle del cliente (`BUILT_IN_SPACES`), asi que no hay nada que ocultar
    // que no este ya publicado; y exigir token dejaria sin config al modo sin
    // auth, que es el que usan el desarrollo local y la suite e2e.
    const { deps } = harness();

    expect((await handleGetSpacesConfig(deps)).status).toBe(200);
  });

  it('devuelve la lista y la version que publica el puerto', async () => {
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Sala de Juntas', x: 50, y: 2, w: 13, h: 14, capacity: null });

    const result = await handleGetSpacesConfig(deps);

    expect(result.body.version).toBe(await spaces.version());
    expect((result.body.spaces as unknown[]).length).toBe(1);
  });

  it('sin espacios devuelve lista vacia y la version del hash vacio', async () => {
    // Importa que no degrade a los incorporados: un despliegue con la tabla
    // vacia debe decirlo, no fingir que tiene las dos salas de siempre.
    const { deps } = harness();

    const result = await handleGetSpacesConfig(deps);

    expect(result.body.spaces).toEqual([]);
    expect(result.body.version).toBe(hashSpaces([]));
  });

  it('publica solo los campos que entran en el hash, mas kind y el suelo, nunca las marcas de tiempo', async () => {
    // `createdAt`/`updatedAt` no afectan a la pertenencia, asi que no los
    // necesita nadie del lado del cliente. Y si viajasen, invitarian a que
    // alguien los metiese en su propio calculo de version y divergiese del
    // servidor (D4). `kind` SI viaja aunque no entre en el hash (D8): es
    // derivado de `deskId`, no un dato propio que pudiese divergir.
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Sala', x: 1, y: 1, w: 6, h: 6, capacity: 8 });

    const result = await handleGetSpacesConfig(deps);

    // `floorMaterialId`/`floorColor` (art step 4) travel for drawing only,
    // outside the hash like `kind`.
    expect(Object.keys((result.body.spaces as Record<string, unknown>[])[0]).sort()).toEqual([
      'capacity',
      'floorColor',
      'floorMaterialId',
      'h',
      'id',
      'kind',
      'name',
      'slug',
      'w',
      'x',
      'y',
    ]);
  });

  it('una sala (sin desk_id) reporta kind "room" (#10 + #12)', async () => {
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Sala', x: 1, y: 1, w: 6, h: 6, capacity: null });

    const result = await handleGetSpacesConfig(deps);

    expect((result.body.spaces as Record<string, unknown>[])[0].kind).toBe('room');
  });

  it('un cubiculo de escritorio (con desk_id) reporta kind "desk" (#10 + #12)', async () => {
    // memorySpaces todavia no sabe crear cubiculos de escritorio (eso llega
    // en S1b, tarea 2.5): se inyecta un `SpacesDirectory` minimo para probar
    // solo la traduccion `toConfigBody`, sin esperar a esa slice.
    const { deps } = harness();
    const cubiculo: Space = {
      id: 'id-cubiculo-1',
      slug: 'desk-id-mesa-1',
      name: 'Mesa 1',
      x: 10,
      y: 10,
      w: 3,
      h: 3,
      capacity: null,
      deskId: 'id-mesa-1',
      floorMaterialId: 'floor-wood',
      floorColor: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const spacesConCubiculo: SpacesDirectory = {
      ...deps.spaces,
      async listSpaces() {
        return [cubiculo];
      },
    };

    const result = await handleGetSpacesConfig({ ...deps, spaces: spacesConCubiculo });

    expect((result.body.spaces as Record<string, unknown>[])[0].kind).toBe('desk');
  });
});

describe('room placement adjacency (#180)', () => {
  for (const obstacle of ['room', 'cubicle'] as const) {
    it.each(['create', 'move'] as const)('%s accepts edge/corner adjacency to a ' + obstacle + ' and preserves overlap conflicts', async (mode) => {
      const { deps, spaces } = harness();
      // A cubicle is 3x3; a room is at least MIN_ROOM_SIDE (6) a side (#184).
      const side = obstacle === 'room' ? 6 : 3;
      if (obstacle === 'room') {
        await spaces.createSpace({ name: 'Fixed', x: 10, y: 10, w: side, h: side, capacity: null });
      } else {
        spaces.deskSpaces.upsertDeskSpace({ id: 'fixed-desk', label: 'Fixed', x: 10, y: 10 });
      }
      const moving = mode === 'move'
        ? await spaces.createSpace({ name: 'Moving', x: 30, y: 30, w: 6, h: 6, capacity: null }) : null;
      const end = 10 + side;
      for (const [index, position] of [{ x: end, y: 10 }, { x: 10, y: end }, { x: end, y: end }, { x: 12, y: 12 }].entries()) {
        const bounds = { ...position, w: 6, h: 6 };
        const before = await spaces.listSpaces();
        const result = moving
          ? await handleUpdateSpace(BEARER_ADMIN, moving.id, bounds, deps)
          : await handleCreateSpace(BEARER_ADMIN, body({ name: `Adjacent ${index}`, ...bounds }), deps);
        if (index === 3) {
          expect(result).toEqual({ status: 409, body: { error: 'space-overlap' } });
          expect(await spaces.listSpaces()).toEqual(before);
        } else {
          expect(result.status).toBe(moving ? 200 : 201);
          expect(result.body).toMatchObject(bounds);
          if (!moving) await spaces.deleteSpace(result.body.id as string);
        }
      }
    });
  }
});

describe('handleCreateSpace', () => {
  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleCreateSpace(undefined, body(), deps)).status).toBe(401);
  });

  it('un empleado con token valido responde 403', async () => {
    const { deps } = harness();

    expect((await handleCreateSpace(BEARER_EMPLEADO, body(), deps)).status).toBe(403);
  });

  it('el 401 va ANTES que la validacion del cuerpo', async () => {
    // Con un cuerpo invalido y sin credencial la respuesta tiene que ser 401.
    // Un 400 aqui confirmaria a quien sondea que su peticion llego a la logica.
    const { deps } = harness();

    expect((await handleCreateSpace(undefined, body({ w: 0 }), deps)).status).toBe(401);
  });

  it('el 403 va ANTES que la comprobacion de solape', async () => {
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Ocupa', x: 1, y: 1, w: 6, h: 6, capacity: null });

    expect((await handleCreateSpace(BEARER_EMPLEADO, body(), deps)).status).toBe(403);
  });

  it('un admin crea el espacio y recibe 201 con el slug derivado', async () => {
    const { deps } = harness();

    const result = await handleCreateSpace(BEARER_ADMIN, body({ name: 'Sala de Juntas' }), deps);

    expect(result.status).toBe(201);
    expect(result.body.slug).toBe('sala-de-juntas');
  });

  it('el espacio creado queda en el puerto y cambia la version', async () => {
    const { deps, spaces } = harness();
    const before = await spaces.version();

    await handleCreateSpace(BEARER_ADMIN, body(), deps);

    expect((await spaces.listSpaces()).length).toBe(1);
    expect(await spaces.version()).not.toBe(before);
  });

  it('un rectangulo invalido responde 400 y no crea nada', async () => {
    const { deps, spaces } = harness();

    const result = await handleCreateSpace(BEARER_ADMIN, body({ w: 0 }), deps);

    expect(result.status).toBe(400);
    expect(await spaces.listSpaces()).toEqual([]);
  });

  it('a room with a side under 6 tiles answers 400 and creates nothing (#184)', async () => {
    const { deps, spaces } = harness();

    const result = await handleCreateSpace(BEARER_ADMIN, body({ w: 5, h: 9 }), deps);

    expect(result.status).toBe(400);
    expect(await spaces.listSpaces()).toEqual([]);
  });

  it('un cuerpo que no es un objeto responde 400', async () => {
    const { deps } = harness();

    expect((await handleCreateSpace(BEARER_ADMIN, 'no soy un objeto', deps)).status).toBe(400);
  });

  it('un solape responde 409 y no 500', async () => {
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Ocupa', x: 1, y: 1, w: 6, h: 6, capacity: null });

    expect((await handleCreateSpace(BEARER_ADMIN, body(), deps)).status).toBe(409);
  });

  it('un nombre repetido que solo difiere en mayusculas responde 409 y no 500', async () => {
    // Los indices unicos de `schema.sql` estan sobre `lower(slug)` y
    // `lower(name)`: escribir "SALA NUEVA" donde ya hay una "Sala Nueva" es una
    // equivocacion corriente del administrador, no una averia del servidor.
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Sala Nueva', x: 30, y: 1, w: 6, h: 6, capacity: null });

    const result = await handleCreateSpace(BEARER_ADMIN, body({ name: 'SALA NUEVA' }), deps);

    expect(result).toEqual({ status: 409, body: { error: 'space-name-taken' } });
  });

  it('el 409 de nombre repetido NO se confunde con el de solape', async () => {
    // El cuerpo es lo unico que le dice al panel que arreglar: el solape se
    // corrige moviendo el rectangulo y el nombre repetido eligiendo otro
    // nombre. Si los dos dijesen `space-overlap`, el admin moveria una sala que
    // estaba bien colocada.
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Ocupa', x: 1, y: 1, w: 6, h: 6, capacity: null });

    const solape = await handleCreateSpace(BEARER_ADMIN, body(), deps);
    const repetido = await handleCreateSpace(
      BEARER_ADMIN,
      body({ name: 'Ocupa', x: 30, y: 1 }),
      deps,
    );

    expect(solape.body).toEqual({ error: 'space-overlap' });
    expect(repetido.body).toEqual({ error: 'space-name-taken' });
  });

  it('dos nombres distintos que derivan el mismo slug responden 409', async () => {
    // `spaces_slug_unique` muerde donde `spaces_name_unique` no llega: "Sala A"
    // y "Sala-A" no son el mismo nombre ni para `lower()`, pero si el mismo
    // slug.
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Sala A', x: 30, y: 1, w: 6, h: 6, capacity: null });

    const result = await handleCreateSpace(BEARER_ADMIN, body({ name: 'Sala-A' }), deps);

    expect(result).toEqual({ status: 409, body: { error: 'space-name-taken' } });
  });

  it('ignora un id y un slug puestos a mano en el cuerpo', async () => {
    // El id es la clave de pertenencia (rebanada 2) y el slug se DERIVA del
    // nombre: dejar que el cuerpo los fije seria dejar que quien llama eligiese
    // a que espacio pertenece la gente.
    const { deps } = harness();

    const result = await handleCreateSpace(
      BEARER_ADMIN,
      body({ id: 'id-elegido-a-mano', slug: 'slug-elegido-a-mano', name: 'Sala Real' }),
      deps,
    );

    expect(result.body.id).not.toBe('id-elegido-a-mano');
    expect(result.body.slug).toBe('sala-real');
  });

  it('sin capacity en el cuerpo el espacio nace sin limite', async () => {
    const { deps } = harness();
    const sinCapacidad = body();
    delete sinCapacidad.capacity;

    const result = await handleCreateSpace(BEARER_ADMIN, sinCapacidad, deps);

    expect(result.status).toBe(201);
    expect(result.body.capacity).toBeNull();
  });
});

describe('handleUpdateSpace', () => {
  async function conEspacio(): Promise<{ deps: SpacesDeps; spaces: SpacesDirectory; id: string }> {
    const { deps, spaces } = harness();
    const created = await spaces.createSpace({ name: 'Antes', x: 1, y: 1, w: 6, h: 6, capacity: null });
    return { deps, spaces, id: created.id };
  }

  it('sin cabecera responde 401', async () => {
    const { deps, id } = await conEspacio();

    expect((await handleUpdateSpace(undefined, id, { name: 'X' }, deps)).status).toBe(401);
  });

  it('un empleado responde 403', async () => {
    const { deps, id } = await conEspacio();

    expect((await handleUpdateSpace(BEARER_EMPLEADO, id, { name: 'X' }, deps)).status).toBe(403);
  });

  it('un admin renombra y recibe 200 con el nuevo slug', async () => {
    const { deps, id } = await conEspacio();

    const result = await handleUpdateSpace(BEARER_ADMIN, id, { name: 'Sala de Juntas' }, deps);

    expect(result.status).toBe(200);
    expect(result.body.slug).toBe('sala-de-juntas');
  });

  it('renombrar NO cambia el id: quien estaba dentro sigue dentro', async () => {
    // Es el criterio de aceptacion del #7 que motivo la reclave de la rebanada 2.
    const { deps, id } = await conEspacio();

    const result = await handleUpdateSpace(BEARER_ADMIN, id, { name: 'Otro Nombre' }, deps);

    expect(result.body.id).toBe(id);
  });

  it('un id que no existe responde 404', async () => {
    const { deps } = await conEspacio();

    expect((await handleUpdateSpace(BEARER_ADMIN, 'no-existe', { name: 'X' }, deps)).status).toBe(404);
  });

  it('un campo ausente no se toca', async () => {
    const { deps, id } = await conEspacio();

    const result = await handleUpdateSpace(BEARER_ADMIN, id, { name: 'Solo el nombre' }, deps);

    expect(result.body.x).toBe(1);
  });

  it('capacity a null presente en el cuerpo quita el limite', async () => {
    // `null` presente y `undefined` ausente significan cosas distintas
    // (`UpdateSpaceInput`): si el handler los colapsara, no habria forma de
    // quitarle el aforo a un espacio.
    const { deps, spaces, id } = await conEspacio();
    await spaces.updateSpace(id, { capacity: 10 });

    const result = await handleUpdateSpace(BEARER_ADMIN, id, { capacity: null }, deps);

    expect(result.body.capacity).toBeNull();
  });

  it('medio rectangulo responde 400', async () => {
    const { deps, id } = await conEspacio();

    expect((await handleUpdateSpace(BEARER_ADMIN, id, { x: 9 }, deps)).status).toBe(400);
  });

  it('mover encima de otro espacio responde 409', async () => {
    const { deps, spaces, id } = await conEspacio();
    await spaces.createSpace({ name: 'Otra', x: 20, y: 20, w: 6, h: 6, capacity: null });

    const result = await handleUpdateSpace(BEARER_ADMIN, id, { x: 21, y: 21, w: 6, h: 6 }, deps);

    expect(result.status).toBe(409);
  });

  it('renombrar al nombre de otro espacio responde 409 y no 500', async () => {
    // Renombrar choca con los mismos dos indices que el alta: dejar que aqui
    // saliese un 500 haria que la misma falta se contase de dos maneras segun
    // por que puerta entrase.
    const { deps, spaces, id } = await conEspacio();
    await spaces.createSpace({ name: 'Cafeteria', x: 20, y: 20, w: 6, h: 6, capacity: null });

    const result = await handleUpdateSpace(BEARER_ADMIN, id, { name: 'CAFETERIA' }, deps);

    expect(result).toEqual({ status: 409, body: { error: 'space-name-taken' } });
  });

  it('renombrarse a si mismo cambiando mayusculas responde 200', async () => {
    // No es un choque: en Postgres el UPDATE reemplaza la entrada de indice de
    // esa misma fila. Un 409 aqui dejaria un nombre mal escrito imposible de
    // corregir.
    const { deps, id } = await conEspacio();

    const result = await handleUpdateSpace(BEARER_ADMIN, id, { name: 'ANTES' }, deps);

    expect(result.status).toBe(200);
    expect(result.body.name).toBe('ANTES');
  });

  it('un intento de renombrar o mover un cubiculo de escritorio responde 409 space-owned-by-desk (#10 + #12, tarea 1.4)', async () => {
    // memorySpaces todavia no sabe crear cubiculos de escritorio (S1b): se
    // inyecta un `SpacesDirectory` minimo para probar solo la traduccion
    // HTTP de `SpaceOwnedByDeskError`, sin esperar a esa slice.
    const { deps, id } = await conEspacio();
    const spacesDeCubiculo: SpacesDirectory = {
      ...deps.spaces,
      async updateSpace() {
        throw new SpaceOwnedByDeskError('este espacio pertenece a un escritorio');
      },
    };

    const result = await handleUpdateSpace(
      BEARER_ADMIN,
      id,
      { name: 'Otro' },
      { ...deps, spaces: spacesDeCubiculo },
    );

    expect(result).toEqual({ status: 409, body: { error: 'space-owned-by-desk' } });
  });
});

describe('handleDeleteSpace', () => {
  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleDeleteSpace(undefined, 'cualquiera', deps)).status).toBe(401);
  });

  it('un empleado responde 403', async () => {
    const { deps } = harness();

    expect((await handleDeleteSpace(BEARER_EMPLEADO, 'cualquiera', deps)).status).toBe(403);
  });

  it('un admin borra y recibe 200', async () => {
    const { deps, spaces } = harness();
    const created = await spaces.createSpace({ name: 'Una', x: 1, y: 1, w: 6, h: 6, capacity: null });

    const result = await handleDeleteSpace(BEARER_ADMIN, created.id, deps);

    expect(result.status).toBe(200);
    expect(await spaces.listSpaces()).toEqual([]);
  });

  it('un id que no existe responde 404', async () => {
    const { deps } = harness();

    expect((await handleDeleteSpace(BEARER_ADMIN, 'no-existe', deps)).status).toBe(404);
  });

  it('un intento de borrar un cubiculo de escritorio responde 409 space-owned-by-desk (#10 + #12, tarea 1.4)', async () => {
    // Prueba tambien que `handleDeleteSpace` quedo envuelto en `translating`:
    // antes de la tarea 1.4 este handler dejaba pasar cualquier error de
    // dominio sin traducir, y aqui reventaria como 500.
    const { deps } = harness();
    const spacesDeCubiculo: SpacesDirectory = {
      ...deps.spaces,
      async deleteSpace() {
        throw new SpaceOwnedByDeskError('este espacio pertenece a un escritorio');
      },
    };

    const result = await handleDeleteSpace(BEARER_ADMIN, 'id-cubiculo', {
      ...deps,
      spaces: spacesDeCubiculo,
    });

    expect(result).toEqual({ status: 409, body: { error: 'space-owned-by-desk' } });
  });
});

/** The floor is chosen when a room is created and never again (art migration, step 7). */
describe('space floor, chosen only at creation (art step 7)', () => {
  const PACK = readArtPackManifest(new URL('../../../public/assets/pack/manifest.json', import.meta.url));

  async function withCatalog() {
    const base = harness();
    const decor = createMemoryDecor({ now: () => NOW });
    await decor.registerArtPack(PACK);
    return { ...base, decor, deps: { ...base.deps, decor } };
  }

  it('stores the chosen floor material and color with the room, color normalized', async () => {
    const { deps, spaces } = await withCatalog();

    const result = await handleCreateSpace(BEARER_ADMIN, body({ floorMaterialId: 'floor-plain', floorColor: '#2C3E50' }), deps);

    expect(result.status).toBe(201);
    expect(result.body).toEqual(expect.objectContaining({ floorMaterialId: 'floor-plain', floorColor: '#2c3e50' }));
    expect(await spaces.listSpaces()).toEqual([
      expect.objectContaining({ floorMaterialId: 'floor-plain', floorColor: '#2c3e50' }),
    ]);
  });

  it('the colorable floor without a color takes its default color', async () => {
    const { deps } = await withCatalog();

    const result = await handleCreateSpace(BEARER_ADMIN, body({ floorMaterialId: 'floor-plain' }), deps);

    expect(result.body).toEqual(expect.objectContaining({ floorMaterialId: 'floor-plain', floorColor: '#b9c3cc' }));
  });

  it('a non-colorable floor keeps its own look, stored without a color', async () => {
    const { deps } = await withCatalog();

    const result = await handleCreateSpace(BEARER_ADMIN, body({ floorMaterialId: 'floor-grass' }), deps);

    expect(result.body).toEqual(expect.objectContaining({ floorMaterialId: 'floor-grass', floorColor: null }));
  });

  it('without a floor the room takes the pack default', async () => {
    const { deps } = await withCatalog();

    const result = await handleCreateSpace(BEARER_ADMIN, body(), deps);

    expect(result.body).toEqual(expect.objectContaining({ floorMaterialId: 'floor-wood', floorColor: null }));
  });

  it.each([
    ['unknown-piece', { floorMaterialId: 'floor-lava' }],
    ['unknown-piece', { floorMaterialId: 'desk-painted' }],
    ['color-not-allowed', { floorMaterialId: 'floor-water', floorColor: '#2c3e50' }],
    ['invalid-color', { floorMaterialId: 'floor-plain', floorColor: '#abc' }],
  ])('rejects a floor the catalog does not allow with 400 invalid-appearance %s and creates nothing', async (reason, floor) => {
    const { deps, spaces } = await withCatalog();

    const result = await handleCreateSpace(BEARER_ADMIN, body(floor), deps);

    expect(result).toEqual({ status: 400, body: { error: 'invalid-appearance', reason } });
    expect(await spaces.listSpaces()).toEqual([]);
  });

  it('a retired floor cannot be chosen again', async () => {
    const { deps, decor } = await withCatalog();
    await decor.registerArtPack({ ...PACK, pieces: PACK.pieces.filter((piece) => piece.id !== 'floor-water') });

    const result = await handleCreateSpace(BEARER_ADMIN, body({ floorMaterialId: 'floor-water' }), deps);

    expect(result).toEqual({ status: 400, body: { error: 'invalid-appearance', reason: 'retired-piece' } });
  });

  it('the role guard still runs before the floor is read', async () => {
    const { deps } = await withCatalog();

    expect((await handleCreateSpace(BEARER_EMPLEADO, body({ floorMaterialId: 'floor-lava' }), deps)).status).toBe(403);
  });

  it.each([
    [{ floorMaterialId: 'floor-grass' }],
    [{ floorColor: '#000000' }],
    [{ name: 'Otra', floorMaterialId: 'floor-plain', floorColor: '#2c3e50' }],
  ])('an update that mentions the floor answers 400 appearance-immutable and changes nothing', async (patch) => {
    const { deps, spaces } = await withCatalog();
    const created = await spaces.createSpace({
      name: 'Sala',
      x: 1,
      y: 1,
      w: 6,
      h: 6,
      capacity: null,
      floor: { materialId: 'floor-plain', color: '#2c3e50' },
    });

    const result = await handleUpdateSpace(BEARER_ADMIN, created.id, patch, deps);

    expect(result).toEqual({ status: 400, body: { error: 'appearance-immutable' } });
    expect(await spaces.listSpaces()).toEqual([
      expect.objectContaining({ name: 'Sala', floorMaterialId: 'floor-plain', floorColor: '#2c3e50' }),
    ]);
  });

  it('moving and renaming a room keep its floor', async () => {
    const { deps } = await withCatalog();
    const created = await handleCreateSpace(BEARER_ADMIN, body({ floorMaterialId: 'floor-plain', floorColor: '#2c3e50' }), deps);
    const id = created.body.id as string;

    expect((await handleUpdateSpace(BEARER_ADMIN, id, { x: 10, y: 10, w: 6, h: 6 }, deps)).status).toBe(200);
    const renamed = await handleUpdateSpace(BEARER_ADMIN, id, { name: 'Sala movida' }, deps);

    expect(renamed.body).toEqual(
      expect.objectContaining({ name: 'Sala movida', x: 10, y: 10, floorMaterialId: 'floor-plain', floorColor: '#2c3e50' }),
    );
  });
});
