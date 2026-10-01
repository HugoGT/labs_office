/**
 * Port of the persisted terrain blocks (#123 phase 2). Types only, same rule
 * as `spacesPort.ts`: no SQL, no Express, no Colyseus. The production adapter
 * is `pgTerrain.ts`, the test one `memoryTerrain.ts`.
 *
 * Only edited blocks are stored. A block nobody touched keeps the material of
 * the committed Tiled layout (`maps/office.json`), so a new layout file still
 * reaches every block an admin never changed.
 */

import type { LayoutMaterial } from '../../../src/game/officeLayout.ts';

export interface TerrainStore {
  /** Edited blocks by index. Indexes the current map no longer has are the runtime's to ignore. */
  loadBlocks(): Promise<ReadonlyMap<number, LayoutMaterial>>;
  /** Sets one block's material and who set it (a directory user id, or `null`). */
  saveBlock(index: number, material: LayoutMaterial, actorId: string | null): Promise<void>;
}
