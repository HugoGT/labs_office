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
