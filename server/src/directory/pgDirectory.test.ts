/**
 * El adaptador de Postgres se prueba contra un ejecutor de consultas inyectado,
 * no contra una base de datos. El motivo es el de siempre en este repo: una
 * suite que necesita infraestructura levantada acaba sin correrse, y entonces
 * no protege de nada.
 *
 * Lo que SI se puede afirmar sin base de datos es todo lo que este fichero se
 * juega: que la forma del SQL es la pactada (una sola sentencia para el login,
 * transaccion para invitar y revocar, el JOIN de la lista), que los parametros
 * van en su sitio y ya normalizados, y que la fila de `pg` se traduce al tipo
 * del puerto. Lo que NO prueba -- que Postgres entienda ese SQL -- lo prueba el
 * arranque real contra la base de datos, y la regla de negocio de verdad (el
 * bootstrap) esta probada por comportamiento en `memoryDirectory.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { InvalidInvitationError } from './invitationRules.ts';
import { createPgDirectory, type DirectoryPool, type DirectoryQueryResult } from './pgDirectory.ts';

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
  ended: number;
}

function fakePool(respond: Responder = () => ({ rows: [], rowCount: 0 })): FakePool {
  const queries: RecordedQuery[] = [];
  const state = { released: 0, ended: 0 };

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
    get ended() {
      return state.ended;
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
    async end() {
      state.ended++;
    },
  };
}

/** Error con la forma que trae `pg` cuando un indice unico salta. */
function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
}

const USER_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  uid: 'uid-ana',
  email: 'ana@example.com',
  display_name: 'Ana',
  role: 'employee',
  status: 'active',
  expires_at: null,
  invited_by: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
};

const ANA = { uid: 'uid-ana', email: 'ana@example.com', name: 'Ana' };

function directoryOver(pool: DirectoryPool, bootstrapSuperadminEmail: string | null = null) {
  return createPgDirectory(pool, { bootstrapSuperadminEmail });
}

describe('pgDirectory: resolveOnLogin', () => {
  it('traduce la fila de postgres al tipo del puerto', async () => {
    const pool = fakePool(() => ({ rows: [USER_ROW], rowCount: 1 }));

    const user = await directoryOver(pool).resolveOnLogin(ANA);

    expect(user).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      uid: 'uid-ana',
      email: 'ana@example.com',
      displayName: 'Ana',
      role: 'employee',
      status: 'active',
      expiresAt: null,
      invitedBy: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('resuelve el login en UNA sola sentencia', async () => {
    // Un SELECT seguido de un INSERT tendria una ventana entre los dos: dos
    // pestanas abriendo sesion a la vez pasarian ambas por el "no existe". Con
    // `ON CONFLICT` la carrera la resuelve Postgres, que es quien puede.
    const pool = fakePool(() => ({ rows: [USER_ROW], rowCount: 1 }));

    await directoryOver(pool).resolveOnLogin(ANA);

    expect(pool.queries).toHaveLength(1);
    const sql = squash(pool.queries[0].text);
    expect(sql).toContain('insert into users');
    expect(sql).toContain('on conflict (uid) do update');
  });

  it('la promocion a superadmin exige el email de bootstrap Y que no haya ninguno', async () => {
    const pool = fakePool(() => ({ rows: [USER_ROW], rowCount: 1 }));

    await directoryOver(pool, 'hugo@example.com').resolveOnLogin(ANA);

    const sql = squash(pool.queries[0].text);
    expect(sql).toContain("not exists (select 1 from users where role = 'superadmin')");
    expect(sql).toContain("then 'superadmin' else 'employee' end");
  });

  it('manda el email ya normalizado y el de bootstrap como parametro', async () => {
    // Como parametro y no interpolado: viene del entorno, pero un entorno con
    // una comilla dentro no tiene por que poder reescribir la sentencia.
    const pool = fakePool(() => ({ rows: [USER_ROW], rowCount: 1 }));

    await directoryOver(pool, '  Hugo@Example.COM ').resolveOnLogin({
      uid: 'uid-ana',
      email: '  Ana@Example.com ',
      name: 'Ana',
    });

    expect(pool.queries[0].values).toEqual(['uid-ana', 'ana@example.com', 'Ana', 'hugo@example.com']);
  });

  it('sin email de bootstrap manda null, no una cadena vacia', async () => {
    const pool = fakePool(() => ({ rows: [USER_ROW], rowCount: 1 }));

    await directoryOver(pool).resolveOnLogin(ANA);

    expect(pool.queries[0].values[3]).toBeNull();
  });

  it('un token sin email no entra y no llega a tocar la base de datos', async () => {
    const pool = fakePool();

    const user = await directoryOver(pool).resolveOnLogin({
      uid: 'uid-anon',
      email: null,
      name: null,
    });

    expect(user).toBeNull();
    expect(pool.queries).toHaveLength(0);
  });

  it('reintenta una vez si salta un indice unico: es la carrera del bootstrap', async () => {
    // Dos logins simultaneos pueden pasar los dos por el `NOT EXISTS` antes de
    // que ninguno haya insertado; el indice parcial deja pasar solo a uno y el
    // otro recibe 23505. Repetir la sentencia ya ve al superadmin y entra como
    // empleado, que es exactamente lo que debia pasar.
    let attempts = 0;
    const pool = fakePool(() => {
      attempts++;
      return attempts === 1 ? uniqueViolation() : { rows: [USER_ROW], rowCount: 1 };
    });

    const user = await directoryOver(pool, 'ana@example.com').resolveOnLogin(ANA);

    expect(attempts).toBe(2);
    expect(user?.role).toBe('employee');
  });

  it('si el reintento tambien choca, relee por uid en vez de reventar el login', async () => {
    // El segundo 23505 ya no es la carrera del superadmin sino el email unico:
    // ese email existe con otro uid. Releer devuelve `null` para este uid y la
    // decision de acceso lo tratara como no aprovisionado, que es el default
    // seguro: no se le inventa una fila ni se le deja entrar.
    const pool = fakePool((text) =>
      squash(text).startsWith('insert into users') ? uniqueViolation() : { rows: [], rowCount: 0 },
    );

    const user = await directoryOver(pool, 'ana@example.com').resolveOnLogin(ANA);

    expect(user).toBeNull();
    expect(squash(pool.queries[2].text)).toContain('select');
  });

  it('un error que no sea de indice unico se propaga', async () => {
    // "La base de datos esta caida" no puede disfrazarse de "esta persona no
    // esta en el directorio": el primero se arregla y el segundo no.
    const pool = fakePool(() => Object.assign(new Error('connection terminated'), { code: '08006' }));

    await expect(directoryOver(pool).resolveOnLogin(ANA)).rejects.toThrow('connection terminated');
  });
});

describe('pgDirectory: busquedas', () => {
  it('findByUid consulta por uid y mapea la fila', async () => {
    const pool = fakePool(() => ({ rows: [USER_ROW], rowCount: 1 }));

    const user = await directoryOver(pool).findByUid('uid-ana');

    expect(pool.queries[0].values).toEqual(['uid-ana']);
    expect(squash(pool.queries[0].text)).toContain('where uid = $1');
    expect(user?.id).toBe(USER_ROW.id);
  });

  it('findByUid devuelve null cuando no hay fila', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    expect(await directoryOver(pool).findByUid('uid-de-nadie')).toBeNull();
  });

  it('findById consulta por id y mapea la fila', async () => {
    const pool = fakePool(() => ({ rows: [USER_ROW], rowCount: 1 }));

    const user = await directoryOver(pool).findById(USER_ROW.id);

    expect(pool.queries[0].values).toEqual([USER_ROW.id]);
    expect(squash(pool.queries[0].text)).toContain('where id = $1');
    expect(user?.uid).toBe('uid-ana');
  });

  it('findById devuelve null cuando no hay fila', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    expect(
      await directoryOver(pool).findById('00000000-0000-4000-8000-000000000000'),
    ).toBeNull();
  });
});

describe('pgDirectory: listInvitations', () => {
  const INVITATION_ROW = {
    ...USER_ROW,
    id: '22222222-2222-4222-8222-222222222222',
    uid: 'uid-externo',
    email: 'externo@example.com',
    display_name: null,
    role: 'guest',
    expires_at: new Date('2026-09-24T12:00:00.000Z'),
    invited_by: USER_ROW.id,
    invited_by_email: 'hugo@example.com',
  };

  it('filtra a los que vinieron por invitacion y ordena por fecha descendente', async () => {
    const pool = fakePool(() => ({ rows: [INVITATION_ROW], rowCount: 1 }));

    await directoryOver(pool).listInvitations();

    const sql = squash(pool.queries[0].text);
    expect(sql).toContain('invited_by is not null');
    expect(sql).toContain('order by');
    expect(sql).toContain('created_at desc');
  });

  it('resuelve el email de quien invito con un LEFT JOIN, no con un INNER', async () => {
    // Un INNER perderia la invitacion entera si el administrador que la firmo
    // ya no estuviese: desaparecer del panel es peor que mostrarla sin autor.
    const pool = fakePool(() => ({ rows: [INVITATION_ROW], rowCount: 1 }));

    const rows = await directoryOver(pool).listInvitations();

    expect(squash(pool.queries[0].text)).toContain('left join');
    expect(rows[0].invitedByEmail).toBe('hugo@example.com');
  });

  it('mapea la caducidad y el estado de cada fila', async () => {
    const pool = fakePool(() => ({ rows: [INVITATION_ROW], rowCount: 1 }));

    const rows = await directoryOver(pool).listInvitations();

    expect(rows[0]).toMatchObject({
      email: 'externo@example.com',
      role: 'guest',
      status: 'active',
      expiresAt: new Date('2026-09-24T12:00:00.000Z'),
      invitedBy: USER_ROW.id,
    });
  });

  it('una lista vacia es una lista vacia, no un null', async () => {
    const pool = fakePool(() => ({ rows: [], rowCount: 0 }));

    expect(await directoryOver(pool).listInvitations()).toEqual([]);
  });
});

describe('pgDirectory: createInvitation', () => {
  const GUEST_ROW = {
    ...USER_ROW,
    id: '22222222-2222-4222-8222-222222222222',
    uid: 'uid-externo',
    email: 'externo@example.com',
    display_name: null,
    role: 'guest',
    expires_at: new Date('2026-09-24T12:00:00.000Z'),
    invited_by: USER_ROW.id,
  };

  const INPUT = {
    email: 'Externo@Example.com',
    days: 7,
    invitedById: USER_ROW.id,
    uid: 'uid-externo',
  };

  function invitingPool() {
    return fakePool((text) =>
      squash(text).startsWith('insert into users')
        ? { rows: [GUEST_ROW], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
  }

  it('valida los dias ANTES de abrir nada: ni conexion ni transaccion', async () => {
    // Si la validacion viviese dentro de la transaccion, un `days` invalido
    // costaria una conexion del pool y un BEGIN/ROLLBACK por cada error de
    // tecleo del administrador.
    const pool = fakePool();

    await expect(directoryOver(pool).createInvitation({ ...INPUT, days: 91 })).rejects.toBeInstanceOf(
      InvalidInvitationError,
    );
    expect(pool.queries).toHaveLength(0);
  });

  it('inserta al invitado y su rastro de auditoria en la MISMA transaccion', async () => {
    // Que la fila exista sin rastro dejaria el panel diciendo que alguien fue
    // invitado por nadie, que es justo lo que la seccion 10 del PRD pide poder
    // responder.
    const pool = invitingPool();

    await directoryOver(pool).createInvitation(INPUT);

    const sqls = pool.queries.map((query) => squash(query.text));
    expect(sqls[0]).toBe('begin');
    expect(sqls[1]).toContain('insert into users');
    expect(sqls[2]).toContain('insert into audit_log');
    expect(sqls[3]).toBe('commit');
  });

  it('el invitado nace como guest activo, con el email normalizado y su caducidad', async () => {
    const pool = invitingPool();

    const guest = await directoryOver(pool).createInvitation(INPUT);

    const insert = pool.queries[1];
    expect(squash(insert.text)).toContain("'guest'");
    expect(squash(insert.text)).toContain('now() + make_interval(days => $4::int)');
    expect(insert.values).toEqual(['uid-externo', 'externo@example.com', USER_ROW.id, 7]);
    expect(guest.role).toBe('guest');
    expect(guest.expiresAt).toEqual(new Date('2026-09-24T12:00:00.000Z'));
  });

  it('la caducidad la calcula postgres con su reloj, no el proceso de node', async () => {
    // Dos relojes (el del contenedor y el de la base) que se separen darian una
    // caducidad que ni el panel ni la comprobacion de acceso ven igual.
    const pool = invitingPool();

    await directoryOver(pool).createInvitation(INPUT);

    expect(squash(pool.queries[1].text)).toContain('now()');
  });

  it('la auditoria registra a quien invita como actor y al invitado como sujeto', async () => {
    const pool = invitingPool();

    await directoryOver(pool).createInvitation(INPUT);

    expect(pool.queries[2].values).toEqual([USER_ROW.id, 'invite', GUEST_ROW.id]);
  });

  it('si algo falla se hace ROLLBACK y no queda media invitacion', async () => {
    const pool = fakePool((text) =>
      squash(text).startsWith('insert into audit_log')
        ? new Error('audit_log no existe')
        : { rows: [GUEST_ROW], rowCount: 1 },
    );

    await expect(directoryOver(pool).createInvitation(INPUT)).rejects.toThrow('audit_log no existe');

    expect(pool.queries.map((query) => squash(query.text))).toContain('rollback');
  });

  it('devuelve la conexion al pool pase lo que pase', async () => {
    // Una conexion no devuelta por cada error agota el pool y el sintoma
    // aparece horas despues, lejos del fallo que lo causo.
    const ok = invitingPool();
    await directoryOver(ok).createInvitation(INPUT);
    expect(ok.released).toBe(1);

    const failing = fakePool((text) =>
      squash(text).startsWith('insert into users') ? new Error('boom') : { rows: [], rowCount: 0 },
    );
    await expect(directoryOver(failing).createInvitation(INPUT)).rejects.toThrow('boom');
    expect(failing.released).toBe(1);
  });
});

describe('pgDirectory: revoke', () => {
  const REVOKED_ROW = {
    ...USER_ROW,
    id: '22222222-2222-4222-8222-222222222222',
    uid: 'uid-externo',
    email: 'externo@example.com',
    role: 'guest',
    status: 'revoked',
    invited_by: USER_ROW.id,
  };

  function revokingPool(rows: Record<string, unknown>[]) {
    return fakePool((text) =>
      squash(text).startsWith('update users') ? { rows, rowCount: rows.length } : { rows: [], rowCount: 0 },
    );
  }

  it('cambia el estado y escribe la auditoria en la misma transaccion', async () => {
    const pool = revokingPool([REVOKED_ROW]);

    const revoked = await directoryOver(pool).revoke(REVOKED_ROW.id, USER_ROW.id);

    const sqls = pool.queries.map((query) => squash(query.text));
    expect(sqls[0]).toBe('begin');
    expect(sqls[1]).toContain("set status = 'revoked'");
    expect(sqls[2]).toContain('insert into audit_log');
    expect(sqls[3]).toBe('commit');
    expect(revoked?.status).toBe('revoked');
  });

  it('solo revoca invitaciones: la propia sentencia lo exige', async () => {
    // La guarda va en el WHERE y no en un `if` de TypeScript a proposito: asi
    // no hay una ventana entre comprobar y actualizar, y no existe forma de
    // llamar a este metodo que expulse a un empleado.
    const pool = revokingPool([REVOKED_ROW]);

    await directoryOver(pool).revoke(REVOKED_ROW.id, USER_ROW.id);

    expect(squash(pool.queries[1].text)).toContain('invited_by is not null');
  });

  it('devuelve null y deshace la transaccion si no hay tal invitacion', async () => {
    const pool = revokingPool([]);

    const result = await directoryOver(pool).revoke('00000000-0000-4000-8000-000000000000', USER_ROW.id);

    expect(result).toBeNull();
    const sqls = pool.queries.map((query) => squash(query.text));
    expect(sqls).toContain('rollback');
    expect(sqls.some((sql) => sql.startsWith('insert into audit_log'))).toBe(false);
  });

  it('la auditoria registra a quien revoca, no al revocado', async () => {
    const pool = revokingPool([REVOKED_ROW]);

    await directoryOver(pool).revoke(REVOKED_ROW.id, USER_ROW.id);

    expect(pool.queries[2].values).toEqual([USER_ROW.id, 'revoke', REVOKED_ROW.id]);
  });

  it('devuelve la conexion al pool tambien cuando no hay nada que revocar', async () => {
    const pool = revokingPool([]);

    await directoryOver(pool).revoke('00000000-0000-4000-8000-000000000000', USER_ROW.id);

    expect(pool.released).toBe(1);
  });
});

describe('pgDirectory: close', () => {
  it('cierra el pool', async () => {
    // Sin esto, `shutdown()` deja conexiones vivas y un test que levanta y apaga
    // el servidor cuelga el proceso de vitest al terminar.
    const pool = fakePool();

    await directoryOver(pool).close();

    expect(pool.ended).toBe(1);
  });
});
