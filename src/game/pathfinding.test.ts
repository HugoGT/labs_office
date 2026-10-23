import { describe, expect, it } from 'vitest';
import { physicalBodyRect } from './avatarGeometry';
import { TILE } from './mapData';
import { wallColliderRects } from './officeLayout';
import { COLLISION_BODY_CENTER_OFFSET } from './pieceCollisions';
import {
  BODY_CENTER_OFFSET,
  bodyTileOf,
  findTilePath,
  planWalk,
  positionForBodyTile,
  type SearchStats,
  type SolidGrid,
  type WalkWorld,
} from './pathfinding';
import type { TileCoord } from './terrainGrid';

/** Rows of text to a grid: `#` is blocked, anything else free. */
function gridOf(rows: readonly string[]): SolidGrid {
  return rows.map((row) => [...row].map((cell) => cell === '#'));
}

function openGrid(width: number, height: number): SolidGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => false));
}

const tile = (tx: number, ty: number): TileCoord => ({ tx, ty });

/** A world of terrain tiles only, no wall or piece rectangle. */
const terrainOnly = (terrainSolid: SolidGrid): WalkWorld => ({ terrainSolid, rects: [] });

/** Integer path cost: 10 per straight step, 14 per diagonal one. */
function pathCost(path: readonly TileCoord[]): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const diagonal = path[i]!.tx !== path[i - 1]!.tx && path[i]!.ty !== path[i - 1]!.ty;
    cost += diagonal ? 14 : 10;
  }
  return cost;
}

function bodyCenterOf(position: { x: number; y: number }): { x: number; y: number } {
  const body = physicalBodyRect(position);
  return { x: body.x + body.width / 2, y: body.y + body.height / 2 };
}

describe('body space constants', () => {
  it('derives the body center offset from the avatar geometry and pins it to the collision rule', () => {
    expect(BODY_CENTER_OFFSET).toEqual({ x: 0, y: 11 });
    expect(BODY_CENTER_OFFSET).toEqual(COLLISION_BODY_CENTER_OFFSET);
  });
});

describe('bodyTileOf', () => {
  it('reads the tile of the body center, not of the position', () => {
    const edge = atBodyCenter(TILE, TILE);
    expect(bodyTileOf({ ...edge, x: edge.x - 0.01 })).toEqual({ tx: 0, ty: 1 });
    expect(bodyTileOf(edge)).toEqual({ tx: 1, ty: 1 });
    expect(bodyTileOf({ ...edge, y: edge.y - 0.01 })).toEqual({ tx: 1, ty: 0 });
  });

  it('agrees with the Arcade body rectangle at tile edges and for negative positions', () => {
    for (const position of [
      { x: 0, y: 0 },
      { x: 15.99, y: 8.99 },
      { x: 16, y: 9 },
      { x: 47.5, y: 40.5 },
      { x: 400, y: 300 },
      { x: -17, y: -10 },
    ]) {
      const center = bodyCenterOf(position);
      expect(bodyTileOf(position)).toEqual({ tx: Math.floor(center.x / TILE), ty: Math.floor(center.y / TILE) });
    }
  });
});

describe('positionForBodyTile', () => {
  it('puts the body center on the tile center', () => {
    expect(positionForBodyTile({ tx: 0, ty: 0 })).toEqual(atBodyCenter(16, 16));
    expect(positionForBodyTile({ tx: 3, ty: 2 })).toEqual(atBodyCenter(112, 80));
    expect(bodyCenterOf(positionForBodyTile({ tx: 3, ty: 2 }))).toEqual({ x: 3 * TILE + 16, y: 2 * TILE + 16 });
  });

  it('round trips through bodyTileOf', () => {
    for (const tile of [
      { tx: 0, ty: 0 },
      { tx: 125, ty: 89 },
      { tx: -1, ty: -2 },
    ]) {
      expect(bodyTileOf(positionForBodyTile(tile))).toEqual(tile);
    }
  });
});

describe('findTilePath', () => {
  it('walks a straight line with both ends included', () => {
    expect(findTilePath(openGrid(6, 3), tile(0, 1), tile(4, 1))).toEqual([0, 1, 2, 3, 4].map((tx) => tile(tx, 1)));
  });

  it('prefers diagonal steps in open ground', () => {
    expect(findTilePath(openGrid(5, 5), tile(0, 0), tile(3, 3))).toEqual([tile(0, 0), tile(1, 1), tile(2, 2), tile(3, 3)]);
  });

  it('answers a single tile when start and goal are the same free tile', () => {
    expect(findTilePath(openGrid(3, 3), tile(1, 1), tile(1, 1))).toEqual([tile(1, 1)]);
  });

  it('detours around a wall through its only gap at the cheapest cost', () => {
    const grid = gridOf(['..#..', '..#..', '..#..', '..#..', '.....']);
    const path = findTilePath(grid, tile(0, 0), tile(4, 0));

    expect(path).not.toBeNull();
    expect(path![0]).toEqual(tile(0, 0));
    expect(path![path!.length - 1]).toEqual(tile(4, 0));
    expect(path).toContainEqual(tile(2, 4));
    for (const step of path!) expect(grid[step.ty]![step.tx]).toBe(false);
    // 54 to reach the gap and 54 to leave it; a corner-cutting path would be cheaper.
    expect(pathCost(path!)).toBe(108);
  });

  it('never cuts a corner between two blocked tiles', () => {
    // (1,0) and (0,1) touch diagonally; (0,0) and (1,1) can only meet through that gap.
    const grid = gridOf(['.#.', '#..', '...']);

    expect(findTilePath(grid, tile(0, 0), tile(1, 1))).toBeNull();
  });

  it('never cuts the corner of a single blocked tile either', () => {
    const grid = gridOf(['.#', '..']);

    expect(findTilePath(grid, tile(0, 0), tile(1, 1))).toEqual([tile(0, 0), tile(0, 1), tile(1, 1)]);
  });

  it('answers null for a blocked or out of bounds goal', () => {
    const grid = gridOf(['...', '.#.', '...']);

    expect(findTilePath(grid, tile(0, 0), tile(1, 1))).toBeNull();
    expect(findTilePath(grid, tile(0, 0), tile(3, 0))).toBeNull();
    expect(findTilePath(grid, tile(0, 0), tile(0, 3))).toBeNull();
    expect(findTilePath(grid, tile(0, 0), tile(-1, 0))).toBeNull();
    expect(findTilePath(grid, tile(0, 0), tile(0, -1))).toBeNull();
  });

  it('answers null for a blocked or out of bounds start', () => {
    const grid = gridOf(['...', '.#.', '...']);

    expect(findTilePath(grid, tile(1, 1), tile(0, 0))).toBeNull();
    expect(findTilePath(grid, tile(-1, 0), tile(0, 0))).toBeNull();
    expect(findTilePath(grid, tile(5, 5), tile(0, 0))).toBeNull();
  });

  it('answers null when a wall closes the goal off', () => {
    const grid = gridOf(['..#..', '..#..', '..#..']);

    expect(findTilePath(grid, tile(0, 1), tile(4, 1))).toBeNull();
  });

  it('takes its size from the array, not from map constants', () => {
    const tall = findTilePath(openGrid(100, 3200), tile(0, 0), tile(99, 3199));
    expect(tall).toHaveLength(3200);
    expect(tall![3199]).toEqual(tile(99, 3199));

    const wide = findTilePath(openGrid(3200, 3), tile(0, 0), tile(3199, 2));
    expect(wide).toHaveLength(3200);
    expect(wide![3199]).toEqual(tile(3199, 2));
  });

  it('treats missing cells as blocked', () => {
    // Row 1 is shorter than row 0: (1,1) and (2,1) do not exist.
    const ragged: SolidGrid = [[false, false, false], [false]];

    expect(findTilePath(ragged, tile(0, 0), tile(2, 0))).toEqual([tile(0, 0), tile(1, 0), tile(2, 0)]);
    expect(findTilePath(ragged, tile(0, 0), tile(1, 1))).toBeNull();
    expect(findTilePath(ragged, tile(0, 0), tile(0, 2))).toBeNull();
    expect(findTilePath([], tile(0, 0), tile(0, 0))).toBeNull();
  });

  it('expands little more than the route itself across open ground', () => {
    // Equal-cost diagonals are everywhere in open ground; preferring the
    // deeper tile keeps the search on one of them instead of fanning out.
    const stats: SearchStats = { expanded: 0 };
    const path = findTilePath(openGrid(126, 90), tile(0, 0), tile(125, 89), stats);

    expect(path).toHaveLength(126);
    expect(stats.expanded).toBeLessThanOrEqual(2 * path!.length);
  });

  it('reports exactly the reachable free tiles as work when the goal is closed off', () => {
    // A ring of walls around an island goal on the real map size: the search
    // has to flood everything else and stop, never loop or re-expand a tile.
    const width = 126;
    const height = 90;
    const grid = openGrid(width, height).map((row) => [...row]);
    for (let x = 60; x <= 64; x++) {
      grid[40]![x] = true;
      grid[44]![x] = true;
    }
    for (let y = 40; y <= 44; y++) {
      grid[y]![60] = true;
      grid[y]![64] = true;
    }
    const stats: SearchStats = { expanded: 0 };

    expect(findTilePath(grid, tile(0, 0), tile(62, 42), stats)).toBeNull();
    // 5x5 ring of 16 walls around a 3x3 island of 9 tiles.
    expect(stats.expanded).toBe(width * height - 16 - 9);
  });
});

/** Network position whose body center is exactly `(x, y)`. */
function atBodyCenter(x: number, y: number): { x: number; y: number } {
  return { x: x - BODY_CENTER_OFFSET.x, y: y - BODY_CENTER_OFFSET.y };
}

const centerOf = (tx: number, ty: number) => positionForBodyTile(tile(tx, ty));

function blockedAt(grid: SolidGrid, tx: number, ty: number): boolean {
  return grid[ty]?.[tx] !== false;
}

/**
 * Independent oracle for "this walk never touches a blocked tile": samples the
 * shared body (no safety margin) every pixel along the segment and checks the
 * open interior of the box against every tile it covers.
 */
function segmentClear(grid: SolidGrid, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const length = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
  for (let i = 0; i <= length; i++) {
    const cx = from.x + ((to.x - from.x) * i) / length + BODY_CENTER_OFFSET.x;
    const cy = from.y + ((to.y - from.y) * i) / length + BODY_CENTER_OFFSET.y;
    const footprint = physicalBodyRect({ x: 0, y: 0 });
    const tx0 = Math.floor((cx - footprint.width / 2) / TILE);
    const tx1 = Math.ceil((cx + footprint.width / 2) / TILE) - 1;
    const ty0 = Math.floor((cy - footprint.height / 2) / TILE);
    const ty1 = Math.ceil((cy + footprint.height / 2) / TILE) - 1;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) if (blockedAt(grid, tx, ty)) return false;
    }
  }
  return true;
}

describe('planWalk', () => {
  it('goes straight to the goal in open ground', () => {
    const goal = centerOf(6, 1);

    expect(planWalk(terrainOnly(openGrid(8, 3)), centerOf(0, 1), goal)).toEqual([goal]);
  });

  it('ends exactly on the clicked point, not on the tile center', () => {
    const goal = atBodyCenter(6 * TILE + 20, 1 * TILE + 11);

    expect(planWalk(terrainOnly(openGrid(8, 3)), centerOf(0, 1), goal)).toEqual([goal]);
  });

  it('walks around a wall without ever sweeping the body through a blocked tile', () => {
    const grid = gridOf(['..#..', '..#..', '..#..', '..#..', '.....']);
    const from = centerOf(0, 0);
    const goal = centerOf(4, 0);
    const route = planWalk(terrainOnly(grid), from, goal);

    expect(route).not.toBeNull();
    expect(route!.length).toBeGreaterThanOrEqual(2);
    expect(route![route!.length - 1]).toEqual(goal);
    // It really goes down to the gap row instead of cutting across the wall.
    expect(Math.max(...route!.map((point) => bodyTileOf(point).ty))).toBe(4);
    let previous = from;
    for (const point of route!) {
      expect(segmentClear(grid, previous, point)).toBe(true);
      previous = point;
    }
  });

  it('keeps only the corners of a corridor', () => {
    const grid = gridOf(['....###', '###.###', '###....']);

    expect(planWalk(terrainOnly(grid), centerOf(0, 0), centerOf(6, 2))).toEqual([centerOf(3, 0), centerOf(3, 2), centerOf(6, 2)]);
  });

  it('keeps the goal tile center as the last stop when the clicked point hugs a wall', () => {
    // Touching the swept margin is clear; one pixel further needs a waypoint.
    const grid = gridOf(['...#']);
    const edge = 3 * TILE - physicalBodyRect({ x: 0, y: 0 }).width / 2 - 3;
    expect(planWalk(terrainOnly(grid), centerOf(0, 0), atBodyCenter(edge, 16))).toEqual([atBodyCenter(edge, 16)]);
    expect(planWalk(terrainOnly(grid), centerOf(0, 0), atBodyCenter(edge + 1, 16))).toEqual([centerOf(2, 0), atBodyCenter(edge + 1, 16)]);
  });

  it('refuses to pull a segment whose swept body clips a wall corner the center line misses', () => {
    // Tile (1,0) is a wall. The center line from tile (0,1) to the point stays
    // below y = 32, but the 14 px tall body (plus margin) reaches into the wall.
    const grid = gridOf(['.#.', '...']);
    const from = centerOf(0, 1);

    expect(planWalk(terrainOnly(grid), from, atBodyCenter(80, 39))).toEqual([centerOf(2, 1), atBodyCenter(80, 39)]);
    expect(planWalk(terrainOnly(grid), from, atBodyCenter(80, 43))).toEqual([atBodyCenter(80, 43)]);
  });

  it('answers null for a blocked or out of bounds goal tile', () => {
    const grid = gridOf(['...', '.#.', '...']);

    expect(planWalk(terrainOnly(grid), centerOf(0, 0), centerOf(1, 1))).toBeNull();
    expect(planWalk(terrainOnly(grid), centerOf(0, 0), centerOf(5, 0))).toBeNull();
    expect(planWalk(terrainOnly(grid), centerOf(0, 0), centerOf(0, -1))).toBeNull();
  });

  it('answers null when no route exists, and for a goal that is not a number', () => {
    const closed = gridOf(['..#..', '..#..', '..#..']);

    expect(planWalk(terrainOnly(closed), centerOf(0, 1), centerOf(4, 1))).toBeNull();
    expect(planWalk(terrainOnly(openGrid(3, 3)), centerOf(0, 0), { x: Number.NaN, y: 40 })).toBeNull();
    expect(planWalk(terrainOnly(openGrid(3, 3)), centerOf(0, 0), { x: 40, y: Number.POSITIVE_INFINITY })).toBeNull();
    expect(planWalk(terrainOnly(openGrid(3, 3)), { x: Number.NaN, y: 0 }, centerOf(2, 2))).toBeNull();
  });

  it('escapes a blocked start tile through the nearest free tile first', () => {
    const grid = openGrid(9, 9).map((row) => [...row]);
    grid[4]![4] = true;
    const goal = centerOf(8, 4);

    const north = planWalk(terrainOnly(grid), centerOf(4, 4), goal);
    expect(north![0]).toEqual(centerOf(4, 3));
    expect(north![north!.length - 1]).toEqual(goal);

    // Same distance, so row then column break the tie: with the north tile gone it is the west one.
    grid[3]![4] = true;
    expect(planWalk(terrainOnly(grid), centerOf(4, 4), goal)![0]).toEqual(centerOf(3, 4));
  });

  it('escapes a start up to 3 tiles from open ground and gives up beyond that', () => {
    const blockedBlock = (from: number, to: number) => {
      const grid = openGrid(15, 15).map((row) => [...row]);
      for (let y = from; y <= to; y++) for (let x = from; x <= to; x++) grid[y]![x] = true;
      return grid;
    };
    const goal = centerOf(13, 7);

    const near = planWalk(terrainOnly(blockedBlock(5, 9)), centerOf(7, 7), goal);
    expect(near![0]).toEqual(centerOf(7, 4));
    expect(near![near!.length - 1]).toEqual(goal);

    expect(planWalk(terrainOnly(blockedBlock(4, 10)), centerOf(7, 7), goal)).toBeNull();
  });

  it('plans over a whole 126x90 map in one call', () => {
    const goal = centerOf(125, 89);

    expect(planWalk(terrainOnly(openGrid(126, 90)), centerOf(0, 0), goal)).toEqual([goal]);
  });

  it('only returns walks that clear every wall, and finds one whenever the tiles are connected', () => {
    // Deterministic pseudo-random rooms (linear congruential generator).
    let seed = 20260507;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const width = 12;
    const height = 10;
    let found = 0;
    let refused = 0;

    for (let round = 0; round < 80; round++) {
      const grid = openGrid(width, height).map((row) => row.map(() => random() < 0.3));
      const free: TileCoord[] = [];
      grid.forEach((row, ty) => row.forEach((blocked, tx) => !blocked && free.push(tile(tx, ty))));
      if (free.length < 2) continue;
      const start = free[Math.floor(random() * free.length)]!;
      const end = free[Math.floor(random() * free.length)]!;

      // 4-connected flood: a diagonal needs both of its straight neighbours,
      // so it reaches exactly the same tiles as the planner's 8 directions.
      const reached = new Set<string>([`${start.tx},${start.ty}`]);
      const queue = [start];
      while (queue.length > 0) {
        const at = queue.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const next = tile(at.tx + dx, at.ty + dy);
          const key = `${next.tx},${next.ty}`;
          if (!blockedAt(grid, next.tx, next.ty) && !reached.has(key)) {
            reached.add(key);
            queue.push(next);
          }
        }
      }

      const route = planWalk(terrainOnly(grid), centerOf(start.tx, start.ty), centerOf(end.tx, end.ty));
      if (!reached.has(`${end.tx},${end.ty}`)) {
        expect(route).toBeNull();
        refused++;
        continue;
      }
      expect(route).not.toBeNull();
      expect(route![route!.length - 1]).toEqual(centerOf(end.tx, end.ty));
      let previous = centerOf(start.tx, start.ty);
      for (const point of route!) {
        expect(segmentClear(grid, previous, point)).toBe(true);
        previous = point;
      }
      found++;
    }

    // Both branches ran, so neither assertion block above was vacuous.
    expect(found).toBeGreaterThan(10);
    expect(refused).toBeGreaterThan(5);
  });
});

/**
 * Independent oracle for "this walk never overlaps anything Arcade collides
 * with": samples the body (no margin) every pixel along the segment against
 * the blocked tiles and every rectangle.
 */
function segmentClearOf(world: WalkWorld, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  if (!segmentClear(world.terrainSolid, from, to)) return false;
  const length = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
  for (let i = 0; i <= length; i++) {
    const body = physicalBodyRect({ x: from.x + ((to.x - from.x) * i) / length, y: from.y + ((to.y - from.y) * i) / length });
    const hit = world.rects.some((rect) =>
      rect.x < body.x + body.width && body.x < rect.x + rect.w && rect.y < body.y + body.height && body.y < rect.y + rect.h);
    if (hit) return false;
  }
  return true;
}

function expectClearWalk(world: WalkWorld, from: { x: number; y: number }, route: readonly { x: number; y: number }[] | null) {
  expect(route).not.toBeNull();
  let previous = from;
  for (const point of route!) {
    expect(segmentClearOf(world, previous, point), `${JSON.stringify(previous)} -> ${JSON.stringify(point)}`).toBe(true);
    previous = point;
  }
}

describe('planWalk against wall and piece rectangles (#219, #221)', () => {
  /**
   * 12x12 open tiles with a room whose walls run on the grid lines from
   * vertex (2,2) to (8,8). With a door, the bottom wall misses the post at
   * (5,8): a one-post door, 48 px between the two joints beside it.
   */
  function walledRoom({ door = true } = {}): WalkWorld {
    const width = 12;
    const height = 12;
    const walls: (string | null)[] = Array(width * height).fill(null);
    for (let i = 2; i <= 8; i++) {
      for (const [tx, ty] of [[i, 2], [i, 8], [2, i], [8, i]] as const) walls[ty * width + tx] = 'wall-brick';
    }
    if (door) walls[8 * width + 5] = null;
    return { terrainSolid: openGrid(width, height), rects: wallColliderRects({ width, height, walls }) };
  }

  it('walks from the corridor into a walled room through a one-post door, and back out', () => {
    const room = walledRoom();
    const outside = centerOf(5, 10);
    const inside = centerOf(5, 4);

    const into = planWalk(room, outside, inside);
    expectClearWalk(room, outside, into);
    expect(into!.at(-1)).toEqual(inside);

    const out = planWalk(room, inside, outside);
    expectClearWalk(room, inside, out);
    expect(out!.at(-1)).toEqual(outside);
  });

  it('reaches the spots along both sides of a wall, which the whole-tile grid blocked', () => {
    const room = walledRoom();
    const from = centerOf(10, 10);
    // Inside, against the top wall (line y = 64), and outside, against the right one (line x = 256).
    for (const goal of [centerOf(3, 2), atBodyCenter(2 * TILE + 18, 4 * TILE + 16), atBodyCenter(8 * TILE + 18, 5 * TILE + 16)]) {
      const route = planWalk(room, from, goal);
      expectClearWalk(room, from, route);
      expect(route!.at(-1)).toEqual(goal);
    }
  });

  it('answers null for a walled room with no door', () => {
    expect(planWalk(walledRoom({ door: false }), centerOf(5, 10), centerOf(5, 4))).toBeNull();
  });

  it('never heads through a desk the body is pressed against: it walks around it', () => {
    // A desk thinner than a tile; the body touches its bottom edge, so its
    // center is in a tile the desk partly covers.
    const desk = { x: 96, y: 136, w: 128, h: 16 };
    const world: WalkWorld = { terrainSolid: openGrid(10, 10), rects: [desk] };
    const from = atBodyCenter(160, desk.y + desk.h + 7);
    const goal = centerOf(5, 1);

    const route = planWalk(world, from, goal);
    expectClearWalk(world, from, route);
    expect(route!.at(-1)).toEqual(goal);
    expect(route!.some((point) => point.x <= desk.x - 9 || point.x >= desk.x + desk.w + 9)).toBe(true);
  });

  it('judges the goal by the whole body: a body overlapping a rectangle is refused, one touching it is not', () => {
    const world: WalkWorld = { terrainSolid: openGrid(8, 8), rects: [{ x: 96, y: 96, w: 32, h: 32 }] };
    const from = centerOf(0, 3);

    expect(planWalk(world, from, atBodyCenter(96 - 9 + 1, 112))).toBeNull();
    const touching = atBodyCenter(96 - 9, 112);
    expect(planWalk(world, from, touching)!.at(-1)).toEqual(touching);
  });

  it('only returns walks that clear every rectangle, around random pieces', () => {
    let seed = 20261023;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let found = 0;
    for (let round = 0; round < 60; round++) {
      const rects = Array.from({ length: 8 }, () => ({
        x: Math.floor(random() * 300), y: Math.floor(random() * 300), w: 8 + Math.floor(random() * 60), h: 8 + Math.floor(random() * 60),
      }));
      const world: WalkWorld = { terrainSolid: openGrid(12, 12), rects };
      const from = { x: Math.floor(random() * 360) + 12, y: Math.floor(random() * 360) };
      const goal = { x: Math.floor(random() * 360) + 12, y: Math.floor(random() * 360) };
      if (!segmentClearOf(world, from, from)) continue;
      const route = planWalk(world, from, goal);
      if (route === null) continue;
      expectClearWalk(world, from, route);
      expect(route.at(-1)).toEqual(goal);
      found++;
    }
    expect(found).toBeGreaterThan(20);
  });
});
