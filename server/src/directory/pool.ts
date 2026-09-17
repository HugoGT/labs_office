/**
 * Construccion del pool de conexiones a Postgres (#24). Deliberadamente fino:
 * aqui no hay logica, solo el unico punto del servidor que conoce el paquete
 * `pg`. `pgDirectory.ts` habla con la forma minima (`DirectoryPool`), no con el
 * `Pool` real, que es lo que permite probarlo entero sin base de datos.
 *
 * `pg.Pool` no abre ninguna conexion al construirse, solo al primer `query`. De
 * ahi que el arranque del servidor no dependa de que Postgres este listo: si no
 * lo esta, falla la migracion con un error que dice exactamente eso, no un
 * cuelgue sin mensaje al levantar el proceso.
 *
 * El constructor se inyecta para poder afirmar en un test que la url llega por
 * el nombre de opcion correcto. Parece poca cosa, pero es lo unico que puede
 * romperse aqui y ningun tipo lo cazaria: en `pg` todas las opciones son
 * opcionales, asi que un nombre mal escrito compila y acaba conectando al
 * `localhost` por defecto en mitad de un despliegue.
 */

import pg from 'pg';
import type { DirectoryConfig } from './bootstrapConfig.ts';
import type { DirectoryPool } from './pgDirectory.ts';

export function createDirectoryPool(
  config: DirectoryConfig,
  PoolConstructor: typeof pg.Pool = pg.Pool,
): DirectoryPool {
  return new PoolConstructor({ connectionString: config.databaseUrl }) as unknown as DirectoryPool;
}
