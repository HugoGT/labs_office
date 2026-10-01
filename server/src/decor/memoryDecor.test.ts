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

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ArtPackManifest, ArtPiece } from '../../../src/game/artContract.ts';
import { ArtPieceExistsError, InvalidArtPackError } from './artCatalogRules.ts';
import { InvalidArtTransitionError } from './artReviewRules.ts';
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

describe('createMemoryDecor: art pack catalog (art migration, step 3)', () => {
  const PACK: ArtPackManifest = JSON.parse(
    readFileSync(new URL('../../../public/assets/pack/manifest.json', import.meta.url), 'utf8'),
  );
  const LATER = new Date('2026-02-01T00:00:00.000Z');

  function withoutPiece(id: string): ArtPackManifest {
    return { ...PACK, pieces: PACK.pieces.filter((piece) => piece.id !== id) };
  }

  it('starts with an empty catalog', async () => {
    expect(await createMemoryDecor().listArtPieces()).toEqual([]);
  });

  it('registers every piece under its manifest id, with its metadata and files', async () => {
    const catalog = decor();
    const result = await catalog.registerArtPack(PACK);

    expect(result).toEqual({ registered: PACK.pieces.length, retired: [] });
    const pieces = await catalog.listArtPieces();
    expect(pieces.map((piece) => piece.id).sort()).toEqual(PACK.pieces.map((piece) => piece.id).sort());
    expect(pieces.find((piece) => piece.id === 'desk-painted')).toMatchObject({
      kind: 'desk',
      name: PACK.pieces.find((piece) => piece.id === 'desk-painted')!.name,
      material: 'painted',
      colorable: true,
      defaultColor: '#4f9a8a',
      contractVersion: PACK.contractVersion,
      retiredAt: null,
      registeredAt: NOW,
    });
    const mateo = pieces.find((piece) => piece.id === 'character-p01-burgundy-suit')!;
    expect(mateo).toMatchObject({ kind: 'character', material: null, colorable: false, defaultColor: null });
    expect(mateo.files).toEqual(PACK.pieces.find((piece) => piece.id === mateo.id)!.files);
    expect(mateo.spec).toEqual(PACK.pieces.find((piece) => piece.id === mateo.id));
  });

  it('seeds the new terrain materials, the tileset and the map props from the pack with no code change', async () => {
    const catalog = decor();
    await catalog.registerArtPack(PACK);
    const pieces = await catalog.listArtPieces();
    const ids = pieces.map((piece) => piece.id);
    for (const id of ['floor-dirt', 'floor-sand', 'floor-cobblestone', 'floor-tile', 'floor-carpet', 'tileset-terrain']) expect(ids).toContain(id);
    for (const kind of ['tree', 'plant', 'bridge', 'hedge', 'table']) expect(pieces.some((piece) => piece.kind === kind), kind).toBe(true);
    expect(pieces.find((piece) => piece.id === 'bridge-wood')).toMatchObject({ kind: 'bridge', material: 'wood', contractVersion: PACK.contractVersion });
  });

  it('lists in a deterministic (kind, id) order, same as pgDecor', async () => {
    const catalog = decor();
    await catalog.registerArtPack(PACK);
    const ids = (await catalog.listArtPieces()).map((piece) => `${piece.kind}/${piece.id}`);
    expect(ids).toEqual([...ids].sort());
  });

  it('registering the same pack twice changes nothing', async () => {
    let clock = NOW;
    const catalog = createMemoryDecor({ now: () => clock });
    await catalog.registerArtPack(PACK);
    const first = await catalog.listArtPieces();

    clock = LATER;
    expect(await catalog.registerArtPack(PACK)).toEqual({ registered: PACK.pieces.length, retired: [] });
    expect(await catalog.listArtPieces()).toEqual(first);
  });

  it('retires a piece that a newer pack no longer ships, instead of deleting it', async () => {
    let clock = NOW;
    const catalog = createMemoryDecor({ now: () => clock });
    await catalog.registerArtPack(PACK);

    clock = LATER;
    const result = await catalog.registerArtPack(withoutPiece('desk-glass'));

    expect(result).toEqual({ registered: PACK.pieces.length - 1, retired: ['desk-glass'] });
    expect((await catalog.listArtPieces()).some((piece) => piece.id === 'desk-glass')).toBe(false);
    const all = await catalog.listArtPieces({ includeRetired: true });
    expect(all.find((piece) => piece.id === 'desk-glass')).toMatchObject({ retiredAt: LATER, registeredAt: NOW });
  });

  it('does not retire an already retired piece again', async () => {
    let clock = NOW;
    const catalog = createMemoryDecor({ now: () => clock });
    await catalog.registerArtPack(PACK);
    clock = LATER;
    await catalog.registerArtPack(withoutPiece('desk-glass'));

    clock = new Date('2026-03-01T00:00:00.000Z');
    expect(await catalog.registerArtPack(withoutPiece('desk-glass'))).toEqual({
      registered: PACK.pieces.length - 1,
      retired: [],
    });
    const glass = (await catalog.listArtPieces({ includeRetired: true })).find((piece) => piece.id === 'desk-glass');
    expect(glass?.retiredAt).toEqual(LATER);
  });

  it('brings a retired piece back when a pack ships it again', async () => {
    const catalog = decor();
    await catalog.registerArtPack(PACK);
    await catalog.registerArtPack(withoutPiece('desk-glass'));

    await catalog.registerArtPack(PACK);

    expect((await catalog.listArtPieces()).find((piece) => piece.id === 'desk-glass')?.retiredAt).toBeNull();
  });

  it('updates the metadata of a piece in place, keeping its identity', async () => {
    let clock = NOW;
    const catalog = createMemoryDecor({ now: () => clock });
    await catalog.registerArtPack(PACK);

    clock = LATER;
    await catalog.registerArtPack({
      ...PACK,
      pieces: PACK.pieces.map((piece) => (piece.id === 'desk-wood' ? { ...piece, name: 'Roble' } : piece)),
    });

    expect((await catalog.listArtPieces()).find((piece) => piece.id === 'desk-wood')).toMatchObject({
      name: 'Roble',
      registeredAt: NOW,
      updatedAt: LATER,
    });
  });

  it('rejects an invalid pack without touching the catalog', async () => {
    const catalog = decor();
    await catalog.registerArtPack(PACK);
    const before = await catalog.listArtPieces({ includeRetired: true });

    await expect(catalog.registerArtPack({ ...PACK, pieces: [] })).rejects.toBeInstanceOf(InvalidArtPackError);

    expect(await catalog.listArtPieces({ includeRetired: true })).toEqual(before);
  });
});

describe('createMemoryDecor: uploaded pieces (#121)', () => {
  const PACK: ArtPackManifest = JSON.parse(
    readFileSync(new URL('../../../public/assets/pack/manifest.json', import.meta.url), 'utf8'),
  );
  const FICUS = PACK.pieces.find((piece) => piece.id === 'plant-ficus')!;
  const UPLOADED: ArtPiece = { ...FICUS, id: 'plant-upload-0123456789abcdef', name: 'Helecho' };
  const UPLOADER = 'id-admin';

  it('adds an upload as an active piece, marked as an upload with its uploader', async () => {
    const catalog = decor([]);
    const { piece, asset } = await catalog.registerUploadedArtPiece({ piece: UPLOADED, uploadedBy: UPLOADER });

    expect(asset).toBeNull();
    expect(piece).toMatchObject({ id: UPLOADED.id, kind: 'plant', name: 'Helecho', source: 'upload', uploadedBy: UPLOADER, retiredAt: null, spec: UPLOADED });
    expect((await catalog.listArtPieces()).map((entry) => entry.id)).toEqual([UPLOADED.id]);
  });

  it('marks pack pieces as such', async () => {
    const catalog = decor([]);
    await catalog.registerArtPack(PACK);
    const [first] = await catalog.listArtPieces();
    expect(first).toMatchObject({ source: 'pack', uploadedBy: null });
  });

  it('a pack registration never retires an upload: the pack only answers for its own pieces', async () => {
    const catalog = decor([]);
    await catalog.registerUploadedArtPiece({ piece: UPLOADED, uploadedBy: UPLOADER });

    const result = await catalog.registerArtPack(PACK);

    expect(result.retired).toEqual([]);
    expect((await catalog.listArtPieces()).some((entry) => entry.id === UPLOADED.id)).toBe(true);
  });

  it('refuses the same id twice instead of overwriting it', async () => {
    const catalog = decor([]);
    await catalog.registerUploadedArtPiece({ piece: UPLOADED, uploadedBy: UPLOADER });

    await expect(catalog.registerUploadedArtPiece({ piece: { ...UPLOADED, name: 'Otro' }, uploadedBy: UPLOADER })).rejects.toBeInstanceOf(
      ArtPieceExistsError,
    );
    expect((await catalog.listArtPieces())[0]!.name).toBe('Helecho');
  });

  it('refuses an id outside the upload space', async () => {
    await expect(decor([]).registerUploadedArtPiece({ piece: FICUS, uploadedBy: UPLOADER })).rejects.toBeInstanceOf(InvalidArtPackError);
  });

  it('with a decor asset, creates the asset that draws it on a desk, both or neither', async () => {
    const catalog = decor([PLANTA]);
    const decorAsset = { name: 'Helecho', kind: 'plant' as const, textureKey: `art:${UPLOADED.id}:sheet`, w: 1, h: 1, placeableOnDesk: true };

    const { asset } = await catalog.registerUploadedArtPiece({ piece: UPLOADED, uploadedBy: UPLOADER, decorAsset });
    expect(asset).toMatchObject({ name: 'Helecho', textureKey: `art:${UPLOADED.id}:sheet`, placeableOnDesk: true, archivedAt: null });
    expect((await catalog.listAssets()).map((entry) => entry.slug)).toEqual(['helecho', 'planta']);

    // A decor name already taken leaves the art catalog untouched too.
    const other: ArtPiece = { ...UPLOADED, id: 'plant-upload-fedcba9876543210' };
    await expect(
      catalog.registerUploadedArtPiece({ piece: other, uploadedBy: UPLOADER, decorAsset: { ...decorAsset, name: 'Planta' } }),
    ).rejects.toBeInstanceOf(AssetNameTakenError);
    expect((await catalog.listArtPieces()).map((entry) => entry.id)).toEqual([UPLOADED.id]);
  });
});

describe('createMemoryDecor: contributions and review (#122)', () => {
  const PACK: ArtPackManifest = JSON.parse(
    readFileSync(new URL('../../../public/assets/pack/manifest.json', import.meta.url), 'utf8'),
  );
  const FICUS = PACK.pieces.find((piece) => piece.id === 'plant-ficus')!;
  const CHARACTER = PACK.pieces.find((piece) => piece.kind === 'character')!;
  const ANA = 'id-ana';
  const BETO = 'id-beto';
  const REVIEWER = 'id-admin';

  function contributed(n: number, kind: 'plant' | 'character' = 'plant'): ArtPiece {
    const base = kind === 'plant' ? FICUS : CHARACTER;
    return { ...base, id: `${kind}-upload-${n.toString(16).padStart(16, '0')}`, name: `Pieza ${n}`, license: 'office-contribution' } as ArtPiece;
  }

  /** A clock the test moves, for the hourly window. */
  function clocked(start = NOW) {
    let at = start.getTime();
    const catalog = createMemoryDecor({ seed: [PLANTA], now: () => new Date(at) });
    return { catalog, advance: (ms: number) => (at += ms) };
  }

  it('a contribution is pending, stamped with its rights acceptance and uploader, and out of every public read', async () => {
    const { catalog } = clocked();
    const piece = await catalog.submitArtContribution({ piece: contributed(1), submittedBy: ANA });

    expect(piece).toMatchObject({ status: 'pending', uploadedBy: ANA, source: 'upload', licenseAcceptedAt: NOW, reviewedBy: null, reviewNote: null });
    expect(await catalog.listArtPieces()).toEqual([]);
    expect(await catalog.listArtPieces({ includeRetired: true })).toEqual([]);
    expect((await catalog.listUploadedArtPieces({ uploadedBy: ANA })).map((entry) => entry.id)).toEqual([piece.id]);
    expect(await catalog.listUploadedArtPieces({ uploadedBy: BETO })).toEqual([]);
    expect((await catalog.listUploadedArtPieces({ status: 'pending' })).map((entry) => entry.id)).toEqual([piece.id]);
    expect((await catalog.findArtPiecesWithFile(piece.files[0]!.sha256)).map((entry) => entry.id)).toEqual([piece.id]);
  });

  it('refuses the sixth pending piece of a user, and not the first of another', async () => {
    const { catalog } = clocked();
    for (let n = 1; n <= 5; n += 1) await catalog.submitArtContribution({ piece: contributed(n), submittedBy: ANA });

    await expect(catalog.submitArtContribution({ piece: contributed(6), submittedBy: ANA })).rejects.toMatchObject({ code: 'too-many-pending' });
    await expect(catalog.submitArtContribution({ piece: contributed(7), submittedBy: BETO })).resolves.toMatchObject({ status: 'pending' });
    expect(await catalog.artContributionUsage(ANA)).toEqual({ pending: 5, lastHour: 5 });
  });

  it('a rejection frees a pending slot but still counts for the hour', async () => {
    const { catalog } = clocked();
    for (let n = 1; n <= 5; n += 1) await catalog.submitArtContribution({ piece: contributed(n), submittedBy: ANA });
    for (let n = 1; n <= 5; n += 1) {
      await catalog.reviewArtContribution({ id: contributed(n).id, reviewerId: REVIEWER, decision: 'reject', note: 'no' });
    }
    for (let n = 6; n <= 10; n += 1) await catalog.submitArtContribution({ piece: contributed(n), submittedBy: ANA });
    await catalog.reviewArtContribution({ id: contributed(6).id, reviewerId: REVIEWER, decision: 'reject', note: 'no' });

    // Four pending, ten in the hour: the eleventh is refused by the hourly cap.
    await expect(catalog.submitArtContribution({ piece: contributed(11), submittedBy: ANA })).rejects.toMatchObject({ code: 'hourly-limit' });
    expect(await catalog.artContributionUsage(ANA)).toEqual({ pending: 4, lastHour: 10 });
  });

  it('the hourly window slides: an hour later the quota is back', async () => {
    const { catalog, advance } = clocked();
    for (let n = 1; n <= 10; n += 1) {
      await catalog.submitArtContribution({ piece: contributed(n), submittedBy: ANA });
      await catalog.reviewArtContribution({ id: contributed(n).id, reviewerId: REVIEWER, decision: 'reject', note: 'no' });
    }
    await expect(catalog.submitArtContribution({ piece: contributed(11), submittedBy: ANA })).rejects.toMatchObject({ code: 'hourly-limit' });

    advance(60 * 60 * 1000 + 1);
    await expect(catalog.submitArtContribution({ piece: contributed(11), submittedBy: ANA })).resolves.toMatchObject({ status: 'pending' });
  });

  it('parallel submissions never take more than the free slots', async () => {
    const { catalog } = clocked();
    for (let n = 1; n <= 3; n += 1) await catalog.submitArtContribution({ piece: contributed(n), submittedBy: ANA });

    const results = await Promise.allSettled(
      [4, 5, 6, 7].map((n) => catalog.submitArtContribution({ piece: contributed(n), submittedBy: ANA })),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect((await catalog.artContributionUsage(ANA)).pending).toBe(5);
  });

  it('refuses pixels already in the catalog and a plant whose decor name is taken, writing nothing', async () => {
    const { catalog } = clocked();
    await catalog.submitArtContribution({ piece: contributed(1), submittedBy: ANA });
    await expect(catalog.submitArtContribution({ piece: contributed(1), submittedBy: BETO })).rejects.toBeInstanceOf(ArtPieceExistsError);

    const decorAsset = { name: 'Planta', kind: 'plant' as const, textureKey: `art:${contributed(2).id}:sheet`, w: 1, h: 1, placeableOnDesk: true };
    await expect(catalog.submitArtContribution({ piece: contributed(2), submittedBy: ANA, decorAsset })).rejects.toBeInstanceOf(AssetNameTakenError);
    expect(await catalog.artContributionUsage(ANA)).toEqual({ pending: 1, lastHour: 1 });
  });

  it('approving a plant makes it public and creates its desk decor asset in the same step', async () => {
    const { catalog } = clocked();
    const piece = contributed(1);
    await catalog.submitArtContribution({ piece, submittedBy: ANA });
    const decorAsset = { name: 'Helecho', kind: 'plant' as const, textureKey: `art:${piece.id}:sheet`, w: 1, h: 1, placeableOnDesk: true };

    const reviewed = await catalog.reviewArtContribution({ id: piece.id, reviewerId: REVIEWER, decision: 'approve', note: null, decorAsset });

    expect(reviewed?.piece).toMatchObject({ status: 'approved', reviewedBy: REVIEWER, reviewedAt: NOW, reviewNote: null });
    expect(reviewed?.asset).toMatchObject({ name: 'Helecho', textureKey: `art:${piece.id}:sheet` });
    expect((await catalog.listArtPieces()).map((entry) => entry.id)).toEqual([piece.id]);
    expect((await catalog.listAssets()).map((entry) => entry.name)).toEqual(['Helecho', 'Planta']);
  });

  it('a rejection keeps the reason for the uploader and the piece out of the catalog', async () => {
    const { catalog } = clocked();
    const piece = contributed(1, 'character');
    await catalog.submitArtContribution({ piece, submittedBy: ANA });

    const reviewed = await catalog.reviewArtContribution({ id: piece.id, reviewerId: REVIEWER, decision: 'reject', note: 'Tiene fondo' });

    expect(reviewed?.piece).toMatchObject({ status: 'rejected', reviewNote: 'Tiene fondo', reviewedBy: REVIEWER });
    expect(reviewed?.asset).toBeNull();
    expect(await catalog.listArtPieces()).toEqual([]);
    expect((await catalog.listUploadedArtPieces({ uploadedBy: ANA }))[0]).toMatchObject({ status: 'rejected', reviewNote: 'Tiene fondo' });
  });

  it('a decision is final, and an unknown id is null', async () => {
    const { catalog } = clocked();
    const piece = contributed(1);
    await catalog.submitArtContribution({ piece, submittedBy: ANA });
    await catalog.reviewArtContribution({ id: piece.id, reviewerId: REVIEWER, decision: 'reject', note: 'no' });

    await expect(catalog.reviewArtContribution({ id: piece.id, reviewerId: REVIEWER, decision: 'approve', note: null })).rejects.toBeInstanceOf(
      InvalidArtTransitionError,
    );
    expect(await catalog.reviewArtContribution({ id: contributed(9).id, reviewerId: REVIEWER, decision: 'approve', note: null })).toBeNull();
  });

  it('retiring an approved plant stops offering its decor asset and keeps it drawable', async () => {
    const { catalog } = clocked();
    const piece = contributed(1);
    await catalog.submitArtContribution({ piece, submittedBy: ANA });
    const decorAsset = { name: 'Helecho', kind: 'plant' as const, textureKey: `art:${piece.id}:sheet`, w: 1, h: 1, placeableOnDesk: true };
    await catalog.reviewArtContribution({ id: piece.id, reviewerId: REVIEWER, decision: 'approve', note: null, decorAsset });

    const retired = await catalog.retireUploadedArtPiece({ id: piece.id, actorId: REVIEWER });

    expect(retired).toMatchObject({ changed: true, piece: { retiredAt: NOW, status: 'approved' } });
    expect(await catalog.listArtPieces()).toEqual([]);
    expect((await catalog.listArtPieces({ includeRetired: true })).map((entry) => entry.id)).toEqual([piece.id]);
    expect((await catalog.listAssets()).map((entry) => entry.name)).toEqual(['Planta']);
    expect((await catalog.listAssets({ includeArchived: true })).find((entry) => entry.name === 'Helecho')?.archivedAt).toEqual(NOW);

    // Twice is harmless and changes nothing.
    expect(await catalog.retireUploadedArtPiece({ id: piece.id, actorId: REVIEWER })).toMatchObject({ changed: false });
  });

  it('refuses to retire what was never approved', async () => {
    const { catalog } = clocked();
    await catalog.submitArtContribution({ piece: contributed(1), submittedBy: ANA });
    await expect(catalog.retireUploadedArtPiece({ id: contributed(1).id, actorId: REVIEWER })).rejects.toBeInstanceOf(InvalidArtTransitionError);
    expect(await catalog.retireUploadedArtPiece({ id: 'plant-upload-ffffffffffffffff', actorId: REVIEWER })).toBeNull();
  });

  it('audits every transition, the Admin upload included, and only real changes', async () => {
    const { catalog } = clocked();
    await catalog.registerUploadedArtPiece({ piece: contributed(1), uploadedBy: REVIEWER });
    await catalog.submitArtContribution({ piece: contributed(2), submittedBy: ANA });
    await catalog.submitArtContribution({ piece: contributed(3, 'character'), submittedBy: ANA });
    await catalog.reviewArtContribution({ id: contributed(2).id, reviewerId: REVIEWER, decision: 'reject', note: 'no' });
    await catalog.reviewArtContribution({ id: contributed(3, 'character').id, reviewerId: REVIEWER, decision: 'approve', note: null });
    await catalog.retireUploadedArtPiece({ id: contributed(3, 'character').id, actorId: REVIEWER });
    await catalog.retireUploadedArtPiece({ id: contributed(3, 'character').id, actorId: REVIEWER });

    expect(catalog.artAuditLog().map(({ actorId, action, pieceId }) => [actorId, action, pieceId])).toEqual([
      [REVIEWER, 'upload-art', contributed(1).id],
      [ANA, 'submit-art', contributed(2).id],
      [ANA, 'submit-art', contributed(3, 'character').id],
      [REVIEWER, 'reject-art', contributed(2).id],
      [REVIEWER, 'approve-art', contributed(3, 'character').id],
      [REVIEWER, 'retire-art', contributed(3, 'character').id],
    ]);
  });

  it('pack pieces and Admin uploads are approved from the start', async () => {
    const { catalog } = clocked();
    await catalog.registerArtPack(PACK);
    const { piece } = await catalog.registerUploadedArtPiece({ piece: contributed(1), uploadedBy: REVIEWER });

    expect(piece.status).toBe('approved');
    expect((await catalog.listArtPieces()).every((entry) => entry.status === 'approved')).toBe(true);
    // The upload list is uploads only, whatever their status.
    expect((await catalog.listUploadedArtPieces()).map((entry) => entry.id)).toEqual([piece.id]);
  });
});
