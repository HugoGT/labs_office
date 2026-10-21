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
  type DecorKind,
  type DecorPieceInfo,
  type DecorRotation,
  type DecorTileRect,
} from './officeDecor';

/**
 * What a map click does: anchor `piece` turned `rotation` (and painted
 * `color`, a colorable piece only; absent is its manifest default) on the
 * clicked tile, replacing a piece already anchored there. The brush carries
 * the piece's info, so the map draws its footprint without a catalog of its
 * own. A brush `from` an anchor moves the item placed there instead: the
 * click takes it off its old tile and puts it on the new one in one batch,
 * and it never replaces another item.
 */
export interface DecorBrush {
  readonly kind: 'piece';
  readonly piece: string;
  readonly info: DecorPieceInfo;
  readonly rotation: DecorRotation;
  readonly color?: string;
  readonly from?: number;
}

/** Whether two brushes place the same thing (compared by value, not identity). */
export function sameDecorBrush(a: DecorBrush | null | undefined, b: DecorBrush | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  return a.piece === b.piece && a.rotation === b.rotation && a.color === b.color && a.from === b.from;
}

/**
 * The placed item a click on `tile` selects with no brush picked
 * (`decorItemCovering`: the smallest footprint where they stack), or `null`.
 * In a desk area ("Mi espacio") only items wholly inside it are its
 * occupant's to select.
 */
export function decorPickAt(
  items: readonly DecorItem[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  width: number,
  tile: number,
  area: DecorTileRect | null,
): DecorItem | null {
  const reachable = area === null ? items : items.filter((item) => fitsInsideDesk(decorFootprint(item, infoOf(item.piece), width), area));
  return decorItemCovering(reachable, infoOf, width, tile);
}

/** The word each group's pieces are named after in Spanish ("Silla de madera"). */
const KIND_WORDS: Readonly<Record<DecorKind, string>> = {
  chair: 'silla',
  desk: 'escritorio',
  table: 'mesa',
  plant: 'planta',
};

/**
 * The name of a palette tile: only what tells a piece apart within its group,
 * whose heading already says the kind ("Silla de madera" is "Madera" under
 * "Sillas"). The kind word and a following "de " go and the rest is
 * capitalized; a name that does not start with the kind word as a word (an
 * upload named anything) or would be left empty keeps its whole name.
 */
export function decorTileName(kind: DecorKind, name: string): string {
  const match = new RegExp(`^${KIND_WORDS[kind]}\\s+(?:de\\s+)?(\\S.*)$`, 'iu').exec(name.trim());
  const rest = match?.[1];
  if (rest === undefined || /^de$/iu.test(rest)) return name;
  return rest.charAt(0).toLocaleUpperCase('es') + rest.slice(1);
}

/** A footprint as the palette states it, columns by rows in tiles: "7x5". */
export function decorSizeLabel(info: DecorPieceInfo): string {
  return `${info.footprint.w}x${info.footprint.h}`;
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
  /**
   * The anchor of the placed item selected with no brush picked, or absent:
   * the map outlines it and draws its move and delete buttons (`decormove`,
   * `decordelete`).
   */
  selected?: number | null;
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

/** The tiles a brush on `index` would cover, turned the way it is. */
export function decorBrushTarget(index: number, brush: DecorBrush, width: number): DecorTileRect {
  return decorFootprint({ index, rotation: brush.rotation }, brush.info, width);
}

/**
 * Whether the room would likely take the brush on `index`: its whole
 * footprint on the map (and inside `area` when there is one), on walkable
 * ground, off every tile a wall touches and off every other item; the item
 * anchored on `index` itself does not count, because painting over an
 * anchor replaces what stands there. A move (`from`) ignores the item it
 * moves instead, and refuses another item's anchor: it replaces nothing.
 */
export function decorPlacementAllowed(
  items: readonly DecorItem[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  ground: DecorGround,
  area: DecorTileRect | null,
  index: number,
  brush: DecorBrush,
): boolean {
  const target = decorBrushTarget(index, brush, ground.width);
  if (area !== null && !fitsInsideDesk(target, area)) return false;
  if (!insideMap(target, ground.width, ground.height)) return false;
  const ignored = brush.from ?? index;
  const taken = new Set(items.filter((item) => item.index !== ignored).flatMap((item) => decorTiles(item, infoOf(item.piece), ground.width)));
  if (brush.from !== undefined && index !== brush.from && items.some((item) => item.index === index)) return false;
  return rectTiles(target, ground.width).every((tile) => ground.walkable[tile] === true && ground.wallTiles[tile] !== true && !taken.has(tile));
}
