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
 * deletes its row. A stored wall wins over the layout's on its tile. Its
 * `updated_at` is when it was last placed or repainted: the placement order
 * (#223), which decides which of two materials is drawn over the other.
 *
 * A block may carry a color of its own (#222), stored on its row and only
 * for a colorable material (`COLORABLE_TERRAIN_MATERIALS`).
 *
 * The office decor layer (#208, `officeDecor.ts`) is stored the same way, one
 * item per anchor tile and only where one stands. The layout has none of its
 * own (its base chairs are `BASE_MAP_SEATS`, its props the Tiled ones).
 */

import type { LayoutMaterial, WallEdit, WallPieceId } from '../../../src/game/officeLayout.ts';
import type { DecorEdit, DecorItem } from '../../../src/game/officeDecor.ts';

export interface TerrainStore {
  /** Edited blocks by index. Indexes the current map no longer has are the runtime's to ignore. */
  loadBlocks(): Promise<ReadonlyMap<number, LayoutMaterial>>;
  /** Sets one block's material and who set it (a directory user id, or `null`). */
  saveBlock(index: number, material: LayoutMaterial, actorId: string | null): Promise<void>;
  /**
   * All rows succeed or none do; the runtime publishes only after this
   * resolves. Each row takes its edit's `color` (#222), and loses any color
   * it had when the edit carries none.
   */
  saveBlocks(edits: readonly { index: number; material: LayoutMaterial; color?: string }[], actorId: string | null): Promise<void>;
  /**
   * The color of each stored block that has one (#222), by index. A row
   * stored before colors existed has none and draws its default art.
   */
  loadBlockColors(): Promise<ReadonlyMap<number, string>>;
  /**
   * Saves blocks like `saveBlocks` and removes the walls on `walls` (post
   * indexes) in the same step: all rows succeed or none do. A void edit uses
   * it to drop the posts it leaves with no ground around them (#217).
   */
  saveBlocksClearingWalls(edits: readonly { index: number; material: LayoutMaterial; color?: string }[], walls: readonly number[], actorId: string | null): Promise<void>;
  /**
   * Placed walls by tile, in placement order, oldest first: the order of the map's entries. Tiles the
   * current map no longer has are the runtime's to ignore.
   */
  loadWalls(): Promise<ReadonlyMap<number, WallPieceId>>;
  /** Places (`piece`) or removes (`null`) walls; all rows succeed or none do. */
  saveWalls(edits: readonly WallEdit[], actorId: string | null): Promise<void>;
  /** Decor items sorted by anchor tile. Tiles the current map no longer has are the runtime's to ignore. */
  loadDecor(): Promise<readonly DecorItem[]>;
  /** Places, turns or replaces (`item`) or removes (`null`) decor items; all rows succeed or none do. */
  saveDecor(edits: readonly DecorEdit[], actorId: string | null): Promise<void>;
  /** Saves walls like `saveWalls` and decor like `saveDecor` together (a desk or room moved with its contents); all rows succeed or none do. */
  saveWallsAndDecor(walls: readonly WallEdit[], decor: readonly DecorEdit[], actorId: string | null): Promise<void>;
}
