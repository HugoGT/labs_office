/**
 * Port of the saved collision areas per art piece (collision editor). Types
 * only, same rule as `terrainPort.ts`: no SQL, no Express, no Colyseus. The
 * production adapter is `pgCollisions.ts`, the test one `memoryCollisions.ts`.
 *
 * Only edited pieces are stored. A piece without a row keeps its default
 * (`pieceCollisions.ts`): the footprint of a layout prop, nothing for the
 * pieces the database places. An empty list is a saved choice: walk-through.
 */

import type { CollisionRect } from '../../../src/game/pieceCollisions.ts';

export interface CollisionStore {
  /** Saved rectangles by piece id. Rows that no longer validate are the adapter's to skip. */
  loadCollisions(): Promise<ReadonlyMap<string, readonly CollisionRect[]>>;
  /** Replaces a piece's rectangles and records who saved them (a directory user id, or `null`). */
  saveCollision(pieceId: string, rects: readonly CollisionRect[], actorId: string | null): Promise<void>;
  /** Forgets a piece's rectangles, so it takes its default again. Deleting a missing row is fine. */
  deleteCollision(pieceId: string): Promise<void>;
}
