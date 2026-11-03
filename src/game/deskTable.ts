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

/**
 * Long side of a table's top on screen, in pixels: a little over 2.5 tiles,
 * grown from 80 so neighbouring desks stand closer, like in a real office
 * (S19). tools/art draws the desk pieces from it.
 */
export const TABLE_LONG_SIDE_PX = 84;
/**
 * Depth of the top in model pixels, grown with the long side (24 * 84 / 80)
 * to the nearest even value: the model is symmetric around the middle in whole
 * pixels. tools/art draws the desk pieces from it.
 */
export const TABLE_DEPTH_PX = 26;
/** Short side of the top's floor area: 16 rows facing up or down (DEPTH_SCALE of tools/art), the depth in columns facing left or right. */
const TABLE_DEPTH_ROWS = 16;
const TABLE_DEPTH_COLUMNS = TABLE_DEPTH_PX;

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
