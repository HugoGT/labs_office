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

import type { GridEdge } from './artContract.ts';
import { physicalBodyRect, type GeometryPoint } from './avatarGeometry.ts';
import { decorChairFacing, type DecorItem, type DecorTileRect } from './officeDecor.ts';
import { wallsJoin, type WallGrid } from './officeLayout.ts';

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
  const { tx, ty } = anchorOf(item, width);
  const facing = decorChairFacing(item.rotation);
  if (facing === 'up') return { tx, ty: ty - 1 };
  if (facing === 'left') return { tx: tx - 1, ty };
  return { tx, ty };
}

/** Whether a door stands on a wall: both posts of its edge standing and joined (the same material, `wallsJoin`). */
export function doorOnWall(grid: WallGrid, item: Pick<DecorItem, 'index' | 'rotation'>): boolean {
  const { col, row, axis } = doorEdge(item, grid.width);
  return axis === 'horizontal' ? wallsJoin(grid, col, row, col + 1, row) : wallsJoin(grid, col, row, col, row + 1);
}

/** The edges the doors of a decor layer open, in layer order. An edge with no joined wall under it opens nothing. */
export function doorOpenings(items: readonly DecorItem[], width: number): GridEdge[] {
  return items.flatMap((item) => (isDoorPiece(item.piece) ? [doorEdge(item, width)] : []));
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
 * over its tiles or within `DOOR_OPEN_REACH_PX` of them. Drawing only: a door
 * never blocks anyone, open or closed.
 */
export function openDoorLeaves(leaves: readonly DoorLeaf[], positions: readonly GeometryPoint[]): Set<number> {
  const bodies = positions.map((position) => physicalBodyRect(position));
  const pairs = new Set<number>();
  for (const leaf of leaves) {
    const { x, y, w, h } = leaf.footprint;
    const left = x * DOOR_TILE - DOOR_OPEN_REACH_PX;
    const top = y * DOOR_TILE - DOOR_OPEN_REACH_PX;
    const right = (x + w) * DOOR_TILE + DOOR_OPEN_REACH_PX;
    const bottom = (y + h) * DOOR_TILE + DOOR_OPEN_REACH_PX;
    if (bodies.some((body) => body.x < right && body.x + body.width > left && body.y < bottom && body.y + body.height > top)) pairs.add(leaf.pair);
  }
  return new Set(leaves.filter((leaf) => pairs.has(leaf.pair)).map((leaf) => leaf.index));
}
