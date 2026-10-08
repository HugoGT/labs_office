/**
 * Postgres adapter of `TerrainStore` (#123 phase 2), on the same minimal `pg`
 * shape (`DirectoryPool`) and the same pool as the other directory-backed
 * features. The table is `terrain_blocks` in `directory/schema.sql`.
 */

import { isLayoutMaterial, type LayoutMaterial } from '../../../src/game/officeLayout.ts';
import type { DirectoryPool } from '../directory/pgDirectory.ts';
import type { TerrainStore } from './terrainPort.ts';

export function createPgTerrain(pool: DirectoryPool): TerrainStore {
  return {
    async loadBlocks() {
      const result = await pool.query('SELECT block_index, material FROM terrain_blocks');
      const blocks = new Map<number, LayoutMaterial>();
      // The CHECK of the table already bounds both columns; a row that still
      // fails here is skipped rather than taking the whole terrain down.
      for (const row of result.rows) {
        if (Number.isInteger(row.block_index) && isLayoutMaterial(row.material)) blocks.set(row.block_index as number, row.material);
      }
      return blocks;
    },

    async saveBlock(index, material, actorId) {
      await pool.query(
        `INSERT INTO terrain_blocks (block_index, material, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (block_index) DO UPDATE
           SET material = EXCLUDED.material, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [index, material, actorId],
      );
    },
    async saveBlocks(edits, actorId) {
      // One statement is atomic in Postgres, including every upsert and FK check.
      await pool.query(
        `INSERT INTO terrain_blocks (block_index, material, updated_by)
         SELECT entry.index, entry.material, $2::uuid
         FROM jsonb_to_recordset($1::jsonb) AS entry(index integer, material text)
         ON CONFLICT (block_index) DO UPDATE
           SET material = EXCLUDED.material, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [JSON.stringify(edits), actorId],
      );
    },
  };
}
