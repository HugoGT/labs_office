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

import { deskOverChairLimit } from './deskDecorRules';
import {
  decorFootprint,
  decorItemCovering,
  decorItemKey,
  decorKey,
  decorLayerOf,
  decorTiles,
  diffDecor,
  fallenTopItems,
  fitsInsideDesk,
  insideMap,
  rectTiles,
  topItemSupported,
  withDecor,
  type DecorEdit,
  type DecorItem,
  type DecorPieceInfo,
  type DecorRotation,
  type DecorTileRect,
} from './officeDecor';
import { doorOnWall, wallTilesAfter } from './officeDoors';
import type { GridEdge } from './artContract';
import { tileAreaRect, type TileRect } from './terrainGrid';

/**
 * What a map click does: anchor `piece` turned `rotation` (and painted
 * `color`, a colorable piece only; absent is its manifest default) on the
 * clicked tile, replacing a piece already anchored there. The brush carries
 * the piece's info, so the map draws its footprint without a catalog of its
 * own. A brush `from` an anchor moves the item placed there instead: the
 * click takes it off its old tile and puts it on the new one in one batch,
 * and it never replaces another item. The moved item is the one of the
 * brush's layer on that anchor (#121: its piece says which).
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
 * In a desk area (desk scope) only items wholly inside it are its
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

/** A footprint as the palette states it, columns by rows in tiles: "7x5". */
export function decorSizeLabel(info: DecorPieceInfo): string {
  return `${info.footprint.w}x${info.footprint.h}`;
}

/**
 * Which remembered palette color a piece takes: a sofa `sofa-<material>-<seats>` shares the one of its armchair
 * `chair-<material>`, so the fabric armchair and both fabric sofas come in the same color; any other piece keeps its own.
 */
export function decorColorKey(piece: string): string {
  const sofa = /^sofa-(.+)-\d+$/.exec(piece);
  return sofa === null ? piece : `chair-${sofa[1]}`;
}

/**
 * What the decor editor asks the map to show while it is open. `null` (the
 * whole command) closes it. The preview is drawn for this person only and is
 * never sat on or collided with: the room decides once each edit lands.
 */
export interface DecorEditCommand {
  /** The palette entry picked, or `null`: while one is, the map draws its ghost on the tile under the pointer and reports `decorpick`. */
  brush: DecorBrush | null;
  /** Where this editor may act, in tiles: the person's desk (desk scope), `null` (the whole map) for an admin. */
  area: DecorTileRect | null;
  /** Every desk area in tiles, absent with none: the ghost turns red where a desk's chair limit refuses it. */
  desks?: readonly DecorTileRect[];
  /**
   * The outlines of the spaces this editor reaches, drawn over the map like
   * "Editar espacios" does (#216): the person's desk, or every desk and room
   * for an admin. A guide only, they change nothing about what can be placed.
   */
  outlines?: readonly TileRect[];
  /** Edits on their way to the room, applied in order over the live layer. Drawing only. */
  preview?: readonly DecorEdit[];
  /**
   * The key (`decorItemKey`, #121: a floor item's is its anchor) of the placed item selected with no brush picked, or absent:
   * the map outlines it and draws its move and delete buttons (`decormove`,
   * `decordelete`).
   */
  selected?: number | null;
  /**
   * The browser's color picker of the picked piece's palette tile is open: the right rail stays on screen then (the
   * picker hangs from it and would close with it), and hides once the picker does. Absent with no piece picked.
   */
  pickingColor?: true;
}

/**
 * The outlines "Decoración" draws (#216): a person decorating their desk sees
 * that one only (`area`), an admin (no `area`) every desk and room, which is
 * where the desk rules and the rooms' furniture need telling apart.
 */
export function decorOutlines(
  area: DecorTileRect | null,
  desks: readonly DecorTileRect[],
  rooms: readonly DecorTileRect[],
): TileRect[] {
  return (area === null ? [...desks, ...rooms] : [area]).map(tileAreaRect);
}

/**
 * The ground the ghost reads: the live terrain's walkable tiles, the tiles a
 * wall touches and the wall posts a door needs under it (#223); absent,
 * there is no wall to hold one.
 */
export interface DecorGround {
  readonly width: number;
  readonly height: number;
  readonly walkable: readonly boolean[];
  readonly wallTiles: readonly boolean[];
  readonly walls?: readonly (string | null)[];
  /** The edges the live doors open (`TerrainSnapshot.openings`), none when absent. */
  readonly openings?: readonly GridEdge[];
}

/** The side of a desk, in tiles: what the desk scope may decorate. */
const DESK_SIDE = 3;

/**
 * Whether a piece fits a 3x3 desk in some rotation, so the desk scope offers
 * it. Never a door (#223): it opens a wall, which only an admin edits. Never
 * a room table either (#116), even one that fits: a desk holds desk tables.
 * Nor a sofa: it furnishes the office, a desk seats one at its table.
 */
export function fitsDeskArea(info: DecorPieceInfo): boolean {
  // A tree's crown covers the office around its base, never a desk's business.
  if (info.kind === 'door' || info.kind === 'table' || info.kind === 'sofa' || info.kind === 'tree') return false;
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
 * With `desks`, a chair that would be the fourth on a desk is refused too
 * (`deskOverChairLimit`); a desk table is never refused for another one on
 * the desk, which it replaces.
 *
 * A door (#223, #233) is the room's door rule: its span between two wall
 * posts of any material, one at each end (`doorOnWall`), the tiles on both
 * sides of it on walkable ground and free of other items. The tiles a wall
 * touches do not count for it (its own posts touch them), and it never goes
 * in a desk.
 *
 * A top piece (#121) is the room's top rule (`findDecorConflict`): its whole
 * footprint on the desk tables and room tables the click leaves, off every
 * other top piece. The floor rules never see the top layer.
 */
export function decorPlacementAllowed(
  items: readonly DecorItem[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  ground: DecorGround,
  area: DecorTileRect | null,
  index: number,
  brush: DecorBrush,
  desks: readonly DecorTileRect[] = [],
): boolean {
  const target = decorBrushTarget(index, brush, ground.width);
  const door = brush.info.kind === 'door';
  if (door && (area !== null || !doorOnWall({ width: ground.width, height: ground.height, walls: ground.walls ?? [] }, { index, rotation: brush.rotation, piece: brush.piece }))) return false;
  if (area !== null && !fitsInsideDesk(target, area)) return false;
  if (!insideMap(target, ground.width, ground.height)) return false;
  const layer = decorLayerOf(brush.piece);
  const onLayer = items.filter((item) => decorLayerOf(item.piece) === layer);
  const ignored = brush.from ?? index;
  const taken = new Set(onLayer.filter((item) => item.index !== ignored).flatMap((item) => decorTiles(item, infoOf(item.piece), ground.width)));
  if (brush.from !== undefined && index !== brush.from && onLayer.some((item) => item.index === index)) return false;
  const placed: DecorEdit = { index, item: { piece: brush.piece, rotation: brush.rotation } };
  const leaving: DecorEdit = layer === 'top' ? { index: brush.from ?? index, item: null, layer } : { index: brush.from ?? index, item: null };
  const after = withDecor(items, brush.from === undefined || brush.from === index ? [placed] : [leaving, placed]);
  if (layer === 'top') return topItemSupported({ index, rotation: brush.rotation, piece: brush.piece }, after, infoOf, ground.width) && rectTiles(target, ground.width).every((tile) => !taken.has(tile));
  const floorOf = (layerItems: readonly DecorItem[]): DecorItem[] => layerItems.filter((item) => decorLayerOf(item.piece) === 'floor');
  if (desks.length > 0 && deskOverChairLimit(floorOf(items), floorOf(after), [index], infoOf, desks, ground.width) !== null) return false;
  // A door this brush replaces or moves closes its wall again (`wallTilesAfter`, the room's rule too).
  const wallTiles = door ? ground.wallTiles : wallTilesAfter(ground, after);
  return rectTiles(target, ground.width).every((tile) => ground.walkable[tile] === true && (door || wallTiles[tile] !== true) && !taken.has(tile));
}

/**
 * The edits of a click (`click`) with the removals of the top pieces it
 * leaves off their surface (#121, `fallenTopItems`): what the room would take
 * off in the same save, sent with it so the preview shows them gone too.
 */
export function withFallenTopItems(
  items: readonly DecorItem[],
  click: readonly DecorEdit[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  width: number,
): DecorEdit[] {
  const after = withDecor(items, click);
  const placed = new Set(click.flatMap((edit) => (edit.item === null ? [] : [decorKey(edit.index, decorLayerOf(edit.item.piece))])));
  const fallen = fallenTopItems(items, after, infoOf, width, placed);
  return [...click, ...fallen.map((item): DecorEdit => ({ index: item.index, item: null, layer: 'top' }))];
}

/**
 * The edits of a move of the item of `placement`'s layer anchored on `from`
 * to `index`, turned and painted as `placement` says (#121). A desk table or
 * room table takes along every top piece standing wholly on it, shifted with
 * it, unless it turns on the way; what it leaves off any surface goes. One
 * edit per (tile, layer) that changes (`diffDecor`), so a piece landing where
 * another stood is never sent twice; the removals first.
 */
export function decorMoveEdits(
  items: readonly DecorItem[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  width: number,
  from: number,
  index: number,
  placement: NonNullable<DecorEdit['item']>,
): DecorEdit[] {
  const layer = decorLayerOf(placement.piece);
  const moved = items.find((item) => decorItemKey(item) === decorKey(from, layer));
  if (moved === undefined) return [];
  const leaving = (item: DecorItem): DecorEdit => (decorLayerOf(item.piece) === 'top' ? { index: item.index, item: null, layer: 'top' } : { index: item.index, item: null });
  let after = withDecor(items, [leaving(moved), { index, item: placement }]);
  if (layer === 'floor' && moved.rotation === placement.rotation) {
    const surface = decorFootprint(moved, infoOf(moved.piece), width);
    const carried = items.filter((item) => decorLayerOf(item.piece) === 'top' && fitsInsideDesk(decorFootprint(item, infoOf(item.piece), width), surface));
    // Anchors are row major: one shift moves a whole footprint by the same tiles.
    const shift = index - from;
    after = withDecor(withDecor(after, carried.map(leaving)), carried.map(({ index: anchor, ...item }) => ({ index: anchor + shift, item })));
  }
  // A top piece moved off any surface is refused (`decorPlacementAllowed`), never dropped here.
  after = withDecor(after, fallenTopItems(items, after, infoOf, width, new Set(layer === 'top' ? [decorKey(index, layer)] : [])).map(leaving));
  // Removals first, the order a move's edits always had: off the old tile, onto the new one.
  const edits = diffDecor(items, after);
  return [...edits.filter((edit) => edit.item === null), ...edits.filter((edit) => edit.item !== null)];
}
