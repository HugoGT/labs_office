/**
 * Adaptador de Postgres de `SpacesDirectory` (#7). Es el unico fichero de la
 * carpeta que sabe SQL, igual que `pgDirectory.ts` es el unico que sabe SQL
 * del directorio de usuarios. Consume la misma forma minima de `pg`
 * (`DirectoryPool`/`DirectoryQueryable`) que ya declara `pgDirectory.ts`, en
 * vez de redeclararla: mismo doble que los tests, mismo `fakePool` posible
 * sin levantar Postgres.
 */

import type {
  CreateSpaceInput,
  LayoutItemInput,
  Space,
  SpaceLayout,
  SpacesDirectory,
  UpdateSpaceInput,
} from './spacesPort.ts';
import {
  SpaceNameTakenError,
  SpaceOverlapError,
  SpaceOwnedByDeskError,
  hashSpaces,
  normalizeCreateSpaceInput,
  normalizeUpdateSpaceInput,
  type CanonicalSpace,
} from './spaceRules.ts';
import { ART_PACK_DEFAULTS, normalizeStoredAppearance } from '../decor/artCatalogRules.ts';
import type { DirectoryPool, DirectoryQueryable } from '../directory/pgDirectory.ts';

/** Codigo de `exclusion_violation` de Postgres: lo que salta `spaces_no_overlap`. */
const EXCLUSION_VIOLATION = '23P01';

function isExclusionViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === EXCLUSION_VIOLATION;
}

/**
 * Codigo de `unique_violation` de Postgres, el mismo que ya nombra
 * `pgDirectory.ts`: lo que saltan `spaces_slug_unique` y `spaces_name_unique`.
 */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;
}

/**
 * La traduccion que comparten el alta y el renombrado. Solo mira los dos
 * codigos que este adaptador sabe leer y RELANZA todo lo demas: tragarse un
 * fallo desconocido como 409 le diria al administrador que se equivoco el
 * cuando el que se rompio fue el servidor, que es el mismo pecado que evitan
 * los `translating` de las rutas, en la otra direccion.
 */
function translatePgError(error: unknown): never {
  if (isExclusionViolation(error)) {
    throw new SpaceOverlapError('el rectangulo solicitado se solapa con un espacio existente');
  }
  if (isUniqueViolation(error)) {
    throw new SpaceNameTakenError('ya existe un espacio con ese nombre');
  }
  throw error;
}

const SPACE_COLUMNS =
  'id, slug, name, x, y, w, h, capacity, desk_id, floor_material_id, floor_color, created_at, updated_at';

function toSpace(row: Record<string, unknown>): Space {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    x: row.x as number,
    y: row.y as number,
    w: row.w as number,
    h: row.h as number,
    capacity: (row.capacity as number | null) ?? null,
    deskId: (row.desk_id as string | null) ?? null,
    // NOT NULL DEFAULT in the schema; the fallback is for a row read before
    // the migration ran, same as `above_avatars` (#71).
    floorMaterialId: (row.floor_material_id as string | null | undefined) ?? ART_PACK_DEFAULTS.floor,
    floorColor: (row.floor_color as string | null | undefined) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toCanonicalSpace(row: Record<string, unknown>): CanonicalSpace {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    x: row.x as number,
    y: row.y as number,
    w: row.w as number,
    h: row.h as number,
    capacity: (row.capacity as number | null) ?? null,
  };
}

function toSpaceLayout(row: Record<string, unknown>): SpaceLayout {
  return {
    id: row.id as string,
    spaceId: row.space_id as string,
    assetId: row.asset_id as string,
    x: row.x as number,
    y: row.y as number,
    rotation: row.rotation as SpaceLayout['rotation'],
    zIndex: row.z_index as number,
    createdAt: row.created_at as Date,
  };
}

export function createPgSpaces(pool: DirectoryPool): SpacesDirectory {
  /**
   * Misma razon que `pgDirectory.inTransaction`: `pool.query` reparte cada
   * consulta por la conexion que este libre, asi que el BEGIN y el resto de
   * la transaccion podrian acabar en conexiones distintas.
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

  async function getSpace(id: string): Promise<Space | null> {
    const result = await pool.query(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? toSpace(row) : null;
  }

  return {
    async listSpaces() {
      const result = await pool.query(`SELECT ${SPACE_COLUMNS} FROM spaces ORDER BY x, y, id`);
      return result.rows.map(toSpace);
    },

    getSpace,

    async createSpace(input: CreateSpaceInput) {
      // Validar ANTES de pedir conexion, misma razon que
      // `invitationRules`/`userRules`: un rectangulo mal escrito no debe
      // costar una consulta.
      const normalized = normalizeCreateSpaceInput(input);
      const floor = input.floor === undefined ? undefined : normalizeStoredAppearance(input.floor, ART_PACK_DEFAULTS.floor);
      const values: unknown[] = [
        normalized.slug,
        normalized.name,
        normalized.x,
        normalized.y,
        normalized.w,
        normalized.h,
        normalized.capacity,
      ];
      // Without a floor the columns are left to their schema DEFAULT, the
      // same value `ART_PACK_DEFAULTS` gives `memorySpaces`.
      let columns = 'slug, name, x, y, w, h, capacity';
      if (floor) {
        columns += ', floor_material_id, floor_color';
        values.push(floor.materialId, floor.color);
      }
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');

      try {
        const result = await pool.query(
          `
            INSERT INTO spaces (${columns})
            VALUES (${placeholders})
            RETURNING ${SPACE_COLUMNS}
          `,
          values,
        );
        return toSpace(result.rows[0]);
      } catch (error) {
        // Las restricciones de `schema.sql` son la garantia real; esto solo
        // traduce sus fallos a errores de dominio en vez de un 500 pelado,
        // misma logica que documenta `boundsOverlap`.
        translatePgError(error);
      }
    },

    async updateSpace(id: string, input: UpdateSpaceInput) {
      // Igual que en `createSpace`: valida ANTES de tocar el pool.
      const patch = normalizeUpdateSpaceInput(input);

      if (Object.keys(patch).length === 0) {
        // Un patch vacio no tiene nada que cambiar: relee en vez de mandar un
        // UPDATE cuyo unico efecto seria pisar `updated_at` sin motivo.
        return getSpace(id);
      }

      const fields = Object.keys(patch) as (keyof typeof patch)[];
      const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
      const values = fields.map((field) => patch[field]);

      try {
        const result = await pool.query(
          `
            UPDATE spaces SET ${setClause}, updated_at = now()
            WHERE id = $1 AND desk_id IS NULL
            RETURNING ${SPACE_COLUMNS}
          `,
          [id, ...values],
        );
        const row = result.rows[0];
        if (row) return toSpace(row);

        // Cero filas: `desk_id IS NULL` en el WHERE las excluye por dos
        // motivos distintos, y solo una lectura de mas los separa -- mismo
        // precedente que `pgDesks.claimDesk`. El id no existe: null, un 404.
        // El id existe pero es de un escritorio: SpaceOwnedByDeskError, un
        // 409 (tarea 1.4).
        const existing = await getSpace(id);
        if (existing === null) return null;
        throw new SpaceOwnedByDeskError('este espacio pertenece a un escritorio y no se administra aqui');
      } catch (error) {
        // Renombrar choca con los mismos indices unicos que el alta:
        // `normalizeUpdateSpaceInput` deriva un slug nuevo del nombre nuevo.
        // `SpaceOwnedByDeskError` no tiene forma de error de Postgres (sin
        // `.code`), asi que `translatePgError` la relanza tal cual.
        translatePgError(error);
      }
    },

    async deleteSpace(id: string) {
      // Un unico DELETE: `space_layouts.space_id ON DELETE CASCADE` en
      // `schema.sql` es quien se lleva el layout, no este adaptador (D1b).
      // `desk_id IS NULL` excluye los cubiculos de escritorio, igual que en
      // `updateSpace` (tarea 1.4).
      const result = await pool.query('DELETE FROM spaces WHERE id = $1 AND desk_id IS NULL', [id]);
      if ((result.rowCount ?? 0) > 0) return true;

      // Cero filas: mismo doble motivo que en `updateSpace`. El id no
      // existe: false, un 404. El id existe pero es de un escritorio:
      // SpaceOwnedByDeskError, un 409.
      const existing = await getSpace(id);
      if (existing === null) return false;
      throw new SpaceOwnedByDeskError('este espacio pertenece a un escritorio y no se administra aqui');
    },

    async listLayout(spaceId: string) {
      const result = await pool.query(
        `
          SELECT id, space_id, asset_id, x, y, rotation, z_index, created_at
          FROM space_layouts
          WHERE space_id = $1
          ORDER BY z_index, id
        `,
        [spaceId],
      );
      return result.rows.map(toSpaceLayout);
    },

    async replaceLayout(spaceId: string, items: readonly LayoutItemInput[]) {
      return inTransaction(async (client) => {
        await client.query('DELETE FROM space_layouts WHERE space_id = $1', [spaceId]);

        if (items.length === 0) return [];

        const rows: SpaceLayout[] = [];
        for (const item of items) {
          const result = await client.query(
            `
              INSERT INTO space_layouts (space_id, asset_id, x, y, rotation, z_index)
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id, space_id, asset_id, x, y, rotation, z_index, created_at
            `,
            [spaceId, item.assetId, item.x, item.y, item.rotation, item.zIndex],
          );
          rows.push(toSpaceLayout(result.rows[0]));
        }
        return rows;
      });
    },

    async version() {
      const result = await pool.query('SELECT id, slug, name, x, y, w, h, capacity FROM spaces');
      return hashSpaces(result.rows.map(toCanonicalSpace));
    },
  };
}
