/**
 * Admin port of the terrain blocks (#123 phase 2). Types only, like
 * `spacesAdminPort.ts`; the only adapter is `terrainAdminClient.ts`.
 *
 * There is no read: the office already holds the live blocks, replicated by
 * the room, and the editor takes them from the scene (`terrain` bridge event).
 */

import type { LayoutMaterial } from '../game/officeLayout';

export interface TerrainAdminPort {
  /**
   * Sets one 9x9 block's material. Everyone, this admin included, sees the
   * change through the room state, so nothing comes back. Refused with
   * `terrain-under-placement` when water would cover a placement or spawn.
   * Affected players are relocated after persistence, including reconnects.
   */
  setBlock(index: number, material: LayoutMaterial): Promise<void>;
  setBlocks(edits: readonly { index: number; material: LayoutMaterial }[], expected: string): Promise<void>;
}
