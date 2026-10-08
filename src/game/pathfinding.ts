/**
 * Obstacle-avoiding walk planning for the local avatar (double-click to walk).
 * Pure numbers, no Phaser: `OfficeScene` hands in `grid.solid` and gets back
 * waypoints for the auto-walk steering.
 *
 * Everything is planned in body-tile space: the server drops a move whose body
 * center lands on a blocked tile and Arcade collides the 22x14 body, so a tile
 * of the position (`floor(P / TILE)`) would let the body straddle a wall. A
 * tile here is the tile its body center is in.
 */

import { ARRIVE_EPSILON_PX } from './autoWalk';
import { physicalBodyRect, type GeometryPoint } from './avatarGeometry';
import { TILE } from './mapData';
import type { TileCoord } from './terrainGrid';

const BODY = physicalBodyRect({ x: 0, y: 0 });

/** Half of the Arcade body, derived from the shared geometry (22x14 today). */
const BODY_HALF = { x: BODY.width / 2, y: BODY.height / 2 } as const;

/**
 * Body center minus network position, derived from the Arcade body instead of
 * repeating `COLLISION_BODY_CENTER_OFFSET`; the test pins both to the same value.
 */
export const BODY_CENTER_OFFSET = { x: BODY.x + BODY_HALF.x, y: BODY.y + BODY_HALF.y } as const;

/** Tile of the body center for an avatar at `position`. */
export function bodyTileOf(position: GeometryPoint): TileCoord {
  return {
    tx: Math.floor((position.x + BODY_CENTER_OFFSET.x) / TILE),
    ty: Math.floor((position.y + BODY_CENTER_OFFSET.y) / TILE),
  };
}

/** Network position that puts the body center on the center of `tile`. */
export function positionForBodyTile(tile: TileCoord): GeometryPoint {
  return {
    x: tile.tx * TILE + TILE / 2 - BODY_CENTER_OFFSET.x,
    y: tile.ty * TILE + TILE / 2 - BODY_CENTER_OFFSET.y,
  };
}

/** Rows are `[ty][tx]`, true when blocked; the same shape as `TerrainGrid.solid`. */
export type SolidGrid = readonly (readonly boolean[])[];

/** Optional out-parameter of `findTilePath`: how many tiles the search expanded. */
export interface SearchStats { expanded: number }

/** Flat copy of a `SolidGrid`; its size is the array's (the map can grow, #123) and a missing cell is blocked. */
interface BlockedGrid {
  readonly width: number;
  readonly height: number;
  readonly blocked: Uint8Array;
}

function blockedGridOf(solid: SolidGrid): BlockedGrid {
  const height = solid.length;
  const width = solid[0]?.length ?? 0;
  const blocked = new Uint8Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    const row = solid[ty]!;
    for (let tx = 0; tx < width; tx++) blocked[ty * width + tx] = row[tx] === false ? 0 : 1;
  }
  return { width, height, blocked };
}

function isFree(grid: BlockedGrid, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height && grid.blocked[ty * grid.width + tx] === 0;
}

const STRAIGHT_COST = 10;
const DIAGONAL_COST = 14;

/** Octile distance in the same integer units as the step costs. Consistent, so a closed tile is final. */
function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return STRAIGHT_COST * Math.max(ax, ay) + (DIAGONAL_COST - STRAIGHT_COST) * Math.min(ax, ay);
}

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * Binary min-heap of tile indices ordered by `f`, ties to the higher `g` (the
 * deeper tile, which keeps the search from fanning out across equal-cost
 * plateaus). Indexed, so improving a queued tile moves it instead of adding a
 * duplicate: the heap never holds more than one entry per tile.
 */
class TileHeap {
  private readonly items: Int32Array;
  private readonly slot: Int32Array;
  private size = 0;

  constructor(
    capacity: number,
    private readonly f: Int32Array,
    private readonly g: Int32Array,
  ) {
    this.items = new Int32Array(capacity);
    this.slot = new Int32Array(capacity).fill(-1);
  }

  get length(): number {
    return this.size;
  }

  push(tile: number): void {
    // Already queued: its key only ever improved, so sifting up is enough.
    const queued = this.slot[tile]!;
    if (queued >= 0) return this.siftUp(queued);
    this.items[this.size] = tile;
    this.slot[tile] = this.size;
    this.siftUp(this.size++);
  }

  pop(): number {
    const top = this.items[0]!;
    const last = this.items[--this.size]!;
    this.slot[top] = -1;
    if (this.size > 0) {
      this.items[0] = last;
      this.slot[last] = 0;
      this.siftDown(0);
    }
    return top;
  }

  private before(a: number, b: number): boolean {
    const fa = this.f[a]!;
    const fb = this.f[b]!;
    return fa < fb || (fa === fb && this.g[a]! > this.g[b]!);
  }

  private place(tile: number, index: number): void {
    this.items[index] = tile;
    this.slot[tile] = index;
  }

  private siftUp(index: number): void {
    const tile = this.items[index]!;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const above = this.items[parent]!;
      if (!this.before(tile, above)) break;
      this.place(above, index);
      index = parent;
    }
    this.place(tile, index);
  }

  private siftDown(index: number): void {
    const tile = this.items[index]!;
    for (;;) {
      let child = index * 2 + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.before(this.items[child + 1]!, this.items[child]!)) child++;
      const below = this.items[child]!;
      if (!this.before(below, tile)) break;
      this.place(below, index);
      index = child;
    }
    this.place(tile, index);
  }
}

function searchTiles(grid: BlockedGrid, start: TileCoord, goal: TileCoord, stats?: SearchStats): TileCoord[] | null {
  if (!isFree(grid, start.tx, start.ty) || !isFree(grid, goal.tx, goal.ty)) return null;

  const { width } = grid;
  const count = width * grid.height;
  const startIndex = start.ty * width + start.tx;
  const goalIndex = goal.ty * width + goal.tx;
  const g = new Int32Array(count).fill(-1);
  const f = new Int32Array(count);
  const parent = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const open = new TileHeap(count, f, g);

  g[startIndex] = 0;
  f[startIndex] = octile(goal.tx - start.tx, goal.ty - start.ty);
  open.push(startIndex);

  while (open.length > 0) {
    const current = open.pop();
    closed[current] = 1;
    if (stats) stats.expanded++;

    if (current === goalIndex) {
      const path: TileCoord[] = [];
      for (let at = current; at !== -1; at = parent[at]!) path.push({ tx: at % width, ty: Math.floor(at / width) });
      return path.reverse();
    }

    const cx = current % width;
    const cy = (current - cx) / width;
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isFree(grid, nx, ny)) continue;
      // A diagonal squeezes the body past the corner of both neighbours it
      // touches, so either one blocked rules the step out.
      if (dx !== 0 && dy !== 0 && (!isFree(grid, cx + dx, cy) || !isFree(grid, cx, cy + dy))) continue;

      const next = ny * width + nx;
      if (closed[next] === 1) continue;
      const cost = g[current]! + (dx !== 0 && dy !== 0 ? DIAGONAL_COST : STRAIGHT_COST);
      if (g[next]! !== -1 && cost >= g[next]!) continue;

      g[next] = cost;
      f[next] = cost + octile(goal.tx - nx, goal.ty - ny);
      parent[next] = current;
      open.push(next);
    }
  }
  return null;
}

/**
 * Cheapest 8-direction route between two free tiles, both ends included, or
 * `null` when either end is blocked or outside the grid, or no route exists.
 * Work is bounded by the grid itself (every tile is expanded at most once),
 * so a far goal is never refused for being far.
 */
export function findTilePath(solid: SolidGrid, start: TileCoord, goal: TileCoord, stats?: SearchStats): TileCoord[] | null {
  return searchTiles(blockedGridOf(solid), start, goal, stats);
}

/**
 * Extra clearance for a straight stretch between two stops. The steering
 * lands within `ARRIVE_EPSILON_PX` of a waypoint before it turns, so the body
 * can be that far off the line; one more pixel absorbs float rounding.
 */
export const SWEEP_MARGIN_PX = ARRIVE_EPSILON_PX + 1;

/** How far from a blocked start (a sitter under a desk, say) a free tile is looked for. */
const ESCAPE_RADIUS_TILES = 3;

/**
 * Whether the body, moved in a straight line between two positions, never
 * overlaps a blocked tile (nor leaves the map), margin included.
 *
 * The body sweeps a hexagon, and a tile hits it exactly when the segment of
 * body centers crosses that tile grown by the body half size. Walking the tile
 * rows that grown tile can touch keeps the cost proportional to the length of
 * the segment. Touching an edge is not overlapping, like in Arcade.
 */
function sweptBodyClear(grid: BlockedGrid, from: GeometryPoint, to: GeometryPoint): boolean {
  const ax = from.x + BODY_CENTER_OFFSET.x;
  const ay = from.y + BODY_CENTER_OFFSET.y;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const reachX = BODY_HALF.x + SWEEP_MARGIN_PX;
  const reachY = BODY_HALF.y + SWEEP_MARGIN_PX;

  const firstRow = Math.floor((Math.min(ay, ay + dy) - reachY) / TILE);
  const lastRow = Math.floor((Math.max(ay, ay + dy) + reachY) / TILE);
  for (let row = firstRow; row <= lastRow; row++) {
    const bandTop = row * TILE - reachY;
    const bandBottom = (row + 1) * TILE + reachY;

    // Part of the segment strictly inside this row's band, as a range of x.
    let xa: number;
    let xb: number;
    if (dy === 0) {
      if (ay <= bandTop || ay >= bandBottom) continue;
      xa = Math.min(ax, ax + dx);
      xb = Math.max(ax, ax + dx);
    } else {
      const t1 = (bandTop - ay) / dy;
      const t2 = (bandBottom - ay) / dy;
      const enter = Math.max(0, Math.min(t1, t2));
      const leave = Math.min(1, Math.max(t1, t2));
      // Merely touching the band at one point is not entering it.
      if (enter >= leave) continue;
      xa = Math.min(ax + dx * enter, ax + dx * leave);
      xb = Math.max(ax + dx * enter, ax + dx * leave);
    }

    for (let col = Math.floor((xa - reachX) / TILE); col <= Math.floor((xb + reachX) / TILE); col++) {
      if (isFree(grid, col, row)) continue;
      if (xb > col * TILE - reachX && xa < (col + 1) * TILE + reachX) return false;
    }
  }
  return true;
}

/** Nearest free tile within `ESCAPE_RADIUS_TILES` of `tile`: squared distance, then row, then column. */
function nearestFreeTile(grid: BlockedGrid, tile: TileCoord): TileCoord | null {
  const stride = 2 * ESCAPE_RADIUS_TILES + 1;
  let best: TileCoord | null = null;
  let bestRank = Infinity;
  for (let dy = -ESCAPE_RADIUS_TILES; dy <= ESCAPE_RADIUS_TILES; dy++) {
    for (let dx = -ESCAPE_RADIUS_TILES; dx <= ESCAPE_RADIUS_TILES; dx++) {
      if (!isFree(grid, tile.tx + dx, tile.ty + dy)) continue;
      // One number that sorts by distance first, then by row, then by column.
      const rank = (dx * dx + dy * dy) * stride * stride + (dy + ESCAPE_RADIUS_TILES) * stride + dx + ESCAPE_RADIUS_TILES;
      if (rank < bestRank) {
        best = { tx: tile.tx + dx, ty: tile.ty + dy };
        bestRank = rank;
      }
    }
  }
  return best;
}

/** Keeps the ends and the tiles where the direction changes; a straight run is one stretch. */
function collapseStraightRuns(path: readonly TileCoord[]): TileCoord[] {
  return path.filter((step, i) => {
    if (i === 0 || i === path.length - 1) return true;
    const before = path[i - 1]!;
    const after = path[i + 1]!;
    return step.tx - before.tx !== after.tx - step.tx || step.ty - before.ty !== after.ty - step.ty;
  });
}

function samePoint(a: GeometryPoint, b: GeometryPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Greedy string pulling over `stops` (the first is where the walk starts): from
 * each kept stop, jump to the furthest following one the swept body reaches in
 * a straight line. Consecutive stops are always accepted: they are tile
 * centers along one run of free tiles, plus the arbitrary spot the avatar or
 * the click sits at inside its own tile, which the swept test could refuse.
 */
function pullString(grid: BlockedGrid, stops: readonly GeometryPoint[]): GeometryPoint[] {
  const kept: GeometryPoint[] = [];
  let anchor = 0;
  while (anchor < stops.length - 1) {
    let reach = anchor + 1;
    for (let candidate = anchor + 2; candidate < stops.length; candidate++) {
      if (!sweptBodyClear(grid, stops[anchor]!, stops[candidate]!)) break;
      reach = candidate;
    }
    kept.push(stops[reach]!);
    anchor = reach;
  }
  return kept;
}

/**
 * Waypoints that walk the avatar from `from` to `goal` around everything
 * blocked, the last one being `goal` itself, or `null` when the goal tile is
 * blocked or outside the map, no route exists, or a blocked start has no free
 * tile within reach. Nothing is stood up or moved here: the caller decides
 * what a `null` costs.
 */
export function planWalk(solid: SolidGrid, from: GeometryPoint, goal: GeometryPoint): GeometryPoint[] | null {
  if (![from.x, from.y, goal.x, goal.y].every(Number.isFinite)) return null;

  const grid = blockedGridOf(solid);
  const goalTile = bodyTileOf(goal);
  if (!isFree(grid, goalTile.tx, goalTile.ty)) return null;

  // A sitter's body is inside the desk's tiles. A swept test from there always
  // fails, so the walk first steps out to the nearest free tile.
  let startTile = bodyTileOf(from);
  if (!isFree(grid, startTile.tx, startTile.ty)) {
    const escape = nearestFreeTile(grid, startTile);
    if (escape === null) return null;
    startTile = escape;
  }

  const path = searchTiles(grid, startTile, goalTile);
  if (path === null) return null;

  const stops: GeometryPoint[] = [from];
  for (const step of collapseStraightRuns(path)) {
    const center = positionForBodyTile(step);
    if (!samePoint(stops[stops.length - 1]!, center)) stops.push(center);
  }
  // The walk ends on the clicked point, not on its tile center: that keeps
  // the landing spot of walk-to-peer and the settle tests exactly as they were.
  if (stops.length > 1 && samePoint(stops[stops.length - 1]!, goal)) stops.pop();
  stops.push({ x: goal.x, y: goal.y });

  return pullString(grid, stops);
}
