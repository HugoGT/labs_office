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

import { ART_CONTRACT_VERSION, type ArtPackManifest } from '../../../src/game/artContract.ts';
import { ArtPieceExistsError, artPieceFields, assertUploadedArtPiece, normalizeArtPack } from './artCatalogRules.ts';
import type {
  ArtCatalogPiece,
  Asset,
  CreateAssetInput,
  DecorCatalog,
  DeskItem,
  DeskItemInput,
  ListArtPiecesOptions,
  ListAssetsOptions,
  UpdateAssetInput,
  UploadedArtPieceInput,
} from './decorPort.ts';
import {
  AssetNameTakenError,
  assertValidDeskShape,
  normalizeCreateAssetInput,
  normalizeDeskConfig,
  normalizeUpdateAssetInput,
  type NormalizedCreateAssetInput,
} from './decorRules.ts';
import type { DirectoryPool, DirectoryQueryable } from '../directory/pgDirectory.ts';

/**
 * Codigo de `unique_violation` de Postgres, el mismo que ya nombran
 * `pgDirectory.ts` y `pgSpaces.ts`: lo que salta `assets_slug_unique`.
 */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;
}

const ASSET_COLUMNS =
  'id, slug, name, kind, texture_key, w, h, placeable_on_desk, above_avatars, archived_at, created_at';

/**
 * Las columnas del escritorio ya cruzadas con su asset. Se enumeran una a una
 * en vez de `d.*, a.*`: los dos lados tienen `id`, `w`, `h`, `name` y
 * `created_at`, y un `*` dejaria cual gana a merced del orden de las tablas.
 */
const DESK_COLUMNS = `
  d.id, d.asset_id, d.slot, d.rotation, d.created_at,
  a.texture_key, a.w, a.h, a.name, a.above_avatars
`;

const DESK_SELECT = `
  SELECT ${DESK_COLUMNS}
  FROM user_desk_configs d
  JOIN assets a ON a.id = d.asset_id
  WHERE d.user_id = $1
  ORDER BY d.slot
`;

const ART_PIECE_COLUMNS =
  'id, kind, name, material, colorable, default_color, author, license, files, spec, contract_version, retired_at, registered_at, updated_at, source, uploaded_by';

/**
 * One upsert per piece. The kind is left out of the update on purpose: the id
 * prefix fixes it, and a stored choice must never change kind under it. The
 * `WHERE` skips a piece that is active and unchanged, so the registration that
 * runs at every start rewrites nothing; `IS DISTINCT FROM` on jsonb compares
 * values, not key order.
 */
const ART_PIECE_UPSERT = `
  INSERT INTO art_pieces (id, kind, name, material, colorable, default_color, author, license, files, spec, contract_version)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, material = EXCLUDED.material, colorable = EXCLUDED.colorable,
    default_color = EXCLUDED.default_color, author = EXCLUDED.author, license = EXCLUDED.license,
    files = EXCLUDED.files, spec = EXCLUDED.spec, contract_version = EXCLUDED.contract_version,
    retired_at = NULL, updated_at = now()
  WHERE art_pieces.spec IS DISTINCT FROM EXCLUDED.spec
     OR art_pieces.contract_version IS DISTINCT FROM EXCLUDED.contract_version
     OR art_pieces.retired_at IS NOT NULL
`;

/**
 * An UPDATE and never a DELETE: users, desks and spaces may still point at
 * these ids. Only pack pieces: an Admin upload (#121) is not in any pack, and
 * retiring it here would undo it at the next start.
 */
const ART_PIECE_RETIRE = `
  UPDATE art_pieces SET retired_at = now(), updated_at = now()
  WHERE retired_at IS NULL AND NOT (id = ANY($1::text[])) AND source = 'pack'
  RETURNING id
`;

/**
 * An upload is inserted or refused, never merged: `DO NOTHING` plus an empty
 * RETURNING is how an id already in the catalog shows up, retired included.
 */
const UPLOADED_ART_PIECE_INSERT = `
  INSERT INTO art_pieces (id, kind, name, material, colorable, default_color, author, license, files, spec, contract_version, source, uploaded_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, 'upload', $12)
  ON CONFLICT (id) DO NOTHING
  RETURNING ${ART_PIECE_COLUMNS}
`;

const ASSET_INSERT = `
  INSERT INTO assets (slug, name, kind, texture_key, w, h, placeable_on_desk, above_avatars)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING ${ASSET_COLUMNS}
`;

function toArtPiece(row: Record<string, unknown>): ArtCatalogPiece {
  return {
    id: row.id as string,
    kind: row.kind as ArtCatalogPiece['kind'],
    name: row.name as string,
    material: (row.material as string | null) ?? null,
    colorable: row.colorable === true,
    defaultColor: (row.default_color as string | null) ?? null,
    author: row.author as string,
    license: row.license as string,
    // `pg` already parses jsonb.
    files: row.files as ArtCatalogPiece['files'],
    spec: row.spec as ArtCatalogPiece['spec'],
    contractVersion: row.contract_version as number,
    retiredAt: (row.retired_at as Date | null) ?? null,
    registeredAt: row.registered_at as Date,
    updatedAt: row.updated_at as Date,
    // A row read before the column existed is a pack piece, its DEFAULT.
    source: row.source === 'upload' ? 'upload' : 'pack',
    uploadedBy: (row.uploaded_by as string | null | undefined) ?? null,
  };
}

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
    // `=== true` and not a cast: the column is NOT NULL DEFAULT false, but a
    // row read before the migration ran must still come out as a normal asset.
    aboveAvatars: row.above_avatars === true,
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
    aboveAvatars: row.above_avatars === true,
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

  /**
   * One INSERT of a validated asset, on the pool or inside a transaction.
   *
   * `assets_slug_unique` es la garantia real; esto solo traduce su fallo a un
   * error de dominio en vez de un 500 pelado, misma logica que ya documenta la
   * cabecera de `decorRules.ts` para los CHECK. Se mira SOLO ese codigo y todo
   * lo demas se relanza: tragarse un fallo desconocido como 409 le diria al
   * administrador que se equivoco el cuando el que se rompio fue el servidor,
   * que es el mismo pecado que evita el `translating` de la ruta, en la otra
   * direccion.
   */
  async function insertAsset(client: DirectoryQueryable, normalized: NormalizedCreateAssetInput): Promise<Asset> {
    try {
      const result = await client.query(ASSET_INSERT, [
        normalized.slug,
        normalized.name,
        normalized.kind,
        normalized.textureKey,
        normalized.w,
        normalized.h,
        normalized.placeableOnDesk,
        normalized.aboveAvatars,
      ]);
      return toAsset(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AssetNameTakenError('ya existe un asset con ese nombre');
      }
      throw error;
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
      return insertAsset(pool, normalizeCreateAssetInput(input));
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

    async updateAsset(id: string, input: UpdateAssetInput) {
      // Validated before asking for a connection, same as `createAsset`. The
      // only editable column is the render layer (#71); it does not touch
      // `archived_at` or any placement.
      const normalized = normalizeUpdateAssetInput(input);
      const result = await pool.query(
        `UPDATE assets SET above_avatars = $2 WHERE id = $1 RETURNING ${ASSET_COLUMNS}`,
        [id, normalized.aboveAvatars],
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
          await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
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
        // Lock the stable owner row: locking placements cannot serialize two
        // replacements when the config is empty (READ COMMITTED).
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        // El escritorio ACTUAL se lee dentro de la MISMA transaccion que luego
        // borra e inserta, y antes del DELETE. Fuera de ella, una escritura
        // concurrente decidiria si una pieza retirada cuenta como retenida:
        // dos guardados simultaneos podrian acordar entre ellos que si estaba
        // puesta cuando ya no lo estaba. Despues del DELETE seria peor todavia
        // -- el escritorio actual siempre estaria vacio y ninguna retirada se
        // conservaria nunca.
        const current = await client.query(
          'SELECT asset_id FROM user_desk_configs WHERE user_id = $1',
          [userId],
        );

        // `archived_at` se TRAE, no se filtra: filtrar haria que un asset
        // retirado fuese indistinguible de uno inexistente, y quien lo tuviese
        // puesto lo perderia al guardar cualquier otro cambio (D1b).
        const catalog = await client.query(
          'SELECT id, placeable_on_desk, archived_at FROM assets WHERE id = ANY($1::uuid[])',
          [ids],
        );
        const normalized = normalizeDeskConfig(
          items,
          catalog.rows.map((row) => ({
            id: row.id as string,
            placeableOnDesk: row.placeable_on_desk as boolean,
            archivedAt: (row.archived_at as Date | null) ?? null,
          })),
          current.rows.map((row) => row.asset_id as string),
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

    async registerArtPack(pack: ArtPackManifest) {
      // Validated before asking for a connection, same as `createAsset`.
      const valid = normalizeArtPack(pack);

      return inTransaction(async (client) => {
        for (const piece of valid.pieces) {
          const fields = artPieceFields(piece);
          await client.query(ART_PIECE_UPSERT, [
            fields.id,
            fields.kind,
            fields.name,
            fields.material,
            fields.colorable,
            fields.defaultColor,
            fields.author,
            fields.license,
            // Stringified: `pg` would send a JS array as a Postgres array literal.
            JSON.stringify(fields.files),
            JSON.stringify(fields.spec),
            valid.contractVersion,
          ]);
        }
        const retired = await client.query(ART_PIECE_RETIRE, [valid.pieces.map((piece) => piece.id)]);
        return { registered: valid.pieces.length, retired: retired.rows.map((row) => row.id as string) };
      });
    },

    async listArtPieces(options: ListArtPiecesOptions = {}) {
      // Composed in the text for the same reason as `listAssets`.
      const where = options.includeRetired ? '' : 'WHERE retired_at IS NULL';
      const result = await pool.query(`SELECT ${ART_PIECE_COLUMNS} FROM art_pieces ${where} ORDER BY kind, id`);
      return result.rows.map(toArtPiece);
    },

    async registerUploadedArtPiece({ piece, uploadedBy, decorAsset }: UploadedArtPieceInput) {
      // Both checked before asking for a connection, same as `createAsset`.
      assertUploadedArtPiece(piece);
      const asset = decorAsset === undefined ? undefined : normalizeCreateAssetInput(decorAsset);
      const fields = artPieceFields(piece);

      return inTransaction(async (client) => {
        const inserted = await client.query(UPLOADED_ART_PIECE_INSERT, [
          fields.id,
          fields.kind,
          fields.name,
          fields.material,
          fields.colorable,
          fields.defaultColor,
          fields.author,
          fields.license,
          JSON.stringify(fields.files),
          JSON.stringify(fields.spec),
          ART_CONTRACT_VERSION,
          uploadedBy,
        ]);
        const row = inserted.rows[0];
        if (row === undefined) throw new ArtPieceExistsError(piece.id);
        // Same transaction: a taken decor name rolls the piece back too.
        const created = asset === undefined ? null : await insertAsset(client, asset);
        return { piece: toArtPiece(row), asset: created };
      });
    },
  };
}
