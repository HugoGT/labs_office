/**
 * The geometry of a desk table of the decor layer (#208, `officeDecor.ts`): a
 * desk piece of the art pack lying along a row or a column, anchored on its
 * middle tile. Its rotation picks the way a person seated at it looks (the
 * same pairing as a decor chair's facing): 0 faces down, 90 right, 180 up,
 * 270 left. Shared by the scene and the collisions.
 *
 * Import-free like `seating.ts`, so the server loads it with Node type
 * stripping.
 */

/** Long side of a table's top on screen, in pixels: about 2.5 tiles (`HALF_LENGTH_PX` of tools/art). */
export const TABLE_LONG_SIDE_PX = 80;
/** Short side of the top's floor area: 24 model pixels of depth, 14 rows facing up or down, 24 columns facing left or right. */
const TABLE_DEPTH_ROWS = 14;
const TABLE_DEPTH_COLUMNS = 24;

export type TableRotation = 0 | 90 | 180 | 270;
export type TableFacing = 'down' | 'right' | 'up' | 'left';

export const TABLE_ROTATIONS: readonly TableRotation[] = [0, 90, 180, 270];

const FACINGS: Readonly<Record<TableRotation, TableFacing>> = { 0: 'down', 90: 'right', 180: 'up', 270: 'left' };

function isTableRotation(value: number): value is TableRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/** The way a person seated at a table with this rotation looks. Anything but 90, 180 or 270 reads as down. */
export function tableFacing(rotation: number): TableFacing {
  return isTableRotation(rotation) ? FACINGS[rotation] : 'down';
}

/**
 * The floor area of a table's top around its anchor (the middle of its
 * middle tile), in world orientation: the default collision of a table
 * nobody edited, so it blocks its row or column but leaves the floor around
 * it walkable.
 */
export function tableFloorRect(rotation: TableRotation): { x: number; y: number; w: number; h: number } {
  const horizontal = rotation === 0 || rotation === 180;
  const w = horizontal ? TABLE_LONG_SIDE_PX : TABLE_DEPTH_COLUMNS;
  const h = horizontal ? TABLE_DEPTH_ROWS : TABLE_LONG_SIDE_PX;
  return { x: -w / 2, y: -h / 2, w, h };
}
