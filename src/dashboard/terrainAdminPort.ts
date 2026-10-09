/**
 * Admin port of the terrain blocks (#123 phase 2). Types only, like
 * `spacesAdminPort.ts`; the only adapter is `terrainAdminClient.ts`.
 *
 * There is no read: the office already holds the live blocks and walls,
 * replicated by the room, and the editor takes them from the scene (`terrain`
 * bridge event).
 */

import type { LayoutMaterial, WallEdit } from '../game/officeLayout';

export interface TerrainAdminPort {
  /**
   * Sets one 9x9 block's material (a palette paint). Everyone, this admin
   * included, sees the change through the room state, so nothing comes back.
   * Refused with `terrain-under-placement` when water or void would cover a
   * placement or spawn. Affected players are relocated after persistence,
   * including reconnects.
   */
  setBlock(index: number, material: LayoutMaterial): Promise<void>;
  /**
   * Sets many blocks atomically (emptying the terrain), refused with
   * `terrain-stale` unless the live blocks still encode to `expected`.
   */
  setBlocks(edits: readonly { index: number; material: LayoutMaterial }[], expected: string): Promise<void>;
  /**
   * Places (`piece`) or removes (`null`) walls on single tiles, all or none,
   * at most `MAX_WALL_EDITS` per call. Refused with `terrain-under-placement`
   * when a wall would stand on a desk, a seat, furniture or the entrance.
   * Players a wall lands on are returned to the entrance.
   */
  setWalls(edits: readonly WallEdit[]): Promise<void>;
}
