/**
 * Adaptador de Postgres de `DecorCatalog` (#7, slice 4), probado igual que
 * `pgSpaces.test.ts` y `pgDirectory.test.ts:33-93`: un pool de mentira que
 * responde por el TEXTO de la consulta, sin levantar ninguna base de datos.
 *
 * Lo decisivo que se fija aqui es D1b, y se fija sobre el SQL emitido porque
 * es donde vive: `listAssets` lleva `archived_at IS NULL` y `getDeskConfig`
 * NO. Un test que solo mirase las filas devueltas pasaria con las dos
 * consultas intercambiadas, porque el pool de mentira contesta lo mismo.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAssetError, InvalidDeskConfigError } from './decorRules.ts';
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

const ASSET_ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  slug: 'planta-grande',
  name: 'Planta Grande',
  kind: 'plant',
  texture_key: 'plant-large',
  w: 1,
  h: 1,
  placeable_on_desk: true,
  archived_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
};

const DESK_ROW = {
  id: '44444444-4444-4444-8444-444444444444',
  asset_id: ASSET_ROW.id,
  slot: 0,
  rotation: 90,
  created_at: new Date('2026-01-02T00:00:00.000Z'),
  texture_key: ASSET_ROW.texture_key,
  w: ASSET_ROW.w,
  h: ASSET_ROW.h,
  name: ASSET_ROW.name,
};

const USER_ID = '55555555-5555-4555-8555-555555555555';

/** Responde el catalogo a la consulta de validacion y la fila de escritorio al resto. */
function deskPool(respond?: Responder): FakePool {
  return fakePool((text, values) => {
    if (respond) {
      const custom = respond(text, values);
      if (custom instanceof Error) return custom;
    }
    if (squash(text).startsWith('select id, placeable_on_desk from assets')) {
      return { rows: [{ id: ASSET_ROW.id, placeable_on_desk: true }], rowCount: 1 };
    }
    return { rows: [DESK_ROW], rowCount: 1 };
  });
}

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
        archivedAt: null,
        createdAt: ASSET_ROW.created_at,
      },
    ]);
    expect(squash(pool.queries[0].text)).toContain('order by kind, slug, id');
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
    ]);
  });

  it('un error del motor se propaga tal cual', async () => {
    const pool = fakePool(() => Object.assign(new Error('connection terminated'), { code: '08006' }));

    await expect(createPgDecor(pool).createAsset(VALIDO)).rejects.toThrow('connection terminated');
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

describe('pgDecor: getDeskConfig', () => {
  it('cruza con assets SIN filtrar archivados: una pieza retirada se sigue pintando (D1b)', async () => {
    // Es la mitad que hace que archivar no sea un borrado retroactivo. Si esta
    // consulta filtrase, retirar una pieza del catalogo la borraria del
    // escritorio de todo el que ya la tenia puesta.
    const pool = fakePool(() => ({ rows: [DESK_ROW], rowCount: 1 }));

    await createPgDecor(pool).getDeskConfig(USER_ID);

    const sql = squash(pool.queries[0].text);
    expect(sql).toContain('join assets');
    expect(sql).not.toContain('archived_at');
  });

  it('consulta por user_id, ordena por slot y mapea la fila con los campos del asset', async () => {
    const pool = fakePool(() => ({ rows: [DESK_ROW], rowCount: 1 }));

    const items = await createPgDecor(pool).getDeskConfig(USER_ID);

    expect(pool.queries[0].values).toEqual([USER_ID]);
    expect(squash(pool.queries[0].text)).toContain('order by');
    expect(squash(pool.queries[0].text)).toContain('slot');
    expect(items).toEqual([
      {
        id: DESK_ROW.id,
        assetId: ASSET_ROW.id,
        slot: 0,
        rotation: 90,
        textureKey: 'plant-large',
        w: 1,
        h: 1,
        name: 'Planta Grande',
        createdAt: DESK_ROW.created_at,
      },
    ]);
  });
});

describe('pgDecor: replaceDeskConfig', () => {
  it('borra e inserta en UNA transaccion', async () => {
    const pool = deskPool();

    await createPgDecor(pool).replaceDeskConfig(USER_ID, [
      { assetId: ASSET_ROW.id, slot: 0, rotation: 90 },
    ]);

    const texts = pool.queries.map((q) => squash(q.text));
    expect(texts[0]).toBe('begin');
    expect(texts.some((t) => t.startsWith('delete from user_desk_configs where user_id = $1'))).toBe(
      true,
    );
    expect(texts.some((t) => t.startsWith('insert into user_desk_configs'))).toBe(true);
    expect(texts[texts.length - 1]).toBe('commit');
    expect(pool.released).toBe(1);
  });

  it('vacia el escritorio sin insertar nada cuando la lista esta vacia', async () => {
    const pool = deskPool();

    const result = await createPgDecor(pool).replaceDeskConfig(USER_ID, []);

    expect(result).toEqual([]);
    const texts = pool.queries.map((q) => squash(q.text));
    expect(texts.some((t) => t.startsWith('insert into user_desk_configs'))).toBe(false);
    expect(texts.some((t) => t.startsWith('delete from user_desk_configs'))).toBe(true);
  });

  it('hace ROLLBACK si el INSERT falla', async () => {
    const pool = deskPool((text) =>
      squash(text).startsWith('insert into user_desk_configs')
        ? Object.assign(new Error('boom'), { code: '23503' })
        : { rows: [], rowCount: 0 },
    );

    await expect(
      createPgDecor(pool).replaceDeskConfig(USER_ID, [
        { assetId: ASSET_ROW.id, slot: 0, rotation: 90 },
      ]),
    ).rejects.toThrow('boom');

    expect(pool.queries.map((q) => squash(q.text)).at(-1)).toBe('rollback');
  });

  it('un slot repetido se rechaza ANTES de tocar el pool', async () => {
    const pool = deskPool();

    await expect(
      createPgDecor(pool).replaceDeskConfig(USER_ID, [
        { assetId: ASSET_ROW.id, slot: 1, rotation: 0 },
        { assetId: ASSET_ROW.id, slot: 1, rotation: 90 },
      ]),
    ).rejects.toThrow(InvalidDeskConfigError);

    expect(pool.queries).toHaveLength(0);
  });

  it('una rotacion invalida se rechaza ANTES de tocar el pool', async () => {
    const pool = deskPool();

    await expect(
      createPgDecor(pool).replaceDeskConfig(USER_ID, [
        { assetId: ASSET_ROW.id, slot: 0, rotation: 45 as unknown as 0 },
      ]),
    ).rejects.toThrow(InvalidDeskConfigError);

    expect(pool.queries).toHaveLength(0);
  });

  it('un asset que no es colocable se rechaza y no llega a escribir', async () => {
    const pool = fakePool((text) =>
      squash(text).startsWith('select id, placeable_on_desk from assets')
        ? { rows: [{ id: ASSET_ROW.id, placeable_on_desk: false }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );

    await expect(
      createPgDecor(pool).replaceDeskConfig(USER_ID, [
        { assetId: ASSET_ROW.id, slot: 0, rotation: 0 },
      ]),
    ).rejects.toThrow(InvalidDeskConfigError);

    const texts = pool.queries.map((q) => squash(q.text));
    expect(texts.some((t) => t.startsWith('insert into user_desk_configs'))).toBe(false);
  });

  it('un assetId que no existe se rechaza como 400 y no como violacion de FK', async () => {
    const pool = fakePool((text) =>
      squash(text).startsWith('select id, placeable_on_desk from assets')
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 0 },
    );

    await expect(
      createPgDecor(pool).replaceDeskConfig(USER_ID, [
        { assetId: 'no-existe', slot: 0, rotation: 0 },
      ]),
    ).rejects.toThrow(InvalidDeskConfigError);
  });

  it('la consulta del catalogo tampoco filtra archivados: reguardar un escritorio no lo vacia', async () => {
    // Archivar es "no se puede colocar de NUEVO desde el panel", no "tu
    // escritorio deja de ser valido". Si esta consulta filtrase, la persona
    // que moviese una pieza cualquiera perderia la retirada que ya tenia.
    const pool = deskPool();

    await createPgDecor(pool).replaceDeskConfig(USER_ID, [
      { assetId: ASSET_ROW.id, slot: 0, rotation: 0 },
    ]);

    const catalogQuery = pool.queries.find((q) =>
      squash(q.text).startsWith('select id, placeable_on_desk from assets'),
    );
    expect(catalogQuery).toBeDefined();
    expect(squash(catalogQuery!.text)).not.toContain('archived_at');
  });

  it('relee la configuracion cruzada dentro de la transaccion y devuelve el tipo del puerto', async () => {
    const pool = deskPool();

    const items = await createPgDecor(pool).replaceDeskConfig(USER_ID, [
      { assetId: ASSET_ROW.id, slot: 0, rotation: 90 },
    ]);

    expect(items).toEqual([
      {
        id: DESK_ROW.id,
        assetId: ASSET_ROW.id,
        slot: 0,
        rotation: 90,
        textureKey: 'plant-large',
        w: 1,
        h: 1,
        name: 'Planta Grande',
        createdAt: DESK_ROW.created_at,
      },
    ]);
    const texts = pool.queries.map((q) => squash(q.text));
    expect(texts.indexOf('commit')).toBeGreaterThan(
      texts.findIndex((t) => t.includes('join assets')),
    );
  });
});
