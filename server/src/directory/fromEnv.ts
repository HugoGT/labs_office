/**
 * Cableado del directorio desde el entorno (#24). Es el hermano de
 * `authVerifierFromEnv` en `createOfficeServer.ts` y existe por la misma razon:
 * que el "sin configuracion, sin directorio" se lea de un vistazo y en un solo
 * sitio, en vez de repartido por el arranque.
 *
 * Devuelve tambien `migrate` y no solo el directorio porque aplicar el esquema
 * necesita el pool, y el pool no sale del puerto -- ni debe: `UserDirectory`
 * describe lo que la aplicacion hace con los usuarios, no como se administra su
 * almacen. Atar las dos cosas aqui es lo que permite que `createOfficeServer`
 * no vea nunca un `pg.Pool`.
 */

import { resolveDirectoryConfig } from './bootstrapConfig.ts';
import type { UserDirectory } from './directoryPort.ts';
import { migrate, reportDesksWithoutSpace } from './migrate.ts';
import { createPgDirectory, type DirectoryPool } from './pgDirectory.ts';
import { createDirectoryPool } from './pool.ts';
import type { ArtPackManifest } from '../../../src/game/artContract.ts';
import { readArtPackManifest } from '../decor/artPackFile.ts';
import { createPgDecor } from '../decor/pgDecor.ts';
import type { DecorCatalog } from '../decor/decorPort.ts';
import { createPgDesks } from '../desks/pgDesks.ts';
import type { DeskDirectory } from '../desks/desksPort.ts';
import { createPgSpaces } from '../spaces/pgSpaces.ts';
import type { SpacesDirectory } from '../spaces/spacesPort.ts';

/**
 * The pack the SPA serves, so the catalog registers exactly the files the
 * browser loads. Resolved here and nowhere else; the server image copies this
 * one file (`infra/gcp/docker/colyseus.Dockerfile`).
 */
const ART_PACK_MANIFEST = new URL('../../../public/assets/pack/manifest.json', import.meta.url);

export interface DirectoryRuntime {
  directory: UserDirectory;
  /**
   * Espacios del PRD 7 (#7, slice 3). Cuelga del MISMO runtime y no de una
   * fabrica propia porque sale del MISMO `DATABASE_URL` y por tanto debe salir
   * del MISMO pool: dos pools contra la misma base serian el doble de
   * conexiones que la instancia cuenta, y `directory.close()` solo cerraria el
   * suyo -- el otro sobreviviria al apagado.
   *
   * No lleva `migrate` propio: las cuatro tablas del PRD 7 ya estan en el
   * mismo `schema.sql` que aplica `migrate()` de aqui abajo.
   */
  spaces: SpacesDirectory;
  /**
   * Catalogo de decoracion del PRD 7 (#7, slice 4). Cuelga del MISMO runtime y
   * del MISMO pool que los otros dos, por la misma razon exacta: sale del
   * MISMO `DATABASE_URL`, y un tercer pool contra la misma base seria el
   * triple de conexiones que la instancia cuenta con `directory.close()`
   * cerrando solo una de ellas.
   *
   * Tampoco lleva `migrate` propio: `assets` y `user_desk_configs` ya estan en
   * el mismo `schema.sql` que aplica `migrate()` de aqui abajo.
   */
  decor: DecorCatalog;
  /**
   * Escritorios asignables del PRD 7 (#7, slice 5). Cuelga del MISMO runtime y
   * del MISMO pool que los otros tres, por la misma razon exacta: sale del
   * MISMO `DATABASE_URL`, y un cuarto pool contra la misma base seria el
   * cuadruple de conexiones que la instancia cuenta con `directory.close()`
   * cerrando solo una de ellas.
   *
   * Tampoco lleva `migrate` propio: `desks` ya esta en el mismo `schema.sql`
   * que aplica `migrate()` de aqui abajo.
   */
  desks: DeskDirectory;
  /**
   * Aplica el esquema. Idempotente: corre en cada arranque. Ver `migrate.ts`.
   *
   * Tambien avisa, DESPUES de aplicar el esquema, de los escritorios que el
   * backfill de cubiculos (#10 + #12) dejo sin espacio emparejado -- ver
   * `reportDesksWithoutSpace`.
   *
   * Last, it registers the art pack in the catalog (art migration, step 3):
   * after the schema, which creates `art_pieces`, and at every start, so a
   * deploy with a new pack updates the catalog and retires what it dropped.
   */
  migrate(): Promise<void>;
}

export function directoryFromEnv(
  env: { DATABASE_URL?: string; BOOTSTRAP_SUPERADMIN_EMAIL?: string; DATABASE_SSL_CA_FILE?: string },
  makePool: typeof createDirectoryPool = createDirectoryPool,
  loadArtPack: () => ArtPackManifest = () => readArtPackManifest(ART_PACK_MANIFEST),
): DirectoryRuntime | undefined {
  const config = resolveDirectoryConfig(env);
  // Sin config no se construye ni el pool: un pool sin destino seria un objeto
  // vivo esperando una conexion que nadie ha pedido.
  if (config === null) return undefined;

  const pool: DirectoryPool = makePool(config);

  const decor = createPgDecor(pool);

  return {
    directory: createPgDirectory(pool, config),
    spaces: createPgSpaces(pool),
    decor,
    desks: createPgDesks(pool),
    migrate: async () => {
      await migrate(pool);
      await reportDesksWithoutSpace(pool);
      await decor.registerArtPack(loadArtPack());
    },
  };
}
