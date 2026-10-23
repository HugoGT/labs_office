/**
 * Obstacle-avoiding walk planning for the local avatar (double-click to walk).
 * Pure numbers, no Phaser: `OfficeScene` hands in what Arcade collides the
 * body with (the terrain tiles and the wall and piece rectangles) and gets
 * back waypoints for the auto-walk steering.
 *
 * Everything is planned for the body, not the position: the server drops a
 * move whose body center lands on a blocked spot and Arcade collides the
 * shared body. Walls stand on grid lines and pieces can be any rectangle, so
 * a whole-tile grid (`TerrainGrid.solid`) blocks the tiles on both sides of
 * every wall and every door in it (#221). The search runs instead on a
 * half-tile lattice of body-center spots tested against the rectangles
 * themselves.
 */

import { ARRIVE_EPSILON_PX } from './autoWalk';
import { physicalBodyRect, type GeometryPoint } from './avatarGeometry';
import { TILE } from './mapData';
import type { CollisionRect } from './pieceCollisions';
import type { TileCoord } from './terrainGrid';

const BODY = physicalBodyRect({ x: 0, y: 0 });

/** Half of the Arcade body, derived from the shared geometry. */
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

/** How far from the start or the goal the first or last lattice spot is looked for. */
const REACH_RADIUS_TILES = 3;

/**
 * Spacing of the search lattice. Half a tile puts a spot on every tile center
 * and every tile edge: the middle of a one-post door (48 px between two wall
 * joints) and of a one-tile gap between tile-aligned pieces are both spots.
 */
const CELL = TILE / 2;

/** What the body collides with, the same things Arcade does. */
export interface WalkWorld {
  /** Terrain tiles (`TerrainGrid.terrainSolid`), `[ty][tx]`, true when blocked; its size is the map's. */
  readonly terrainSolid: SolidGrid;
  /** Wall and piece collision rectangles in world pixels. */
  readonly rects: readonly CollisionRect[];
}

/** The world indexed for overlap tests: each tile lists the rectangles that touch it. */
interface Obstacles {
  readonly terrain: BlockedGrid;
  readonly rects: readonly CollisionRect[];
  readonly buckets: readonly (readonly number[] | undefined)[];
  /** Per rectangle, the last query that tested it: one rectangle over several tiles is tested once. */
  readonly seen: Uint32Array;
  query: number;
}

function obstaclesOf(world: WalkWorld): Obstacles {
  const terrain = blockedGridOf(world.terrainSolid);
  const buckets: number[][] = [];
  world.rects.forEach((rect, index) => {
    const x0 = Math.max(0, Math.floor(rect.x / TILE));
    const y0 = Math.max(0, Math.floor(rect.y / TILE));
    const x1 = Math.min(terrain.width - 1, Math.ceil((rect.x + rect.w) / TILE) - 1);
    const y1 = Math.min(terrain.height - 1, Math.ceil((rect.y + rect.h) / TILE) - 1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) (buckets[ty * terrain.width + tx] ??= []).push(index);
    }
  });
  return { terrain, rects: world.rects, buckets, seen: new Uint32Array(world.rects.length), query: 0 };
}

/**
 * Whether the segment from `(ax, ay)` along `(dx, dy)` passes strictly inside
 * the open box: touching an edge is not overlapping, like in Arcade.
 */
function segmentEntersBox(ax: number, ay: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let enter = 0;
  let leave = 1;
  for (const [start, delta, low, high] of [[ax, dx, x0, x1], [ay, dy, y0, y1]] as const) {
    if (delta === 0) {
      if (start <= low || start >= high) return false;
      continue;
    }
    const t1 = (low - start) / delta;
    const t2 = (high - start) / delta;
    enter = Math.max(enter, Math.min(t1, t2));
    leave = Math.min(leave, Math.max(t1, t2));
  }
  return enter < leave;
}

/**
 * Whether the body, its center moved in a straight line from `(ax, ay)` to
 * `(bx, by)`, never overlaps a blocked tile or a rectangle (nor leaves the
 * map), grown by `margin`. A zero-length segment tests the body standing there.
 *
 * The body sweeps a hexagon, and an obstacle hits it exactly when the segment
 * of body centers crosses that obstacle grown by the body half size. Walking
 * the tile rows that grown tiles can touch keeps the cost proportional to the
 * length of the segment.
 */
function bodySweepClear(obstacles: Obstacles, ax: number, ay: number, bx: number, by: number, margin: number): boolean {
  const { terrain, rects, buckets, seen } = obstacles;
  const query = ++obstacles.query;
  const dx = bx - ax;
  const dy = by - ay;
  const reachX = BODY_HALF.x + margin;
  const reachY = BODY_HALF.y + margin;

  const firstRow = Math.floor((Math.min(ay, by) - reachY) / TILE);
  const lastRow = Math.floor((Math.max(ay, by) + reachY) / TILE);
  for (let row = firstRow; row <= lastRow; row++) {
    const bandTop = row * TILE - reachY;
    const bandBottom = (row + 1) * TILE + reachY;

    // Part of the segment strictly inside this row's band, as a range of x.
    let xa: number;
    let xb: number;
    if (dy === 0) {
      if (ay <= bandTop || ay >= bandBottom) continue;
      xa = Math.min(ax, bx);
      xb = Math.max(ax, bx);
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
      if (!isFree(terrain, col, row)) {
        // The band is this tile grown in y, so overlapping x ranges is the exact test.
        if (xb > col * TILE - reachX && xa < (col + 1) * TILE + reachX) return false;
        continue;
      }
      for (const index of buckets[row * terrain.width + col] ?? []) {
        if (seen[index] === query) continue;
        seen[index] = query;
        const rect = rects[index]!;
        if (segmentEntersBox(ax, ay, dx, dy, rect.x - reachX, rect.y - reachY, rect.x + rect.w + reachX, rect.y + rect.h + reachY)) return false;
      }
    }
  }
  return true;
}

/** Lattice spot `(tx, ty)` is the body center `(tx * CELL, ty * CELL)`; the lattice spans the map, edges included. */
type Lattice = BlockedGrid;

/**
 * The spots where the body stands clear of everything by `SWEEP_MARGIN_PX`.
 * Two neighbouring free spots are less than a body apart, so the stretch
 * between them is clear too; a diagonal also needs both straight neighbours,
 * which the search already asks for.
 */
function latticeOf(obstacles: Obstacles): Lattice {
  const width = obstacles.terrain.width * 2 + 1;
  const height = obstacles.terrain.height * 2 + 1;
  const blocked = new Uint8Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const x = tx * CELL;
      const y = ty * CELL;
      blocked[ty * width + tx] = bodySweepClear(obstacles, x, y, x, y, SWEEP_MARGIN_PX) ? 0 : 1;
    }
  }
  return { width, height, blocked };
}

/** Network position whose body center is lattice spot `spot`. */
function positionForSpot(spot: TileCoord): GeometryPoint {
  return { x: spot.tx * CELL - BODY_CENTER_OFFSET.x, y: spot.ty * CELL - BODY_CENTER_OFFSET.y };
}

/**
 * Nearest free lattice spot within `REACH_RADIUS_TILES` of the body center
 * `(cx, cy)` that `reachable` accepts: distance, then row, then column.
 */
function nearestSpot(lattice: Lattice, cx: number, cy: number, reachable: (x: number, y: number) => boolean): TileCoord | null {
  const radius = REACH_RADIUS_TILES * TILE;
  const candidates: { spot: TileCoord; distance: number }[] = [];
  for (let ty = Math.ceil((cy - radius) / CELL); ty <= Math.floor((cy + radius) / CELL); ty++) {
    for (let tx = Math.ceil((cx - radius) / CELL); tx <= Math.floor((cx + radius) / CELL); tx++) {
      if (!isFree(lattice, tx, ty)) continue;
      const distance = (tx * CELL - cx) ** 2 + (ty * CELL - cy) ** 2;
      if (distance <= radius * radius) candidates.push({ spot: { tx, ty }, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.spot.ty - b.spot.ty || a.spot.tx - b.spot.tx);
  return candidates.find(({ spot }) => reachable(spot.tx * CELL, spot.ty * CELL))?.spot ?? null;
}

/** Keeps the ends and the spots where the direction changes; a straight run is one stretch. */
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

function sweepClear(obstacles: Obstacles, from: GeometryPoint, to: GeometryPoint, margin: number): boolean {
  return bodySweepClear(
    obstacles,
    from.x + BODY_CENTER_OFFSET.x, from.y + BODY_CENTER_OFFSET.y,
    to.x + BODY_CENTER_OFFSET.x, to.y + BODY_CENTER_OFFSET.y,
    margin,
  );
}

/**
 * Greedy string pulling over `stops` (the first is where the walk starts): from
 * each kept stop, jump to the furthest following one the swept body reaches in
 * a straight line. Consecutive stops are always accepted: they are lattice
 * spots along one run of free spots, plus the legs to the avatar and to the
 * clicked point, which `planWalk` already checked without the margin.
 */
function pullString(obstacles: Obstacles, stops: readonly GeometryPoint[]): GeometryPoint[] {
  const kept: GeometryPoint[] = [];
  let anchor = 0;
  while (anchor < stops.length - 1) {
    let reach = anchor + 1;
    for (let candidate = anchor + 2; candidate < stops.length; candidate++) {
      if (!sweepClear(obstacles, stops[anchor]!, stops[candidate]!, SWEEP_MARGIN_PX)) break;
      reach = candidate;
    }
    kept.push(stops[reach]!);
    anchor = reach;
  }
  return kept;
}

/**
 * Waypoints that walk the avatar from `from` to `goal` around everything the
 * body collides with, the last one being `goal` itself, or `null` when the
 * body does not fit at the goal (blocked or outside the map), no route exists,
 * or no free spot is within reach of the start. Nothing is stood up or moved
 * here: the caller decides what a `null` costs.
 */
export function planWalk(world: WalkWorld, from: GeometryPoint, goal: GeometryPoint): GeometryPoint[] | null {
  if (![from.x, from.y, goal.x, goal.y].every(Number.isFinite)) return null;

  const obstacles = obstaclesOf(world);
  if (!sweepClear(obstacles, goal, goal, 0)) return null;
  const lattice = latticeOf(obstacles);

  // The first and last stretches join the avatar and the clicked point to the
  // lattice, so they are checked like the rest of the walk: a start pressed
  // against a desk never heads through it (#219). A body already inside
  // something (a sitter under a desk) cannot clear any stretch, so it steps
  // out to the nearest free spot and Arcade separates it on the way.
  const start = { x: from.x + BODY_CENTER_OFFSET.x, y: from.y + BODY_CENTER_OFFSET.y };
  const end = { x: goal.x + BODY_CENTER_OFFSET.x, y: goal.y + BODY_CENTER_OFFSET.y };
  const startInside = !bodySweepClear(obstacles, start.x, start.y, start.x, start.y, 0);
  const startSpot = nearestSpot(lattice, start.x, start.y,
    (x, y) => startInside || bodySweepClear(obstacles, start.x, start.y, x, y, 0));
  const goalSpot = nearestSpot(lattice, end.x, end.y, (x, y) => bodySweepClear(obstacles, x, y, end.x, end.y, 0));
  if (startSpot === null || goalSpot === null) return null;

  const path = searchTiles(lattice, startSpot, goalSpot);
  if (path === null) return null;

  const stops: GeometryPoint[] = [from];
  for (const step of collapseStraightRuns(path)) {
    const center = positionForSpot(step);
    if (!samePoint(stops[stops.length - 1]!, center)) stops.push(center);
  }
  // The walk ends on the clicked point, not on a lattice spot: that keeps
  // the landing spot of walk-to-peer and the settle tests exactly as they were.
  if (stops.length > 1 && samePoint(stops[stops.length - 1]!, goal)) stops.pop();
  stops.push({ x: goal.x, y: goal.y });

  return pullString(obstacles, stops);
}
