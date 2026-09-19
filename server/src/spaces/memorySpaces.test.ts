/**
 * El segundo adaptador de `SpacesDirectory`, probado por COMPORTAMIENTO y no
 * por la forma de su SQL (que no tiene). Lo que se afirma aqui es que comparte
 * de verdad `spaceRules.ts` con `pgSpaces.ts`: si un dia uno de los dos dejase
 * de validar, o derivase otro slug, o hasheara otra cosa, las rutas probadas
 * contra este adaptador dejarian de decir nada sobre las que corren contra
 * Postgres.
 */

import { describe, expect, it } from 'vitest';
import { createMemorySpaces } from './memorySpaces.ts';
import { InvalidSpaceError, SpaceOverlapError, hashSpaces } from './spaceRules.ts';
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
});
