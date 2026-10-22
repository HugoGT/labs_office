/**
 * Adaptador de Postgres de `DecorCatalog` (#7, slice 4), probado igual que
 * `pgSpaces.test.ts` y `pgDirectory.test.ts:33-93`: un pool de mentira que
 * responde por el TEXTO de la consulta, sin levantar ninguna base de datos.
 *
 * Lo decisivo que se fija aqui es D1b, y se fija sobre el SQL emitido porque
 * es donde vive: `listAssets` lleva `archived_at IS NULL`. Un test que solo
 * mirase las filas devueltas no lo veria, porque el pool de mentira contesta
 * lo mismo.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ArtPackManifest } from '../../../src/game/artContract.ts';
import { ArtPieceExistsError, InvalidArtPackError } from './artCatalogRules.ts';
import { InvalidArtTransitionError } from './artReviewRules.ts';
import { AssetNameTakenError, InvalidAssetError } from './decorRules.ts';
import { createPgDecor } from './pgDecor.ts';
import type { DirectoryPool, DirectoryQueryResult } from '../directory/pgDirectory.ts';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

/** Comparar SQL con saltos de linea y sangria es comparar formato, no contrato. */
function squash(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

type Responder = (text: string, values: unknown[]) => DirectoryQueryResult | Error;

interface FakePool extends DirectoryPool {
  queries: RecordedQuery[];
  released: number;
}

function fakePool(respond: Responder = () => ({ rows: [], rowCount: 0 })): FakePool {
  const queries: RecordedQuery[] = [];
  const state = { released: 0 };

  function run(text: string, values: unknown[] = []): Promise<DirectoryQueryResult> {
    queries.push({ text, values });
    const result = respond(text, values);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  }

  return {
    queries,
    get released() {
      return state.released;
    },
    query: run,
    async connect() {
      return {
        query: run,
        release() {
          state.released++;
        },
      };
    },
    async end() {},
  };
}

/** Error con la forma que trae `pg` cuando un indice unico salta. */
function uniqueViolation(constraint: string): Error {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { code: '23505', constraint },
  );
}

const ASSET_ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  slug: 'planta-grande',
  name: 'Planta Grande',
  kind: 'plant',
  texture_key: 'plant-large',
  w: 1,
  h: 1,
  placeable_on_desk: true,
  above_avatars: false,
  archived_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('pgDecor: listAssets', () => {
  it('mapea las filas al tipo del puerto en orden deterministico', async () => {
    const pool = fakePool(() => ({ rows: [ASSET_ROW], rowCount: 1 }));

    const assets = await createPgDecor(pool).listAssets();

    expect(assets).toEqual([
      {
        id: ASSET_ROW.id,
        slug: 'planta-grande',
        name: 'Planta Grande',
        kind: 'plant',
        textureKey: 'plant-large',
        w: 1,
        h: 1,
        placeableOnDesk: true,
        aboveAvatars: false,
        archivedAt: null,
        createdAt: ASSET_ROW.created_at,
      },
    ]);
    expect(squash(pool.queries[0].text)).toContain('order by kind, slug, id');
  });

  it('selects and maps above_avatars (#71)', async () => {
    const pool = fakePool(() => ({ rows: [{ ...ASSET_ROW, above_avatars: true }], rowCount: 1 }));

    const assets = await createPgDecor(pool).listAssets();

    expect(squash(pool.queries[0].text)).toContain('above_avatars');
    expect(assets[0].aboveAvatars).toBe(true);
  });

  it('la lectura normal del catalogo filtra los archivados (D1b)', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    await createPgDecor(pool).listAssets();

    expect(squash(pool.queries[0].text)).toContain('archived_at is null');
  });

  it('con includeArchived el filtro NO va en el SQL', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    await createPgDecor(pool).listAssets({ includeArchived: true });

    expect(squash(pool.queries[0].text)).not.toContain('archived_at is null');
  });

  it('mapea archived_at cuando la fila esta retirada', async () => {
    const retirado = new Date('2026-02-01T00:00:00.000Z');
    const pool = fakePool(() => ({
      rows: [{ ...ASSET_ROW, archived_at: retirado }],
      rowCount: 1,
    }));

    const assets = await createPgDecor(pool).listAssets({ includeArchived: true });

    expect(assets[0].archivedAt).toBe(retirado);
  });
});

describe('pgDecor: createAsset', () => {
  const VALIDO = {
    name: 'Planta Grande',
    kind: 'plant' as const,
    textureKey: 'plant-large',
    w: 1,
    h: 1,
    placeableOnDesk: true,
  };

  it('valida ANTES de tocar el pool: un tipo invalido no llega a consultar', async () => {
    const pool = fakePool();

    await expect(
      createPgDecor(pool).createAsset({ ...VALIDO, kind: 'rug' as unknown as 'plant' }),
    ).rejects.toThrow(InvalidAssetError);

    expect(pool.queries).toHaveLength(0);
  });

  it('inserta con el slug derivado del nombre', async () => {
    const pool = fakePool(() => ({ rows: [ASSET_ROW], rowCount: 1 }));

    await createPgDecor(pool).createAsset(VALIDO);

    expect(squash(pool.queries[0].text)).toContain('insert into assets');
    expect(pool.queries[0].values).toEqual([
      'planta-grande',
      'Planta Grande',
      'plant',
      'plant-large',
      1,
      1,
      true,
      false,
    ]);
  });

  it('inserts aboveAvatars when the admin marks the asset as special (#71)', async () => {
    const pool = fakePool(() => ({ rows: [{ ...ASSET_ROW, above_avatars: true }], rowCount: 1 }));

    const asset = await createPgDecor(pool).createAsset({ ...VALIDO, aboveAvatars: true });

    expect(squash(pool.queries[0].text)).toContain('above_avatars');
    expect(pool.queries[0].values.at(-1)).toBe(true);
    expect(asset.aboveAvatars).toBe(true);
  });

  it('un error del motor se propaga tal cual', async () => {
    const pool = fakePool(() => Object.assign(new Error('connection terminated'), { code: '08006' }));

    await expect(createPgDecor(pool).createAsset(VALIDO)).rejects.toThrow('connection terminated');
  });

  it('traduce una violacion de unicidad en AssetNameTakenError, no un 500 pelado', async () => {
    // `assets_slug_unique` esta sobre `lower(slug)` y el slug se DERIVA del
    // nombre: dar de alta "Planta Grande" donde ya hay una es una equivocacion
    // corriente del administrador, no una averia del servidor.
    const pool = fakePool(() => uniqueViolation('assets_slug_unique'));

    await expect(createPgDecor(pool).createAsset(VALIDO)).rejects.toThrow(AssetNameTakenError);
  });

  it('una violacion de unicidad NO se confunde con un cuerpo mal escrito', async () => {
    // `InvalidAssetError` acaba en 400 y este en 409: el primero dice "esto no
    // es un asset", el segundo "este asset ya existe".
    const pool = fakePool(() => uniqueViolation('assets_slug_unique'));

    const thrown = await createPgDecor(pool)
      .createAsset(VALIDO)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AssetNameTakenError);
    expect(thrown).not.toBeInstanceOf(InvalidAssetError);
  });

  it('un error de integridad que NO es de unicidad se propaga tal cual', async () => {
    // `23514` es un CHECK que no cuadra: nada que el administrador haya escrito
    // mal en el nombre. Tragarselo como 409 le diria que se equivoco el cuando
    // el que se rompio fue el servidor.
    const pool = fakePool(() =>
      Object.assign(new Error('violates check constraint'), { code: '23514' }),
    );

    await expect(createPgDecor(pool).createAsset(VALIDO)).rejects.toThrow(
      'violates check constraint',
    );
  });
});

describe('pgDecor: archiveAsset', () => {
  it('marca archived_at con now() y NO borra la fila', async () => {
    const retirado = new Date('2026-02-01T00:00:00.000Z');
    const pool = fakePool(() => ({ rows: [{ ...ASSET_ROW, archived_at: retirado }], rowCount: 1 }));

    const asset = await createPgDecor(pool).archiveAsset(ASSET_ROW.id);

    const sql = squash(pool.queries[0].text);
    expect(sql).toContain('update assets set archived_at = now()');
    expect(sql).not.toContain('delete');
    expect(pool.queries[0].values).toEqual([ASSET_ROW.id]);
    expect(asset?.archivedAt).toBe(retirado);
  });

  it('no toca ninguna colocacion: archivar dice que se puede colocar MANANA, no reescribe ayer', async () => {
    const pool = fakePool(() => ({ rows: [ASSET_ROW], rowCount: 1 }));

    await createPgDecor(pool).archiveAsset(ASSET_ROW.id);

    expect(pool.queries).toHaveLength(1);
    expect(pool.queries.map((q) => squash(q.text)).join(' ')).not.toContain('user_desk_configs');
  });

  it('devuelve null cuando el id no existe', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    expect(await createPgDecor(pool).archiveAsset('no-existe')).toBeNull();
  });
});

describe('pgDecor: updateAsset (#71)', () => {
  it('updates only above_avatars and returns the row', async () => {
    const pool = fakePool(() => ({ rows: [{ ...ASSET_ROW, above_avatars: true }], rowCount: 1 }));

    const asset = await createPgDecor(pool).updateAsset(ASSET_ROW.id, { aboveAvatars: true });

    const sql = squash(pool.queries[0].text);
    expect(sql).toContain('update assets set above_avatars = $2 where id = $1');
    expect(sql).not.toContain('archived_at =');
    expect(pool.queries[0].values).toEqual([ASSET_ROW.id, true]);
    expect(asset?.aboveAvatars).toBe(true);
  });

  it('validates BEFORE touching the pool', async () => {
    const pool = fakePool();

    await expect(
      createPgDecor(pool).updateAsset(ASSET_ROW.id, { aboveAvatars: 'si' as unknown as boolean }),
    ).rejects.toThrow(InvalidAssetError);
    expect(pool.queries).toHaveLength(0);
  });

  it('returns null when the id does not exist', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    expect(await createPgDecor(pool).updateAsset('no-existe', { aboveAvatars: true })).toBeNull();
  });
});

describe('createPgDecor: art pack catalog (art migration, step 3)', () => {
  const PACK: ArtPackManifest = JSON.parse(
    readFileSync(new URL('../../../public/assets/pack/manifest.json', import.meta.url), 'utf8'),
  );
  const PAINTED = PACK.pieces.find((piece) => piece.id === 'desk-painted')!;
  const PIECE_ROW = {
    id: PAINTED.id,
    kind: 'desk',
    name: PAINTED.name,
    material: 'painted',
    colorable: true,
    default_color: '#4f9a8a',
    author: PAINTED.author,
    license: PAINTED.license,
    files: PAINTED.files,
    spec: PAINTED,
    contract_version: 1,
    retired_at: null,
    registered_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T00:00:00.000Z'),
  };

  it('listArtPieces reads only active approved pieces by default, in (kind, id) order, and maps the row', async () => {
    const pool = fakePool(() => ({ rows: [PIECE_ROW], rowCount: 1 }));

    const pieces = await createPgDecor(pool).listArtPieces();

    expect(squash(pool.queries[0].text)).toContain("from art_pieces where status = 'approved' and retired_at is null order by kind, id");
    expect(pieces).toEqual([
      {
        id: PAINTED.id,
        kind: 'desk',
        name: PAINTED.name,
        material: 'painted',
        colorable: true,
        defaultColor: '#4f9a8a',
        author: PAINTED.author,
        license: PAINTED.license,
        files: PAINTED.files,
        spec: PAINTED,
        contractVersion: 1,
        retiredAt: null,
        registeredAt: PIECE_ROW.registered_at,
        updatedAt: PIECE_ROW.updated_at,
        // A row read before #121 has no source column yet: it is a pack piece.
        source: 'pack',
        uploadedBy: null,
        // Nor review columns before #122: approved from the start, like its DEFAULT.
        status: 'approved',
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        licenseAcceptedAt: null,
      },
    ]);
  });

  it('listArtPieces({ includeRetired: true }) drops the retired filter, never the approved one (#122)', async () => {
    const pool = fakePool();

    await createPgDecor(pool).listArtPieces({ includeRetired: true });

    expect(squash(pool.queries[0].text)).not.toContain('retired_at is null');
    expect(squash(pool.queries[0].text)).toContain("where status = 'approved'");
  });

  function registrationPool(retired: readonly string[] = []): FakePool {
    return fakePool((text) =>
      /update art_pieces set retired_at/i.test(text)
        ? { rows: retired.map((id) => ({ id })), rowCount: retired.length }
        : { rows: [], rowCount: 0 },
    );
  }

  it('upserts every piece by its id inside one transaction and never deletes', async () => {
    const pool = registrationPool();

    await createPgDecor(pool).registerArtPack(PACK);

    const texts = pool.queries.map((query) => squash(query.text));
    expect(texts[0]).toBe('begin');
    expect(texts.at(-1)).toBe('commit');
    const upserts = pool.queries.filter((query) => /insert into art_pieces/i.test(query.text));
    expect(upserts).toHaveLength(PACK.pieces.length);
    expect(upserts.map((query) => query.values[0])).toEqual(PACK.pieces.map((piece) => piece.id));
    expect(squash(upserts[0].text)).toContain('on conflict (id) do update set');
    // Shipping a piece again un-retires it.
    expect(squash(upserts[0].text)).toContain('retired_at = null');
    // The kind is never rewritten: the id prefix already fixes it.
    expect(squash(upserts[0].text)).not.toMatch(/kind = excluded\.kind/);
    expect(texts.some((text) => text.includes('delete'))).toBe(false);
    expect(pool.released).toBe(1);
  });

  it('does not rewrite a piece that did not change, so registering at every start is a no-op', async () => {
    const pool = registrationPool();

    await createPgDecor(pool).registerArtPack(PACK);

    const upsert = squash(pool.queries.find((query) => /insert into art_pieces/i.test(query.text))!.text);
    expect(upsert).toContain('where art_pieces.spec is distinct from excluded.spec');
    expect(upsert).toContain('or art_pieces.retired_at is not null');
  });

  it('sends files and spec as JSON text, not as a Postgres array', async () => {
    // `pg` turns a JS array parameter into an array literal; `files` is an
    // array, so it has to travel stringified and cast to jsonb.
    const pool = registrationPool();

    await createPgDecor(pool).registerArtPack(PACK);

    const upsert = pool.queries.find((query) => query.values[0] === 'desk-painted')!;
    expect(squash(upsert.text)).toContain('::jsonb');
    expect(upsert.values).toEqual([
      'desk-painted',
      'desk',
      PAINTED.name,
      'painted',
      true,
      '#4f9a8a',
      PAINTED.author,
      PAINTED.license,
      JSON.stringify(PAINTED.files),
      JSON.stringify(PAINTED),
      PACK.contractVersion,
    ]);
    const mateo = pool.queries.find((query) => query.values[0] === 'character-p01-burgundy-suit')!;
    expect(mateo.values.slice(3, 6)).toEqual([null, false, null]);
  });

  it('retires, with one UPDATE, every active piece the pack no longer ships', async () => {
    const pool = registrationPool(['desk-old']);

    const result = await createPgDecor(pool).registerArtPack(PACK);

    const retire = pool.queries.find((query) => /update art_pieces set retired_at/i.test(query.text))!;
    expect(squash(retire.text)).toContain('where retired_at is null and not (id = any($1::text[]))');
    expect(retire.values).toEqual([PACK.pieces.map((piece) => piece.id)]);
    expect(result).toEqual({ registered: PACK.pieces.length, retired: ['desk-old'] });
  });

  it('gives each pack chair one decor asset, once by texture key, inside the same transaction', async () => {
    const pool = registrationPool();

    await createPgDecor(pool).registerArtPack(PACK);

    const inserts = pool.queries.filter((query) => /insert into assets/i.test(query.text));
    expect(inserts.map((query) => query.values[3]).sort()).toEqual([
      'art:chair-gamer:sheet',
      'art:chair-leather:sheet',
      'art:chair-metal:sheet',
      'art:chair-wood:sheet',
      ...PACK.pieces.filter((piece) => piece.kind === 'desk').map((piece) => `art:${piece.id}:sheet`).sort(),
    ].sort());
    const wood = inserts.find((query) => query.values[3] === 'art:chair-wood:sheet')!;
    expect(wood.values).toEqual(['silla-de-madera', 'Silla de madera', 'furniture', 'art:chair-wood:sheet', 1, 1, true, false]);
    // Archived or not, an existing asset of that texture is never recreated,
    // and a name already taken skips the chair instead of failing the start.
    expect(squash(wood.text)).toContain('where not exists (select 1 from assets where texture_key = $4)');
    expect(squash(wood.text)).toContain('on conflict do nothing');
    const texts = pool.queries.map((query) => squash(query.text));
    expect(texts.indexOf(squash(wood.text))).toBeLessThan(texts.lastIndexOf('commit'));
  });

  it('archives the decor assets of the pieces it retires, and none when nothing retires', async () => {
    const retiring = registrationPool(['chair-old']);
    await createPgDecor(retiring).registerArtPack(PACK);
    const archive = retiring.queries.find((query) => /update assets set archived_at/i.test(query.text))!;
    expect(squash(archive.text)).toContain('where texture_key = any($1::text[]) and archived_at is null');
    expect(archive.values).toEqual([['art:chair-old:sheet']]);

    const steady = registrationPool();
    await createPgDecor(steady).registerArtPack(PACK);
    expect(steady.queries.some((query) => /update assets/i.test(query.text))).toBe(false);
  });

  it('rejects an invalid pack before asking for a connection', async () => {
    const pool = registrationPool();

    await expect(createPgDecor(pool).registerArtPack({ ...PACK, contractVersion: 99 })).rejects.toBeInstanceOf(
      InvalidArtPackError,
    );
    expect(pool.queries).toEqual([]);
  });

  it('rolls back the whole registration if one statement fails', async () => {
    const pool = fakePool((text) => (/update art_pieces/i.test(text) ? new Error('boom') : { rows: [], rowCount: 0 }));

    await expect(createPgDecor(pool).registerArtPack(PACK)).rejects.toThrow('boom');

    expect(squash(pool.queries.at(-1)!.text)).toBe('rollback');
    expect(pool.released).toBe(1);
  });
});

describe('createPgDecor: uploaded pieces (#121)', () => {
  const PACK: ArtPackManifest = JSON.parse(
    readFileSync(new URL('../../../public/assets/pack/manifest.json', import.meta.url), 'utf8'),
  );
  const FICUS = PACK.pieces.find((piece) => piece.id === 'plant-ficus')!;
  const UPLOADED = { ...FICUS, id: 'plant-upload-0123456789abcdef', name: 'Helecho' };
  const UPLOADER = '11111111-1111-4111-8111-111111111111';
  const UPLOADED_ROW = {
    id: UPLOADED.id,
    kind: 'plant',
    name: 'Helecho',
    material: 'ficus',
    colorable: false,
    default_color: null,
    author: UPLOADED.author,
    license: UPLOADED.license,
    files: UPLOADED.files,
    spec: UPLOADED,
    contract_version: 2,
    retired_at: null,
    registered_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    source: 'upload',
    uploaded_by: UPLOADER,
  };
  const DECOR = { name: 'Helecho', kind: 'plant' as const, textureKey: `art:${UPLOADED.id}:sheet`, w: 1, h: 1, placeableOnDesk: true };

  it('a pack registration retires only pack pieces, never an upload', async () => {
    const pool = fakePool();

    await createPgDecor(pool).registerArtPack(PACK);

    const retire = pool.queries.find((query) => /update art_pieces set retired_at/i.test(query.text))!;
    expect(squash(retire.text)).toContain("and source = 'pack'");
  });

  it('inserts the upload as source upload without touching an existing id, inside one transaction', async () => {
    const pool = fakePool((text) => (/insert into art_pieces/i.test(text) ? { rows: [UPLOADED_ROW], rowCount: 1 } : { rows: [], rowCount: 0 }));

    const { piece, asset } = await createPgDecor(pool).registerUploadedArtPiece({ piece: UPLOADED, uploadedBy: UPLOADER });

    const texts = pool.queries.map((query) => squash(query.text));
    expect(texts[0]).toBe('begin');
    expect(texts.at(-1)).toBe('commit');
    const insert = pool.queries.find((query) => /insert into art_pieces/i.test(query.text))!;
    expect(squash(insert.text)).toContain('on conflict (id) do nothing');
    expect(insert.values).toEqual([
      UPLOADED.id,
      'plant',
      'Helecho',
      'ficus',
      false,
      null,
      UPLOADED.author,
      UPLOADED.license,
      JSON.stringify(UPLOADED.files),
      JSON.stringify(UPLOADED),
      PACK.contractVersion,
      UPLOADER,
    ]);
    expect(squash(insert.text)).toContain("'upload'");
    expect(piece).toMatchObject({ id: UPLOADED.id, source: 'upload', uploadedBy: UPLOADER });
    expect(asset).toBeNull();
    expect(texts.some((text) => text.includes('insert into assets'))).toBe(false);
  });

  it('answers ArtPieceExistsError when the id is already taken, and rolls back', async () => {
    const pool = fakePool();

    await expect(createPgDecor(pool).registerUploadedArtPiece({ piece: UPLOADED, uploadedBy: UPLOADER })).rejects.toBeInstanceOf(
      ArtPieceExistsError,
    );
    expect(squash(pool.queries.at(-1)!.text)).toBe('rollback');
    expect(pool.released).toBe(1);
  });

  it('creates the decor asset in the same transaction, and a taken name undoes both', async () => {
    const ok = fakePool((text) =>
      /insert into art_pieces/i.test(text)
        ? { rows: [UPLOADED_ROW], rowCount: 1 }
        : /insert into assets/i.test(text)
          ? { rows: [{ ...ASSET_ROW, name: 'Helecho', slug: 'helecho', texture_key: DECOR.textureKey }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    );
    const { asset } = await createPgDecor(ok).registerUploadedArtPiece({ piece: UPLOADED, uploadedBy: UPLOADER, decorAsset: DECOR });
    expect(asset).toMatchObject({ slug: 'helecho', textureKey: DECOR.textureKey });
    const texts = ok.queries.map((query) => squash(query.text));
    expect(texts.findIndex((text) => text.includes('insert into assets'))).toBeLessThan(texts.indexOf('commit'));

    const taken = fakePool((text) =>
      /insert into art_pieces/i.test(text)
        ? { rows: [UPLOADED_ROW], rowCount: 1 }
        : /insert into assets/i.test(text)
          ? uniqueViolation('assets_slug_unique')
          : { rows: [], rowCount: 0 },
    );
    await expect(
      createPgDecor(taken).registerUploadedArtPiece({ piece: UPLOADED, uploadedBy: UPLOADER, decorAsset: DECOR }),
    ).rejects.toBeInstanceOf(AssetNameTakenError);
    expect(squash(taken.queries.at(-1)!.text)).toBe('rollback');
  });

  it('refuses an id outside the upload space before asking for a connection', async () => {
    const pool = fakePool();
    await expect(createPgDecor(pool).registerUploadedArtPiece({ piece: FICUS, uploadedBy: UPLOADER })).rejects.toBeInstanceOf(
      InvalidArtPackError,
    );
    expect(pool.queries).toEqual([]);
  });
});

describe('createPgDecor: contributions and review (#122)', () => {
  const PACK: ArtPackManifest = JSON.parse(
    readFileSync(new URL('../../../public/assets/pack/manifest.json', import.meta.url), 'utf8'),
  );
  const FICUS = PACK.pieces.find((piece) => piece.id === 'plant-ficus')!;
  const PIECE = { ...FICUS, id: 'plant-upload-0123456789abcdef', name: 'Helecho', license: 'office-contribution' };
  const ANA = '11111111-1111-4111-8111-111111111111';
  const REVIEWER = '22222222-2222-4222-8222-222222222222';
  const ROW = {
    id: PIECE.id,
    kind: 'plant',
    name: 'Helecho',
    material: 'ficus',
    colorable: false,
    default_color: null,
    author: PIECE.author,
    license: PIECE.license,
    files: PIECE.files,
    spec: PIECE,
    contract_version: 2,
    retired_at: null,
    registered_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    source: 'upload',
    uploaded_by: ANA,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    license_accepted_at: new Date('2026-01-01T00:00:00.000Z'),
  };
  const DECOR = { name: 'Helecho', kind: 'plant' as const, textureKey: `art:${PIECE.id}:sheet`, w: 1, h: 1, placeableOnDesk: true };

  function usage(pending: number, lastHour: number) {
    return { rows: [{ pending, last_hour: lastHour }], rowCount: 1 };
  }

  function submitPool(counts = usage(0, 0), extra: Responder = () => ({ rows: [], rowCount: 0 })): FakePool {
    return fakePool((text, values) => {
      if (/as pending/i.test(text)) return counts;
      if (/insert into art_pieces/i.test(text)) return { rows: [ROW], rowCount: 1 };
      return extra(text, values);
    });
  }

  it('locks the user row, counts and inserts inside one transaction, in that order', async () => {
    const pool = submitPool();

    const piece = await createPgDecor(pool).submitArtContribution({ piece: PIECE, submittedBy: ANA });

    const texts = pool.queries.map((query) => squash(query.text));
    const lock = texts.findIndex((text) => text === 'select id from users where id = $1 for update');
    const count = texts.findIndex((text) => text.includes('as pending'));
    const insert = texts.findIndex((text) => text.includes('insert into art_pieces'));
    const audit = texts.findIndex((text) => text.includes('insert into audit_log'));
    expect(texts[0]).toBe('begin');
    expect([lock, count, insert, audit].every((index, i, all) => index > 0 && (i === 0 || index > all[i - 1]!))).toBe(true);
    expect(texts.at(-1)).toBe('commit');
    expect(pool.queries[lock]!.values).toEqual([ANA]);
    expect(piece).toMatchObject({ status: 'pending', uploadedBy: ANA, licenseAcceptedAt: ROW.license_accepted_at });
  });

  it('counts pending rows of the user and its submit-art entries of the last hour', async () => {
    const pool = submitPool();

    await createPgDecor(pool).submitArtContribution({ piece: PIECE, submittedBy: ANA });

    const count = pool.queries.find((query) => /as pending/i.test(query.text))!;
    expect(squash(count.text)).toContain("uploaded_by = $1 and status = 'pending'");
    expect(squash(count.text)).toContain("actor_id = $1 and action = 'submit-art' and created_at > now() - make_interval(secs => $2)");
    expect(count.values).toEqual([ANA, 3600]);
  });

  it('inserts pending with the rights stamp and audits submit-art against the piece', async () => {
    const pool = submitPool();

    await createPgDecor(pool).submitArtContribution({ piece: PIECE, submittedBy: ANA });

    const insert = pool.queries.find((query) => /insert into art_pieces/i.test(query.text))!;
    expect(squash(insert.text)).toContain("'upload', $12, 'pending', now()");
    expect(squash(insert.text)).toContain('on conflict (id) do nothing');
    const audit = pool.queries.find((query) => /insert into audit_log/i.test(query.text))!;
    expect(squash(audit.text)).toBe('insert into audit_log (actor_id, action, piece_id) values ($1, $2, $3)');
    expect(audit.values).toEqual([ANA, 'submit-art', PIECE.id]);
  });

  it.each([
    [usage(5, 5), 'too-many-pending'],
    [usage(1, 10), 'hourly-limit'],
  ])('refuses over the limits and rolls back without inserting (%j)', async (counts, code) => {
    const pool = submitPool(counts);

    await expect(createPgDecor(pool).submitArtContribution({ piece: PIECE, submittedBy: ANA })).rejects.toMatchObject({ code });

    expect(pool.queries.some((query) => /insert into/i.test(query.text))).toBe(false);
    expect(squash(pool.queries.at(-1)!.text)).toBe('rollback');
  });

  it('refuses the same pixels already in the catalog, and a plant whose decor name is taken', async () => {
    const existing = fakePool((text) => (/as pending/i.test(text) ? usage(0, 0) : { rows: [], rowCount: 0 }));
    await expect(createPgDecor(existing).submitArtContribution({ piece: PIECE, submittedBy: ANA })).rejects.toBeInstanceOf(ArtPieceExistsError);
    expect(squash(existing.queries.at(-1)!.text)).toBe('rollback');

    const taken = submitPool(usage(0, 0), (text) => (/from assets where lower\(slug\)/i.test(text) ? { rows: [{ id: 'x' }], rowCount: 1 } : { rows: [], rowCount: 0 }));
    await expect(createPgDecor(taken).submitArtContribution({ piece: PIECE, submittedBy: ANA, decorAsset: DECOR })).rejects.toBeInstanceOf(
      AssetNameTakenError,
    );
    expect(taken.queries.some((query) => /insert into art_pieces/i.test(query.text))).toBe(false);
  });

  it('artContributionUsage runs the same count outside any transaction', async () => {
    const pool = fakePool(() => usage(2, 7));

    expect(await createPgDecor(pool).artContributionUsage(ANA)).toEqual({ pending: 2, lastHour: 7 });
    expect(pool.queries).toHaveLength(1);
  });

  it('lists uploads only, filtered by uploader and status, oldest first', async () => {
    const pool = fakePool(() => ({ rows: [ROW], rowCount: 1 }));

    const pieces = await createPgDecor(pool).listUploadedArtPieces({ uploadedBy: ANA, status: 'pending' });

    expect(squash(pool.queries[0]!.text)).toContain(
      "from art_pieces where source = 'upload' and ($1::uuid is null or uploaded_by = $1) and ($2::text is null or status = $2) order by registered_at, id",
    );
    expect(pool.queries[0]!.values).toEqual([ANA, 'pending']);
    expect(pieces[0]).toMatchObject({ id: PIECE.id, status: 'pending' });
  });

  it('finds the uploads carrying a file by jsonb containment', async () => {
    const pool = fakePool(() => ({ rows: [ROW], rowCount: 1 }));
    const sha = PIECE.files[0]!.sha256;

    await createPgDecor(pool).findArtPiecesWithFile(sha);

    expect(squash(pool.queries[0]!.text)).toContain("where source = 'upload' and files @> $1::jsonb");
    expect(pool.queries[0]!.values).toEqual([JSON.stringify([{ sha256: sha }])]);
  });

  function reviewPool(status: string, extra: Responder = () => ({ rows: [], rowCount: 0 })): FakePool {
    return fakePool((text, values) => {
      if (/for update/i.test(text) && /from art_pieces/i.test(text)) return { rows: [{ ...ROW, status }], rowCount: 1 };
      if (/update art_pieces set status/i.test(text)) {
        return { rows: [{ ...ROW, status: values[1], reviewed_by: values[2], review_note: values[3], reviewed_at: new Date() }], rowCount: 1 };
      }
      return extra(text, values);
    });
  }

  it('approves under a row lock, creates the decor asset and audits, atomically', async () => {
    const pool = reviewPool('pending', (text) =>
      /insert into assets/i.test(text) ? { rows: [{ ...ASSET_ROW, name: 'Helecho', slug: 'helecho', texture_key: DECOR.textureKey }], rowCount: 1 } : { rows: [], rowCount: 0 },
    );

    const reviewed = await createPgDecor(pool).reviewArtContribution({ id: PIECE.id, reviewerId: REVIEWER, decision: 'approve', note: null, decorAsset: DECOR });

    const texts = pool.queries.map((query) => squash(query.text));
    expect(texts[0]).toBe('begin');
    expect(texts[1]).toContain("from art_pieces where id = $1 and source = 'upload' for update");
    expect(pool.queries.find((query) => /update art_pieces set status/i.test(query.text))!.values).toEqual([PIECE.id, 'approved', REVIEWER, null]);
    expect(texts.some((text) => text.includes('insert into assets'))).toBe(true);
    expect(pool.queries.find((query) => /insert into audit_log/i.test(query.text))!.values).toEqual([REVIEWER, 'approve-art', PIECE.id]);
    expect(texts.at(-1)).toBe('commit');
    expect(reviewed?.piece.status).toBe('approved');
    expect(reviewed?.asset).toMatchObject({ slug: 'helecho' });
  });

  it('rejects with its reason and no decor asset', async () => {
    const pool = reviewPool('pending');

    const reviewed = await createPgDecor(pool).reviewArtContribution({ id: PIECE.id, reviewerId: REVIEWER, decision: 'reject', note: 'Tiene fondo', decorAsset: DECOR });

    expect(pool.queries.find((query) => /update art_pieces set status/i.test(query.text))!.values).toEqual([PIECE.id, 'rejected', REVIEWER, 'Tiene fondo']);
    expect(pool.queries.some((query) => /insert into assets/i.test(query.text))).toBe(false);
    expect(pool.queries.find((query) => /insert into audit_log/i.test(query.text))!.values).toEqual([REVIEWER, 'reject-art', PIECE.id]);
    expect(reviewed).toMatchObject({ piece: { status: 'rejected', reviewNote: 'Tiene fondo' }, asset: null });
  });

  it('refuses to review twice and answers null for an unknown id, rolling back both', async () => {
    const done = reviewPool('approved');
    await expect(createPgDecor(done).reviewArtContribution({ id: PIECE.id, reviewerId: REVIEWER, decision: 'reject', note: 'x' })).rejects.toBeInstanceOf(
      InvalidArtTransitionError,
    );
    expect(squash(done.queries.at(-1)!.text)).toBe('rollback');

    const missing = fakePool();
    expect(await createPgDecor(missing).reviewArtContribution({ id: PIECE.id, reviewerId: REVIEWER, decision: 'approve', note: null })).toBeNull();
    expect(missing.queries.some((query) => /^\s*update/i.test(query.text))).toBe(false);
  });

  it('retires under a row lock, archives the decor asset drawing it and audits', async () => {
    const pool = fakePool((text) => {
      if (/for update/i.test(text) && /from art_pieces/i.test(text)) return { rows: [{ ...ROW, status: 'approved' }], rowCount: 1 };
      if (/update art_pieces set retired_at/i.test(text)) return { rows: [{ ...ROW, status: 'approved', retired_at: new Date() }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const result = await createPgDecor(pool).retireUploadedArtPiece({ id: PIECE.id, actorId: REVIEWER });

    const archive = pool.queries.find((query) => /update assets set archived_at/i.test(query.text))!;
    expect(squash(archive.text)).toContain('where texture_key = $1 and archived_at is null');
    expect(archive.values).toEqual([`art:${PIECE.id}:sheet`]);
    expect(pool.queries.find((query) => /insert into audit_log/i.test(query.text))!.values).toEqual([REVIEWER, 'retire-art', PIECE.id]);
    expect(result?.changed).toBe(true);
    expect(squash(pool.queries.at(-1)!.text)).toBe('commit');
  });

  it('retiring an already retired piece writes nothing', async () => {
    const pool = fakePool((text) =>
      /for update/i.test(text) ? { rows: [{ ...ROW, status: 'approved', retired_at: new Date() }], rowCount: 1 } : { rows: [], rowCount: 0 },
    );

    const result = await createPgDecor(pool).retireUploadedArtPiece({ id: PIECE.id, actorId: REVIEWER });

    expect(result?.changed).toBe(false);
    expect(pool.queries.some((query) => /^\s*(update|insert)/i.test(query.text))).toBe(false);
  });

  it('the Admin upload of #121 is audited as upload-art in its transaction', async () => {
    const pool = fakePool((text) => (/insert into art_pieces/i.test(text) ? { rows: [{ ...ROW, status: 'approved' }], rowCount: 1 } : { rows: [], rowCount: 0 }));

    await createPgDecor(pool).registerUploadedArtPiece({ piece: PIECE, uploadedBy: REVIEWER });

    const texts = pool.queries.map((query) => squash(query.text));
    expect(pool.queries.find((query) => /insert into audit_log/i.test(query.text))!.values).toEqual([REVIEWER, 'upload-art', PIECE.id]);
    expect(texts.findIndex((text) => text.includes('insert into audit_log'))).toBeLessThan(texts.indexOf('commit'));
  });
});
