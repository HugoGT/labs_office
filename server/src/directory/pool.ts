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

import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { DirectoryConfig } from './bootstrapConfig.ts';
import type { DirectoryPool } from './pgDirectory.ts';

/**
 * TLS towards Cloud SQL over its private IP (#72): libpq's `verify-ca`.
 *
 * The chain IS verified against the instance's own CA, which Terraform hands
 * to the VM. That is what proves the peer is our instance and not something
 * else inside the VPC; `rejectUnauthorized: false` would encrypt towards
 * whoever answers. The hostname is NOT checked: the Cloud SQL server
 * certificate does not carry the private IP, so that check would always fail.
 *
 * The CA is read once, at startup. A missing file throws instead of falling
 * back to clear text: the instance only accepts TLS (ENCRYPTED_ONLY), and a
 * "connection refused" later would point at the network, not at this file.
 */
function sslOptions(caFile: string, readFile: (path: string) => string) {
  return { ca: readFile(caFile), checkServerIdentity: () => undefined };
}

export function createDirectoryPool(
  config: DirectoryConfig,
  PoolConstructor: typeof pg.Pool = pg.Pool,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): DirectoryPool {
  return new PoolConstructor({
    connectionString: config.databaseUrl,
    ...(config.databaseSslCaFile ? { ssl: sslOptions(config.databaseSslCaFile, readFile) } : {}),
  }) as unknown as DirectoryPool;
}
