/**
 * The table of a desk's decor (Editar espacios). A desk is an empty 3x3 area;
 * its occupant may place one table, a desk piece of the art pack, on one
 * 3-tile edge: the top row, the bottom row, the left column or the right
 * column. Shared by the decor editor, the scene, the collisions and the
 * server's decor rules, so all of them read the same edge from the same item.
 *
 * A table is one decor item: its `slot` is the middle tile of its edge and its
 * `rotation` picks that edge, the way a person seated at it looks (the same
 * pairing as a decor chair's `decorSeatFacing`): 0 faces down, so it lies on
 * the bottom row and people stand north of it; 90 right (right column), 180
 * up (top row), 270 left (left column). It covers the three slots of its
 * edge, and nothing else may stand on them.
 *
 * Import-free like `seating.ts`, so the server loads it with Node type
 * stripping. Slots are row major, 0..8 (`deskLayout.ts`).
 */

/** Long side of a table's top on screen, in pixels: about 2.5 tiles (`HALF_LENGTH_PX` of tools/art). */
export const TABLE_LONG_SIDE_PX = 80;
/** Short side of the top's floor area: 24 model pixels of depth, 14 rows facing up or down, 24 columns facing left or right. */
const TABLE_DEPTH_ROWS = 14;
const TABLE_DEPTH_COLUMNS = 24;

/** A desk is 3x3 tiles (`DESK_SIDE`): no decor piece may be larger. */
export const DESK_DECOR_MAX_SIDE = 3;

export type TableRotation = 0 | 90 | 180 | 270;
export type TableFacing = 'down' | 'right' | 'up' | 'left';

export const TABLE_ROTATIONS: readonly TableRotation[] = [0, 90, 180, 270];

const EDGES: Readonly<Record<TableRotation, { facing: TableFacing; slots: readonly [number, number, number] }>> = {
  0: { facing: 'down', slots: [6, 7, 8] },
  90: { facing: 'right', slots: [2, 5, 8] },
  180: { facing: 'up', slots: [0, 1, 2] },
  270: { facing: 'left', slots: [0, 3, 6] },
};

function isTableRotation(value: number): value is TableRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

const TABLE_KEY = /^art:(desk-[a-z0-9]+(?:-[a-z0-9]+)*):sheet$/;
const ART_SHEET_KEY = /^art:([a-z]+)-[^:]+:([a-z]+)$/;
/** Art pieces a desk takes as decor: chairs (guest seats), plants and its table. */
const DESK_DECOR_ART_KINDS = ['chair', 'plant', 'desk'];

/** The desk piece of a decor texture key (`art:desk-<x>:sheet`, what a table's decor asset carries), else `null`. */
export function decorTablePiece(textureKey: string): string | null {
  const match = TABLE_KEY.exec(textureKey);
  return match === null ? null : (match[1] as string);
}

/** The way a person seated at a table with this rotation looks. Anything but 90, 180 or 270 reads as down. */
export function tableFacing(rotation: number): TableFacing {
  return isTableRotation(rotation) ? EDGES[rotation].facing : 'down';
}

/** The middle slot of the edge a rotation picks: where a table item with that rotation is stored. */
export function tableEdgeSlot(rotation: TableRotation): number {
  return EDGES[rotation].slots[1];
}

/** The three slots of the edge a rotation picks, in slot order. */
export function tableSlots(rotation: TableRotation): readonly number[] {
  return EDGES[rotation].slots;
}

/** The rotation whose edge has `slot` as its middle, or `null` (a corner or the center). */
export function tableRotationForSlot(slot: number): TableRotation | null {
  return TABLE_ROTATIONS.find((rotation) => tableEdgeSlot(rotation) === slot) ?? null;
}

/** The parts of a decor item these rules read; both sides' `DeskItem` fit. */
export interface DeskTableItem {
  readonly slot: number;
  readonly rotation: number;
  readonly textureKey: string;
}

export interface DecorTable {
  readonly piece: string;
  readonly rotation: TableRotation;
  readonly facing: TableFacing;
  readonly slots: readonly number[];
}

/** The table of a desk decor, or `null` when it has none (or only a malformed one). */
export function decorTableAt(items: readonly DeskTableItem[]): DecorTable | null {
  for (const item of items) {
    const piece = decorTablePiece(item.textureKey);
    if (piece === null || !isTableRotation(item.rotation) || tableEdgeSlot(item.rotation) !== item.slot) continue;
    return { piece, rotation: item.rotation, facing: EDGES[item.rotation].facing, slots: EDGES[item.rotation].slots };
  }
  return null;
}

/**
 * Whether a decor asset may stand on a desk. An art piece must be a chair, a
 * plant or a table (a desk piece): room tables, trees and every other map
 * piece are never desk decor. Nothing larger than the desk fits either.
 */
export function fitsDeskDecor(asset: { readonly textureKey: string; readonly w: number; readonly h: number }): boolean {
  if (asset.w > DESK_DECOR_MAX_SIDE || asset.h > DESK_DECOR_MAX_SIDE) return false;
  const art = ART_SHEET_KEY.exec(asset.textureKey);
  if (art === null) return !asset.textureKey.startsWith('art:');
  return art[2] === 'sheet' && DESK_DECOR_ART_KINDS.includes(art[1] as string);
}

export type DeskDecorConflict = 'table-off-edge' | 'second-table' | 'on-table';

/**
 * What is wrong with a whole desk decor as far as its table goes, or `null`:
 * a table must sit on the middle slot of the edge its rotation picks, there is
 * at most one, and nothing else may stand on its three slots.
 */
export function deskDecorConflict(items: readonly DeskTableItem[]): DeskDecorConflict | null {
  const tables = items.filter((item) => decorTablePiece(item.textureKey) !== null);
  for (const table of tables) {
    if (!isTableRotation(table.rotation) || tableEdgeSlot(table.rotation) !== table.slot) return 'table-off-edge';
  }
  if (tables.length > 1) return 'second-table';
  const table = tables[0];
  if (table === undefined) return null;
  const covered = new Set(tableSlots(table.rotation as TableRotation));
  return items.some((item) => item !== table && covered.has(item.slot)) ? 'on-table' : null;
}

/**
 * The floor area of a table's top around its anchor (the middle of its edge's
 * middle tile), in world orientation: the default collision of a table nobody
 * edited, so it blocks the edge but leaves the rest of the desk walkable.
 */
export function tableFloorRect(rotation: TableRotation): { x: number; y: number; w: number; h: number } {
  const horizontal = rotation === 0 || rotation === 180;
  const w = horizontal ? TABLE_LONG_SIDE_PX : TABLE_DEPTH_COLUMNS;
  const h = horizontal ? TABLE_DEPTH_ROWS : TABLE_LONG_SIDE_PX;
  return { x: -w / 2, y: -h / 2, w, h };
}
