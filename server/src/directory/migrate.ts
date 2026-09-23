/**
 * Aplicacion del esquema del directorio (#24). Corre en cada arranque con el
 * directorio activo, y por eso `schema.sql` es idempotente de arriba abajo.
 *
 * No hay tabla de versiones ni cadena de migraciones numeradas: con dos tablas,
 * un fichero que converge al estado deseado se lee de un vistazo, mientras que
 * una cadena hay que recorrerla entera para saber que hay ahora mismo. Cuando
 * el esquema crezca lo bastante como para necesitar cambios destructivos, esa
 * decision habra que revisarla -- este comentario es donde empezar.
 *
 * Se manda en UNA sola consulta a proposito. Postgres ejecuta una consulta
 * simple con varias sentencias dentro de una transaccion implicita, y el DDL
 * aqui es transaccional: o queda el esquema entero o no queda nada. Arrancar
 * con el esquema a medias seria peor que no arrancar, porque el servidor
 * aceptaria logins y fallaria en la primera consulta con un error que no
 * menciona las migraciones por ningun lado.
 */

import { readFileSync } from 'node:fs';
import type { DirectoryQueryable } from './pgDirectory.ts';

/**
 * Se lee del disco en vez de vivir como plantilla en TypeScript: un `.sql` de
 * verdad lo colorea el editor, lo entiende `psql` y se puede pegar tal cual en
 * una consola para ver que hace. Se lee en cada llamada y no al importar el
 * modulo: son dos veces en la vida del proceso (arranque y tests) y asi
 * importar este fichero no toca el disco.
 */
export function readSchemaSql(): string {
  return readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
}

export async function migrate(db: DirectoryQueryable): Promise<void> {
  await db.query(readSchemaSql());
}

/**
 * Avisa de los escritorios que el backfill de `schema.sql` dejo sin cubiculo
 * emparejado -- el caso es un escritorio que ya existia y solapa una sala,
 * asi que el `INSERT ... ON CONFLICT DO NOTHING` del backfill lo salta en
 * silencio en vez de tumbar el arranque entero (misma logica que
 * `boundsOverlap` mas amable que la restriccion real). Sin este aviso nadie
 * se entera, porque el propio escritorio sigue existiendo y respondiendo con
 * normalidad hasta que alguien intenta moverlo o renombrarlo y choca con
 * `desk-space-overlap` (tarea 1.4).
 *
 * `warn` inyectable por lo mismo que `createOfficeServer.ts:338`: un test no
 * tiene por que escribir en la consola real para afirmar cuantas veces se
 * avisa.
 */
export async function reportDesksWithoutSpace(
  db: DirectoryQueryable,
  warn: (message: string) => void = (message) => console.warn(message),
): Promise<void> {
  const result = await db.query(`
    SELECT d.id, d.label, d.x, d.y
    FROM desks d
    LEFT JOIN spaces s ON s.desk_id = d.id
    WHERE s.id IS NULL
  `);

  for (const row of result.rows) {
    warn(
      `[desks] escritorio sin cubiculo (solapa una sala): id=${row.id} label="${row.label}" x=${row.x} y=${row.y}`,
    );
  }
}
