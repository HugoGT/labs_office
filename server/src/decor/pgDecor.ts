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
 *   - Lo ya colocado no pasa por aqui: la capa de decoracion de la oficina
 *     (#208) guarda la pieza de arte, y una retirada se sigue pintando.
 */

import { ART_CONTRACT_VERSION, artSheetKey, type ArtPackManifest, type ArtPiece } from '../../../src/game/artContract.ts';
import { ArtPieceExistsError, artPieceFields, assertUploadedArtPiece, normalizeArtPack, packDecorAsset } from './artCatalogRules.ts';
import {
  CONTRIBUTION_QUOTA_WINDOW_MS,
  assertContributionQuota,
  retireTransition,
  reuploadTransition,
  reviewTransition,
  type ArtAuditAction,
  type ArtPieceStatus,
  type ContributionUsage,
} from './artReviewRules.ts';
import type {
  ArtCatalogPiece,
  ArtContributionInput,
  ArtRetirementInput,
  ArtReviewInput,
  Asset,
  CreateAssetInput,
  DecorCatalog,
  ListArtPiecesOptions,
  ListAssetsOptions,
  ListUploadedArtOptions,
  UpdateAssetInput,
  UploadedArtPieceInput,
} from './decorPort.ts';
import {
  AssetNameTakenError,
  normalizeCreateAssetInput,
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

const ART_PIECE_COLUMNS =
  'id, kind, name, material, colorable, default_color, author, license, files, spec, contract_version, retired_at, registered_at, updated_at, source, uploaded_by, status, reviewed_by, reviewed_at, review_note, license_accepted_at';

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

/**
 * A contribution (#122): the same insert-or-refuse as an Admin upload, but
 * `pending` and stamped with the moment its rights statement was accepted.
 */
const CONTRIBUTION_INSERT = `
  INSERT INTO art_pieces (id, kind, name, material, colorable, default_color, author, license, files, spec, contract_version, source, uploaded_by, status, license_accepted_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, 'upload', $12, 'pending', now())
  ON CONFLICT (id) DO NOTHING
  RETURNING ${ART_PIECE_COLUMNS}
`;

/**
 * The same pixels as a retired piece, uploaded again by an Admin (#264): the
 * row takes the new upload's fields and is offered at once. `$1..$12` are
 * `uploadValues`; the kind is only matched, since the id prefix fixes it.
 */
const UPLOADED_ART_PIECE_REVIVE = `
  UPDATE art_pieces SET name = $3, material = $4, colorable = $5, default_color = $6, author = $7, license = $8,
    files = $9::jsonb, spec = $10::jsonb, contract_version = $11, uploaded_by = $12,
    status = 'approved', retired_at = NULL, reviewed_by = NULL, reviewed_at = NULL, review_note = NULL, license_accepted_at = NULL,
    updated_at = now()
  WHERE id = $1 AND kind = $2
  RETURNING ${ART_PIECE_COLUMNS}
`;

/**
 * The same, contributed (#264): back to `pending` with `retired_at` kept, so it
 * is not offered until approved, and with the approved fields kept, so placed
 * copies draw what was reviewed (pending metadata is never public, #122).
 */
const CONTRIBUTION_REVIVE = `
  UPDATE art_pieces SET uploaded_by = $3, status = 'pending', reviewed_by = NULL, reviewed_at = NULL, review_note = NULL, license_accepted_at = now(),
    updated_at = now()
  WHERE id = $1 AND kind = $2
  RETURNING ${ART_PIECE_COLUMNS}
`;

/**
 * What a user has in flight: pending pieces, and accepted submissions of the
 * last window read from the audit trail, so a rejected or retired piece still
 * counts for the hour. Run under the user's row lock when it is binding.
 */
const CONTRIBUTION_USAGE = `
  SELECT
    (SELECT count(*) FROM art_pieces WHERE uploaded_by = $1 AND status = 'pending')::int AS pending,
    (SELECT count(*) FROM audit_log
      WHERE actor_id = $1 AND action = 'submit-art' AND created_at > now() - make_interval(secs => $2))::int AS last_hour
`;

const ART_AUDIT_INSERT = 'INSERT INTO audit_log (actor_id, action, piece_id) VALUES ($1, $2, $3)';

const UPLOADED_ART_PIECE_LOCK = `SELECT ${ART_PIECE_COLUMNS} FROM art_pieces WHERE id = $1 AND source = 'upload' FOR UPDATE`;

/** An approval also ends a retirement: a comeback (#264) is offered again. */
const ART_REVIEW_UPDATE = `
  UPDATE art_pieces SET status = $2, reviewed_by = $3, review_note = $4, reviewed_at = now(), updated_at = now(),
    retired_at = CASE WHEN $2 = 'approved' THEN NULL ELSE retired_at END
  WHERE id = $1
  RETURNING ${ART_PIECE_COLUMNS}
`;

const UPLOADED_ART_PIECE_RETIRE = `
  UPDATE art_pieces SET retired_at = now(), updated_at = now()
  WHERE id = $1
  RETURNING ${ART_PIECE_COLUMNS}
`;

/** The decor asset of a piece coming back (#264): its own, so placed copies keep it. */
const DECOR_ASSET_UNARCHIVE_BY_TEXTURE = `UPDATE assets SET archived_at = NULL WHERE texture_key = $1 RETURNING ${ASSET_COLUMNS}`;

/** Archived, never deleted: whoever placed the plant keeps seeing it (D1b). */
const DECOR_ASSET_ARCHIVE_BY_TEXTURE = 'UPDATE assets SET archived_at = now() WHERE texture_key = $1 AND archived_at IS NULL';

/**
 * The decor asset of a pack chair, at every registration. Keyed by texture:
 * an asset of that texture, archived or not, is never recreated, so a restart
 * neither duplicates it nor undoes an admin's archive. `ON CONFLICT DO
 * NOTHING` covers `assets_slug_unique`: a name some other asset already took
 * skips the chair rather than stopping the server. Casts because the values
 * go through a SELECT, where Postgres would type them as text.
 */
const PACK_DECOR_ASSET_INSERT = `
  INSERT INTO assets (slug, name, kind, texture_key, w, h, placeable_on_desk, above_avatars)
  SELECT $1, $2, $3, $4, $5::int, $6::int, $7::boolean, $8::boolean
  WHERE NOT EXISTS (SELECT 1 FROM assets WHERE texture_key = $4)
  ON CONFLICT DO NOTHING
`;

/** The decor assets of the pieces a pack registration retired, like `DECOR_ASSET_ARCHIVE_BY_TEXTURE`. */
const DECOR_ASSET_ARCHIVE_BY_TEXTURES = 'UPDATE assets SET archived_at = now() WHERE texture_key = ANY($1::text[]) AND archived_at IS NULL';

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
    // Same for the review columns (#122): the DEFAULT is approved.
    status: (row.status as ArtPieceStatus | undefined) ?? 'approved',
    reviewedBy: (row.reviewed_by as string | null | undefined) ?? null,
    reviewedAt: (row.reviewed_at as Date | null | undefined) ?? null,
    reviewNote: (row.review_note as string | null | undefined) ?? null,
    licenseAcceptedAt: (row.license_accepted_at as Date | null | undefined) ?? null,
  };
}

/** The values of `UPLOADED_ART_PIECE_INSERT` and `CONTRIBUTION_INSERT`, in order. */
function uploadValues(piece: ArtPiece, uploadedBy: string): unknown[] {
  const fields = artPieceFields(piece);
  return [
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
  ];
}

function toUsage(row: Record<string, unknown> | undefined): ContributionUsage {
  return { pending: Number(row?.pending ?? 0), lastHour: Number(row?.last_hour ?? 0) };
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
  /** One audit entry of the art catalog, inside the transaction of the change it records. */
  async function audit(client: DirectoryQueryable, actorId: string, action: ArtAuditAction, pieceId: string): Promise<void> {
    await client.query(ART_AUDIT_INSERT, [actorId, action, pieceId]);
  }

  /**
   * After an upload's insert found its id taken: the retired row it revives
   * with `revive`, under its lock, or `ArtPieceExistsError` (#264).
   */
  async function revive(client: DirectoryQueryable, piece: ArtPiece, sql: string, values: unknown[]): Promise<Record<string, unknown>> {
    const locked = await client.query(UPLOADED_ART_PIECE_LOCK, [piece.id]);
    const current = locked.rows[0];
    if (current === undefined || reuploadTransition(toArtPiece(current)) === 'exists') throw new ArtPieceExistsError(piece.id);
    const revived = await client.query(sql, values);
    return revived.rows[0]!;
  }

  /** A piece back in the catalog offers its own decor asset again; a new one only if it never had one. */
  async function offeredAsset(client: DirectoryQueryable, pieceId: string, asset: NormalizedCreateAssetInput | undefined): Promise<Asset | null> {
    const unarchived = await client.query(DECOR_ASSET_UNARCHIVE_BY_TEXTURE, [artSheetKey(pieceId, 'sheet')]);
    if (unarchived.rows[0] !== undefined) return toAsset(unarchived.rows[0]);
    return asset === undefined ? null : insertAsset(client, asset);
  }

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
        const retiredIds = retired.rows.map((row) => row.id as string);
        for (const piece of valid.pieces) {
          const input = packDecorAsset(piece);
          if (input === null) continue;
          const asset = normalizeCreateAssetInput(input);
          await client.query(PACK_DECOR_ASSET_INSERT, [
            asset.slug,
            asset.name,
            asset.kind,
            asset.textureKey,
            asset.w,
            asset.h,
            asset.placeableOnDesk,
            asset.aboveAvatars,
          ]);
        }
        if (retiredIds.length > 0) {
          await client.query(DECOR_ASSET_ARCHIVE_BY_TEXTURES, [retiredIds.map((id) => artSheetKey(id, 'sheet'))]);
        }
        return { registered: valid.pieces.length, retired: retiredIds };
      });
    },

    async listArtPieces(options: ListArtPiecesOptions = {}) {
      // Composed in the text for the same reason as `listAssets`. Approved
      // only, always: a contribution under review is not part of the catalog.
      // A retired piece was approved: it stays drawable while a comeback of it
      // is reviewed (#264).
      const where = options.includeRetired ? "WHERE status = 'approved' OR retired_at IS NOT NULL" : "WHERE status = 'approved' AND retired_at IS NULL";
      const result = await pool.query(`SELECT ${ART_PIECE_COLUMNS} FROM art_pieces ${where} ORDER BY kind, id`);
      return result.rows.map(toArtPiece);
    },

    async registerUploadedArtPiece({ piece, uploadedBy, decorAsset }: UploadedArtPieceInput) {
      // Both checked before asking for a connection, same as `createAsset`.
      assertUploadedArtPiece(piece);
      const asset = decorAsset === undefined ? undefined : normalizeCreateAssetInput(decorAsset);

      return inTransaction(async (client) => {
        const inserted = await client.query(UPLOADED_ART_PIECE_INSERT, uploadValues(piece, uploadedBy));
        const row = inserted.rows[0] ?? (await revive(client, piece, UPLOADED_ART_PIECE_REVIVE, uploadValues(piece, uploadedBy)));
        // Same transaction: a taken decor name rolls the piece back too.
        const created =
          inserted.rows[0] === undefined ? await offeredAsset(client, piece.id, asset) : asset === undefined ? null : await insertAsset(client, asset);
        await audit(client, uploadedBy, 'upload-art', piece.id);
        return { piece: toArtPiece(row), asset: created };
      });
    },

    async artContributionUsage(userId: string) {
      const result = await pool.query(CONTRIBUTION_USAGE, [userId, CONTRIBUTION_QUOTA_WINDOW_MS / 1000]);
      return toUsage(result.rows[0]);
    },

    async submitArtContribution({ piece, submittedBy, decorAsset }: ArtContributionInput) {
      assertUploadedArtPiece(piece);
      const asset = decorAsset === undefined ? undefined : normalizeCreateAssetInput(decorAsset);

      return inTransaction(async (client) => {
        // The user row is the lock every submission of that user queues on
        // (READ COMMITTED): two parallel uploads count one after the other,
        // so they cannot both take the last pending slot or the last of the
        // hour. The lock is on the stable owner row.
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [submittedBy]);
        const counted = await client.query(CONTRIBUTION_USAGE, [submittedBy, CONTRIBUTION_QUOTA_WINDOW_MS / 1000]);
        assertContributionQuota(toUsage(counted.rows[0]));
        if (asset !== undefined) {
          // Only checked: the asset itself is created by the approval. A
          // comeback gets its own asset back instead, so its name is not checked.
          const taken = await client.query(
            'SELECT id FROM assets WHERE lower(slug) = lower($1) AND NOT EXISTS (SELECT 1 FROM assets WHERE texture_key = $2)',
            [asset.slug, asset.textureKey],
          );
          if (taken.rows.length > 0) throw new AssetNameTakenError('ya existe un asset con ese nombre');
        }
        const inserted = await client.query(CONTRIBUTION_INSERT, uploadValues(piece, submittedBy));
        const row = inserted.rows[0] ?? (await revive(client, piece, CONTRIBUTION_REVIVE, [piece.id, piece.kind, submittedBy]));
        await audit(client, submittedBy, 'submit-art', piece.id);
        return toArtPiece(row);
      });
    },

    async listUploadedArtPieces(options: ListUploadedArtOptions = {}) {
      const result = await pool.query(
        `SELECT ${ART_PIECE_COLUMNS} FROM art_pieces
         WHERE source = 'upload' AND ($1::uuid IS NULL OR uploaded_by = $1) AND ($2::text IS NULL OR status = $2)
         ORDER BY registered_at, id`,
        [options.uploadedBy ?? null, options.status ?? null],
      );
      return result.rows.map(toArtPiece);
    },

    async findUploadedArtPiece(id: string) {
      const result = await pool.query(`SELECT ${ART_PIECE_COLUMNS} FROM art_pieces WHERE id = $1 AND source = 'upload'`, [id]);
      const row = result.rows[0];
      return row ? toArtPiece(row) : null;
    },

    async findArtPiecesWithFile(sha256: string) {
      // jsonb containment: some element of `files` has this `sha256`.
      const result = await pool.query(
        `SELECT ${ART_PIECE_COLUMNS} FROM art_pieces WHERE source = 'upload' AND files @> $1::jsonb ORDER BY registered_at, id`,
        [JSON.stringify([{ sha256 }])],
      );
      return result.rows.map(toArtPiece);
    },

    async reviewArtContribution({ id, reviewerId, decision, note, decorAsset }: ArtReviewInput) {
      const asset = decorAsset === undefined ? undefined : normalizeCreateAssetInput(decorAsset);

      return inTransaction(async (client) => {
        // The row lock makes two reviewers deciding at once queue: the second
        // one reads the first decision and is refused by the transition rule.
        const locked = await client.query(UPLOADED_ART_PIECE_LOCK, [id]);
        const current = locked.rows[0];
        if (current === undefined) return null;
        const before = toArtPiece(current);
        const status = reviewTransition(before.status, decision);
        const updated = await client.query(ART_REVIEW_UPDATE, [id, status, reviewerId, status === 'rejected' ? note : null]);
        // An approved comeback (#264) is offered again with its own decor asset.
        const created =
          status !== 'approved' ? null : before.retiredAt !== null ? await offeredAsset(client, id, asset) : asset === undefined ? null : await insertAsset(client, asset);
        await audit(client, reviewerId, status === 'approved' ? 'approve-art' : 'reject-art', id);
        return { piece: toArtPiece(updated.rows[0]), asset: created };
      });
    },

    async retireUploadedArtPiece({ id, actorId }: ArtRetirementInput) {
      return inTransaction(async (client) => {
        const locked = await client.query(UPLOADED_ART_PIECE_LOCK, [id]);
        const current = locked.rows[0];
        if (current === undefined) return null;
        const piece = toArtPiece(current);
        if (retireTransition(piece) === 'already-retired') return { piece, changed: false };
        const retired = await client.query(UPLOADED_ART_PIECE_RETIRE, [id]);
        await client.query(DECOR_ASSET_ARCHIVE_BY_TEXTURE, [artSheetKey(id, 'sheet')]);
        await audit(client, actorId, 'retire-art', id);
        return { piece: toArtPiece(retired.rows[0]), changed: true };
      });
    },
  };
}
