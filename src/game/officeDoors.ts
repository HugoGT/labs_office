/**
 * Doors (#223): a door is an item of the office decor layer (`officeDecor.ts`)
 * that stands on a wall's grid line instead of on a tile. Its anchor tile
 * names the edge: the top edge of the tile for rotation 0 and 180, the left
 * one for 90 and 270. Its rotation is the side it opens into, the chair's
 * facing (`decorChairFacing`: 0 down, 90 right, 180 up, 270 left), and that
 * side is its inside.
 *
 * A door placed between two joined posts opens that edge of the wall: the
 * snapshot leaves its body out and clips the posts' joints along it
 * (`terrainSnapshot`, `wallFootprintRects`), so the room, Arcade and the
 * double-click path all let people through. Doors next to each other on one
 * line, turned the same way, are one group (a double door): their leaves pair
 * up from the start of the run, hinged at the outer ends of each pair.
 *
 * Shared by the room, the server's rules and the scene. Import-free like
 * `officeDecor.ts`: explicit `.ts` imports of other pure modules only.
 */

import { WALL, type GridEdge } from './artContract.ts';
import { AVATAR_BODY_CENTER_OFFSET, physicalBodyRect, type GeometryPoint } from './avatarGeometry.ts';
import { decorChairFacing, type DecorItem, type DecorTileRect } from './officeDecor.ts';
import { wallFootprintRects, wallsJoin, type WallGrid } from './officeLayout.ts';
import { coveredTiles } from './pieceCollisions.ts';

/** Same as `TILE` in mapData.ts (pinned by the tests through the footprint pixels). */
const DOOR_TILE = 32;

/** How far past its tiles an avatar's body opens a door: it swings open just before someone reaches it. */
export const DOOR_OPEN_REACH_PX = 6;

const DOOR_PREFIX = 'door-';

/** Whether a piece of the decor layer is a door, by its id (`<kind>-<name>`). */
export function isDoorPiece(piece: string): boolean {
  return piece.startsWith(DOOR_PREFIX);
}

function anchorOf(item: Pick<DecorItem, 'index'>, width: number): { tx: number; ty: number } {
  return { tx: item.index % width, ty: Math.floor(item.index / width) };
}

/** The grid edge a door stands on: the top edge of its anchor tile for 0 and 180, the left edge for 90 and 270. */
export function doorEdge(item: Pick<DecorItem, 'index' | 'rotation'>, width: number): GridEdge {
  const { tx, ty } = anchorOf(item, width);
  return { col: tx, row: ty, axis: item.rotation === 0 || item.rotation === 180 ? 'horizontal' : 'vertical' };
}

/** The two posts (grid vertices, row major) at the ends of a door's edge: its start (west or north) first. */
export function doorEndPosts(item: Pick<DecorItem, 'index' | 'rotation'>, width: number): [number, number] {
  const { col, row, axis } = doorEdge(item, width);
  return axis === 'horizontal' ? [row * width + col, row * width + col + 1] : [row * width + col, (row + 1) * width + col];
}

/** The tile a door opens into, its inside: the side its rotation faces. */
export function doorInsideTile(item: Pick<DecorItem, 'index' | 'rotation'>, width: number): { tx: number; ty: number } {
  return insideTileOf(doorEdge(item, width), item.rotation);
}

function insideTileOf({ col, row }: GridEdge, rotation: DecorItem['rotation']): { tx: number; ty: number } {
  const facing = decorChairFacing(rotation);
  if (facing === 'up') return { tx: col, ty: row - 1 };
  if (facing === 'left') return { tx: col - 1, ty: row };
  return { tx: col, ty: row };
}

/**
 * Whether a door stands on a wall: both posts of its edge standing and joined
 * (`wallsJoin`) and of the same material. Walls of two materials join since
 * #223, but a door across them is still refused; the door rule is its own.
 */
export function doorOnWall(grid: WallGrid, item: Pick<DecorItem, 'index' | 'rotation'>): boolean {
  const { col, row, axis } = doorEdge(item, grid.width);
  const [nx, ny] = axis === 'horizontal' ? [col + 1, row] : [col, row + 1];
  if (!wallsJoin(grid, col, row, nx, ny)) return false;
  return grid.walls[row * grid.width + col] === grid.walls[ny * grid.width + nx];
}

/** The edges the doors of a decor layer open, in layer order. An edge with no joined wall under it opens nothing. */
export function doorOpenings(items: readonly DecorItem[], width: number): GridEdge[] {
  return items.flatMap((item) => (isDoorPiece(item.piece) ? [doorEdge(item, width)] : []));
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

/** Every post that ends a door's edge: removing or repainting one would leave the door off its wall. */
export function doorPostSet(items: readonly DecorItem[], width: number): Set<number> {
  return new Set(items.flatMap((item) => (isDoorPiece(item.piece) ? doorEndPosts(item, width) : [])));
}

/**
 * One door as drawn: its edge, its footprint (the tile on each side), the
 * end its hinge is on (`start`, west or north, or `end`), the anchor of the
 * first leaf of its pair (a double door opens together) and of its group
 * (the whole run of doors it stands in).
 */
export interface DoorLeaf {
  readonly index: number;
  readonly piece: string;
  readonly rotation: DecorItem['rotation'];
  readonly edge: GridEdge;
  readonly footprint: DecorTileRect;
  readonly hinge: 'start' | 'end';
  readonly pair: number;
  readonly group: number;
}

function footprintOf(edge: GridEdge): DecorTileRect {
  return edge.axis === 'horizontal' ? { x: edge.col, y: edge.row - 1, w: 1, h: 2 } : { x: edge.col - 1, y: edge.row, w: 2, h: 1 };
}

/**
 * The leaves of the layer's doors, sorted by line and position along it.
 * Doors next to each other on one line (the same row of horizontal edges or
 * column of vertical ones) and turned the same way are one group; within it
 * the leaves pair up from the start, each pair hinged at its outer ends so
 * the handles meet in the middle, and an odd last leaf stands alone, hinged
 * at its start like a lone door.
 */
export function doorLeaves(items: readonly DecorItem[], width: number): DoorLeaf[] {
  const doors = items
    .filter((item) => isDoorPiece(item.piece))
    .map((item) => ({ item, edge: doorEdge(item, width) }))
    .sort((a, b) => {
      if (a.edge.axis !== b.edge.axis) return a.edge.axis === 'horizontal' ? -1 : 1;
      const line = a.edge.axis === 'horizontal' ? a.edge.row - b.edge.row : a.edge.col - b.edge.col;
      if (line !== 0) return line;
      return a.edge.axis === 'horizontal' ? a.edge.col - b.edge.col : a.edge.row - b.edge.row;
    });
  const leaves: DoorLeaf[] = [];
  let run: typeof doors = [];
  const flush = (): void => {
    run.forEach(({ item, edge }, position) => {
      const second = position % 2 === 1;
      leaves.push({
        index: item.index,
        piece: item.piece,
        rotation: item.rotation,
        edge,
        footprint: footprintOf(edge),
        hinge: second ? 'end' : 'start',
        pair: second ? run[position - 1]!.item.index : item.index,
        group: run[0]!.item.index,
      });
    });
    run = [];
  };
  for (const door of doors) {
    const last = run.at(-1);
    const next =
      last !== undefined &&
      last.item.rotation === door.item.rotation &&
      last.edge.axis === door.edge.axis &&
      (door.edge.axis === 'horizontal'
        ? last.edge.row === door.edge.row && last.edge.col + 1 === door.edge.col
        : last.edge.col === door.edge.col && last.edge.row + 1 === door.edge.row);
    if (!next) flush();
    run.push(door);
  }
  flush();
  return leaves;
}

/**
 * The anchors of the leaves drawn open: every leaf of a pair one of whose
 * leaves has an avatar's body (`physicalBodyRect` of each network position)
 * over its tiles or within `DOOR_OPEN_REACH_PX` of them. A locked leaf
 * (S13) opens only for a body whose center is on its inside. Drawing only:
 * an unlocked door never blocks anyone, open or closed.
 */
export function openDoorLeaves(leaves: readonly DoorLeaf[], positions: readonly GeometryPoint[], locked: ReadonlySet<number> = new Set()): Set<number> {
  const bodies = positions.map((position) => ({ box: physicalBodyRect(position), center: bodyCenter(position) }));
  const pairs = new Set<number>();
  for (const leaf of leaves) {
    const { x, y, w, h } = leaf.footprint;
    const left = x * DOOR_TILE - DOOR_OPEN_REACH_PX;
    const top = y * DOOR_TILE - DOOR_OPEN_REACH_PX;
    const right = (x + w) * DOOR_TILE + DOOR_OPEN_REACH_PX;
    const bottom = (y + h) * DOOR_TILE + DOOR_OPEN_REACH_PX;
    const opens = bodies.some(
      ({ box, center }) =>
        box.x < right && box.x + box.width > left && box.y < bottom && box.y + box.height > top && (!locked.has(leaf.index) || insideOf(leaf, center) > 0),
    );
    if (opens) pairs.add(leaf.pair);
  }
  return new Set(leaves.filter((leaf) => pairs.has(leaf.pair)).map((leaf) => leaf.index));
}

// --- Locks (S13) --------------------------------------------------------------------------------
//
// Someone inside a door (on the side it opens to, the tile next to its edge)
// may lock it, or unlock it: a lock keeps everyone outside from walking in,
// and anyone may still walk out. Locks live in the room's state only, by the
// anchors of the leaves of the locked group, and are never saved.

/** The body center of an avatar at a network position: what the room checks a move by. */
function bodyCenter(position: GeometryPoint): GeometryPoint {
  return { x: position.x + AVATAR_BODY_CENTER_OFFSET.x, y: position.y + AVATAR_BODY_CENTER_OFFSET.y };
}

/** How far `point` is on a leaf's inside: positive inside, zero on the edge line, negative outside. */
function insideOf(leaf: DoorLeaf, point: GeometryPoint): number {
  const facing = decorChairFacing(leaf.rotation);
  const sign = facing === 'down' || facing === 'right' ? 1 : -1;
  return leaf.edge.axis === 'horizontal' ? (point.y - leaf.edge.row * DOOR_TILE) * sign : (point.x - leaf.edge.col * DOOR_TILE) * sign;
}

/**
 * The anchors of the door group (the whole run, `DoorLeaf.group`) whose
 * inside tile holds the body center of an avatar at `position`, or `null`
 * with no door within reach: only someone inside, right at the door, may
 * lock or unlock it.
 */
export function doorLockGroup(items: readonly DecorItem[], width: number, position: GeometryPoint): number[] | null {
  const center = bodyCenter(position);
  const tx = Math.floor(center.x / DOOR_TILE);
  const ty = Math.floor(center.y / DOOR_TILE);
  const leaves = doorLeaves(items, width);
  const at = leaves.find((leaf) => {
    const inside = insideTileOf(leaf.edge, leaf.rotation);
    return inside.tx === tx && inside.ty === ty;
  });
  return at === undefined ? null : leaves.filter((leaf) => leaf.group === at.group).map((leaf) => leaf.index);
}

/**
 * The locks after someone at `position` presses the lock key: the door group
 * they stand inside locks, or unlocks when any leaf of it was locked. `null`
 * when no door is within reach, so nothing changes.
 */
export function toggleDoorLock(items: readonly DecorItem[], width: number, locked: ReadonlySet<number>, position: GeometryPoint): Set<number> | null {
  const group = doorLockGroup(items, width, position);
  if (group === null) return null;
  const next = new Set(locked);
  if (group.some((index) => locked.has(index))) for (const index of group) next.delete(index);
  else for (const index of group) next.add(index);
  return next;
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
 * Whether a body center moving from `from` to `to` walks into a locked
 * door: it crosses a locked leaf's edge line from the outside (or the line
 * itself) to the inside, within the leaf's segment. Walking out is never
 * refused. Points are body centers, not network positions.
 */
export function crossesLockedDoor(leaves: readonly DoorLeaf[], locked: ReadonlySet<number>, from: GeometryPoint, to: GeometryPoint): boolean {
  return leaves.some((leaf) => {
    if (!locked.has(leaf.index)) return false;
    const before = insideOf(leaf, from);
    const after = insideOf(leaf, to);
    if (before > 0 || after <= 0) return false;
    const t = before / (before - after);
    const horizontal = leaf.edge.axis === 'horizontal';
    const along = horizontal ? from.x + (to.x - from.x) * t : from.y + (to.y - from.y) * t;
    const start = (horizontal ? leaf.edge.col : leaf.edge.row) * DOOR_TILE;
    return along >= start && along <= start + DOOR_TILE;
  });
}

/**
 * The locked leaves that bar an avatar at `position`, which stands outside
 * them: each one's opening (the wall's thickness across its whole segment,
 * the client's collider) and its inside tile (blocked for its path).
 */
export function lockedDoorBarriers(
  leaves: readonly DoorLeaf[],
  locked: ReadonlySet<number>,
  position: GeometryPoint,
): { index: number; rect: DecorTileRect; inside: { tx: number; ty: number } }[] {
  const center = bodyCenter(position);
  return leaves.flatMap((leaf) => {
    if (!locked.has(leaf.index) || insideOf(leaf, center) > 0) return [];
    const { col, row, axis } = leaf.edge;
    // The wall's thickness across the whole segment, like the body the door stands in for.
    const thick = WALL.thickness;
    const rect = axis === 'horizontal'
      ? { x: col * DOOR_TILE, y: row * DOOR_TILE - thick / 2, w: DOOR_TILE, h: thick }
      : { x: col * DOOR_TILE - thick / 2, y: row * DOOR_TILE, w: thick, h: DOOR_TILE };
    return [{ index: leaf.index, rect, inside: insideTileOf(leaf.edge, leaf.rotation) }];
  });
}
