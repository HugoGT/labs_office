/**
 * Adaptador de Postgres de `SpacesDirectory` (#7), probado igual que
 * `pgDirectory.test.ts:33-93`: un pool de mentira que responde por el TEXTO
 * de la consulta, sin levantar ninguna base de datos.
 */

import { describe, expect, it } from 'vitest';
import { InvalidSpaceError, SpaceNameTakenError, SpaceOverlapError } from './spaceRules.ts';
import { createPgSpaces } from './pgSpaces.ts';
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

/** Error con la forma que trae `pg` cuando una restriccion de exclusion salta. */
function exclusionViolation(): Error {
  return Object.assign(new Error('conflicting key value violates exclusion constraint "spaces_no_overlap"'), {
    code: '23P01',
  });
}

/** Error con la forma que trae `pg` cuando un indice unico salta. */
function uniqueViolation(constraint: string): Error {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { code: '23505', constraint },
  );
}

const SPACE_ROW = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'sala-de-juntas',
  name: 'Sala de Juntas',
  x: 50,
  y: 2,
  w: 13,
  h: 14,
  capacity: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

const LAYOUT_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  space_id: SPACE_ROW.id,
  asset_id: '22222222-2222-4222-8222-222222222222',
  x: 1,
  y: 1,
  rotation: 0,
  z_index: 0,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('pgSpaces: listSpaces', () => {
  it('mapea las filas al tipo del puerto en orden deterministico', async () => {
    const pool = fakePool(() => ({ rows: [SPACE_ROW], rowCount: 1 }));

    const spaces = await createPgSpaces(pool).listSpaces();

    expect(spaces).toEqual([
      {
        id: SPACE_ROW.id,
        slug: 'sala-de-juntas',
        name: 'Sala de Juntas',
        x: 50,
        y: 2,
        w: 13,
        h: 14,
        capacity: null,
        createdAt: SPACE_ROW.created_at,
        updatedAt: SPACE_ROW.updated_at,
      },
    ]);
    expect(squash(pool.queries[0].text)).toContain('order by x, y, id');
  });
});

describe('pgSpaces: getSpace', () => {
  it('consulta por id y mapea la fila', async () => {
    const pool = fakePool(() => ({ rows: [SPACE_ROW], rowCount: 1 }));

    const space = await createPgSpaces(pool).getSpace(SPACE_ROW.id);

    expect(pool.queries[0].values).toEqual([SPACE_ROW.id]);
    expect(squash(pool.queries[0].text)).toContain('where id = $1');
    expect(space?.slug).toBe('sala-de-juntas');
  });

  it('devuelve null cuando no hay fila', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    expect(await createPgSpaces(pool).getSpace('nope')).toBeNull();
  });
});

describe('pgSpaces: createSpace', () => {
  it('normaliza y valida ANTES de tocar el pool: bounds invalidos no llegan a consultar', async () => {
    const pool = fakePool();

    await expect(
      createPgSpaces(pool).createSpace({ name: 'X', x: -1, y: 0, w: 10, h: 10, capacity: null }),
    ).rejects.toThrow(InvalidSpaceError);

    expect(pool.queries).toHaveLength(0);
  });

  it('inserta con el slug derivado del nombre', async () => {
    const pool = fakePool(() => ({ rows: [SPACE_ROW], rowCount: 1 }));

    await createPgSpaces(pool).createSpace({
      name: 'Sala de Juntas',
      x: 50,
      y: 2,
      w: 13,
      h: 14,
      capacity: null,
    });

    const sql = squash(pool.queries[0].text);
    expect(sql).toContain('insert into spaces');
    expect(pool.queries[0].values).toEqual(['sala-de-juntas', 'Sala de Juntas', 50, 2, 13, 14, null]);
  });

  it('traduce una violacion de exclusion en SpaceOverlapError, no un 500 pelado', async () => {
    const pool = fakePool(() => exclusionViolation());

    await expect(
      createPgSpaces(pool).createSpace({
        name: 'Choca',
        x: 50,
        y: 2,
        w: 13,
        h: 14,
        capacity: null,
      }),
    ).rejects.toThrow(SpaceOverlapError);
  });

  it('un error que no sea de exclusion se propaga tal cual', async () => {
    const pool = fakePool(() => Object.assign(new Error('connection terminated'), { code: '08006' }));

    await expect(
      createPgSpaces(pool).createSpace({ name: 'X', x: 0, y: 0, w: 1, h: 1, capacity: null }),
    ).rejects.toThrow('connection terminated');
  });

  it('traduce una violacion de unicidad en SpaceNameTakenError, no un 500 pelado', async () => {
    const pool = fakePool(() => uniqueViolation('spaces_name_unique'));

    await expect(
      createPgSpaces(pool).createSpace({
        name: 'Cafeteria',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        capacity: null,
      }),
    ).rejects.toThrow(SpaceNameTakenError);
  });

  it('el choque de slug se traduce igual: el admin solo escribio el nombre', async () => {
    // `spaces_slug_unique` y `spaces_name_unique` son dos indices, pero una
    // sola equivocacion: el slug se DERIVA del nombre, asi que quien llama no
    // tiene otro campo que corregir.
    const pool = fakePool(() => uniqueViolation('spaces_slug_unique'));

    await expect(
      createPgSpaces(pool).createSpace({ name: 'Sala-A', x: 0, y: 0, w: 1, h: 1, capacity: null }),
    ).rejects.toThrow(SpaceNameTakenError);
  });

  it('una violacion de unicidad NO se confunde con un solape', async () => {
    // Los dos acaban en 409 y por eso es facil colapsarlos, pero el solape se
    // arregla moviendo el rectangulo y el nombre repetido eligiendo otro
    // nombre. Un solo tipo mandaria al administrador a corregir lo que no esta
    // mal.
    const pool = fakePool(() => uniqueViolation('spaces_name_unique'));

    const thrown = await createPgSpaces(pool)
      .createSpace({ name: 'Cafeteria', x: 0, y: 0, w: 1, h: 1, capacity: null })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(SpaceNameTakenError);
    expect(thrown).not.toBeInstanceOf(SpaceOverlapError);
  });

  it('un error de integridad que NO es de unicidad se propaga tal cual', async () => {
    // `23503` es una violacion de clave ajena: nada que el administrador haya
    // escrito mal. Tragarsela como 409 le diria que se equivoco el cuando el
    // que se rompio fue el servidor.
    const pool = fakePool(() =>
      Object.assign(new Error('violates foreign key constraint'), { code: '23503' }),
    );

    await expect(
      createPgSpaces(pool).createSpace({ name: 'X', x: 0, y: 0, w: 1, h: 1, capacity: null }),
    ).rejects.toThrow('violates foreign key constraint');
  });
});

describe('pgSpaces: updateSpace', () => {
  it('rectangulo parcial se rechaza ANTES de tocar el pool', async () => {
    const pool = fakePool();

    await expect(createPgSpaces(pool).updateSpace(SPACE_ROW.id, { x: 1 })).rejects.toThrow(
      InvalidSpaceError,
    );
    expect(pool.queries).toHaveLength(0);
  });

  it('un patch vacio no dispara UPDATE: relee la fila actual', async () => {
    const pool = fakePool(() => ({ rows: [SPACE_ROW], rowCount: 1 }));

    await createPgSpaces(pool).updateSpace(SPACE_ROW.id, {});

    expect(squash(pool.queries[0].text)).toContain('select');
    // OJO: `updated_at` contiene la subcadena "update" -- por eso se busca
    // "update spaces set" y no "update" a secas.
    expect(squash(pool.queries[0].text)).not.toContain('update spaces set');
  });

  it('actualiza solo los campos provistos', async () => {
    const pool = fakePool(() => ({ rows: [{ ...SPACE_ROW, name: 'War Room', slug: 'war-room' }], rowCount: 1 }));

    await createPgSpaces(pool).updateSpace(SPACE_ROW.id, { name: 'War Room' });

    const sql = squash(pool.queries[0].text);
    expect(sql).toContain('update spaces set');
    expect(sql).toContain('name = $');
    expect(sql).toContain('slug = $');
    expect(sql).not.toContain('x = $');
  });

  it('devuelve null cuando el id no existe', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    expect(await createPgSpaces(pool).updateSpace('nope', { name: 'X' })).toBeNull();
  });

  it('traduce una violacion de exclusion al mover un espacio', async () => {
    const pool = fakePool(() => exclusionViolation());

    await expect(
      createPgSpaces(pool).updateSpace(SPACE_ROW.id, { x: 0, y: 0, w: 5, h: 5 }),
    ).rejects.toThrow(SpaceOverlapError);
  });

  it('traduce una violacion de unicidad al renombrar un espacio', async () => {
    // Renombrar tambien choca: `normalizeUpdateSpaceInput` deriva un slug nuevo
    // del nombre nuevo, y los dos indices unicos siguen ahi. Sin esta
    // traduccion, el alta daria 409 y el renombrado 500 por la misma falta.
    const pool = fakePool(() => uniqueViolation('spaces_name_unique'));

    await expect(
      createPgSpaces(pool).updateSpace(SPACE_ROW.id, { name: 'Cafeteria' }),
    ).rejects.toThrow(SpaceNameTakenError);
  });

  it('un error de integridad que NO es de unicidad se propaga tal cual al renombrar', async () => {
    const pool = fakePool(() =>
      Object.assign(new Error('violates check constraint'), { code: '23514' }),
    );

    await expect(
      createPgSpaces(pool).updateSpace(SPACE_ROW.id, { name: 'Cafeteria' }),
    ).rejects.toThrow('violates check constraint');
  });
});

describe('pgSpaces: deleteSpace', () => {
  it('emite un unico DELETE FROM spaces: la cascada la lleva la FK, no este adaptador', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 1 }));

    const deleted = await createPgSpaces(pool).deleteSpace(SPACE_ROW.id);

    expect(deleted).toBe(true);
    expect(pool.queries).toHaveLength(1);
    expect(squash(pool.queries[0].text)).toBe('delete from spaces where id = $1');
    expect(squash(pool.queries[0].text)).not.toContain('space_layouts');
  });

  it('devuelve false cuando el id no existia', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    expect(await createPgSpaces(pool).deleteSpace('nope')).toBe(false);
  });
});

describe('pgSpaces: listLayout', () => {
  it('consulta por space_id y mapea la fila', async () => {
    const pool = fakePool(() => ({ rows: [LAYOUT_ROW], rowCount: 1 }));

    const layout = await createPgSpaces(pool).listLayout(SPACE_ROW.id);

    expect(pool.queries[0].values).toEqual([SPACE_ROW.id]);
    expect(squash(pool.queries[0].text)).toContain('where space_id = $1');
    expect(layout).toEqual([
      {
        id: LAYOUT_ROW.id,
        spaceId: SPACE_ROW.id,
        assetId: LAYOUT_ROW.asset_id,
        x: 1,
        y: 1,
        rotation: 0,
        zIndex: 0,
        createdAt: LAYOUT_ROW.created_at,
      },
    ]);
  });
});

describe('pgSpaces: replaceLayout', () => {
  it('borra e inserta en UNA transaccion', async () => {
    const pool = fakePool(() => ({ rows: [LAYOUT_ROW], rowCount: 1 }));

    await createPgSpaces(pool).replaceLayout(SPACE_ROW.id, [
      { assetId: LAYOUT_ROW.asset_id, x: 1, y: 1, rotation: 0, zIndex: 0 },
    ]);

    const texts = pool.queries.map((q) => squash(q.text));
    expect(texts[0]).toBe('begin');
    expect(texts.some((t) => t.startsWith('delete from space_layouts where space_id = $1'))).toBe(
      true,
    );
    expect(texts.some((t) => t.startsWith('insert into space_layouts'))).toBe(true);
    expect(texts[texts.length - 1]).toBe('commit');
    expect(pool.released).toBe(1);
  });

  it('vacia el layout sin insertar nada cuando la lista de items esta vacia', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    const result = await createPgSpaces(pool).replaceLayout(SPACE_ROW.id, []);

    expect(result).toEqual([]);
    const texts = pool.queries.map((q) => squash(q.text));
    expect(texts.some((t) => t.startsWith('insert into space_layouts'))).toBe(false);
  });

  it('hace ROLLBACK si el INSERT falla', async () => {
    const pool = fakePool((text) =>
      squash(text).startsWith('insert into space_layouts')
        ? Object.assign(new Error('boom'), { code: '23503' })
        : { rows: [], rowCount: 0 },
    );

    await expect(
      createPgSpaces(pool).replaceLayout(SPACE_ROW.id, [
        { assetId: LAYOUT_ROW.asset_id, x: 1, y: 1, rotation: 0, zIndex: 0 },
      ]),
    ).rejects.toThrow('boom');

    const texts = pool.queries.map((q) => squash(q.text));
    expect(texts[texts.length - 1]).toBe('rollback');
  });
});

describe('pgSpaces: version', () => {
  it('calcula el hash canonico sobre las filas leidas', async () => {
    const other = { ...SPACE_ROW, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', slug: 'cafeteria', name: 'Cafetería', y: 18 };
    const pool = fakePool(() => ({ rows: [SPACE_ROW, other], rowCount: 2 }));

    const version = await createPgSpaces(pool).version();

    expect(version).toMatch(/^[0-9a-f]{16}$/);
  });

  it('es el mismo hash que produciria spaceRules.hashSpaces sobre las mismas filas', async () => {
    const pool = fakePool(() => ({ rows: [SPACE_ROW], rowCount: 1 }));
    const { hashSpaces } = await import('./spaceRules.ts');

    const version = await createPgSpaces(pool).version();

    expect(version).toBe(
      hashSpaces([
        {
          id: SPACE_ROW.id,
          slug: SPACE_ROW.slug,
          name: SPACE_ROW.name,
          x: SPACE_ROW.x,
          y: SPACE_ROW.y,
          w: SPACE_ROW.w,
          h: SPACE_ROW.h,
          capacity: SPACE_ROW.capacity,
        },
      ]),
    );
  });
});
