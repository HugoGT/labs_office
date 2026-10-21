/**
 * Shapes of the decor editor (#208) shared by React and the scene, kept free
 * of Phaser so the sidebar can import them: the brush, the command the map
 * follows, and the pure rule behind the ghost's color.
 *
 * The ghost is a hint, not the judge: the room checks every edit again
 * (`findDecorConflict` on the server, which also protects the base seats,
 * the static furniture and the entrance), so a green ghost can still be
 * refused and the editor says why.
 */

import {
  decorFootprint,
  decorItemCovering,
  decorTiles,
  fitsInsideDesk,
  insideMap,
  rectTiles,
  type DecorEdit,
  type DecorItem,
  type DecorPieceInfo,
  type DecorRotation,
  type DecorTileRect,
} from './officeDecor';

/**
 * What a map click does: anchor `piece` turned `rotation` on the clicked
 * tile (a piece already anchored there is replaced), or remove the item
 * whose footprint covers the clicked tile (`eraser`). The brush carries the
 * piece's info, so the map draws its footprint without a catalog of its own.
 */
export type DecorBrush =
  | { readonly kind: 'piece'; readonly piece: string; readonly info: DecorPieceInfo; readonly rotation: DecorRotation }
  | { readonly kind: 'eraser' };

/** Whether two brushes place the same thing (compared by value, not identity). */
export function sameDecorBrush(a: DecorBrush | null | undefined, b: DecorBrush | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (a.kind === 'eraser' || b.kind === 'eraser') return a.kind === b.kind;
  return a.piece === b.piece && a.rotation === b.rotation;
}

/**
 * What the decor editor asks the map to show while it is open. `null` (the
 * whole command) closes it. The preview is drawn for this person only and is
 * never sat on or collided with: the room decides once each edit lands.
 */
export interface DecorEditCommand {
  /** The palette entry picked, or `null`: while one is, the map draws its ghost on the tile under the pointer and reports `decorpick`. */
  brush: DecorBrush | null;
  /** Where this editor may act, in tiles: the person's desk in "Mi espacio", `null` (the whole map) in "Decoración". */
  area: DecorTileRect | null;
  /** Edits on their way to the room, applied in order over the live layer. Drawing only. */
  preview?: readonly DecorEdit[];
}

/** The ground the ghost reads: the live terrain's walkable tiles and the tiles a wall touches. */
export interface DecorGround {
  readonly width: number;
  readonly height: number;
  readonly walkable: readonly boolean[];
  readonly wallTiles: readonly boolean[];
}

/** The side of a desk, in tiles: what "Mi espacio" may decorate. */
const DESK_SIDE = 3;

/** Whether a piece fits a 3x3 desk in some rotation, so "Mi espacio" offers it. */
export function fitsDeskArea(info: DecorPieceInfo): boolean {
  return info.footprint.w <= DESK_SIDE && info.footprint.h <= DESK_SIDE;
}

/**
 * The tiles a brush on `index` acts on: the footprint the piece would cover,
 * or the footprint of the item the eraser would remove (`null` when there is
 * none under the tile).
 */
export function decorBrushTarget(
  items: readonly DecorItem[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  width: number,
  index: number,
  brush: DecorBrush,
): DecorTileRect | null {
  if (brush.kind === 'piece') return decorFootprint({ index, rotation: brush.rotation }, brush.info, width);
  const covering = decorItemCovering(items, infoOf, width, index);
  return covering === null ? null : decorFootprint(covering, infoOf(covering.piece), width);
}

/**
 * Whether the room would likely take the brush on `index`. A piece needs its
 * whole footprint on the map (and inside `area` when there is one), on
 * walkable ground, off every tile a wall touches and off every other item;
 * the item anchored on `index` itself does not count, because painting over
 * an anchor replaces what stands there. The eraser needs an item under the
 * tile, wholly inside `area` when there is one.
 */
export function decorPlacementAllowed(
  items: readonly DecorItem[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  ground: DecorGround,
  area: DecorTileRect | null,
  index: number,
  brush: DecorBrush,
): boolean {
  const target = decorBrushTarget(items, infoOf, ground.width, index, brush);
  if (target === null) return false;
  if (area !== null && !fitsInsideDesk(target, area)) return false;
  if (brush.kind === 'eraser') return true;
  if (!insideMap(target, ground.width, ground.height)) return false;
  const taken = new Set(items.filter((item) => item.index !== index).flatMap((item) => decorTiles(item, infoOf(item.piece), ground.width)));
  return rectTiles(target, ground.width).every((tile) => ground.walkable[tile] === true && ground.wallTiles[tile] !== true && !taken.has(tile));
}
