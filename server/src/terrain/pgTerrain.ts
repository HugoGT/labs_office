/**
 * Postgres adapter of `TerrainStore` (#123 phase 2), on the same minimal `pg`
 * shape (`DirectoryPool`) and the same pool as the other directory-backed
 * features. The tables are `terrain_blocks`, `terrain_walls` and `office_decor` in
 * `directory/schema.sql`.
 */

import { isLayoutMaterial, isWallPieceId, type LayoutMaterial, type WallPieceId } from '../../../src/game/officeLayout.ts';
import { isDecorColor, isDecorPieceId, isDecorRotation, type DecorItem } from '../../../src/game/officeDecor.ts';
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

    async loadWalls() {
      const result = await pool.query('SELECT tile_index, piece_id FROM terrain_walls');
      const walls = new Map<number, WallPieceId>();
      // Same as the blocks: an unreadable row is skipped, not fatal.
      for (const row of result.rows) {
        if (Number.isInteger(row.tile_index) && isWallPieceId(row.piece_id)) walls.set(row.tile_index as number, row.piece_id);
      }
      return walls;
    },
    async saveWalls(edits, actorId) {
      // One statement, so removals and placements commit together. The
      // tiles of a batch are distinct, so both halves never touch one row.
      await pool.query(
        `WITH entries AS (
           SELECT entry.index, entry.piece FROM jsonb_to_recordset($1::jsonb) AS entry(index integer, piece text)
         ),
         removed AS (
           DELETE FROM terrain_walls WHERE tile_index IN (SELECT index FROM entries WHERE piece IS NULL)
         )
         INSERT INTO terrain_walls (tile_index, piece_id, updated_by)
         SELECT index, piece, $2::uuid FROM entries WHERE piece IS NOT NULL
         ON CONFLICT (tile_index) DO UPDATE
           SET piece_id = EXCLUDED.piece_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [JSON.stringify(edits), actorId],
      );
    },

    async loadDecor() {
      const result = await pool.query('SELECT tile_index, piece_id, rotation, color FROM office_decor');
      const items: DecorItem[] = [];
      // Same as the walls: an unreadable row is skipped, not fatal.
      for (const row of result.rows) {
        const color: unknown = row.color ?? null;
        if (!Number.isInteger(row.tile_index) || !isDecorPieceId(row.piece_id) || !isDecorRotation(row.rotation)) continue;
        if (color !== null && !isDecorColor(color)) continue;
        items.push({ index: row.tile_index as number, piece: row.piece_id, rotation: row.rotation, ...(color === null ? {} : { color }) });
      }
      return items.sort((a, b) => a.index - b.index);
    },
    async saveDecor(edits, actorId) {
      // One statement, like the walls: removals and placements commit
      // together, and the tiles of a batch are distinct.
      const entries = edits.map(({ index, item }) => ({ index, piece: item?.piece ?? null, rotation: item?.rotation ?? null, color: item?.color ?? null }));
      await pool.query(
        `WITH entries AS (
           SELECT entry.index, entry.piece, entry.rotation FROM jsonb_to_recordset($1::jsonb) AS entry(index integer, piece text, rotation smallint, color text)
         ),
         removed AS (
           DELETE FROM office_decor WHERE tile_index IN (SELECT index FROM entries WHERE piece IS NULL)
         )
         INSERT INTO office_decor (tile_index, piece_id, rotation, color, updated_by)
         SELECT index, piece, rotation, color, $2::uuid FROM entries WHERE piece IS NOT NULL
         ON CONFLICT (tile_index) DO UPDATE
           SET piece_id = EXCLUDED.piece_id, rotation = EXCLUDED.rotation, color = EXCLUDED.color, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [JSON.stringify(entries), actorId],
      );
    },
  };
}
