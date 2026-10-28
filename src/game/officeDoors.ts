/**
 * Doors (#223, #233): a door is an item of the office decor layer
 * (`officeDecor.ts`) that stands on a wall's grid line instead of on a tile.
 * Its anchor tile names the first edge it spans: the top edge of the tile for
 * rotation 0 and 180, the left one for 90 and 270. A door spans 2 tiles of the
 * line, a double door 3 (`doorSpanOf`): the leaf in the middle and a jamb at
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

import { DOOR_STEPS, doorHingeOf, doorSpanOf, type DoorHinge, type GridEdge } from './artContract.ts';
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

/** How many tiles of wall a door spans: 2 for a door, 3 for a double door. */
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

/** The posts strictly between a door's two end posts, in order: the wall a door stands in front of. */
export function doorInnerPosts(item: Pick<DecorItem, 'index' | 'rotation' | 'piece'>, width: number): number[] {
  const { col, row, axis } = doorEdge(item, width);
  return Array.from({ length: doorSpan(item) - 1 }, (_, step) => (axis === 'horizontal' ? row * width + col + 1 + step : (row + 1 + step) * width + col));
}

/** Every post of a door's span, the ends and the ones between, start first: the vertices the eraser takes the door by. */
export function doorPosts(item: Pick<DecorItem, 'index' | 'rotation' | 'piece'>, width: number): number[] {
  const [start, end] = doorEndPosts(item, width);
  return [start, ...doorInnerPosts(item, width), end];
}

/**
 * The vertices straight across each end of a door's span, one row (or column)
 * to each side: the posts a wall may end at, against the door's end post
 * (#233). Their footprint touches the door's own tiles, but a wall there
 * stands beside the doorway, not in it, so the door keeps its swing. The ones
 * off the map are left out.
 */
export function doorShoulders(item: Pick<DecorItem, 'index' | 'rotation' | 'piece'>, width: number, height: number): number[] {
  const { col, row, axis } = doorEdge(item, width);
  const span = doorSpan(item);
  const horizontal = axis === 'horizontal';
  const shoulders: number[] = [];
  for (const along of [0, span]) {
    for (const across of [-1, 1]) {
      const [tx, ty] = horizontal ? [col + along, row + across] : [col + across, row + along];
      if (tx >= 0 && ty >= 0 && tx < width && ty < height) shoulders.push(ty * width + tx);
    }
  }
  return shoulders;
}

/** The grid edges a door stands on, as one key: two doors with the same one cover the same wall. */
function doorKey(item: Pick<DecorItem, 'index' | 'rotation' | 'piece'>, width: number): string {
  const { col, row, axis } = doorEdge(item, width);
  return `${axis}:${col}:${row}:${doorSpan(item)}`;
}

/**
 * The wall posts to erase when the doors of `before` become `after` (#233):
 * the standing ones strictly between the ends of a door that no longer
 * covers those edges (removed, or moved), so the wall that stood behind it
 * does not come back. Not an end post of a door that stays, and not one where
 * another wall meets it across the door's line (a T): that wall is not under
 * the door. A door only turned in place covers the same edges and takes none.
 */
export function wallsUnderLeftDoors(before: readonly DecorItem[], after: readonly DecorItem[], walls: readonly (string | null)[], width: number): number[] {
  const height = walls.length / width;
  const stays = new Set(after.filter((item) => isDoorPiece(item.piece)).map((item) => doorKey(item, width)));
  const ends = doorPostSet(after, width);
  const standing = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < width && ty < height && walls[ty * width + tx] != null;
  const erased = new Set<number>();
  for (const item of before) {
    if (!isDoorPiece(item.piece) || stays.has(doorKey(item, width))) continue;
    const horizontal = doorEdge(item, width).axis === 'horizontal';
    for (const post of doorInnerPosts(item, width)) {
      const [tx, ty] = [post % width, Math.floor(post / width)];
      const crossed = horizontal ? standing(tx, ty - 1) || standing(tx, ty + 1) : standing(tx - 1, ty) || standing(tx + 1, ty);
      if (walls[post] != null && !ends.has(post) && !crossed) erased.add(post);
    }
  }
  return [...erased];
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
 * single door hinges at the end its rotation puts it at (`doorHingeOf`); a
 * double door is drawn whole.
 */
export interface DoorLeaf {
  readonly index: number;
  readonly piece: string;
  readonly rotation: DecorItem['rotation'];
  readonly edge: GridEdge;
  readonly span: number;
  readonly footprint: DecorTileRect;
  readonly hinge: DoorHinge;
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
      return { index: item.index, piece: item.piece, rotation: item.rotation, edge, span, footprint: footprintOf(edge, span), hinge: doorHingeOf(item.piece, item.rotation) };
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
 * closed. `keptShut` names the avatars a door does not open for (a locked
 * space behind it, `spaceLocks.ts`); one lined up with it opens it for no one.
 */
export function openDoorLeaves(
  leaves: readonly DoorLeaf[],
  positions: readonly GeometryPoint[],
  previous: ReadonlyMap<number, DoorSwing> = new Map(),
  keptShut: (leaf: DoorLeaf, position: GeometryPoint) => boolean = () => false,
): Map<number, DoorSwing> {
  const open = new Map<number, DoorSwing>();
  for (const leaf of leaves) {
    const openers = positions.filter((position) => !keptShut(leaf, position)).map(bodyCenter).filter((center) => liningUp(leaf, center));
    if (openers.length === 0) continue;
    open.set(leaf.index, previous.get(leaf.index) ?? (sideOf(leaf, openers[0]!) > 0 ? 'outside' : 'inside'));
  }
  return open;
}

/** How long a door takes to swing from shut to fully open, or back (#233). */
export const DOOR_SWING_MS = 180;

/** How long a door stays fully open after nobody is lined up with it any more, before it starts to close (#233). */
export const DOOR_HOLD_MS = 360;

/**
 * One door's swing: the side it turns to, how far open it is (0 shut to 1
 * fully open) and the hold it still owes at fully open: set while someone is
 * lined up with it, used up once it is wide open and nobody is. A door with
 * hold left and not yet fully open is opening; with none, closing.
 */
export interface DoorMotion {
  readonly swing: DoorSwing;
  readonly progress: number;
  readonly hold: number;
}

/**
 * The sides doors are still committed to: those showing a swung frame. One
 * drawn shut is free to take the side of whoever opens it next, since the
 * closed frames of both sides are the same. What `openDoorLeaves` gets as
 * `previous`, and what `moveDoors` keeps.
 */
export function keptSwings(motion: ReadonlyMap<number, DoorMotion>): Map<number, DoorSwing> {
  return new Map([...motion].filter(([, { progress }]) => doorStepOf(progress) > 0).map(([index, { swing }]) => [index, swing]));
}

/**
 * The swing of every door after `dtMs` more. A door someone is lined up with
 * (`targets`, from `openDoorLeaves`) opens. Once nobody is, it still opens
 * the rest of the way, waits `DOOR_HOLD_MS` wide open and only then closes, so
 * it never swings back on whoever just went through. A door keeps the side it
 * swings to for as long as it shows a swung frame, so it never flips mid
 * swing; one drawn shut takes the side of whoever opens it. A door that
 * finishes shutting is dropped.
 */
export function moveDoors(targets: ReadonlyMap<number, DoorSwing>, motion: ReadonlyMap<number, DoorMotion>, dtMs: number): Map<number, DoorMotion> {
  const next = new Map<number, DoorMotion>();
  const kept = keptSwings(motion);
  for (const index of new Set([...targets.keys(), ...motion.keys()])) {
    const before = motion.get(index);
    const target = targets.get(index);
    if (target !== undefined) {
      next.set(index, { swing: kept.get(index) ?? target, progress: Math.min(1, (before?.progress ?? 0) + dtMs / DOOR_SWING_MS), hold: DOOR_HOLD_MS });
    } else if (before !== undefined) {
      // What is left of the time goes to each stage in turn: finish opening, wait, close.
      let left = dtMs;
      let { progress, hold } = before;
      if (hold > 0) {
        const toOpen = (1 - progress) * DOOR_SWING_MS;
        // Exactly 1 once there, so the hold starts on the same frame whatever the float arithmetic says.
        if (left >= toOpen) {
          progress = 1;
          left -= toOpen;
        } else {
          progress += left / DOOR_SWING_MS;
          left = 0;
        }
        const waited = progress === 1 ? Math.min(left, hold) : 0;
        hold -= waited;
        left -= waited;
      }
      if (hold === 0) progress -= left / DOOR_SWING_MS;
      if (progress > 0) next.set(index, { swing: before.swing, progress: Math.min(1, progress), hold });
    }
  }
  return next;
}

/** The frame of a swing (`doorFrameIndex`'s step): the nearest of closed, the two between and open. */
export function doorStepOf(progress: number): number {
  return Math.round(progress * (DOOR_STEPS - 1));
}

/**
 * Where a door leads a body at network position `position` lined up with it
 * (`openDoorLeaves`): the middle of the door's tile across its edge from the
 * body center, along that center. `null` for a body not lined up with it.
 */
export function doorFarSide(leaf: DoorLeaf, position: GeometryPoint): GeometryPoint | null {
  const center = bodyCenter(position);
  if (!liningUp(leaf, center)) return null;
  if (leaf.edge.axis === 'horizontal') {
    const line = leaf.edge.row * DOOR_TILE;
    return { x: center.x, y: center.y < line ? line + DOOR_TILE / 2 : line - DOOR_TILE / 2 };
  }
  const line = leaf.edge.col * DOOR_TILE;
  return { x: center.x < line ? line + DOOR_TILE / 2 : line - DOOR_TILE / 2, y: center.y };
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
