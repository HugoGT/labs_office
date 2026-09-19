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
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import { createMemorySpaces } from './memorySpaces.ts';
import { hashSpaces } from './spaceRules.ts';
import type { SpacesDirectory } from './spacesPort.ts';
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
  spaces: SpacesDirectory;
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
  return { name: 'Sala Nueva', x: 1, y: 1, w: 4, h: 4, capacity: null, ...overrides };
}

describe('handleGetSpacesConfig', () => {
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

  it('publica solo los campos que entran en el hash, nunca las marcas de tiempo', async () => {
    // `createdAt`/`updatedAt` no afectan a la pertenencia, asi que no los
    // necesita nadie del lado del cliente. Y si viajasen, invitarian a que
    // alguien los metiese en su propio calculo de version y divergiese del
    // servidor (D4).
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Sala', x: 1, y: 1, w: 4, h: 4, capacity: 8 });

    const result = await handleGetSpacesConfig(deps);

    expect(Object.keys((result.body.spaces as Record<string, unknown>[])[0]).sort()).toEqual([
      'capacity',
      'h',
      'id',
      'name',
      'slug',
      'w',
      'x',
      'y',
    ]);
  });
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
    await spaces.createSpace({ name: 'Ocupa', x: 1, y: 1, w: 4, h: 4, capacity: null });

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

  it('un cuerpo que no es un objeto responde 400', async () => {
    const { deps } = harness();

    expect((await handleCreateSpace(BEARER_ADMIN, 'no soy un objeto', deps)).status).toBe(400);
  });

  it('un solape responde 409 y no 500', async () => {
    const { deps, spaces } = harness();
    await spaces.createSpace({ name: 'Ocupa', x: 1, y: 1, w: 4, h: 4, capacity: null });

    expect((await handleCreateSpace(BEARER_ADMIN, body(), deps)).status).toBe(409);
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
    const created = await spaces.createSpace({ name: 'Antes', x: 1, y: 1, w: 4, h: 4, capacity: null });
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
    await spaces.createSpace({ name: 'Otra', x: 20, y: 20, w: 4, h: 4, capacity: null });

    const result = await handleUpdateSpace(BEARER_ADMIN, id, { x: 21, y: 21, w: 4, h: 4 }, deps);

    expect(result.status).toBe(409);
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
    const created = await spaces.createSpace({ name: 'Una', x: 1, y: 1, w: 4, h: 4, capacity: null });

    const result = await handleDeleteSpace(BEARER_ADMIN, created.id, deps);

    expect(result.status).toBe(200);
    expect(await spaces.listSpaces()).toEqual([]);
  });

  it('un id que no existe responde 404', async () => {
    const { deps } = harness();

    expect((await handleDeleteSpace(BEARER_ADMIN, 'no-existe', deps)).status).toBe(404);
  });
});
