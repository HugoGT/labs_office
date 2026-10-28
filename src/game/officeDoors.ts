/**
 * Doors (#223, #233): a door is an item of the office decor layer
 * (`officeDecor.ts`) that stands on a wall's grid line instead of on a tile.
 * Its anchor tile names the first edge it spans: the top edge of the tile for
 * rotation 0 and 180, the left one for 90 and 270. A door spans 2 tiles of the
 * line, a double door 4 (`doorSpanOf`): the leaf in the middle and a jamb at
 * each end that merges with the wall there. Its rotation is the side it opens
 * into, the chair's facing (`decorChairFacing`: 0 down, 90 right, 180 up, 270
 * left). A door goes between two standing wall posts (`doorOnWall`), one at
 * each end of its span, of any material and with any wall around them: a
 * corner works as well as a straight wall, and the edges between them need no
 * wall.
 *
 * A door opens the edges it spans: the snapshot leaves their wall body out and
 * clips the posts' joints along them (`terrainSnapshot`, `wallFootprintRects`),
 * so the room, Arcade and the double-click path all let people through.
 *
 * Shared by the room, the server's rules and the scene. Import-free like
 * `officeDecor.ts`: explicit `.ts` imports of other pure modules only.
 */

import { doorSpanOf, type GridEdge } from './artContract.ts';
import { AVATAR_BODY_CENTER_OFFSET, type GeometryPoint } from './avatarGeometry.ts';
import { decorChairFacing, type DecorItem, type DecorTileRect } from './officeDecor.ts';
import { wallFootprintRects, type WallGrid } from './officeLayout.ts';
import { coveredTiles } from './pieceCollisions.ts';

/** Same as `TILE` in mapData.ts (pinned by the tests through the footprint pixels). */
const DOOR_TILE = 32;

/** How far past its tiles, across the edge, an avatar's body center opens a door: it swings open just before someone reaches it. */
export const DOOR_OPEN_REACH_PX = 6;

const DOOR_PREFIX = 'door-';

/** Whether a piece of the decor layer is a door, by its id (`<kind>-<name>`). */
export function isDoorPiece(piece: string): boolean {
  return piece.startsWith(DOOR_PREFIX);
}

function anchorOf(item: Pick<DecorItem, 'index'>, width: number): { tx: number; ty: number } {
  return { tx: item.index % width, ty: Math.floor(item.index / width) };
}

/** How many tiles of wall a door spans: 2 for a door, 4 for a double door. */
export function doorSpan(item: Pick<DecorItem, 'piece'>): number {
  return doorSpanOf(item.piece);
}

/** The first grid edge a door stands on: the top edge of its anchor tile for 0 and 180, the left edge for 90 and 270. */
export function doorEdge(item: Pick<DecorItem, 'index' | 'rotation'>, width: number): GridEdge {
  const { tx, ty } = anchorOf(item, width);
  return { col: tx, row: ty, axis: item.rotation === 0 || item.rotation === 180 ? 'horizontal' : 'vertical' };
}

/** Every grid edge a door spans, its start (west or north) first. */
export function doorEdges(item: Pick<DecorItem, 'index' | 'rotation' | 'piece'>, width: number): GridEdge[] {
  const first = doorEdge(item, width);
  return Array.from({ length: doorSpan(item) }, (_, step) => (first.axis === 'horizontal' ? { ...first, col: first.col + step } : { ...first, row: first.row + step }));
}

/** The two posts (grid vertices, row major) at the ends of a door's span: its start (west or north) first. */
export function doorEndPosts(item: Pick<DecorItem, 'index' | 'rotation' | 'piece'>, width: number): [number, number] {
  const { col, row, axis } = doorEdge(item, width);
  const span = doorSpan(item);
  return axis === 'horizontal' ? [row * width + col, row * width + col + span] : [row * width + col, (row + span) * width + col];
}

/**
 * Whether a door may stand where it is (#233): a wall post at each end of its
 * span, of any material and whatever walls meet there (a corner or a wall
 * running on both work), and nothing else: the edges between the posts need
 * no wall, since the door fills them. The one rule of the editor's ghost and
 * the room.
 */
export function doorOnWall(grid: Pick<WallGrid, 'width' | 'height' | 'walls'>, item: Pick<DecorItem, 'index' | 'rotation' | 'piece'>): boolean {
  const { col, row, axis } = doorEdge(item, grid.width);
  const span = doorSpan(item);
  const [endCol, endRow] = axis === 'horizontal' ? [col + span, row] : [col, row + span];
  if (col < 0 || row < 0 || endCol >= grid.width || endRow >= grid.height) return false;
  return grid.walls[row * grid.width + col] != null && grid.walls[endRow * grid.width + endCol] != null;
}

/** The edges the doors of a decor layer open, in layer order: every edge of every door's span. */
export function doorOpenings(items: readonly DecorItem[], width: number): GridEdge[] {
  return items.flatMap((item) => (isDoorPiece(item.piece) ? doorEdges(item, width) : []));
}

/**
 * The tiles a wall touches once the decor layer is `after` (#223): a door
 * that goes away closes its wall again, so whatever takes its tiles must
 * keep off them like off any wall. The ground's own `wallTiles` when the
 * doors are the same (the usual case), or when it has no walls to rebuild
 * from. Shared by the editor's ghost and the room's decor rule.
 */
export function wallTilesAfter(
  ground: Pick<WallGrid, 'width' | 'height'> & { readonly walls?: WallGrid['walls']; readonly openings?: readonly GridEdge[]; readonly wallTiles: readonly boolean[] },
  after: readonly DecorItem[],
): readonly boolean[] {
  const openings = doorOpenings(after, ground.width);
  if (ground.walls === undefined || JSON.stringify(openings) === JSON.stringify(ground.openings ?? [])) return ground.wallTiles;
  const { width, height, walls } = ground;
  return coveredTiles(wallFootprintRects({ width, height, walls, openings }), width, height);
}

/** Every post that ends a door's span: removing one would leave the door off its wall (repainting one keeps the door). */
export function doorPostSet(items: readonly DecorItem[], width: number): Set<number> {
  return new Set(items.flatMap((item) => (isDoorPiece(item.piece) ? doorEndPosts(item, width) : [])));
}

/**
 * One door as drawn: its first edge, its span, its footprint (the tiles on
 * each side along the span) and the side it opens to (its rotation). A
 * single door hinges at its start; a double door is drawn whole.
 */
export interface DoorLeaf {
  readonly index: number;
  readonly piece: string;
  readonly rotation: DecorItem['rotation'];
  readonly edge: GridEdge;
  readonly span: number;
  readonly footprint: DecorTileRect;
  readonly hinge: 'start';
}

function footprintOf(edge: GridEdge, span: number): DecorTileRect {
  return edge.axis === 'horizontal' ? { x: edge.col, y: edge.row - 1, w: span, h: 2 } : { x: edge.col - 1, y: edge.row, w: 2, h: span };
}

/** The doors of the layer, in layer order. */
export function doorLeaves(items: readonly DecorItem[], width: number): DoorLeaf[] {
  return items
    .filter((item) => isDoorPiece(item.piece))
    .map((item) => {
      const edge = doorEdge(item, width);
      const span = doorSpan(item);
      return { index: item.index, piece: item.piece, rotation: item.rotation, edge, span, footprint: footprintOf(edge, span), hinge: 'start' as const };
    });
}

/** Which side of its edge an open leaf swings to: the side it faces (`inside`), or the other one. */
export type DoorSwing = 'inside' | 'outside';

/**
 * The rotation to draw a leaf with when it swings to `swing`: its own
 * rotation for `inside`, turned half way round for `outside`. The open frame
 * of the opposite rotation keeps the hinge at the same world end
 * (`doorFrameIndex`), so no extra art is needed (S14).
 */
export function doorSwingRotation(rotation: DecorItem['rotation'], swing: DoorSwing): DecorItem['rotation'] {
  return swing === 'inside' ? rotation : (((rotation + 180) % 360) as DecorItem['rotation']);
}

/**
 * The doors drawn open, each with the side it swings to (#223, S14): every
 * one a body (the center of each network position) is about to cross, lined
 * up with its span along the edge and on the footprint's tiles across it or
 * within `DOOR_OPEN_REACH_PX` of them; walking past alongside the wall opens
 * nothing. A door swings away from the side its walker comes from. `previous` is the result of the last call: a door
 * already open keeps its swing until it closes, so it does not flip when the
 * body center passes the edge line mid crossing. Two bodies from opposite
 * sides get that kept swing, else the one of the first body (in `positions`
 * order) that opens it. Drawing only: a door never blocks anyone, open or
 * closed.
 */
export function openDoorLeaves(
  leaves: readonly DoorLeaf[],
  positions: readonly GeometryPoint[],
  previous: ReadonlyMap<number, DoorSwing> = new Map(),
): Map<number, DoorSwing> {
  const centers = positions.map(bodyCenter);
  const open = new Map<number, DoorSwing>();
  for (const leaf of leaves) {
    const openers = centers.filter((center) => liningUp(leaf, center));
    if (openers.length === 0) continue;
    open.set(leaf.index, previous.get(leaf.index) ?? (sideOf(leaf, openers[0]!) > 0 ? 'outside' : 'inside'));
  }
  return open;
}

/** Whether a body center is lined up with a door's span and close to its edge across it. */
function liningUp(leaf: DoorLeaf, center: GeometryPoint): boolean {
  const horizontal = leaf.edge.axis === 'horizontal';
  const [along, across] = horizontal ? [center.x, center.y] : [center.y, center.x];
  const { x, y, w, h } = leaf.footprint;
  const [start, end, near, far] = horizontal ? [x, x + w, y, y + h] : [y, y + h, x, x + w];
  return along >= start * DOOR_TILE && along < end * DOOR_TILE && across > near * DOOR_TILE - DOOR_OPEN_REACH_PX && across < far * DOOR_TILE + DOOR_OPEN_REACH_PX;
}

/** The body center of an avatar at a network position: what the room checks a move by. */
function bodyCenter(position: GeometryPoint): GeometryPoint {
  return { x: position.x + AVATAR_BODY_CENTER_OFFSET.x, y: position.y + AVATAR_BODY_CENTER_OFFSET.y };
}

/** How far `point` is on the side a leaf opens to: positive there, zero on the edge line, negative on the other side. */
function sideOf(leaf: DoorLeaf, point: GeometryPoint): number {
  const facing = decorChairFacing(leaf.rotation);
  const sign = facing === 'down' || facing === 'right' ? 1 : -1;
  return leaf.edge.axis === 'horizontal' ? (point.y - leaf.edge.row * DOOR_TILE) * sign : (point.x - leaf.edge.col * DOOR_TILE) * sign;
}
