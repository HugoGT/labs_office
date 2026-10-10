/**
 * Port of the persisted terrain blocks (#123 phase 2). Types only, same rule
 * as `spacesPort.ts`: no SQL, no Express, no Colyseus. The production adapter
 * is `pgTerrain.ts`, the test one `memoryTerrain.ts`.
 *
 * Only edited blocks are stored. A block nobody touched keeps the material of
 * the committed Tiled layout (`maps/office.json`), so a new layout file still
 * reaches every block an admin never changed.
 *
 * Walls are stored per tile, and only where one stands: removing a wall
 * deletes its row. A stored wall wins over the layout's on its tile.
 *
 * Placed chairs are stored the same way, one per tile and only where one
 * stands. The layout has none of its own (its base chairs are `BASE_MAP_SEATS`).
 */

import type { LayoutMaterial, WallEdit, WallPieceId } from '../../../src/game/officeLayout.ts';
import type { ChairEdit, PlacedChair } from '../../../src/game/seating.ts';

export interface TerrainStore {
  /** Edited blocks by index. Indexes the current map no longer has are the runtime's to ignore. */
  loadBlocks(): Promise<ReadonlyMap<number, LayoutMaterial>>;
  /** Sets one block's material and who set it (a directory user id, or `null`). */
  saveBlock(index: number, material: LayoutMaterial, actorId: string | null): Promise<void>;
  /** All rows succeed or none do; the runtime publishes only after this resolves. */
  saveBlocks(edits: readonly { index: number; material: LayoutMaterial }[], actorId: string | null): Promise<void>;
  /** Placed walls by tile. Tiles the current map no longer has are the runtime's to ignore. */
  loadWalls(): Promise<ReadonlyMap<number, WallPieceId>>;
  /** Places (`piece`) or removes (`null`) walls; all rows succeed or none do. */
  saveWalls(edits: readonly WallEdit[], actorId: string | null): Promise<void>;
  /** Placed chairs sorted by tile. Tiles the current map no longer has are the runtime's to ignore. */
  loadChairs(): Promise<readonly PlacedChair[]>;
  /** Places or turns (`chair`) or removes (`null`) chairs; all rows succeed or none do. */
  saveChairs(edits: readonly ChairEdit[], actorId: string | null): Promise<void>;
}
