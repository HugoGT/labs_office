/**
 * Las migraciones se prueban contra un ejecutor inyectado: lo que hay que poder
 * afirmar sin Postgres delante es que el esquema que se manda contiene las
 * garantias que este cambio promete, y que volver a arrancar no rompe nada.
 *
 * Varias de estas aserciones miran el texto del SQL, que normalmente seria una
 * mala prueba. Aqui no lo es: el indice unico parcial del superadmin y el de
 * `lower(email)` NO son detalles de implementacion, son la garantia misma. Si
 * alguien los quita, todo lo demas sigue pasando y la oficina se queda sin su
 * unica proteccion real contra un segundo superadmin.
 */

import { describe, expect, it } from 'vitest';
import { migrate, readSchemaSql } from './migrate.ts';

/**
 * Solo las sentencias: los comentarios del fichero nombran `citext` para
 * explicar por que NO se usa, y una asercion que mirase el texto entero se
 * dispararia con la explicacion en vez de con el esquema.
 */
const schema = readSchemaSql()
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .toLowerCase();

interface Recorder {
  texts: string[];
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
}

function recorder(): Recorder {
  const texts: string[] = [];
  return {
    texts,
    async query(text: string) {
      texts.push(text);
      return { rows: [] };
    },
  };
}

describe('migrate', () => {
  it('manda el esquema a la base de datos', async () => {
    const db = recorder();

    await migrate(db);

    expect(db.texts).toHaveLength(1);
    expect(db.texts[0]).toBe(readSchemaSql());
  });

  it('se puede correr dos veces seguidas, que es lo que pasa en cada arranque', async () => {
    const db = recorder();

    await migrate(db);
    await migrate(db);

    expect(db.texts[0]).toBe(db.texts[1]);
  });

  it('propaga el error si el esquema no se puede aplicar', async () => {
    // Arrancar con el esquema a medias seria peor que no arrancar: el servidor
    // aceptaria logins y fallaria en la primera consulta, con un error que no
    // menciona las migraciones por ningun lado.
    const db = {
      async query() {
        throw new Error('permission denied for schema public');
      },
    };

    await expect(migrate(db)).rejects.toThrow('permission denied');
  });
});

describe('schema.sql: lo que no puede faltar', () => {
  it('crea las tablas solo si no existen', () => {
    expect(schema).toContain('create table if not exists users');
    expect(schema).toContain('create table if not exists audit_log');
  });

  it('genera los ids con gen_random_uuid(), que no necesita extension en postgres 13+', () => {
    expect(schema).toContain('gen_random_uuid()');
  });

  it('NO pide ninguna extension', () => {
    // `citext` habria sido comodo para el email, pero exige un
    // `CREATE EXTENSION` que necesita permisos de superusuario en la base de
    // datos. En un Postgres gestionado eso es justo lo que uno no tiene, y el
    // fallo aparece en el arranque del despliegue, no en local. `text` mas un
    // indice unico sobre `lower(email)` da la misma garantia sin pedir nada.
    expect(schema).not.toContain('create extension');
    expect(schema).not.toContain('citext');
  });

  it('garantiza como mucho UN superadmin con un indice unico parcial', () => {
    // La garantia de verdad. El `CASE` de `pgDirectory.ts` es la version
    // amable; esto es lo que hace imposible el segundo superadmin incluso con
    // dos logins simultaneos o con un UPDATE hecho a mano contra la base.
    expect(schema).toContain('create unique index if not exists users_single_superadmin');
    expect(schema).toContain("where role = 'superadmin'");
  });

  it('impide dos cuentas con el mismo email aunque cambie el uso de mayusculas', () => {
    expect(schema).toContain('unique index if not exists users_email_unique');
    expect(schema).toContain('lower(email)');
  });

  it('el uid es unico, que es lo que hace idempotente al login', () => {
    // `ON CONFLICT (uid)` de `resolveOnLogin` exige que exista este indice: sin
    // el, Postgres rechaza la sentencia entera.
    expect(schema).toMatch(/uid\s+text\s+unique/);
  });

  it('acota rol y estado con CHECK, no solo con el tipo de TypeScript', () => {
    // El tipo `Role` no existe en tiempo de ejecucion ni protege de un UPDATE
    // escrito a mano contra la base de datos.
    expect(schema).toContain("check (role in ('superadmin', 'admin', 'employee', 'guest'))");
    expect(schema).toContain("check (status in ('active', 'revoked'))");
  });

  it('quien invito es una clave foranea a la propia tabla', () => {
    expect(schema).toContain('invited_by uuid references users(id)');
  });

  it('la auditoria guarda actor, accion y sujeto (PRD 10, punto 7 del issue)', () => {
    expect(schema).toContain('actor_id uuid references users(id)');
    expect(schema).toContain('subject_id uuid references users(id)');
    expect(schema).toContain("check (action in ('invite', 'revoke', 'create-user'))");
  });

  it('refresca el CHECK de la auditoria en un despliegue que ya tenia la tabla', () => {
    // `CREATE TABLE IF NOT EXISTS` NO actualiza una tabla que ya existe: en un
    // despliegue vivo el CHECK viejo seguiria permitiendo solo 'invite' y
    // 'revoke', y cada alta de alguien de casa moriria con una violacion de
    // restriccion justo en el peor momento -- con la cuenta de Identity
    // Platform ya creada, es decir en el camino de la cuenta huerfana. El DROP
    // ... IF EXISTS delante es lo que lo hace idempotente, que es lo que este
    // fichero exige de todo lo que contiene.
    expect(schema).toContain('alter table audit_log drop constraint if exists audit_log_action_check');
    expect(schema).toContain(
      "alter table audit_log add constraint audit_log_action_check check (action in ('invite', 'revoke', 'create-user'))",
    );
  });

  it('el refresco del CHECK viaja en el MISMO script que el resto del esquema', () => {
    // `migrate` manda el fichero entero en una sola consulta y Postgres lo
    // envuelve en una transaccion implicita. Si el ALTER se ejecutase aparte,
    // podria quedar aplicado a medias respecto de la tabla que acota.
    const sentencias = readSchemaSql();

    expect(sentencias).toContain('ALTER TABLE audit_log');
  });
});

describe('schema.sql: las cuatro tablas de PRD-7 (#7)', () => {
  it('crea las cuatro tablas nuevas solo si no existen', () => {
    expect(schema).toContain('create table if not exists spaces');
    expect(schema).toContain('create table if not exists assets');
    expect(schema).toContain('create table if not exists space_layouts');
    expect(schema).toContain('create table if not exists user_desk_configs');
  });

  it('acota las coordenadas y el tamano de un espacio con CHECK', () => {
    expect(schema).toContain('x integer not null check (x >= 0)');
    expect(schema).toContain('y integer not null check (y >= 0)');
    expect(schema).toContain('w integer not null check (w > 0)');
    expect(schema).toContain('h integer not null check (h > 0)');
  });

  it('la capacidad es opcional pero, si esta, es positiva', () => {
    expect(schema).toContain('capacity integer check (capacity is null or capacity > 0)');
  });

  it('un espacio NO tiene archived_at: borrarlo es un DELETE de verdad (D1b)', () => {
    // Acotado al bloque de `spaces`, no al fichero entero: `assets` SI tiene
    // `archived_at` (siguiente bloque), asi que una busqueda global no
    // distinguiria "ausente en spaces" de "ausente en todas partes".
    const spacesBlock = schema.slice(
      schema.indexOf('create table if not exists spaces'),
      schema.indexOf('create table if not exists assets'),
    );
    expect(spacesBlock).not.toContain('archived_at');
    expect(schema).toContain('archived_at timestamptz');
  });

  it('impide dos espacios solapados con una restriccion de exclusion GiST, sin extension', () => {
    // Verificado empiricamente en la fase de apply de este cambio (#7) contra
    // Postgres real (WASM, sin ninguna extension instalada): `box`/GiST
    // (box_ops) es de nucleo, `EXCLUDE USING gist` no necesita `postgis` ni
    // ninguna `CREATE EXTENSION`. Ver nota del spike en apply-progress.
    expect(schema).toContain('drop constraint if exists spaces_no_overlap');
    expect(schema).toContain(
      'exclude using gist (box(point(x, y), point(x + w, y + h)) with &&)',
    );
    expect(schema).not.toContain('create extension');
  });

  it('slug y nombre de un espacio son unicos sin distinguir mayusculas', () => {
    expect(schema).toContain('unique index if not exists spaces_slug_unique on spaces (lower(slug))');
    expect(schema).toContain('unique index if not exists spaces_name_unique on spaces (lower(name))');
  });

  it('el catalogo de assets acota el tipo y el slug es unico', () => {
    expect(schema).toContain("check (kind in ('furniture', 'decor', 'plant'))");
    expect(schema).toContain('unique index if not exists assets_slug_unique on assets (lower(slug))');
  });

  it('un layout referencia espacio y asset con acciones de borrado distintas (D1b)', () => {
    // Borrar un Space es un DELETE de verdad y se lleva su layout con el
    // (CASCADE); borrar un Asset esta BLOQUEADO mientras algo lo use
    // (RESTRICT) -- eso es lo que obliga al admin a confrontar que esta
    // borrando colocaciones ajenas.
    expect(schema).toContain('space_id uuid not null references spaces(id) on delete cascade');
    expect(schema).toContain('asset_id uuid not null references assets(id) on delete restrict');
  });

  it('la rotacion de un layout esta acotada a los cuatro giros de 90 grados', () => {
    expect(schema).toContain('rotation smallint not null default 0 check (rotation in (0, 90, 180, 270))');
  });

  it('la decoracion de escritorio referencia al usuario con CASCADE y un slot unico por usuario', () => {
    // CASCADE en `user_id`: si se borra la cuenta, su decoracion de
    // escritorio no tiene a quien pertenecer.
    expect(schema).toContain('user_id uuid not null references users(id) on delete cascade');
    expect(schema).toContain('slot smallint not null check (slot between 0 and 5)');
    expect(schema).toContain('unique index if not exists user_desk_slot_unique on user_desk_configs (user_id, slot)');
  });

  it('siembra los dos espacios de siempre de forma idempotente', () => {
    expect(schema).toContain('insert into spaces (id, slug, name, x, y, w, h) values');
    expect(schema).toContain('on conflict (id) do nothing');
  });

  it('NO pide ninguna extension nueva para las cuatro tablas de PRD-7', () => {
    expect(schema).not.toContain('create extension');
    expect(schema).not.toContain('postgis');
  });
});
