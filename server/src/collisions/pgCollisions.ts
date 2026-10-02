/**
 * Postgres adapter of `CollisionStore`, on the same minimal `pg` shape
 * (`DirectoryPool`) and the same pool as the other directory-backed features.
 * The table is `piece_collisions` in `directory/schema.sql`.
 */

import { isEditablePieceId, parseCollisionRects, type CollisionRect } from '../../../src/game/pieceCollisions.ts';
import type { DirectoryPool } from '../directory/pgDirectory.ts';
import type { CollisionStore } from './collisionPort.ts';

export function createPgCollisions(pool: DirectoryPool): CollisionStore {
  return {
    async loadCollisions() {
      const result = await pool.query('SELECT piece_id, rects FROM piece_collisions');
      const table = new Map<string, readonly CollisionRect[]>();
      // `jsonb` has no shape of its own: a row that does not validate is
      // skipped rather than taking every collision down with it.
      for (const row of result.rows) {
        if (!isEditablePieceId(row.piece_id)) continue;
        try {
          table.set(row.piece_id, parseCollisionRects(row.rects));
        } catch {
          // Skipped, see above.
        }
      }
      return table;
    },

    async saveCollision(pieceId, rects, actorId) {
      await pool.query(
        `INSERT INTO piece_collisions (piece_id, rects, updated_by) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (piece_id) DO UPDATE
           SET rects = EXCLUDED.rects, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [pieceId, JSON.stringify(rects.map(({ x, y, w, h }) => ({ x, y, w, h }))), actorId],
      );
    },

    async deleteCollision(pieceId) {
      await pool.query('DELETE FROM piece_collisions WHERE piece_id = $1', [pieceId]);
    },
  };
}
