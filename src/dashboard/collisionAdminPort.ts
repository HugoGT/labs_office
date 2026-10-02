/**
 * Admin port of the collision areas per piece. Types only, like
 * `terrainAdminPort.ts`; the only adapter is `collisionAdminClient.ts`.
 *
 * There is no read: the office already holds the live table, replicated by
 * the room, and the editor takes it from the scene.
 */

import type { CollisionRect } from '../game/pieceCollisions';

export interface CollisionAdminPort {
  /**
   * Replaces a piece's rectangles (art pixels from its anchor, down-facing);
   * `[]` makes it walk-through. Everyone sees the change through the room
   * state. Refused with `collision-under-player` when a new rectangle would
   * close over someone.
   */
  saveRects(pieceId: string, rects: readonly CollisionRect[]): Promise<void>;
  /** Gives a piece back its default collision. */
  reset(pieceId: string): Promise<void>;
}
