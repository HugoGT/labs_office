/**
 * El segundo adaptador de `DecorCatalog`, probado por COMPORTAMIENTO y no por
 * la forma de su SQL (que no tiene). Mismo papel y misma justificacion que
 * `memorySpaces.test.ts`.
 *
 * Lo que mas se vigila aqui es la regla de archivados de D1b, y no por
 * completitud: las rutas de la slice se prueban contra ESTE adaptador, asi que
 * si aqui `getDeskConfig` filtrase por archivados y en `pgDecor` no, la suite
 * entera estaria certificando un comportamiento que produccion no tiene. Un
 * test que pasa contra memoria y falla contra Postgres es peor que ningun test.
 */

import { describe, expect, it } from 'vitest';
import type { Asset } from './decorPort.ts';
import { AssetNameTakenError, InvalidAssetError, InvalidDeskConfigError } from './decorRules.ts';
import { createMemoryDecor } from './memoryDecor.ts';

const NOW = new Date('2026-01-15T12:00:00.000Z');

function asset(overrides: Partial<Asset> & Pick<Asset, 'id'>): Asset {
  return {
    slug: overrides.id,
    name: overrides.id,
    kind: 'decor',
    textureKey: `${overrides.id}-tex`,
    w: 1,
    h: 1,
    placeableOnDesk: true,
    aboveAvatars: false,
    archivedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

const PLANTA = asset({ id: 'asset-planta', slug: 'planta', name: 'Planta', kind: 'plant' });
const SOFA = asset({ id: 'asset-sofa', slug: 'sofa', name: 'Sofa', placeableOnDesk: false });
const USER = 'user-hugo';

function decor(seed: readonly Asset[] = [PLANTA, SOFA]) {
  return createMemoryDecor({ seed, now: () => NOW });
}

describe('createMemoryDecor: listAssets', () => {
  it('arranca vacio sin semilla', async () => {
    expect(await createMemoryDecor().listAssets()).toEqual([]);
  });

  it('devuelve la semilla en orden deterministico (kind, slug, id), igual que pgDecor', async () => {
    const catalog = decor();

    expect((await catalog.listAssets()).map((a) => a.id)).toEqual([SOFA.id, PLANTA.id]);
  });

  it('filtra los archivados por defecto (D1b)', async () => {
    const catalog = decor([PLANTA, { ...SOFA, archivedAt: NOW }]);

    expect((await catalog.listAssets()).map((a) => a.id)).toEqual([PLANTA.id]);
  });

  it('con includeArchived los devuelve todos', async () => {
    const catalog = decor([PLANTA, { ...SOFA, archivedAt: NOW }]);

    expect((await catalog.listAssets({ includeArchived: true })).map((a) => a.id)).toEqual([
      SOFA.id,
      PLANTA.id,
    ]);
  });
});

describe('createMemoryDecor: createAsset', () => {
  it('deriva el slug del nombre, igual que el adaptador de Postgres', async () => {
    const created = await decor().createAsset({
      name: 'Planta Grande',
      kind: 'plant',
      textureKey: 'plant-large',
      w: 1,
      h: 1,
      placeableOnDesk: true,
    });

    expect(created.slug).toBe('planta-grande');
    expect(created.name).toBe('Planta Grande');
    expect(created.archivedAt).toBeNull();
    expect(created.createdAt).toEqual(NOW);
  });

  it('rechaza un nombre repetido que solo difiere en mayusculas', async () => {
    // `assets_slug_unique` esta sobre `lower(slug)` y el slug se deriva del
    // nombre, asi que "Planta" y "PLANTA" son la misma pieza para Postgres. Sin
    // esto, la ruta pasaria el test contra memoria y daria 500 en produccion.
    await expect(
      decor().createAsset({
        name: 'PLANTA',
        kind: 'plant',
        textureKey: 'plant',
        w: 1,
        h: 1,
        placeableOnDesk: true,
      }),
    ).rejects.toThrow(AssetNameTakenError);
  });

  it('un asset retirado sigue ocupando su nombre', async () => {
    // El indice unico de `schema.sql` NO es parcial: la fila archivada sigue
    // ahi con su slug. Dejar que memoria lo reutilizase haria pasar un alta que
    // Postgres rechaza (D1b: archivar no borra).
    const catalog = decor();
    await catalog.archiveAsset(PLANTA.id);

    await expect(
      catalog.createAsset({
        name: 'Planta',
        kind: 'plant',
        textureKey: 'plant',
        w: 1,
        h: 1,
        placeableOnDesk: true,
      }),
    ).rejects.toThrow(AssetNameTakenError);
  });

  it('comparte decorRules con pgDecor: un tipo invalido se rechaza igual', async () => {
    await expect(
      decor().createAsset({
        name: 'X',
        kind: 'rug' as unknown as 'plant',
        textureKey: 'x',
        w: 1,
        h: 1,
        placeableOnDesk: true,
      }),
    ).rejects.toThrow(InvalidAssetError);
  });

  it('el asset creado ya sale en el catalogo', async () => {
    const catalog = createMemoryDecor({ now: () => NOW });
    await catalog.createAsset({
      name: 'Planta',
      kind: 'plant',
      textureKey: 'plant',
      w: 1,
      h: 1,
      placeableOnDesk: true,
    });

    expect(await catalog.listAssets()).toHaveLength(1);
  });
});

describe('createMemoryDecor: archiveAsset', () => {
  it('marca archivedAt y lo saca del catalogo, sin borrarlo', async () => {
    const catalog = decor();

    const archived = await catalog.archiveAsset(PLANTA.id);

    expect(archived?.archivedAt).toEqual(NOW);
    expect((await catalog.listAssets()).map((a) => a.id)).toEqual([SOFA.id]);
    expect((await catalog.listAssets({ includeArchived: true })).map((a) => a.id)).toContain(
      PLANTA.id,
    );
  });

  it('devuelve null cuando el id no existe', async () => {
    expect(await decor().archiveAsset('no-existe')).toBeNull();
  });

  it('no toca las colocaciones ya existentes (D1b)', async () => {
    // Es la propiedad entera de la decision: archivar dice que pieza se puede
    // colocar MANANA, no reescribe el escritorio de quien ya la puso.
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);

    await catalog.archiveAsset(PLANTA.id);

    const items = await catalog.getDeskConfig(USER);
    expect(items).toHaveLength(1);
    expect(items[0].textureKey).toBe(PLANTA.textureKey);
  });
});

describe('createMemoryDecor: aboveAvatars (#71)', () => {
  it('a created asset is normal unless it asks otherwise', async () => {
    const catalog = decor();
    const base = { kind: 'decor' as const, textureKey: 'x', w: 1, h: 1, placeableOnDesk: true };

    expect((await catalog.createAsset({ ...base, name: 'Normal' })).aboveAvatars).toBe(false);
    expect((await catalog.createAsset({ ...base, name: 'Arco', aboveAvatars: true })).aboveAvatars).toBe(
      true,
    );
  });

  it('updateAsset marks and unmarks an asset, and the catalog reflects it', async () => {
    const catalog = decor();

    expect((await catalog.updateAsset(PLANTA.id, { aboveAvatars: true }))?.aboveAvatars).toBe(true);
    expect((await catalog.listAssets()).find((a) => a.id === PLANTA.id)?.aboveAvatars).toBe(true);

    expect((await catalog.updateAsset(PLANTA.id, { aboveAvatars: false }))?.aboveAvatars).toBe(false);
  });

  it('updateAsset leaves every other field untouched', async () => {
    const catalog = decor();

    expect(await catalog.updateAsset(PLANTA.id, { aboveAvatars: true })).toEqual({
      ...PLANTA,
      aboveAvatars: true,
    });
  });

  it('updateAsset returns null for an unknown id', async () => {
    expect(await decor().updateAsset('no-existe', { aboveAvatars: true })).toBeNull();
  });

  it('updateAsset shares decorRules with pgDecor: a non-boolean flag is rejected', async () => {
    await expect(
      decor().updateAsset(PLANTA.id, { aboveAvatars: 'si' as unknown as boolean }),
    ).rejects.toThrow(InvalidAssetError);
  });

  it('a placed piece picks up the new layer on the next read', async () => {
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);

    await catalog.updateAsset(PLANTA.id, { aboveAvatars: true });

    expect((await catalog.getDeskConfig(USER))[0].aboveAvatars).toBe(true);
  });
});

describe('createMemoryDecor: getDeskConfig', () => {
  it('un escritorio sin configurar es una lista vacia, no un error', async () => {
    expect(await decor().getDeskConfig('nadie')).toEqual([]);
  });

  it('resuelve los campos del asset que hacen falta para pintar', async () => {
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 2, rotation: 90 }]);

    expect(await catalog.getDeskConfig(USER)).toEqual([
      {
        id: expect.any(String),
        assetId: PLANTA.id,
        slot: 2,
        rotation: 90,
        textureKey: PLANTA.textureKey,
        w: PLANTA.w,
        h: PLANTA.h,
        name: PLANTA.name,
        aboveAvatars: false,
        createdAt: NOW,
      },
    ]);
  });

  it('resolves aboveAvatars from the asset, so the scene knows the render layer (#71)', async () => {
    const ARCO = asset({ id: 'asset-arco', aboveAvatars: true });
    const catalog = decor([PLANTA, ARCO]);
    await catalog.replaceDeskConfig(USER, [
      { assetId: PLANTA.id, slot: 0, rotation: 0 },
      { assetId: ARCO.id, slot: 1, rotation: 0 },
    ]);

    expect((await catalog.getDeskConfig(USER)).map((item) => item.aboveAvatars)).toEqual([
      false,
      true,
    ]);
  });

  it('ordena por slot, igual que el ORDER BY de pgDecor', async () => {
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [
      { assetId: PLANTA.id, slot: 4, rotation: 0 },
      { assetId: PLANTA.id, slot: 1, rotation: 0 },
    ]);

    expect((await catalog.getDeskConfig(USER)).map((item) => item.slot)).toEqual([1, 4]);
  });

  it('el escritorio de una persona no se ve desde el de otra', async () => {
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);

    expect(await catalog.getDeskConfig('otra-persona')).toEqual([]);
  });
});

describe('createMemoryDecor: replaceDeskConfig', () => {
  it('reemplaza entero: lo que no viene en la lista deja de estar', async () => {
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [
      { assetId: PLANTA.id, slot: 0, rotation: 0 },
      { assetId: PLANTA.id, slot: 1, rotation: 0 },
    ]);

    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 1, rotation: 180 }]);

    expect((await catalog.getDeskConfig(USER)).map((item) => item.slot)).toEqual([1]);
  });

  it('una lista vacia deja el escritorio pelado', async () => {
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);

    expect(await catalog.replaceDeskConfig(USER, [])).toEqual([]);
    expect(await catalog.getDeskConfig(USER)).toEqual([]);
  });

  it('rechaza dos items en el mismo slot, igual que el indice unico de schema.sql', async () => {
    await expect(
      decor().replaceDeskConfig(USER, [
        { assetId: PLANTA.id, slot: 0, rotation: 0 },
        { assetId: PLANTA.id, slot: 0, rotation: 90 },
      ]),
    ).rejects.toThrow(InvalidDeskConfigError);
  });

  it('rechaza un slot fuera de rango y una rotacion invalida', async () => {
    await expect(
      decor().replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 9, rotation: 0 }]),
    ).rejects.toThrow(InvalidDeskConfigError);
    await expect(
      decor().replaceDeskConfig(USER, [
        { assetId: PLANTA.id, slot: 0, rotation: 45 as unknown as 0 },
      ]),
    ).rejects.toThrow(InvalidDeskConfigError);
  });

  it('rechaza un asset que no es colocable en un escritorio', async () => {
    await expect(
      decor().replaceDeskConfig(USER, [{ assetId: SOFA.id, slot: 0, rotation: 0 }]),
    ).rejects.toThrow(InvalidDeskConfigError);
  });

  it('rechaza un assetId que no existe', async () => {
    await expect(
      decor().replaceDeskConfig(USER, [{ assetId: 'no-existe', slot: 0, rotation: 0 }]),
    ).rejects.toThrow(InvalidDeskConfigError);
  });

  it('un rechazo no deja el escritorio a medias', async () => {
    // El equivalente del ROLLBACK de `pgDecor`: si el segundo item es
    // invalido, el primero tampoco entra.
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 5, rotation: 0 }]);

    await expect(
      catalog.replaceDeskConfig(USER, [
        { assetId: PLANTA.id, slot: 0, rotation: 0 },
        { assetId: SOFA.id, slot: 1, rotation: 0 },
      ]),
    ).rejects.toThrow(InvalidDeskConfigError);

    expect((await catalog.getDeskConfig(USER)).map((item) => item.slot)).toEqual([5]);
  });

  /**
   * D1b entero: una pieza retirada se conserva, se puede quitar y no se puede
   * volver a anadir. Mismo comportamiento que `pgDecor`, y no por simetria
   * decorativa: las rutas se prueban contra ESTE adaptador, asi que si aqui
   * bastase con que el asset existiera, la suite certificaria una permisividad
   * que produccion no tiene.
   */
  it('conserva un asset archivado que la persona ya tenia puesto (D1b)', async () => {
    // Si esto fallase, mover una pieza cualquiera le borraria a esa persona la
    // retirada que ya tenia, sin que hubiese pedido nada de eso.
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);
    await catalog.archiveAsset(PLANTA.id);

    const items = await catalog.replaceDeskConfig(USER, [
      { assetId: PLANTA.id, slot: 0, rotation: 0 },
    ]);

    expect(items).toHaveLength(1);
  });

  it('rechaza anadir un asset archivado que no estaba en ese escritorio (D1b)', async () => {
    const catalog = decor();
    await catalog.archiveAsset(PLANTA.id);

    await expect(
      catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]),
    ).rejects.toThrow(InvalidDeskConfigError);
  });

  it('mover de slot o girar una pieza retirada retenida sigue valiendo', async () => {
    // Retener no es recolocar: es el mismo asset id, asi que cambiar su hueco
    // no es volver a anadirlo.
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);
    await catalog.archiveAsset(PLANTA.id);

    const items = await catalog.replaceDeskConfig(USER, [
      { assetId: PLANTA.id, slot: 5, rotation: 270 },
    ]);

    expect(items).toEqual([expect.objectContaining({ slot: 5, rotation: 270 })]);
  });

  it('quitar una pieza retirada se puede, y luego ya no se puede recuperar', async () => {
    // Las dos mitades de la frase del diseno, en el mismo test: se puede
    // quitar, y una vez fuera no vuelve.
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);
    await catalog.archiveAsset(PLANTA.id);

    expect(await catalog.replaceDeskConfig(USER, [])).toEqual([]);
    await expect(
      catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]),
    ).rejects.toThrow(InvalidDeskConfigError);
  });

  it('el escritorio de otra persona no sirve para retener: la retencion es por escritorio', async () => {
    const catalog = decor();
    await catalog.replaceDeskConfig(USER, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);
    await catalog.archiveAsset(PLANTA.id);

    await expect(
      catalog.replaceDeskConfig('otra-persona', [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]),
    ).rejects.toThrow(InvalidDeskConfigError);
  });
});
