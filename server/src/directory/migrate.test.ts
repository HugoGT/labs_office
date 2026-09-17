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
