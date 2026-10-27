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
 * so the room, Arcade and the double-click path all let people through. The
 * lock key locks the one door next to the avatar, from either side, and
 * unlocks it the same way.
 *
 * Shared by the room, the server's rules and the scene. Import-free like
 * `officeDecor.ts`: explicit `.ts` imports of other pure modules only.
 */

import { WALL, doorSpanOf, type GridEdge } from './artContract.ts';
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
 * nothing. A locked door (#233) stays shut. A door swings away from the side
 * its walker comes from. `previous` is the result of the last call: a door
 * already open keeps its swing until it closes, so it does not flip when the
 * body center passes the edge line mid crossing. Two bodies from opposite
 * sides get that kept swing, else the one of the first body (in `positions`
 * order) that opens it. Drawing only: an unlocked door never blocks anyone,
 * open or closed.
 */
export function openDoorLeaves(
  leaves: readonly DoorLeaf[],
  positions: readonly GeometryPoint[],
  locked: ReadonlySet<number> = new Set(),
  previous: ReadonlyMap<number, DoorSwing> = new Map(),
): Map<number, DoorSwing> {
  const centers = positions.map(bodyCenter);
  const open = new Map<number, DoorSwing>();
  for (const leaf of leaves) {
    if (locked.has(leaf.index)) continue;
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

// --- Locks (S13, #233) --------------------------------------------------------------------------
//
// The lock key toggles the door a body stands next to, and only that door (a
// double door is one door): while it is locked nobody walks through it, from
// either side, and anybody standing next to it may unlock it with the same key.
// Locks live in the room's state only, by the anchors of the locked doors,
// and are never saved.

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

/**
 * The anchor of the door the lock key at `position` acts on, or `null` with
 * none next to the body: the one whose footprint (a tile on each side of its
 * span) holds the body center, the closest to its middle when several do.
 */
export function doorLockTarget(leaves: readonly DoorLeaf[], position: GeometryPoint): number | null {
  const center = bodyCenter(position);
  let best: { index: number; distance: number } | null = null;
  for (const leaf of leaves) {
    const { x, y, w, h } = leaf.footprint;
    if (center.x < x * DOOR_TILE || center.x >= (x + w) * DOOR_TILE || center.y < y * DOOR_TILE || center.y >= (y + h) * DOOR_TILE) continue;
    const distance = (center.x - (x + w / 2) * DOOR_TILE) ** 2 + (center.y - (y + h / 2) * DOOR_TILE) ** 2;
    if (best === null || distance < best.distance) best = { index: leaf.index, distance };
  }
  return best?.index ?? null;
}

/**
 * The locks after someone at `position` presses the lock key: the door next
 * to them (`doorLockTarget`) locks, or unlocks when it was locked. `null`
 * when no door is next to them, so nothing changes.
 */
export function toggleDoorLock(leaves: readonly DoorLeaf[], locked: ReadonlySet<number>, position: GeometryPoint): Set<number> | null {
  const target = doorLockTarget(leaves, position);
  if (target === null) return null;
  const next = new Set(locked);
  if (!next.delete(target)) next.add(target);
  return next;
}

/** What the local player is told about the lock key where they stand (#223, S15). */
export interface DoorLockNotice {
  /** What the lock key would do here: `lock` or `unlock` the door next to them, `null` when it does nothing. */
  readonly lockable: 'lock' | 'unlock' | null;
}

/**
 * The hint for the avatar at `position` (a network position). It reuses
 * `doorLockTarget`, the very rule the room applies to the key, so the hint
 * never promises what the key will not do.
 */
export function doorLockNotice(leaves: readonly DoorLeaf[], locked: ReadonlySet<number>, position: GeometryPoint): DoorLockNotice {
  const target = doorLockTarget(leaves, position);
  return { lockable: target === null ? null : locked.has(target) ? 'unlock' : 'lock' };
}

/** The locks of doors that still stand: a door removed or replaced takes its lock with it. */
export function liveDoorLocks(items: readonly DecorItem[], locked: ReadonlySet<number>): Set<number> {
  return new Set(items.filter((item) => isDoorPiece(item.piece) && locked.has(item.index)).map((item) => item.index));
}

/** The wire form of the locks, a replicated string of the room state: anchors sorted and joined by commas, empty for none. */
export function encodeDoorLocks(locked: ReadonlySet<number>): string {
  return [...locked].sort((a, b) => a - b).join(',');
}

/** The locks of a wire string, or `null` unless every entry is an anchor. */
export function decodeDoorLocks(raw: unknown): Set<number> | null {
  if (typeof raw !== 'string') return null;
  if (raw === '') return new Set();
  const parts = raw.split(',');
  if (!parts.every((part) => /^\d+$/.test(part))) return null;
  return new Set(parts.map(Number));
}

/**
 * Whether a body center moving from `from` to `to` walks through a locked
 * door: it crosses the leaf's edge line, from either side, within the
 * door's span. Points are body centers, not network positions.
 */
export function crossesLockedDoor(leaves: readonly DoorLeaf[], locked: ReadonlySet<number>, from: GeometryPoint, to: GeometryPoint): boolean {
  return leaves.some((leaf) => {
    if (!locked.has(leaf.index)) return false;
    const before = sideOf(leaf, from);
    const after = sideOf(leaf, to);
    if (!((before > 0 && after <= 0) || (before < 0 && after >= 0))) return false;
    const t = before / (before - after);
    const horizontal = leaf.edge.axis === 'horizontal';
    const along = horizontal ? from.x + (to.x - from.x) * t : from.y + (to.y - from.y) * t;
    const start = (horizontal ? leaf.edge.col : leaf.edge.row) * DOOR_TILE;
    return along >= start && along <= start + leaf.span * DOOR_TILE;
  });
}

/**
 * The colliders of the locked doors: each one's opening, the wall's
 * thickness across its whole span, like the body the door stands in for.
 * The client stops its body on them (the stricter side) and plans its path
 * around them.
 */
export function lockedDoorBarriers(leaves: readonly DoorLeaf[], locked: ReadonlySet<number>): { index: number; rect: DecorTileRect }[] {
  return leaves.flatMap((leaf) => {
    if (!locked.has(leaf.index)) return [];
    const { col, row, axis } = leaf.edge;
    const thick = WALL.thickness;
    const length = leaf.span * DOOR_TILE;
    const rect = axis === 'horizontal'
      ? { x: col * DOOR_TILE, y: row * DOOR_TILE - thick / 2, w: length, h: thick }
      : { x: col * DOOR_TILE - thick / 2, y: row * DOOR_TILE, w: thick, h: length };
    return [{ index: leaf.index, rect }];
  });
}
