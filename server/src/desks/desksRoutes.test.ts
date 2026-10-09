/**
 * Las rutas de los escritorios (#7, slice 5), probadas como funciones puras y
 * sin montar Express, igual que `spacesRoutes.test.ts` y `decorRoutes.test.ts`.
 *
 * Hay tres propiedades que este fichero existe para fijar, y ninguna es una
 * comprobacion de forma:
 *
 *   1. **El ocupante es SIEMPRE el del token.** Ni un `occupantId` ni un
 *      `userId` del cuerpo pueden sentar o levantar a otra persona.
 *   2. **`GET /desks` exige credencial**, a diferencia de `GET /spaces`.
 *      Quien se sienta donde es informacion del directorio sobre gente real.
 *   3. **Quien administra NO reparte sitios.** El panel crea, mueve, renombra
 *      y borra escritorios; sentarse es cosa de cada quien.
 */

import { describe, expect, it, vi } from 'vitest';
import { readArtPackManifest } from '../decor/artPackFile.ts';
import { createMemoryDecor } from '../decor/memoryDecor.ts';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import { createMemorySpaces } from '../spaces/memorySpaces.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import type { DeskDirectory } from './desksPort.ts';
import { createMemoryDesks } from './memoryDesks.ts';
import {
  handleClaimDesk,
  handleCreateDesk,
  handleDeleteDesk,
  handleListDesks,
  handleReleaseDesk,
  handleUpdateDesk,
  type DeskWallGuard,
  type DesksDeps,
} from './desksRoutes.ts';

const NOW = new Date('2026-02-01T10:00:00.000Z');

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

const ADMIN = user({ id: 'id-admin', uid: 'uid-admin', role: 'admin', displayName: 'Admin' });
const ANA = user({ id: 'id-ana', uid: 'uid-ana', displayName: 'Ana' });
const BRUNO = user({ id: 'id-bruno', uid: 'uid-bruno', displayName: 'Bruno' });
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
const BEARER_ANA = 'Bearer valido-uid-ana';
const BEARER_BRUNO = 'Bearer valido-uid-bruno';
const BEARER_CADUCADO = 'Bearer valido-uid-caducado';

interface Harness {
  deps: DesksDeps;
  desks: DeskDirectory;
  spaces: ReturnType<typeof createMemorySpaces>;
}

/**
 * `seed` se puede sustituir para probar la unica propiedad que el nombre
 * visible NO puede dar: un RENOMBRADO es este mismo directorio devolviendo
 * otro `displayName` para el MISMO `id`.
 *
 * `spaces` cablea la afordancia `deskSpaces` de `memorySpaces` (#10 + #12,
 * S1b, tarea 2.5): sin ella, ningun escritorio sincroniza su cubiculo y el
 * 409 `desk-space-overlap` nunca podria dispararse en estas pruebas.
 */
function harness(
  seed: DirectoryUser[] = [ADMIN, ANA, BRUNO, CADUCADO],
  roomSeed: Parameters<typeof createMemorySpaces>[0] = {},
): Harness {
  const directory = createMemoryDirectory({
    now: () => NOW,
    seed,
  });
  const decor = createMemoryDecor({ now: () => NOW });
  const spaces = createMemorySpaces({ now: () => NOW, ...roomSeed });
  const desks = createMemoryDesks({ now: () => NOW, directory, decor, spaces: spaces.deskSpaces });
  return {
    desks,
    spaces,
    deps: { directory, desks, auth: verifier, now: () => NOW, log: () => {} },
  };
}

describe('handleListDesks', () => {
  it('sin cabecera responde 401: quien se sienta donde NO es publico', async () => {
    // A diferencia de `GET /spaces`, que no publica nada que no este ya en el
    // bundle del cliente. Aqui lo que viaja son personas reales y su sitio.
    const { deps } = harness();

    expect((await handleListDesks(undefined, deps)).status).toBe(401);
  });

  it('una cuenta caducada tampoco la lee', async () => {
    const { deps } = harness();

    expect((await handleListDesks(BEARER_CADUCADO, deps)).status).toBe(401);
  });

  it('NO exige rol de administracion: cualquiera de la oficina la lee', async () => {
    const { deps } = harness();

    expect((await handleListDesks(BEARER_ANA, deps)).status).toBe(200);
  });

  it('una oficina sin escritorios responde una lista vacia, no un error', async () => {
    // Estado legitimo: nadie siembra escritorios.
    const { deps } = harness();

    expect(await handleListDesks(BEARER_ANA, deps)).toEqual({ status: 200, body: { desks: [] } });
  });

  it('cada escritorio viaja con su ocupante y la decoracion de ese ocupante', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa 1', x: 4, y: 4 });
    await desks.claimDesk(desk.id, ANA.id);

    const result = await handleListDesks(BEARER_ANA, deps);

    expect(result.body.desks).toEqual([
      expect.objectContaining({
        id: desk.id,
        label: 'Mesa 1',
        x: 4,
        y: 4,
        occupant: { id: ANA.id, displayName: 'Ana', items: [] },
      }),
    ]);
  });

  it('el lado del escritorio viaja DERIVADO y no de una columna', async () => {
    // Un escritorio es 3x3 siempre. Viaja para que el cliente no tenga que
    // guardar su propia copia del 3, que es como dos numeros que deberian ser
    // el mismo acaban discrepando.
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    const result = await handleListDesks(BEARER_ANA, deps);

    expect(result.body.desks).toEqual([expect.objectContaining({ w: 3, h: 3 })]);
  });

  it('un escritorio libre viaja con occupant null', async () => {
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    const result = await handleListDesks(BEARER_ANA, deps);

    expect((result.body.desks as { occupant: unknown }[])[0].occupant).toBeNull();
  });

  it('NO publica createdAt ni updatedAt: no dicen nada para pintar la oficina', async () => {
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    const result = await handleListDesks(BEARER_ANA, deps);

    expect((result.body.desks as Record<string, unknown>[])[0]).not.toHaveProperty('createdAt');
    expect((result.body.desks as Record<string, unknown>[])[0]).not.toHaveProperty('updatedAt');
  });

  /**
   * Cual de estos escritorios es el de quien pregunta (#7, slice 5).
   *
   * Lo contesta el SERVIDOR y no el cliente, y esa es toda la razon de que
   * este campo exista. El cliente no tiene con que averiguarlo: `occupantId`
   * no viaja (ver la prueba de aqui abajo, y la cabecera de `desksPort.ts`) y
   * el unico cruce que le queda seria el nombre visible. Comparar nombres es
   * exactamente lo que la slice 1 de esta misma issue retiro de
   * `proximityAudio.ts` -- alli decidia quien oye a quien y un renombrado lo
   * cambiaba en silencio. Reintroducirlo aqui haria que renombrar a alguien
   * cambiase de manos un escritorio en la pantalla.
   *
   * Lo que se publica es una RESPUESTA SOBRE QUIEN PREGUNTA, no un dato de
   * nadie mas: es la misma informacion que `/me/desk` ya le da, y ningun uuid
   * del directorio sale con ella.
   */
  it('marca como propio el escritorio de quien pregunta, y solo ese', async () => {
    const { deps, desks } = harness();
    const deAna = await desks.createDesk({ label: 'Mesa Ana', x: 0, y: 0 });
    const deBruno = await desks.createDesk({ label: 'Mesa Bruno', x: 4, y: 0 });
    await desks.claimDesk(deAna.id, ANA.id);
    await desks.claimDesk(deBruno.id, BRUNO.id);

    const result = await handleListDesks(BEARER_ANA, deps);

    expect(result.body.desks).toEqual([
      expect.objectContaining({ id: deAna.id, mine: true }),
      expect.objectContaining({ id: deBruno.id, mine: false }),
    ]);
  });

  it('la misma lista vista por otra persona mueve la marca a su escritorio', async () => {
    // Es la mitad que demuestra que la respuesta es sobre QUIEN PREGUNTA y no
    // una propiedad del escritorio: los mismos dos, el flag en el otro.
    const { deps, desks } = harness();
    const deAna = await desks.createDesk({ label: 'Mesa Ana', x: 0, y: 0 });
    const deBruno = await desks.createDesk({ label: 'Mesa Bruno', x: 4, y: 0 });
    await desks.claimDesk(deAna.id, ANA.id);
    await desks.claimDesk(deBruno.id, BRUNO.id);

    const result = await handleListDesks(BEARER_BRUNO, deps);

    expect(result.body.desks).toEqual([
      expect.objectContaining({ id: deAna.id, mine: false }),
      expect.objectContaining({ id: deBruno.id, mine: true }),
    ]);
  });

  it('serves the appearance of each desk so the office draws its material and color (art step 4)', async () => {
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0, appearance: { materialId: 'desk-painted', color: '#c0392b' } });
    await desks.createDesk({ label: 'Mesa 2', x: 4, y: 0 });

    const result = await handleListDesks(BEARER_ANA, deps);

    expect(result.body.desks).toEqual([
      expect.objectContaining({ label: 'Mesa 1', materialId: 'desk-painted', color: '#c0392b' }),
      expect.objectContaining({ label: 'Mesa 2', materialId: 'desk-wood', color: null }),
    ]);
  });

  it('un escritorio libre nunca es de nadie', async () => {
    // `mine` sale de `occupant_id`, no de la ausencia de ocupante: sin esta
    // prueba, un `occupantId === viewerId` con los dos a null marcaria como
    // propio TODO escritorio libre.
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    const result = await handleListDesks(BEARER_ANA, deps);

    expect(result.body.desks).toEqual([expect.objectContaining({ occupant: null, mine: false })]);
  });

  it('renombrar a una persona no cambia de manos ningun escritorio', async () => {
    // La propiedad que el nombre visible no puede dar, y la razon de que este
    // campo lo calcule el servidor. Un renombrado es este mismo directorio
    // devolviendo otro `displayName` para el MISMO `id`: aqui Ana pasa a
    // llamarse como Bruno, que es el peor caso que un cruce por nombre podria
    // encontrarse.
    const renombrada = { ...ANA, displayName: 'Bruno' };
    const { deps, desks } = harness([ADMIN, renombrada, BRUNO, CADUCADO]);
    const deAna = await desks.createDesk({ label: 'Mesa Ana', x: 0, y: 0 });
    const deBruno = await desks.createDesk({ label: 'Mesa Bruno', x: 4, y: 0 });
    await desks.claimDesk(deAna.id, ANA.id);
    await desks.claimDesk(deBruno.id, BRUNO.id);

    const result = await handleListDesks(BEARER_ANA, deps);

    // Los dos se llaman igual en la pantalla y aun asi el suyo es el suyo.
    expect(result.body.desks).toEqual([
      expect.objectContaining({ id: deAna.id, mine: true }),
      expect.objectContaining({ id: deBruno.id, mine: false }),
    ]);
  });

  it('NO publica el occupantId suelto: el ocupante entero ya lo trae', async () => {
    // Dos formas de decir lo mismo en el mismo cuerpo invitan a que el cliente
    // use una cuando la otra dice algo distinto.
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    const result = await handleListDesks(BEARER_ANA, deps);

    expect((result.body.desks as Record<string, unknown>[])[0]).not.toHaveProperty('occupantId');
  });
});

describe('handleCreateDesk', () => {
  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleCreateDesk(undefined, { label: 'Mesa', x: 0, y: 0 }, deps)).status).toBe(
      401,
    );
  });

  it('un empleado con token valido responde 403: el mobiliario lo pone quien administra', async () => {
    const { deps } = harness();

    expect((await handleCreateDesk(BEARER_ANA, { label: 'Mesa', x: 0, y: 0 }, deps)).status).toBe(
      403,
    );
  });

  it('la credencial se comprueba ANTES que el cuerpo', async () => {
    // Un 400 aqui le confirmaria a quien sondea que su peticion llego hasta la
    // logica. Mismo argumento que en `adminRoutes.ts`.
    const { deps } = harness();

    expect((await handleCreateDesk(undefined, 'nada de esto es un cuerpo', deps)).status).toBe(401);
    expect((await handleCreateDesk(BEARER_ANA, 'nada de esto es un cuerpo', deps)).status).toBe(403);
  });

  it('un admin crea el escritorio y recibe 201', async () => {
    const { deps } = harness();

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 1', x: 4, y: 4 }, deps);

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ label: 'Mesa 1', x: 4, y: 4, occupant: null });
  });

  it('coordenadas invalidas responden 400', async () => {
    const { deps } = harness();

    expect((await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa', x: -1, y: 0 }, deps)).status).toBe(
      400,
    );
  });

  it('un cuerpo que no es un objeto responde 400', async () => {
    const { deps } = harness();

    expect((await handleCreateDesk(BEARER_ADMIN, [], deps)).status).toBe(400);
  });

  it('un escritorio encima de otro responde 409', async () => {
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 2', x: 1, y: 1 }, deps);

    expect(result).toEqual({ status: 409, body: { error: 'desk-overlap' } });
  });

  it('un escritorio que choca con una sala responde 409 desk-space-overlap (#10 + #12, tarea 2.2)', async () => {
    const { deps, desks } = harness(undefined, {
      seed: [
        { id: 'sala-1', slug: 'sala-1', name: 'Sala de Juntas', x: 50, y: 2, w: 13, h: 14, capacity: null },
      ],
    });

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa', x: 50, y: 2 }, deps);

    expect(result).toEqual({ status: 409, body: { error: 'desk-space-overlap' } });
    // El rollback de la transaccion (D1) es total: el 409 no deja NINGUN
    // escritorio a medio crear, ni siquiera uno sin su cubiculo emparejado.
    expect(await desks.listDesks()).toEqual([]);
  });

  it('el 409 de sala NO se confunde con el de otro escritorio', async () => {
    const { deps } = harness(undefined, {
      seed: [
        { id: 'sala-1', slug: 'sala-1', name: 'Sala de Juntas', x: 50, y: 2, w: 13, h: 14, capacity: null },
      ],
    });

    const contraSala = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa', x: 50, y: 2 }, deps);

    expect(contraSala.body).not.toEqual({ error: 'desk-overlap' });
  });

  it('un occupantId en el cuerpo NO sienta a nadie: crear no reparte sitios', async () => {
    const { deps } = harness();

    const result = await handleCreateDesk(
      BEARER_ADMIN,
      { label: 'Mesa 1', x: 0, y: 0, occupantId: ANA.id },
      deps,
    );

    expect(result.body).toMatchObject({ occupant: null });
  });
});

describe('handleUpdateDesk', () => {
  it('un empleado responde 403', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleUpdateDesk(BEARER_ANA, desk.id, { label: 'Otra' }, deps)).status).toBe(403);
  });

  it('un admin renombra sin mover', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Antes', x: 0, y: 0 });

    const result = await handleUpdateDesk(BEARER_ADMIN, desk.id, { label: 'Despues' }, deps);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: desk.id, label: 'Despues', x: 0, y: 0 });
  });

  it('un admin lo mueve', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    const result = await handleUpdateDesk(BEARER_ADMIN, desk.id, { x: 8, y: 9 }, deps);

    expect(result.body).toMatchObject({ x: 8, y: 9 });
  });

  it('coordenadas invalidas responden 400', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleUpdateDesk(BEARER_ADMIN, desk.id, { x: 2.5, y: 0 }, deps)).status).toBe(400);
  });

  it('media coordenada responde 400', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleUpdateDesk(BEARER_ADMIN, desk.id, { x: 4 }, deps)).status).toBe(400);
  });

  it('moverlo encima de otro responde 409', async () => {
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const segundo = await desks.createDesk({ label: 'Mesa 2', x: 8, y: 0 });

    const result = await handleUpdateDesk(BEARER_ADMIN, segundo.id, { x: 1, y: 0 }, deps);

    expect(result).toEqual({ status: 409, body: { error: 'desk-overlap' } });
  });

  it('un id que no existe responde 404', async () => {
    const { deps } = harness();

    expect((await handleUpdateDesk(BEARER_ADMIN, 'no-existe', { label: 'Mesa' }, deps)).status).toBe(
      404,
    );
  });

  it('moverlo encima de una sala responde 409 desk-space-overlap (#10 + #12, tarea 2.2)', async () => {
    const { deps, desks } = harness(undefined, {
      seed: [
        { id: 'sala-1', slug: 'sala-1', name: 'Sala de Juntas', x: 50, y: 2, w: 13, h: 14, capacity: null },
      ],
    });
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    const result = await handleUpdateDesk(BEARER_ADMIN, desk.id, { x: 50, y: 2 }, deps);

    expect(result).toEqual({ status: 409, body: { error: 'desk-space-overlap' } });
    // El rollback de la transaccion (D1) es total: el 409 no mueve el
    // escritorio ni un poco, se queda exactamente donde estaba.
    expect(await desks.getDesk(desk.id)).toMatchObject({ x: 0, y: 0 });
  });

  it('un escritorio que el backfill dejo sin cubiculo se rechaza aunque solo se renombre (tarea 2.4)', async () => {
    // Simula el escritorio que el backfill de S1a dejo sin cubiculo: `seed` lo
    // pone directamente en `desks` ya encima de una sala (saltandose
    // `normalizeCreateDeskInput`/`assertNoOverlap`, igual que hace el
    // `INSERT ... ON CONFLICT DO NOTHING` del backfill en `schema.sql`), y sin
    // fila emparejada en `spaces` todavia.
    const directory = createMemoryDirectory({ now: () => NOW, seed: [ADMIN] });
    const decor = createMemoryDecor({ now: () => NOW });
    const spaces = createMemorySpaces({
      now: () => NOW,
      seed: [{ id: 'sala-1', slug: 'sala-1', name: 'Sala de Juntas', x: 50, y: 2, w: 13, h: 14, capacity: null }],
    });
    const D0 = {
      id: 'id-d0',
      label: 'Escritorio atascado',
      x: 50,
      y: 2,
      occupantId: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const desks = createMemoryDesks({ now: () => NOW, directory, decor, spaces: spaces.deskSpaces, seed: [D0] });
    const deps: DesksDeps = { directory, desks, auth: verifier, now: () => NOW, log: () => {} };

    // Un renombrado no lo mueve, y sigue chocando: 409 desk-space-overlap.
    const renombrado = await handleUpdateDesk(BEARER_ADMIN, D0.id, { label: 'Sigue chocando' }, deps);
    expect(renombrado).toEqual({ status: 409, body: { error: 'desk-space-overlap' } });

    // Moverlo a un sitio libre lo cura: se crea su cubiculo por primera vez.
    const movido = await handleUpdateDesk(BEARER_ADMIN, D0.id, { x: 90, y: 90 }, deps);
    expect(movido.status).toBe(200);
  });

  it('un occupantId en el cuerpo NO levanta ni sienta a nadie', async () => {
    // La otra mitad de "quien administra no reparte sitios": ni al crear ni al
    // mover. Lo que no se lee no se puede olvidar de comprobar.
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    const result = await handleUpdateDesk(
      BEARER_ADMIN,
      desk.id,
      { label: 'Mesa 2', occupantId: BRUNO.id },
      deps,
    );

    expect(result.status).toBe(200);
    expect((await desks.getDesk(desk.id))?.occupantId).toBe(ANA.id);
  });
});

/**
 * Painted walls under a desk (terrain editor): a desk on a wall could never
 * be reached or sat at. The walls come from the injected guard, which runs
 * the write in the terrain edit queue so no wall lands between the check and
 * the write.
 */
describe('desks over painted walls', () => {
  const WIDTH = 40;

  function wallGuard(...tiles: (readonly [number, number])[]) {
    const walls: (string | null)[] = new Array(WIDTH * 30).fill(null);
    for (const [tx, ty] of tiles) walls[ty * WIDTH + tx] = 'wall-brick';
    const guard: DeskWallGuard = { run: vi.fn(async (write) => write({ width: WIDTH, walls })) };
    return guard;
  }

  it('refuses to create a desk whose 3x3 footprint covers a wall, and creates nothing', async () => {
    const { deps, desks } = harness();
    const walls = wallGuard([12, 7]);

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa', x: 10, y: 5 }, { ...deps, walls });

    expect(result).toEqual({ status: 409, body: { error: 'desk-on-wall' } });
    expect(await desks.listDesks()).toEqual([]);
  });

  it('creates a desk right next to a wall', async () => {
    const { deps } = harness();

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa', x: 10, y: 5 }, { ...deps, walls: wallGuard([13, 7]) });

    expect(result.status).toBe(201);
  });

  it('still answers 400 to invalid coordinates before looking at any wall', async () => {
    const { deps } = harness();
    const walls = wallGuard();

    expect((await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa', x: 'diez', y: 5 }, { ...deps, walls })).status).toBe(400);
    expect(walls.run).not.toHaveBeenCalled();
  });

  it('refuses to move a desk onto a wall and leaves it where it was', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    const result = await handleUpdateDesk(BEARER_ADMIN, desk.id, { x: 20, y: 20 }, { ...deps, walls: wallGuard([21, 22]) });

    expect(result).toEqual({ status: 409, body: { error: 'desk-on-wall' } });
    expect(await desks.getDesk(desk.id)).toMatchObject({ x: 0, y: 0 });
  });

  it('moves a desk to a free spot through the guard', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    const walls = wallGuard([21, 22]);

    const result = await handleUpdateDesk(BEARER_ADMIN, desk.id, { x: 25, y: 20 }, { ...deps, walls });

    expect(result.body).toMatchObject({ x: 25, y: 20 });
    expect(walls.run).toHaveBeenCalledOnce();
  });

  it('renames, claims and releases without looking at the walls', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 20, y: 20 });
    // A wall under the desk can only come from before this check existed:
    // renaming or sitting at it must keep working.
    const walls = wallGuard([21, 21]);

    expect((await handleUpdateDesk(BEARER_ADMIN, desk.id, { label: 'Otra' }, { ...deps, walls })).status).toBe(200);
    expect((await handleClaimDesk(BEARER_ANA, desk.id, { ...deps, walls })).status).toBe(200);
    expect((await handleReleaseDesk(BEARER_ANA, { ...deps, walls })).status).toBe(200);
    expect(walls.run).not.toHaveBeenCalled();
  });

  it('without a guard there are no walls to refuse', async () => {
    const { deps } = harness();

    expect((await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa', x: 10, y: 5 }, deps)).status).toBe(201);
  });
});

describe('handleDeleteDesk', () => {
  it('un empleado responde 403', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleDeleteDesk(BEARER_ANA, desk.id, deps)).status).toBe(403);
  });

  it('un admin lo borra', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect(await handleDeleteDesk(BEARER_ADMIN, desk.id, deps)).toEqual({
      status: 200,
      body: { deleted: true },
    });
    expect(await desks.listDesks()).toEqual([]);
  });

  it('un id que no existe responde 404', async () => {
    const { deps } = harness();

    expect((await handleDeleteDesk(BEARER_ADMIN, 'no-existe', deps)).status).toBe(404);
  });

  it('borrarlo deja sin sitio a quien lo ocupaba, y esa persona puede coger otro', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const otro = await desks.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    await handleDeleteDesk(BEARER_ADMIN, desk.id, deps);

    expect((await handleClaimDesk(BEARER_ANA, otro.id, deps)).status).toBe(200);
  });

  /**
   * S6 (remediacion): `desk-assignment` "Delete a desk deletes its cubicle
   * space" pide que el cubiculo emparejado se borre CON el escritorio.
   * `pgDesks.test.ts` ya afirma el lado Postgres (una unica sentencia, sin
   * tocar `spaces`, apoyada en la cascada de la FK `desk_id`). Este archivo ya
   * cablea `memorySpaces` de verdad via `spaces: spaces.deskSpaces` (ver
   * comentario de `harness`) precisamente para poder afirmar lo mismo del
   * lado en memoria -- que hasta ahora ningun test hacia: `removeDeskSpace`
   * esta cableado en `memoryDesks.deleteDesk` pero nunca se comprobaba que
   * `listSpaces()` reflejase la ausencia tras pasar por la ruta HTTP.
   */
  it('un admin borra un escritorio: el cubiculo emparejado desaparece de listSpaces (memoria, #10 + #12)', async () => {
    const { deps, desks, spaces } = harness();
    const desk = await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    expect(await spaces.listSpaces()).toHaveLength(1);

    await handleDeleteDesk(BEARER_ADMIN, desk.id, deps);

    expect(await spaces.listSpaces()).toEqual([]);
  });
});

describe('handleClaimDesk', () => {
  it('sin cabecera responde 401', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleClaimDesk(undefined, desk.id, deps)).status).toBe(401);
  });

  it('una cuenta caducada no se sienta en ningun sitio', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleClaimDesk(BEARER_CADUCADO, desk.id, deps)).status).toBe(401);
  });

  it('NO exige rol de administracion: el escritorio es de quien lo usa', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    const result = await handleClaimDesk(BEARER_ANA, desk.id, deps);

    expect(result.status).toBe(200);
    expect((await desks.getDesk(desk.id))?.occupantId).toBe(ANA.id);
  });

  it('un escritorio que ya tiene otra persona responde 409', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    const result = await handleClaimDesk(BEARER_BRUNO, desk.id, deps);

    expect(result).toEqual({ status: 409, body: { error: 'desk-taken' } });
    expect((await desks.getDesk(desk.id))?.occupantId).toBe(ANA.id);
  });

  it('el 409 de ocupado NO se confunde con el de solape', async () => {
    // Se arreglan de formas distintas: uno eligiendo otro sitio y el otro
    // corrigiendo unas coordenadas. Un cuerpo comun obligaria al cliente a
    // adivinar cual de las dos cosas decirle a quien esta mirando.
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    const ocupado = await handleClaimDesk(BEARER_BRUNO, desk.id, deps);
    const solapado = await handleCreateDesk(BEARER_ADMIN, { label: 'Otra', x: 1, y: 1 }, deps);

    expect(ocupado.body).not.toEqual(solapado.body);
  });

  it('pedir el que uno YA ocupa responde 200 y no 409', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    expect((await handleClaimDesk(BEARER_ANA, desk.id, deps)).status).toBe(200);
  });

  it('coger otro SUELTA el anterior', async () => {
    const { deps, desks } = harness();
    const viejo = await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const nuevo = await desks.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await desks.claimDesk(viejo.id, ANA.id);

    await handleClaimDesk(BEARER_ANA, nuevo.id, deps);

    expect((await desks.getDesk(viejo.id))?.occupantId).toBeNull();
    expect((await desks.getDesk(nuevo.id))?.occupantId).toBe(ANA.id);
  });

  it('un id que no existe responde 404', async () => {
    const { deps } = harness();

    expect((await handleClaimDesk(BEARER_ANA, 'no-existe', deps)).status).toBe(404);
  });

  it('un id que no es una cadena responde 400', async () => {
    const { deps } = harness();

    expect((await handleClaimDesk(BEARER_ANA, 42, deps)).status).toBe(400);
  });

  it('el ocupante sale del TOKEN, y el cuerpo NI SIQUIERA llega hasta aqui', async () => {
    // La propiedad de seguridad de la slice. Estas rutas viven en una url
    // publica y cualquiera con un ID token valido puede llamarlas con curl. Si
    // el cuerpo pudiese decir a quien se sienta, "cada quien elige su sitio"
    // seria una costumbre del cliente y bastaria un id ajeno para sentar a
    // otra persona donde uno quisiera.
    //
    // No se valida un `occupantId` del cuerpo ni se compara con el del token:
    // el handler no RECIBE cuerpo, asi que no hay nada que olvidarse de
    // comprobar. Lo que fija esta asercion es justo eso -- el dia que alguien
    // le anada un parametro para leer algo del cuerpo, este test se cae.
    // `createOfficeServer.test.ts` lo comprueba ademas mandando uno de verdad.
    expect(handleClaimDesk).toHaveLength(3);

    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await handleClaimDesk(BEARER_ANA, desk.id, deps);

    expect((await desks.getDesk(desk.id))?.occupantId).toBe(ANA.id);
  });
});

describe('handleReleaseDesk', () => {
  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleReleaseDesk(undefined, deps)).status).toBe(401);
  });

  it('NO exige rol de administracion', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    const result = await handleReleaseDesk(BEARER_ANA, deps);

    expect(result).toEqual({ status: 200, body: { released: true } });
    expect((await desks.getDesk(desk.id))?.occupantId).toBeNull();
  });

  it('soltar sin tener nada responde 200: es idempotente', async () => {
    const { deps } = harness();

    expect((await handleReleaseDesk(BEARER_ANA, deps)).status).toBe(200);
  });

  it('soltar dos veces tampoco es un error', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    await handleReleaseDesk(BEARER_ANA, deps);

    expect((await handleReleaseDesk(BEARER_ANA, deps)).status).toBe(200);
  });

  it('quien suelta solo suelta LO SUYO, y el cuerpo no llega hasta aqui', async () => {
    // Misma razon que en el claim, y la mitad que mas duele si falta: un id
    // ajeno bastaria para echar a alguien de su sitio.
    expect(handleReleaseDesk).toHaveLength(2);

    const { deps, desks } = harness();
    const deAna = await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const deBruno = await desks.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await desks.claimDesk(deAna.id, ANA.id);
    await desks.claimDesk(deBruno.id, BRUNO.id);

    await handleReleaseDesk(BEARER_ANA, deps);

    expect((await desks.getDesk(deBruno.id))?.occupantId).toBe(BRUNO.id);
    expect((await desks.getDesk(deAna.id))?.occupantId).toBeNull();
  });
});

/**
 * Material and color are chosen when a desk is created and never again (art
 * migration, step 7). The catalog check runs in the route, before the port,
 * against the registered pack.
 */
describe('desk appearance, chosen only at creation (art step 7)', () => {
  const PACK = readArtPackManifest(new URL('../../../public/assets/pack/manifest.json', import.meta.url));

  /** Same wiring as `harness`, with the pack registered in the catalog the desks read decor from. */
  async function withCatalog() {
    const directory = createMemoryDirectory({ now: () => NOW, seed: [ADMIN, ANA, BRUNO, CADUCADO] });
    const decor = createMemoryDecor({ now: () => NOW });
    await decor.registerArtPack(PACK);
    const spaces = createMemorySpaces({ now: () => NOW });
    const desks = createMemoryDesks({ now: () => NOW, directory, decor, spaces: spaces.deskSpaces });
    const deps: DesksDeps = { directory, desks, decor, auth: verifier, now: () => NOW, log: () => {} };
    return { deps, desks, decor };
  }

  it('stores the chosen material and color with the desk, color normalized', async () => {
    const { deps, desks } = await withCatalog();

    const result = await handleCreateDesk(
      BEARER_ADMIN,
      { label: 'Mesa 1', x: 0, y: 0, materialId: 'desk-painted', color: '#C0392B' },
      deps,
    );

    expect(result.status).toBe(201);
    expect(result.body).toEqual(expect.objectContaining({ materialId: 'desk-painted', color: '#c0392b' }));
    const stored = await desks.getDesk(result.body.id as string);
    expect(stored).toEqual(expect.objectContaining({ materialId: 'desk-painted', color: '#c0392b' }));
  });

  it('a colorable material without a color takes its default color', async () => {
    const { deps } = await withCatalog();

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 1', x: 0, y: 0, materialId: 'desk-painted' }, deps);

    expect(result.body).toEqual(expect.objectContaining({ materialId: 'desk-painted', color: '#4f9a8a' }));
  });

  it('a non-colorable material keeps its own look, stored without a color', async () => {
    const { deps } = await withCatalog();

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 1', x: 0, y: 0, materialId: 'desk-metal' }, deps);

    expect(result.body).toEqual(expect.objectContaining({ materialId: 'desk-metal', color: null }));
  });

  it('without an appearance the desk takes the pack default', async () => {
    const { deps } = await withCatalog();

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 1', x: 0, y: 0 }, deps);

    expect(result.body).toEqual(expect.objectContaining({ materialId: 'desk-wood', color: null }));
  });

  it.each([
    ['unknown-piece', { materialId: 'desk-marble' }],
    ['unknown-piece', { materialId: 'floor-plain' }],
    ['color-not-allowed', { materialId: 'desk-wood', color: '#c0392b' }],
    ['invalid-color', { materialId: 'desk-painted', color: 'red' }],
  ])('rejects a choice the catalog does not allow with 400 invalid-appearance %s and creates nothing', async (reason, appearance) => {
    const { deps, desks } = await withCatalog();

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 1', x: 0, y: 0, ...appearance }, deps);

    expect(result).toEqual({ status: 400, body: { error: 'invalid-appearance', reason } });
    expect(await desks.listDesks()).toEqual([]);
  });

  it('a retired material cannot be chosen again', async () => {
    const { deps, desks, decor } = await withCatalog();
    await decor.registerArtPack({ ...PACK, pieces: PACK.pieces.filter((piece) => piece.id !== 'desk-metal') });

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 1', x: 0, y: 0, materialId: 'desk-metal' }, deps);

    expect(result).toEqual({ status: 400, body: { error: 'invalid-appearance', reason: 'retired-piece' } });
    expect(await desks.listDesks()).toEqual([]);
  });

  it('without a catalog an explicit choice cannot be checked, so it is refused', async () => {
    const { deps } = harness();

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 1', x: 0, y: 0, materialId: 'desk-painted' }, deps);

    expect(result).toEqual({ status: 400, body: { error: 'invalid-appearance', reason: 'unknown-piece' } });
  });

  it('the role guard still runs before the appearance is read', async () => {
    const { deps } = await withCatalog();

    const result = await handleCreateDesk(BEARER_ANA, { label: 'Mesa 1', x: 0, y: 0, materialId: 'desk-marble' }, deps);

    expect(result.status).toBe(403);
  });

  it.each([
    [{ materialId: 'desk-glass' }],
    [{ color: '#000000' }],
    [{ label: 'Mesa movida', materialId: 'desk-painted', color: '#c0392b' }],
  ])('an update that mentions the appearance answers 400 appearance-immutable and changes nothing', async (patch) => {
    const { deps, desks } = await withCatalog();
    const created = await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0, appearance: { materialId: 'desk-painted', color: '#c0392b' } });

    const result = await handleUpdateDesk(BEARER_ADMIN, created.id, patch, deps);

    expect(result).toEqual({ status: 400, body: { error: 'appearance-immutable' } });
    expect(await desks.getDesk(created.id)).toEqual(
      expect.objectContaining({ label: 'Mesa 1', materialId: 'desk-painted', color: '#c0392b' }),
    );
  });

  it('moving, renaming, claiming and releasing keep the appearance; the decor follows the person', async () => {
    const { deps, desks, decor } = await withCatalog();
    const painted = await handleCreateDesk(
      BEARER_ADMIN,
      { label: 'Mesa 1', x: 0, y: 0, materialId: 'desk-painted', color: '#c0392b' },
      deps,
    );
    const glass = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 2', x: 8, y: 0, materialId: 'desk-glass' }, deps);
    const paintedId = painted.body.id as string;
    const glassId = glass.body.id as string;
    const plant = await decor.createAsset({ name: 'Planta', kind: 'plant', textureKey: 'plant-large', w: 1, h: 1, placeableOnDesk: true });
    await decor.replaceDeskConfig(ANA.id, [{ assetId: plant.id, slot: 0, rotation: 0 }]);

    expect((await handleUpdateDesk(BEARER_ADMIN, paintedId, { x: 4, y: 4 }, deps)).status).toBe(200);
    expect((await handleUpdateDesk(BEARER_ADMIN, paintedId, { label: 'Mesa roja' }, deps)).status).toBe(200);
    expect((await handleClaimDesk(BEARER_ANA, paintedId, deps)).status).toBe(200);
    // Ana moving to another desk takes her decor along, never the furniture color.
    expect((await handleClaimDesk(BEARER_ANA, glassId, deps)).status).toBe(200);

    const seated = await handleListDesks(BEARER_BRUNO, deps);
    expect(seated.body.desks).toEqual([
      expect.objectContaining({ id: paintedId, label: 'Mesa roja', x: 4, y: 4, materialId: 'desk-painted', color: '#c0392b', occupant: null }),
      expect.objectContaining({
        id: glassId,
        materialId: 'desk-glass',
        color: null,
        occupant: expect.objectContaining({ id: ANA.id, items: [expect.objectContaining({ assetId: plant.id })] }),
      }),
    ]);

    expect((await handleReleaseDesk(BEARER_ANA, deps)).status).toBe(200);
    expect(await desks.getDesk(paintedId)).toEqual(expect.objectContaining({ materialId: 'desk-painted', color: '#c0392b' }));
    expect(await desks.getDesk(glassId)).toEqual(expect.objectContaining({ materialId: 'desk-glass', color: null, occupantId: null }));
  });
});
