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
import { migrate, readSchemaSql, reportDesksWithoutSpace } from './migrate.ts';

/** Comparar SQL con saltos de linea y sangria es comparar formato, no contrato. */
function squash(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

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

  it('el slug de un espacio es unico sin distinguir mayusculas', () => {
    // La unicidad de nombre se mueve a un indice parcial acotado a las salas
    // (ver 'schema.sql: cubiculos de escritorio son espacios' mas abajo): dos
    // cubiculos pueden compartir el nombre del escritorio que los dueno.
    expect(schema).toContain('unique index if not exists spaces_slug_unique on spaces (lower(slug))');
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
    expect(schema).toContain('slot smallint not null check (slot between 0 and 8)');
    expect(schema).toContain('unique index if not exists user_desk_slot_unique on user_desk_configs (user_id, slot)');
  });

  it('el escritorio tiene NUEVE huecos, y el CHECK se refresca en una base que ya existia', () => {
    // El rango nacio en 0..5 y el escritorio resulto ser de 3x3 tiles, que son
    // nueve cajas. Las tres que faltaban no se pueden ganar reescribiendo el
    // `CREATE TABLE`: `IF NOT EXISTS` no toca una tabla que ya existe, asi que
    // en un despliegue vivo el CHECK viejo seguiria rechazando el slot 6 y la
    // persona veria un 500 al decorar la fila de abajo de su escritorio.
    //
    // Mismo par DROP/ADD idempotente que `audit_log_action_check`, y por la
    // misma razon. El nombre no se inventa: es el que Postgres le pone al
    // CHECK en linea de `slot`, `<tabla>_<columna>_check`.
    expect(schema).toContain(
      'alter table user_desk_configs drop constraint if exists user_desk_configs_slot_check',
    );
    expect(schema).toContain(
      'alter table user_desk_configs add constraint user_desk_configs_slot_check check (slot between 0 and 8)',
    );
  });

  it('el CHECK en linea y el refrescado dicen lo MISMO', () => {
    // Converge igual en una base nueva y en una vieja solo si las dos copias
    // coinciden: en la nueva el `CREATE TABLE` pone la primera y el ADD la
    // sustituye por la segunda, y dos rangos distintos harian que el esquema
    // significase una cosa antes del ALTER y otra despues. Mismo precedente
    // que `audit_log`, que tambien repite su lista en los dos sitios.
    const enLinea = schema.match(/slot smallint not null check \(slot between (\d+) and (\d+)\)/);
    const refrescado = schema.match(
      /add constraint user_desk_configs_slot_check check \(slot between (\d+) and (\d+)\)/,
    );

    expect(enLinea).not.toBeNull();
    expect(refrescado).not.toBeNull();
    expect(enLinea!.slice(1)).toEqual(refrescado!.slice(1));
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

describe('schema.sql: los escritorios asignables (#7, slice 5)', () => {
  const desksBlock = schema.slice(schema.indexOf('create table if not exists desks'));

  it('crea la tabla solo si no existe', () => {
    expect(schema).toContain('create table if not exists desks');
  });

  it('guarda TILES y no pixeles, igual que spaces', () => {
    expect(desksBlock).toContain('x integer not null check (x >= 0), y integer not null check (y >= 0)');
  });

  it('NO guarda w ni h: un escritorio es 3x3 SIEMPRE', () => {
    // Una columna que pudiese decir otra cosa que 3 contradiria al CHECK de
    // `slot`, que cuenta nueve cajas, y a la restriccion de exclusion de aqui
    // abajo, que mide el area con un 3 literal. Dos fuentes para el mismo
    // numero es una de mas.
    expect(desksBlock).not.toMatch(/\bw integer\b/);
    expect(desksBlock).not.toMatch(/\bh integer\b/);
  });

  it('el ocupante es una FK a users que se ANULA al borrar la cuenta', () => {
    // SET NULL y no CASCADE: el escritorio es mobiliario de la oficina, no
    // propiedad de quien lo usa. Borrar a una persona libera su sitio; borrar
    // el sitio no deberia poder pasarle a nadie por borrar una cuenta.
    expect(desksBlock).toContain('occupant_id uuid references users(id) on delete set null');
  });

  it('una persona ocupa como mucho UN escritorio, con un indice unico parcial', () => {
    // Parcial porque muchos escritorios pueden estar libres a la vez y NULL no
    // colisiona consigo mismo en un unique normal de forma fiable de leer.
    // Mismo precedente que `users_single_superadmin`.
    expect(schema).toContain('create unique index if not exists desks_single_occupant on desks (occupant_id)');
    expect(schema).toContain('where occupant_id is not null');
  });

  it('impide dos escritorios solapados con una restriccion de exclusion GiST, sin extension', () => {
    // Mismo mecanismo y mismo par DROP/ADD que `spaces_no_overlap`: no existe
    // forma `IF NOT EXISTS` para una restriccion de exclusion.
    expect(schema).toContain('drop constraint if exists desks_no_overlap');
    expect(schema).toContain(
      'exclude using gist (box(point(x, y), point(x + 3, y + 3)) with &&)',
    );
    expect(schema).not.toContain('create extension');
  });

  it('la decoracion NO se ata al escritorio, sino a la persona', () => {
    // La propiedad del producto: la decoracion de alguien le SIGUE al
    // escritorio que ocupe. `user_desk_configs` ya esta indexada por
    // `user_id`; una columna `desk_id` la anclaria a un sitio y la perderia en
    // cuanto esa persona se mudase a otro.
    const deskConfigsBlock = schema.slice(
      schema.indexOf('create table if not exists user_desk_configs'),
      schema.indexOf('unique index if not exists user_desk_slot_unique'),
    );
    expect(deskConfigsBlock).not.toContain('desk_id');
  });
});

describe('schema.sql: cubiculos de escritorio son espacios (#10 + #12, S1a)', () => {
  it('anade desk_id como FK unica a desks, con cascada de borrado', () => {
    // UNIQUE porque un escritorio tiene, como mucho, UN cubiculo emparejado
    // (D2 del diseno: el upsert de `pgDesks` apunta a `ON CONFLICT (desk_id)`).
    // CASCADE porque borrar el escritorio se lleva su cubiculo con el.
    expect(schema).toContain(
      'alter table spaces add column if not exists desk_id uuid unique references desks(id) on delete cascade',
    );
  });

  it('retira el indice de nombre unico sobre la tabla entera', () => {
    expect(schema).toContain('drop index if exists spaces_name_unique');
    expect(schema).not.toContain(
      'create unique index if not exists spaces_name_unique on spaces (lower(name))',
    );
  });

  it('el nombre unico ahora solo protege a las salas, no a los cubiculos', () => {
    // Dos cubiculos pueden compartir el nombre del escritorio que los dueno
    // (dos personas llamadas "Ana" tendrian dos "Mesa de Ana"); dos salas no.
    expect(schema).toContain(
      'create unique index if not exists spaces_room_name_unique on spaces (lower(name)) where desk_id is null',
    );
  });

  it('reserva un cubiculo 3x3 para cada escritorio que todavia no tiene uno', () => {
    expect(schema).toContain('insert into spaces (desk_id, slug, name, x, y, w, h, capacity)');
    expect(schema).toContain(
      "select d.id, 'desk-' || d.id::text, d.label, d.x, d.y, 3, 3, null from desks d",
    );
    expect(schema).toContain('where not exists (select 1 from spaces s where s.desk_id = d.id)');
  });

  it('el backfill se salta, sin reventar, un escritorio que solapa una sala', () => {
    // `ON CONFLICT DO NOTHING` sin target absorbe tambien el choque contra
    // `spaces_no_overlap`: un escritorio sentado encima de una sala se salta
    // en vez de tumbar el arranque entero. `reportDesksWithoutSpace` (S1a,
    // tarea 1.2) es quien avisa de los que se quedan sin cubiculo.
    const backfillBlock = schema.slice(
      schema.indexOf('insert into spaces (desk_id'),
      schema.indexOf('insert into spaces (id, slug, name, x, y, w, h) values'),
    );
    expect(backfillBlock).toContain('on conflict do nothing');
  });

  it('el bloque de desk_id va DESPUES de desks_no_overlap: la FK necesita la tabla desks', () => {
    expect(schema.indexOf('desks_no_overlap')).toBeLessThan(
      schema.indexOf('alter table spaces add column if not exists desk_id'),
    );
  });

  it('correr el esquema dos veces seguidas no cambia lo que se manda (backfill idempotente)', async () => {
    const db = recorder();

    await migrate(db);
    await migrate(db);

    expect(db.texts[0]).toBe(db.texts[1]);
  });
});

describe('reportDesksWithoutSpace (#10 + #12, S1a tarea 1.2)', () => {
  it('consulta los escritorios sin espacio emparejado por desk_id', async () => {
    const texts: string[] = [];
    const db = {
      async query(text: string) {
        texts.push(text);
        return { rows: [] };
      },
    };

    await reportDesksWithoutSpace(db, () => {});

    expect(squash(texts[0])).toContain('left join spaces s on s.desk_id = d.id');
    expect(squash(texts[0])).toContain('where s.id is null');
  });

  it('avisa una vez por cada escritorio que la migracion dejo sin cubiculo', async () => {
    // El caso real: un escritorio que ya existia y solapa una sala se salta
    // en el backfill de schema.sql (ON CONFLICT DO NOTHING), y esta es la
    // unica forma de que alguien se entere.
    const db = {
      async query() {
        return {
          rows: [{ id: 'id-mesa-1', label: 'Mesa 1', x: 52, y: 3 }],
        };
      },
    };
    const warnings: string[] = [];

    await reportDesksWithoutSpace(db, (message) => warnings.push(message));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[desks] escritorio sin cubiculo (solapa una sala)');
    expect(warnings[0]).toContain('id-mesa-1');
  });

  it('avisa una vez POR ESCRITORIO, no una vez en total', async () => {
    const db = {
      async query() {
        return {
          rows: [
            { id: 'id-mesa-1', label: 'Mesa 1', x: 52, y: 3 },
            { id: 'id-mesa-2', label: 'Mesa 2', x: 55, y: 3 },
          ],
        };
      },
    };
    const warnings: string[] = [];

    await reportDesksWithoutSpace(db, (message) => warnings.push(message));

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('id-mesa-1');
    expect(warnings[1]).toContain('id-mesa-2');
  });

  it('sin escritorios huerfanos no avisa nada', async () => {
    const db = { async query() { return { rows: [] }; } };
    const warnings: string[] = [];

    await reportDesksWithoutSpace(db, (message) => warnings.push(message));

    expect(warnings).toHaveLength(0);
  });

  it('sin un warn inyectado, usa console.warn por defecto', async () => {
    const db = {
      async query() {
        return { rows: [{ id: 'id-mesa-1', label: 'Mesa 1', x: 52, y: 3 }] };
      },
    };
    const spy: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => spy.push(message);

    try {
      await reportDesksWithoutSpace(db);
    } finally {
      console.warn = original;
    }

    expect(spy).toHaveLength(1);
    expect(spy[0]).toContain('[desks] escritorio sin cubiculo');
  });
});

describe('schema.sql: assets drawn above avatars (#71)', () => {
  it('adds the flag to databases that already exist, defaulting every existing asset to normal', () => {
    // `CREATE TABLE IF NOT EXISTS assets` never touches a live table, so the
    // column has to arrive through its own idempotent ALTER. NOT NULL DEFAULT
    // false backfills every existing row as a normal asset: nothing becomes
    // special by migrating.
    expect(schema).toContain(
      'alter table assets add column if not exists above_avatars boolean not null default false',
    );
  });
});
