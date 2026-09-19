/**
 * Adaptador de Postgres de `DeskDirectory` (#7, slice 5), probado igual que
 * `pgSpaces.test.ts`: un pool de mentira que responde por el TEXTO de la
 * consulta, sin levantar ninguna base de datos.
 *
 * Aqui SI se mira el SQL, y en un sitio no es opcional. `claimDesk` es una
 * carrera: dos personas pueden pedir el mismo escritorio libre en el mismo
 * instante. La unica forma de arbitrarla es un UPDATE condicional
 * (`WHERE ... AND occupant_id IS NULL`) cuyo numero de filas ES la respuesta.
 * Un `SELECT` seguido de un `UPDATE` pasaria estas mismas pruebas de
 * comportamiento contra un solo hilo y perderia la carrera en produccion, asi
 * que la forma de la consulta se afirma explicitamente.
 */

import { describe, expect, it } from 'vitest';
import { DeskOverlapError, DeskTakenError, InvalidDeskError } from './deskRules.ts';
import { createPgDesks } from './pgDesks.ts';
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
  return Object.assign(
    new Error('conflicting key value violates exclusion constraint "desks_no_overlap"'),
    { code: '23P01' },
  );
}

const DESK_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Mesa 1',
  x: 4,
  y: 6,
  occupant_id: null,
  created_at: new Date('2026-02-01T10:00:00.000Z'),
  updated_at: new Date('2026-02-01T10:00:00.000Z'),
};

const ANA = '22222222-2222-4222-8222-222222222222';

function sqls(pool: FakePool): string[] {
  return pool.queries.map((query) => squash(query.text));
}

describe('pgDesks: listDesks', () => {
  it('mapea las filas al tipo del puerto en orden deterministico', async () => {
    const pool = fakePool(() => ({ rows: [DESK_ROW], rowCount: 1 }));

    const desks = await createPgDesks(pool).listDesks();

    expect(desks).toEqual([
      {
        id: DESK_ROW.id,
        label: 'Mesa 1',
        x: 4,
        y: 6,
        occupantId: null,
        createdAt: DESK_ROW.created_at,
        updatedAt: DESK_ROW.updated_at,
      },
    ]);
    expect(sqls(pool)[0]).toContain('order by x, y, id');
  });

  it('NO selecciona w ni h: no existen como columnas', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    await createPgDesks(pool).listDesks();

    expect(sqls(pool)[0]).not.toMatch(/\bw\b/);
    expect(sqls(pool)[0]).not.toMatch(/,\s*h\b/);
  });
});

describe('pgDesks: createDesk', () => {
  it('valida ANTES de pedir conexion: una posicion mala no cuesta una consulta', async () => {
    const pool = fakePool();

    await expect(createPgDesks(pool).createDesk({ label: 'Mesa', x: -1, y: 0 })).rejects.toThrow(
      InvalidDeskError,
    );

    expect(pool.queries).toHaveLength(0);
  });

  it('inserta la etiqueta recortada y la posicion', async () => {
    const pool = fakePool(() => ({ rows: [DESK_ROW], rowCount: 1 }));

    await createPgDesks(pool).createDesk({ label: '  Mesa 1 ', x: 4, y: 6 });

    expect(pool.queries[0].values).toEqual(['Mesa 1', 4, 6]);
    expect(sqls(pool)[0]).toContain('insert into desks (label, x, y)');
  });

  it('NO inserta occupant_id: un escritorio nace libre', async () => {
    const pool = fakePool(() => ({ rows: [DESK_ROW], rowCount: 1 }));

    await createPgDesks(pool).createDesk({ label: 'Mesa 1', x: 4, y: 6 });

    // Acotado a lo que se ESCRIBE: el `RETURNING` si nombra `occupant_id`,
    // porque la fila que vuelve lo trae, y una busqueda sobre la consulta
    // entera no distinguiria las dos cosas.
    const escritura = sqls(pool)[0].slice(0, sqls(pool)[0].indexOf('returning'));

    expect(escritura).not.toContain('occupant_id');
  });

  it('traduce la violacion de exclusion a un error de dominio, no a un 500', async () => {
    const pool = fakePool(() => exclusionViolation());

    await expect(
      createPgDesks(pool).createDesk({ label: 'Mesa', x: 0, y: 0 }),
    ).rejects.toThrow(DeskOverlapError);
  });
});

describe('pgDesks: updateDesk', () => {
  it('un patch vacio RELEE en vez de pisar updated_at sin motivo', async () => {
    const pool = fakePool(() => ({ rows: [DESK_ROW], rowCount: 1 }));

    await createPgDesks(pool).updateDesk(DESK_ROW.id, {});

    expect(sqls(pool)[0]).toContain('select');
    expect(sqls(pool)[0]).not.toContain('update desks');
  });

  it('actualiza solo los campos presentes y refresca updated_at', async () => {
    const pool = fakePool(() => ({ rows: [DESK_ROW], rowCount: 1 }));

    await createPgDesks(pool).updateDesk(DESK_ROW.id, { label: 'Mesa 9' });

    expect(sqls(pool)[0]).toContain('update desks set label = $2, updated_at = now()');
    expect(pool.queries[0].values).toEqual([DESK_ROW.id, 'Mesa 9']);
  });

  it('NO toca occupant_id: mover o renombrar no levanta a quien lo ocupa', async () => {
    const pool = fakePool(() => ({ rows: [DESK_ROW], rowCount: 1 }));

    await createPgDesks(pool).updateDesk(DESK_ROW.id, { x: 1, y: 2 });

    expect(sqls(pool)[0]).not.toContain('occupant_id =');
  });

  it('devuelve null si ese id no existe', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    expect(await createPgDesks(pool).updateDesk('no-existe', { label: 'Mesa' })).toBeNull();
  });

  it('traduce la violacion de exclusion a un error de dominio', async () => {
    const pool = fakePool(() => exclusionViolation());

    await expect(
      createPgDesks(pool).updateDesk(DESK_ROW.id, { x: 1, y: 1 }),
    ).rejects.toThrow(DeskOverlapError);
  });
});

describe('pgDesks: deleteDesk', () => {
  it('borra de verdad y dice si habia algo que borrar', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 1 }));

    expect(await createPgDesks(pool).deleteDesk(DESK_ROW.id)).toBe(true);
    expect(sqls(pool)[0]).toContain('delete from desks where id = $1');
  });

  it('devuelve false si ese id no existia', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    expect(await createPgDesks(pool).deleteDesk('no-existe')).toBe(false);
  });
});

describe('pgDesks: claimDesk', () => {
  /**
   * Responde como Postgres a la secuencia de `claimDesk`: la liberacion del
   * anterior siempre pasa, y el UPDATE condicional del nuevo toca `claimed`
   * filas.
   */
  function claimPool(options: { claimed: number; exists?: boolean }) {
    return fakePool((text) => {
      const sql = squash(text);
      if (sql.includes('set occupant_id = $1')) {
        return options.claimed > 0
          ? { rows: [{ ...DESK_ROW, occupant_id: ANA }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select')) {
        return options.exists === false ? { rows: [], rowCount: 0 } : { rows: [DESK_ROW], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  it('es UN SOLO UPDATE condicional, no un read-then-write', async () => {
    // La propiedad de la slice. Leer y luego escribir tiene una ventana entre
    // las dos consultas en la que otra persona entra: las dos leerian "libre"
    // y las dos escribirian. Con la condicion DENTRO del UPDATE, el arbitro es
    // Postgres y el numero de filas afectadas ES la respuesta.
    const pool = claimPool({ claimed: 1 });

    await createPgDesks(pool).claimDesk(DESK_ROW.id, ANA);

    const claim = sqls(pool).find((sql) => sql.includes('set occupant_id = $1'))!;
    expect(claim).toContain('update desks set occupant_id = $1, updated_at = now()');
    expect(claim).toContain('where id = $2');
    expect(claim).toContain('occupant_id is null');
  });

  it('el UPDATE tambien acepta el escritorio que YA es de quien lo pide', async () => {
    // Pedir el propio es un exito sin efecto y no un conflicto contra uno
    // mismo. Va en la MISMA condicion y no en una lectura previa, para no
    // reintroducir por la puerta de atras el read-then-write que se evita.
    const pool = claimPool({ claimed: 1 });

    await createPgDesks(pool).claimDesk(DESK_ROW.id, ANA);

    const claim = sqls(pool).find((sql) => sql.includes('set occupant_id = $1'))!;
    expect(claim).toContain('occupant_id is null or occupant_id = $1');
  });

  it('suelta el escritorio anterior en la MISMA transaccion y ANTES de reclamar', async () => {
    // El orden importa: `desks_single_occupant` es un indice unico que se
    // comprueba al vuelo, asi que reclamar el nuevo con el viejo todavia
    // puesto fallaria con una violacion de unicidad. Y la transaccion importa
    // porque, si el nuevo se pierde, el viejo tiene que volver.
    const pool = claimPool({ claimed: 1 });

    await createPgDesks(pool).claimDesk(DESK_ROW.id, ANA);

    const ejecutadas = sqls(pool);
    const release = ejecutadas.findIndex((sql) => sql.includes('set occupant_id = null'));
    const claim = ejecutadas.findIndex((sql) => sql.includes('set occupant_id = $1'));
    expect(ejecutadas[0]).toBe('begin');
    expect(release).toBeGreaterThan(0);
    expect(release).toBeLessThan(claim);
    expect(ejecutadas).toContain('commit');
  });

  it('la liberacion previa EXCLUYE el escritorio que se esta pidiendo', async () => {
    // Soltarlo y volver a cogerlo dejaria una ventana en la que el sitio
    // propio esta libre para cualquiera, justo al refrescar la pagina.
    const pool = claimPool({ claimed: 1 });

    await createPgDesks(pool).claimDesk(DESK_ROW.id, ANA);

    const release = sqls(pool).find((sql) => sql.includes('set occupant_id = null'))!;
    expect(release).toContain('where occupant_id = $1 and id <> $2');
  });

  it('cero filas afectadas con el escritorio existente es DeskTakenError', async () => {
    const pool = claimPool({ claimed: 0, exists: true });

    await expect(createPgDesks(pool).claimDesk(DESK_ROW.id, ANA)).rejects.toThrow(DeskTakenError);
  });

  it('un intento fallido hace ROLLBACK: quien tenia sitio no se queda sin el', async () => {
    const pool = claimPool({ claimed: 0, exists: true });

    await expect(createPgDesks(pool).claimDesk(DESK_ROW.id, ANA)).rejects.toThrow(DeskTakenError);

    expect(sqls(pool)).toContain('rollback');
    expect(sqls(pool)).not.toContain('commit');
    expect(pool.released).toBe(1);
  });

  it('cero filas afectadas con un id que NO existe es null, y no un 409', async () => {
    // Clasificar el fallo se hace DESPUES, sobre una transaccion ya deshecha:
    // solo explica algo que ya paso, asi que no reintroduce ninguna carrera.
    const pool = claimPool({ claimed: 0, exists: false });

    expect(await createPgDesks(pool).claimDesk('no-existe', ANA)).toBeNull();
  });

  it('devuelve el escritorio ya ocupado cuando lo consigue', async () => {
    const pool = claimPool({ claimed: 1 });

    expect(await createPgDesks(pool).claimDesk(DESK_ROW.id, ANA)).toMatchObject({
      id: DESK_ROW.id,
      occupantId: ANA,
    });
  });
});

describe('pgDesks: releaseDesk', () => {
  it('suelta lo que tenga esa persona con un solo UPDATE', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 1 }));

    await createPgDesks(pool).releaseDesk(ANA);

    expect(sqls(pool)[0]).toContain('update desks set occupant_id = null, updated_at = now()');
    expect(sqls(pool)[0]).toContain('where occupant_id = $1');
    expect(pool.queries[0].values).toEqual([ANA]);
  });

  it('soltar sin tener nada NO es un error: cero filas es un exito', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    await expect(createPgDesks(pool).releaseDesk(ANA)).resolves.toBeUndefined();
  });

  it('el UPDATE lo acota el OCUPANTE y nunca un id de escritorio del cliente', async () => {
    // Quien suelta solo puede soltar lo suyo. Si la consulta se acotase por
    // `id`, un id ajeno en el cuerpo levantaria a otra persona.
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    await createPgDesks(pool).releaseDesk(ANA);

    expect(sqls(pool)[0]).not.toContain('where id =');
  });
});

describe('pgDesks: listOfficeDesks', () => {
  const OCCUPIED_ROW = { ...DESK_ROW, occupant_id: ANA, display_name: 'Ana' };

  const ITEM_ROW = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: ANA,
    asset_id: '44444444-4444-4444-8444-444444444444',
    slot: 8,
    rotation: 90,
    created_at: DESK_ROW.created_at,
    texture_key: 'plant-small',
    w: 1,
    h: 1,
    name: 'Planta',
  };

  function officePool(rows: Record<string, unknown>[], items: Record<string, unknown>[]) {
    return fakePool((text) => {
      const sql = squash(text);
      if (sql.includes('user_desk_configs')) return { rows: items, rowCount: items.length };
      return { rows, rowCount: rows.length };
    });
  }

  it('resuelve el nombre del ocupante con un JOIN al directorio', async () => {
    const pool = officePool([OCCUPIED_ROW], []);

    const office = await createPgDesks(pool).listOfficeDesks();

    expect(office[0].occupant).toMatchObject({ id: ANA, displayName: 'Ana' });
    expect(sqls(pool)[0]).toContain('left join users u on u.id = d.occupant_id');
  });

  it('el JOIN es LEFT: un escritorio libre sigue apareciendo, sin ocupante', async () => {
    // Un INNER JOIN esconderia justo los escritorios que alguien quiere coger.
    const pool = officePool([DESK_ROW], []);

    const office = await createPgDesks(pool).listOfficeDesks();

    expect(office[0].occupant).toBeNull();
  });

  it('trae la decoracion de TODOS los ocupantes en una sola consulta acotada', async () => {
    // Una consulta por ocupante seria una oficina llena de idas y vueltas
    // proporcional a cuanta gente haya sentada.
    const pool = officePool([OCCUPIED_ROW], [ITEM_ROW]);

    const office = await createPgDesks(pool).listOfficeDesks();

    expect(office[0].occupant?.items).toEqual([
      expect.objectContaining({ assetId: ITEM_ROW.asset_id, slot: 8, textureKey: 'plant-small' }),
    ]);
    const items = sqls(pool).find((sql) => sql.includes('user_desk_configs'))!;
    expect(items).toContain('user_id = any($1::uuid[])');
    expect(pool.queries.at(-1)?.values).toEqual([[ANA]]);
  });

  it('la decoracion NO filtra archivados: quien ya la tenia puesta la sigue viendo (D1b)', async () => {
    const pool = officePool([OCCUPIED_ROW], [ITEM_ROW]);

    await createPgDesks(pool).listOfficeDesks();

    const items = sqls(pool).find((sql) => sql.includes('user_desk_configs'))!;
    expect(items).not.toContain('archived_at');
  });

  it('sin nadie sentado NO pregunta por decoracion de nadie', async () => {
    const pool = officePool([DESK_ROW], []);

    await createPgDesks(pool).listOfficeDesks();

    expect(sqls(pool).some((sql) => sql.includes('user_desk_configs'))).toBe(false);
  });

  it('mantiene el mismo orden que listDesks', async () => {
    const pool = officePool([DESK_ROW], []);

    await createPgDesks(pool).listOfficeDesks();

    expect(sqls(pool)[0]).toContain('order by d.x, d.y, d.id');
  });
});
