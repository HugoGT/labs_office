/**
 * El segundo adaptador de `SpacesDirectory`, probado por COMPORTAMIENTO y no
 * por la forma de su SQL (que no tiene). Lo que se afirma aqui es que comparte
 * de verdad `spaceRules.ts` con `pgSpaces.ts`: si un dia uno de los dos dejase
 * de validar, o derivase otro slug, o hasheara otra cosa, las rutas probadas
 * contra este adaptador dejarian de decir nada sobre las que corren contra
 * Postgres.
 */

import { describe, expect, it } from 'vitest';
import { DeskSpaceOverlapError } from '../desks/deskRules.ts';
import { createMemorySpaces } from './memorySpaces.ts';
import {
  InvalidSpaceError,
  SpaceNameTakenError,
  SpaceOverlapError,
  SpaceOwnedByDeskError,
  hashSpaces,
} from './spaceRules.ts';
import { BUILT_IN_SEED_SPACES, BUILT_IN_SEED_VERSION } from './builtInSeed.ts';

describe('createMemorySpaces', () => {
  it('arranca vacio y su version es la del hash de la lista vacia', async () => {
    const spaces = createMemorySpaces();

    expect(await spaces.listSpaces()).toEqual([]);
    expect(await spaces.version()).toBe(hashSpaces([]));
  });

  it('sembrado con los espacios incorporados reproduce BUILT_IN_SEED_VERSION', async () => {
    // Es la comprobacion que ata este adaptador al despliegue real: `schema.sql`
    // inserta esa misma semilla, asi que un cliente en modo fallback y este
    // adaptador tienen que coincidir en version.
    const spaces = createMemorySpaces({ seed: BUILT_IN_SEED_SPACES });

    expect(await spaces.version()).toBe(BUILT_IN_SEED_VERSION);
  });

  it('createSpace deriva el slug del nombre, igual que el adaptador de Postgres', async () => {
    const spaces = createMemorySpaces();

    const created = await spaces.createSpace({ name: 'Sala de Juntas', x: 1, y: 1, w: 4, h: 4, capacity: null });

    expect(created.slug).toBe('sala-de-juntas');
    expect(created.name).toBe('Sala de Juntas');
  });

  it('createSpace rechaza un rectangulo invalido con InvalidSpaceError', async () => {
    const spaces = createMemorySpaces();

    await expect(
      spaces.createSpace({ name: 'Mala', x: 1, y: 1, w: 0, h: 4, capacity: null }),
    ).rejects.toThrow(InvalidSpaceError);
  });

  it('createSpace rechaza un solape con SpaceOverlapError', async () => {
    const spaces = createMemorySpaces();
    await spaces.createSpace({ name: 'Primera', x: 10, y: 10, w: 5, h: 5, capacity: null });

    await expect(
      spaces.createSpace({ name: 'Encima', x: 12, y: 12, w: 5, h: 5, capacity: null }),
    ).rejects.toThrow(SpaceOverlapError);
  });

  it('createSpace rechaza un nombre repetido que solo difiere en mayusculas', async () => {
    // `spaces_name_unique` esta sobre `lower(name)`: para Postgres "Cafeteria"
    // y "CAFETERIA" son la misma sala. Si este adaptador no lo reprodujese, la
    // ruta pasaria el test contra memoria y devolveria un 500 en produccion.
    const spaces = createMemorySpaces();
    await spaces.createSpace({ name: 'Cafeteria', x: 1, y: 1, w: 4, h: 4, capacity: null });

    await expect(
      spaces.createSpace({ name: 'CAFETERIA', x: 30, y: 1, w: 4, h: 4, capacity: null }),
    ).rejects.toThrow(SpaceNameTakenError);
  });

  it('createSpace rechaza dos nombres distintos que derivan el mismo slug', async () => {
    // `spaces_slug_unique` muerde donde `spaces_name_unique` no llega: "Sala A"
    // y "Sala-A" son nombres distintos hasta para `lower()`, pero el slug
    // derivado es el mismo y el indice de slug los rechaza igual.
    const spaces = createMemorySpaces();
    await spaces.createSpace({ name: 'Sala A', x: 1, y: 1, w: 4, h: 4, capacity: null });

    await expect(
      spaces.createSpace({ name: 'Sala-A', x: 30, y: 1, w: 4, h: 4, capacity: null }),
    ).rejects.toThrow(SpaceNameTakenError);
  });

  it('updateSpace rechaza renombrar a un nombre que ya es de otro espacio', async () => {
    const spaces = createMemorySpaces();
    await spaces.createSpace({ name: 'Cafeteria', x: 1, y: 1, w: 4, h: 4, capacity: null });
    const otra = await spaces.createSpace({ name: 'War Room', x: 30, y: 1, w: 4, h: 4, capacity: null });

    await expect(spaces.updateSpace(otra.id, { name: 'cafeteria' })).rejects.toThrow(
      SpaceNameTakenError,
    );
  });

  it('updateSpace no cuenta el espacio consigo mismo al comprobar el nombre', async () => {
    // Cambiarle las mayusculas a su propio nombre no choca con nadie: en
    // Postgres el UPDATE reemplaza la entrada del indice de esa misma fila. Sin
    // esta exclusion, corregir "cafeteria" a "Cafeteria" seria imposible.
    const spaces = createMemorySpaces();
    const created = await spaces.createSpace({ name: 'cafeteria', x: 1, y: 1, w: 4, h: 4, capacity: null });

    const updated = await spaces.updateSpace(created.id, { name: 'Cafeteria' });

    expect(updated?.name).toBe('Cafeteria');
  });

  it('la version cambia al renombrar: el nombre entra en el hash canonico', async () => {
    const spaces = createMemorySpaces();
    const created = await spaces.createSpace({ name: 'Antes', x: 1, y: 1, w: 4, h: 4, capacity: null });
    const before = await spaces.version();

    await spaces.updateSpace(created.id, { name: 'Despues' });

    expect(await spaces.version()).not.toBe(before);
  });

  it('renombrar NO cambia el id: es la promesa de la reclave de la rebanada 2', async () => {
    const spaces = createMemorySpaces();
    const created = await spaces.createSpace({ name: 'Antes', x: 1, y: 1, w: 4, h: 4, capacity: null });

    const updated = await spaces.updateSpace(created.id, { name: 'Despues' });

    expect(updated?.id).toBe(created.id);
  });

  it('updateSpace devuelve null para un id que no existe', async () => {
    const spaces = createMemorySpaces();

    expect(await spaces.updateSpace('no-existe', { name: 'X' })).toBeNull();
  });

  it('updateSpace no cuenta el espacio consigo mismo al comprobar el solape', async () => {
    // Mover un espacio a un sitio que se solapa con SU PROPIA posicion previa
    // es legal: el rectangulo viejo deja de existir en el mismo movimiento.
    const spaces = createMemorySpaces();
    const created = await spaces.createSpace({ name: 'Una', x: 10, y: 10, w: 5, h: 5, capacity: null });

    const moved = await spaces.updateSpace(created.id, { x: 11, y: 11, w: 5, h: 5 });

    expect(moved?.x).toBe(11);
  });

  it('deleteSpace devuelve true la primera vez y false la segunda', async () => {
    const spaces = createMemorySpaces();
    const created = await spaces.createSpace({ name: 'Una', x: 1, y: 1, w: 4, h: 4, capacity: null });

    expect(await spaces.deleteSpace(created.id)).toBe(true);
    expect(await spaces.deleteSpace(created.id)).toBe(false);
  });

  it('listSpaces ordena por (x, y, id), igual que el adaptador de Postgres', async () => {
    const spaces = createMemorySpaces();
    await spaces.createSpace({ name: 'Lejos', x: 30, y: 1, w: 4, h: 4, capacity: null });
    await spaces.createSpace({ name: 'Cerca', x: 1, y: 1, w: 4, h: 4, capacity: null });

    expect((await spaces.listSpaces()).map((space) => space.name)).toEqual(['Cerca', 'Lejos']);
  });

  it('replaceLayout sustituye el layout entero del espacio', async () => {
    const spaces = createMemorySpaces();
    const created = await spaces.createSpace({ name: 'Una', x: 1, y: 1, w: 4, h: 4, capacity: null });
    await spaces.replaceLayout(created.id, [{ assetId: 'a-1', x: 0, y: 0, rotation: 0, zIndex: 0 }]);

    await spaces.replaceLayout(created.id, [{ assetId: 'a-2', x: 1, y: 1, rotation: 90, zIndex: 1 }]);

    expect((await spaces.listLayout(created.id)).map((item) => item.assetId)).toEqual(['a-2']);
  });

  it('borrar un espacio se lleva su layout, como la cascada de schema.sql', async () => {
    const spaces = createMemorySpaces();
    const created = await spaces.createSpace({ name: 'Una', x: 1, y: 1, w: 4, h: 4, capacity: null });
    await spaces.replaceLayout(created.id, [{ assetId: 'a-1', x: 0, y: 0, rotation: 0, zIndex: 0 }]);

    await spaces.deleteSpace(created.id);

    expect(await spaces.listLayout(created.id)).toEqual([]);
  });

  it('createSpace NO choca de nombre con un cubiculo de escritorio: el indice parcial solo protege salas (#10 + #12)', async () => {
    // `spaces_room_name_unique` de `schema.sql` (S1a) es `WHERE desk_id IS
    // NULL`: solo compara salas entre si. Un escritorio llamado igual que una
    // sala nueva no tiene por que chocar.
    const spaces = createMemorySpaces();
    spaces.deskSpaces.upsertDeskSpace({ id: 'd1', label: 'Sala de Juntas', x: 0, y: 0 });

    const created = await spaces.createSpace({
      name: 'Sala de Juntas',
      x: 30,
      y: 1,
      w: 4,
      h: 4,
      capacity: null,
    });

    expect(created.name).toBe('Sala de Juntas');
  });

  it('updateSpace rechaza un cubiculo de escritorio con SpaceOwnedByDeskError, no un 500 (#10 + #12)', async () => {
    // Mirroring de `pgSpaces.updateSpace` (S1a, pgSpaces.ts:164-208): un
    // cubiculo NO se administra por esta ruta, solo como efecto secundario del
    // CRUD de escritorios.
    const spaces = createMemorySpaces();
    spaces.deskSpaces.upsertDeskSpace({ id: 'd1', label: 'Mesa 1', x: 0, y: 0 });
    const [cubiculo] = await spaces.listSpaces();

    await expect(spaces.updateSpace(cubiculo.id, { name: 'Otra cosa' })).rejects.toThrow(
      SpaceOwnedByDeskError,
    );
  });

  it('updateSpace sigue devolviendo null para un id que no existe, y no SpaceOwnedByDeskError', async () => {
    const spaces = createMemorySpaces();

    expect(await spaces.updateSpace('no-existe', { name: 'X' })).toBeNull();
  });

  it('deleteSpace rechaza un cubiculo de escritorio con SpaceOwnedByDeskError, no un 500 (#10 + #12)', async () => {
    const spaces = createMemorySpaces();
    spaces.deskSpaces.upsertDeskSpace({ id: 'd1', label: 'Mesa 1', x: 0, y: 0 });
    const [cubiculo] = await spaces.listSpaces();

    await expect(spaces.deleteSpace(cubiculo.id)).rejects.toThrow(SpaceOwnedByDeskError);
  });

  it('deleteSpace sigue devolviendo false para un id que no existe', async () => {
    const spaces = createMemorySpaces();

    expect(await spaces.deleteSpace('no-existe')).toBe(false);
  });
});

describe('createMemorySpaces: deskSpaces (#10 + #12, tarea 2.5)', () => {
  it('upsertDeskSpace crea el cubiculo la primera vez: 3x3, sin capacidad, emparejado por deskId', async () => {
    const spaces = createMemorySpaces();

    spaces.deskSpaces.upsertDeskSpace({ id: 'd1', label: 'Mesa 1', x: 4, y: 6 });

    const [cubiculo] = await spaces.listSpaces();
    expect(cubiculo).toMatchObject({
      name: 'Mesa 1',
      x: 4,
      y: 6,
      w: 3,
      h: 3,
      capacity: null,
      deskId: 'd1',
    });
  });

  it('upsertDeskSpace MUEVE el mismo cubiculo la segunda vez, no crea uno nuevo', async () => {
    const spaces = createMemorySpaces();
    spaces.deskSpaces.upsertDeskSpace({ id: 'd1', label: 'Mesa 1', x: 4, y: 6 });
    const [primero] = await spaces.listSpaces();

    spaces.deskSpaces.upsertDeskSpace({ id: 'd1', label: 'Mesa 1', x: 8, y: 9 });

    const listado = await spaces.listSpaces();
    expect(listado).toHaveLength(1);
    expect(listado[0]).toMatchObject({ id: primero.id, x: 8, y: 9 });
  });

  it('assertDeskFits rechaza con DeskSpaceOverlapError si el area 3x3 choca con una sala', async () => {
    const spaces = createMemorySpaces({
      seed: [{ id: 'sala-1', slug: 'sala-1', name: 'Sala de Juntas', x: 50, y: 2, w: 13, h: 14, capacity: null }],
    });

    expect(() => spaces.deskSpaces.assertDeskFits({ id: 'd1', x: 50, y: 2 })).toThrow(
      DeskSpaceOverlapError,
    );
  });

  it('assertDeskFits NO cuenta el cubiculo del propio escritorio: moverse dentro de su propia area es legal', async () => {
    // Mismo argumento que `assertNoOverlap`/`exceptId`: el rectangulo viejo
    // deja de existir en el mismo movimiento.
    const spaces = createMemorySpaces();
    spaces.deskSpaces.upsertDeskSpace({ id: 'd1', label: 'Mesa 1', x: 4, y: 6 });

    expect(() => spaces.deskSpaces.assertDeskFits({ id: 'd1', x: 5, y: 6 })).not.toThrow();
  });

  it('removeDeskSpace borra el cubiculo emparejado', async () => {
    const spaces = createMemorySpaces();
    spaces.deskSpaces.upsertDeskSpace({ id: 'd1', label: 'Mesa 1', x: 4, y: 6 });

    spaces.deskSpaces.removeDeskSpace('d1');

    expect(await spaces.listSpaces()).toEqual([]);
  });

  it('removeDeskSpace sin cubiculo emparejado no es un error: idempotente, como releaseDesk', async () => {
    const spaces = createMemorySpaces();

    expect(() => spaces.deskSpaces.removeDeskSpace('no-existe')).not.toThrow();
  });
});
