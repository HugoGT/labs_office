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
  SpaceOverlapError,
  hashSpaces,
  normalizeCreateSpaceInput,
  normalizeUpdateSpaceInput,
  type CanonicalSpace,
} from './spaceRules.ts';
import type { DirectoryPool, DirectoryQueryable } from '../directory/pgDirectory.ts';

/** Codigo de `exclusion_violation` de Postgres: lo que salta `spaces_no_overlap`. */
const EXCLUSION_VIOLATION = '23P01';

function isExclusionViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === EXCLUSION_VIOLATION;
}

const SPACE_COLUMNS = 'id, slug, name, x, y, w, h, capacity, created_at, updated_at';

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

      try {
        const result = await pool.query(
          `
            INSERT INTO spaces (slug, name, x, y, w, h, capacity)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING ${SPACE_COLUMNS}
          `,
          [normalized.slug, normalized.name, normalized.x, normalized.y, normalized.w, normalized.h, normalized.capacity],
        );
        return toSpace(result.rows[0]);
      } catch (error) {
        // La restriccion de exclusion de `schema.sql` es la garantia real;
        // esto solo traduce su fallo a un error de dominio en vez de un 500
        // pelado, misma logica que documenta `boundsOverlap`.
        if (isExclusionViolation(error)) {
          throw new SpaceOverlapError('el rectangulo solicitado se solapa con un espacio existente');
        }
        throw error;
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
            WHERE id = $1
            RETURNING ${SPACE_COLUMNS}
          `,
          [id, ...values],
        );
        const row = result.rows[0];
        return row ? toSpace(row) : null;
      } catch (error) {
        if (isExclusionViolation(error)) {
          throw new SpaceOverlapError('el rectangulo solicitado se solapa con un espacio existente');
        }
        throw error;
      }
    },

    async deleteSpace(id: string) {
      // Un unico DELETE: `space_layouts.space_id ON DELETE CASCADE` en
      // `schema.sql` es quien se lleva el layout, no este adaptador (D1b).
      const result = await pool.query('DELETE FROM spaces WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
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
