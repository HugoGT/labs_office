/**
 * Adaptador de Postgres de `DecorCatalog` (#7, slice 4). Es el unico fichero
 * de la carpeta que sabe SQL, igual que `pgSpaces.ts` lo es de los espacios.
 * Consume la misma forma minima de `pg` (`DirectoryPool`/`DirectoryQueryable`)
 * que ya declara `pgDirectory.ts`, en vez de redeclararla: mismo doble en los
 * tests, mismo `fakePool` posible sin levantar Postgres.
 *
 * ## Donde va y donde NO va `archived_at IS NULL` (D1b)
 *
 * No es una preferencia de estilo, es la diferencia entre "retirado del
 * catalogo" y "borrado":
 *
 *   - `listAssets` lo lleva. Es la lectura de CATALOGO: lo que el panel puede
 *     ofrecer para colocar hoy.
 *   - `getDeskConfig` NO lo lleva. Es la lectura de COLOCACION: quien ya tenia
 *     la pieza puesta la sigue viendo, con su `texture_key` resuelto.
 *   - La consulta de validacion de `replaceDeskConfig` tampoco. Archivar dice
 *     que no se puede colocar de NUEVO desde el panel, no que el escritorio de
 *     alguien haya dejado de ser valido; si filtrase, mover una pieza
 *     cualquiera le borraria a esa persona la retirada que ya tenia.
 */

import type {
  Asset,
  CreateAssetInput,
  DecorCatalog,
  DeskItem,
  DeskItemInput,
  ListAssetsOptions,
} from './decorPort.ts';
import {
  assertValidDeskShape,
  normalizeCreateAssetInput,
  normalizeDeskConfig,
} from './decorRules.ts';
import type { DirectoryPool, DirectoryQueryable } from '../directory/pgDirectory.ts';

const ASSET_COLUMNS =
  'id, slug, name, kind, texture_key, w, h, placeable_on_desk, archived_at, created_at';

/**
 * Las columnas del escritorio ya cruzadas con su asset. Se enumeran una a una
 * en vez de `d.*, a.*`: los dos lados tienen `id`, `w`, `h`, `name` y
 * `created_at`, y un `*` dejaria cual gana a merced del orden de las tablas.
 */
const DESK_COLUMNS = `
  d.id, d.asset_id, d.slot, d.rotation, d.created_at,
  a.texture_key, a.w, a.h, a.name
`;

const DESK_SELECT = `
  SELECT ${DESK_COLUMNS}
  FROM user_desk_configs d
  JOIN assets a ON a.id = d.asset_id
  WHERE d.user_id = $1
  ORDER BY d.slot
`;

function toAsset(row: Record<string, unknown>): Asset {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    kind: row.kind as Asset['kind'],
    textureKey: row.texture_key as string,
    w: row.w as number,
    h: row.h as number,
    placeableOnDesk: row.placeable_on_desk as boolean,
    archivedAt: (row.archived_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

function toDeskItem(row: Record<string, unknown>): DeskItem {
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    slot: row.slot as number,
    rotation: row.rotation as DeskItem['rotation'],
    textureKey: row.texture_key as string,
    w: row.w as number,
    h: row.h as number,
    name: row.name as string,
    createdAt: row.created_at as Date,
  };
}

export function createPgDecor(pool: DirectoryPool): DecorCatalog {
  /**
   * Misma razon que `pgDirectory.inTransaction` y `pgSpaces.inTransaction`:
   * `pool.query` reparte cada consulta por la conexion que este libre, asi que
   * el BEGIN y el resto de la transaccion podrian acabar en conexiones
   * distintas.
   */
  async function inTransaction<T>(run: (client: DirectoryQueryable) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async listAssets(options: ListAssetsOptions = {}) {
      // El filtro se compone en el TEXTO y no como un parametro: un
      // `archived_at IS NULL OR $1` seria una condicion que Postgres no puede
      // resolver con el indice, y sobre todo seria una sola consulta cuya
      // forma no dice cual de los dos modos esta corriendo.
      const where = options.includeArchived ? '' : 'WHERE archived_at IS NULL';
      const result = await pool.query(
        `SELECT ${ASSET_COLUMNS} FROM assets ${where} ORDER BY kind, slug, id`,
      );
      return result.rows.map(toAsset);
    },

    async createAsset(input: CreateAssetInput) {
      // Validar ANTES de pedir conexion, misma razon que `pgSpaces.createSpace`:
      // un asset mal escrito no debe costar una consulta.
      const normalized = normalizeCreateAssetInput(input);

      const result = await pool.query(
        `
          INSERT INTO assets (slug, name, kind, texture_key, w, h, placeable_on_desk)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING ${ASSET_COLUMNS}
        `,
        [
          normalized.slug,
          normalized.name,
          normalized.kind,
          normalized.textureKey,
          normalized.w,
          normalized.h,
          normalized.placeableOnDesk,
        ],
      );
      return toAsset(result.rows[0]);
    },

    async archiveAsset(id: string) {
      // UPDATE y no DELETE, y sin tocar `user_desk_configs`: retirar del
      // catalogo es una afirmacion sobre lo que se puede colocar MANANA, no
      // una edicion retroactiva del escritorio de otra persona (D1b). Un
      // DELETE ademas chocaria con el `ON DELETE RESTRICT` de la FK en cuanto
      // alguien tuviese la pieza puesta.
      const result = await pool.query(
        `UPDATE assets SET archived_at = now() WHERE id = $1 RETURNING ${ASSET_COLUMNS}`,
        [id],
      );
      const row = result.rows[0];
      return row ? toAsset(row) : null;
    },

    async getDeskConfig(userId: string) {
      const result = await pool.query(DESK_SELECT, [userId]);
      return result.rows.map(toDeskItem);
    },

    async replaceDeskConfig(userId: string, items: readonly DeskItemInput[]) {
      if (items.length === 0) {
        // Sin items no hay catalogo que consultar ni nada que insertar, pero
        // si hay que borrar: vaciar el escritorio es una peticion legitima.
        return inTransaction(async (client) => {
          await client.query('DELETE FROM user_desk_configs WHERE user_id = $1', [userId]);
          return [];
        });
      }

      // Lo que se puede validar sin base de datos (slot, rotacion, slots
      // repetidos) se valida sin base de datos: un cuerpo mal escrito no debe
      // costar una conexion. Lo unico que si obliga a consultar es si cada
      // asset existe y es colocable, y eso se hace ya dentro de la
      // transaccion.
      assertValidDeskShape(items);
      const ids = [...new Set(items.map((item) => item.assetId))];

      return inTransaction(async (client) => {
        const catalog = await client.query(
          'SELECT id, placeable_on_desk FROM assets WHERE id = ANY($1::uuid[])',
          [ids],
        );
        const normalized = normalizeDeskConfig(
          items,
          catalog.rows.map((row) => ({
            id: row.id as string,
            placeableOnDesk: row.placeable_on_desk as boolean,
          })),
        );

        await client.query('DELETE FROM user_desk_configs WHERE user_id = $1', [userId]);

        for (const item of normalized) {
          await client.query(
            `
              INSERT INTO user_desk_configs (user_id, asset_id, slot, rotation)
              VALUES ($1, $2, $3, $4)
            `,
            [userId, item.assetId, item.slot, item.rotation],
          );
        }

        // Se RELEE cruzado en vez de devolver el RETURNING del INSERT: los
        // campos del asset (`textureKey`, `w`, `h`, `name`) no salen de la
        // fila insertada, y pedirselos al cliente en una segunda vuelta
        // volveria a meter el filtro del catalogo por la puerta de atras.
        const result = await client.query(DESK_SELECT, [userId]);
        return result.rows.map(toDeskItem);
      });
    },
  };
}
