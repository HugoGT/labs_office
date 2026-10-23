import { describe, expect, it } from 'vitest';
import { physicalBodyRect } from './avatarGeometry';
import type { DecorItem } from './officeDecor';
import {
  DOOR_OPEN_REACH_PX,
  crossesLockedDoor,
  decodeDoorLocks,
  doorEdge,
  doorEndPosts,
  doorInsideTile,
  doorLeaves,
  doorLockGroup,
  doorOnWall,
  doorOpenings,
  doorSwingRotation,
  encodeDoorLocks,
  isDoorPiece,
  liveDoorLocks,
  lockedDoorBarriers,
  openDoorLeaves,
  roomMap,
  ROOM_MAX_TILES,
  toggleDoorLock,
} from './officeDoors';

const WIDTH = 12;
const HEIGHT = 10;
const at = (tx: number, ty: number): number => ty * WIDTH + tx;
const door = (tx: number, ty: number, rotation: DecorItem['rotation'] = 0): DecorItem => ({ index: at(tx, ty), piece: 'door-wood', rotation });

/** A wall grid with `piece` posts on the given vertices. */
function wallGrid(posts: readonly (readonly [number, number, string?])[]) {
  const walls = new Array<string | null>(WIDTH * HEIGHT).fill(null);
  for (const [tx, ty, piece] of posts) walls[at(tx, ty)] = piece ?? 'wall-brick';
  return { width: WIDTH, height: HEIGHT, walls };
}

/** Posts all around the rectangle of vertices (x0, y0)..(x1, y1): a closed room of the tiles inside it, `piece` or the per-vertex override. */
function ring(x0: number, y0: number, x1: number, y1: number, piece = 'wall-brick', overrides: Readonly<Record<string, string>> = {}) {
  const posts: [number, number, string][] = [];
  for (let x = x0; x <= x1; x += 1) posts.push([x, y0, piece], [x, y1, piece]);
  for (let y = y0 + 1; y < y1; y += 1) posts.push([x0, y, piece], [x1, y, piece]);
  return wallGrid(posts.map(([x, y, p]) => [x, y, overrides[`${x},${y}`] ?? p] as const));
}

describe('officeDoors: the edge a door stands on (#223)', () => {
  it('knows a door by its id', () => {
    expect(isDoorPiece('door-wood')).toBe(true);
    expect(isDoorPiece('chair-wood')).toBe(false);
    expect(isDoorPiece('doorway-wood')).toBe(false);
  });

  it('stands on the top edge of its anchor tile for 0 and 180, on the left edge for 90 and 270', () => {
    expect(doorEdge(door(4, 6, 0), WIDTH)).toEqual({ col: 4, row: 6, axis: 'horizontal' });
    expect(doorEdge(door(4, 6, 180), WIDTH)).toEqual({ col: 4, row: 6, axis: 'horizontal' });
    expect(doorEdge(door(4, 6, 90), WIDTH)).toEqual({ col: 4, row: 6, axis: 'vertical' });
    expect(doorEdge(door(4, 6, 270), WIDTH)).toEqual({ col: 4, row: 6, axis: 'vertical' });
  });

  it('ends on the two posts of its edge', () => {
    expect(doorEndPosts(door(4, 6, 0), WIDTH)).toEqual([at(4, 6), at(5, 6)]);
    expect(doorEndPosts(door(4, 6, 90), WIDTH)).toEqual([at(4, 6), at(4, 7)]);
  });

  it('opens into the side its rotation faces, like a chair: down, right, up, left', () => {
    expect(doorInsideTile(door(4, 6, 0), WIDTH)).toEqual({ tx: 4, ty: 6 });
    expect(doorInsideTile(door(4, 6, 90), WIDTH)).toEqual({ tx: 4, ty: 6 });
    expect(doorInsideTile(door(4, 6, 180), WIDTH)).toEqual({ tx: 4, ty: 5 });
    expect(doorInsideTile(door(4, 6, 270), WIDTH)).toEqual({ tx: 3, ty: 6 });
  });

  it('stands on a wall only between two joined posts that close a room on at least one side', () => {
    const room = ring(3, 2, 8, 6);
    expect(doorOnWall(room, door(4, 2, 0))).toBe(true);
    expect(doorOnWall(room, door(3, 4, 90))).toBe(true);
    // A bare wall closes no room, a lone post is no wall, and a vertical wall does not hold a horizontal door.
    expect(doorOnWall(wallGrid([[4, 6], [5, 6]]), door(4, 6, 0))).toBe(false);
    expect(doorOnWall(wallGrid([[4, 6]]), door(4, 6, 0))).toBe(false);
    expect(doorOnWall(room, door(3, 3, 0))).toBe(false);
  });

  it('opens the edge of every door of the layer, and of nothing else', () => {
    const items: DecorItem[] = [door(4, 6, 180), { index: at(1, 1), piece: 'chair-wood', rotation: 0 }, door(7, 2, 90)];
    expect(doorOpenings(items, WIDTH)).toEqual([
      { col: 4, row: 6, axis: 'horizontal' },
      { col: 7, row: 2, axis: 'vertical' },
    ]);
  });
});

describe('officeDoors: leaves and hinges (#223)', () => {
  it('hinges a lone door at the start of its edge (west or north), the handle at the other end', () => {
    expect(doorLeaves([door(4, 6, 0)], WIDTH)).toEqual([
      expect.objectContaining({ index: at(4, 6), hinge: 'start', pair: at(4, 6), group: at(4, 6) }),
    ]);
    expect(doorLeaves([door(4, 6, 90)], WIDTH)[0]).toMatchObject({ hinge: 'start', edge: { col: 4, row: 6, axis: 'vertical' } });
  });

  it('makes two adjacent doors of one line and rotation a double door, hinged at the outer ends', () => {
    const leaves = doorLeaves([door(5, 6, 0), door(4, 6, 0)], WIDTH);
    expect(leaves.map(({ index, hinge, pair, group }) => ({ index, hinge, pair, group }))).toEqual([
      { index: at(4, 6), hinge: 'start', pair: at(4, 6), group: at(4, 6) },
      { index: at(5, 6), hinge: 'end', pair: at(4, 6), group: at(4, 6) },
    ]);
    const vertical = doorLeaves([door(3, 2, 270), door(3, 3, 270)], WIDTH);
    expect(vertical.map(({ hinge, group }) => ({ hinge, group }))).toEqual([
      { hinge: 'start', group: at(3, 2) },
      { hinge: 'end', group: at(3, 2) },
    ]);
  });

  it('pairs a longer run from its start, the odd last leaf alone', () => {
    const leaves = doorLeaves([door(1, 6), door(2, 6), door(3, 6)], WIDTH);
    expect(leaves.map(({ hinge, pair, group }) => ({ hinge, pair, group }))).toEqual([
      { hinge: 'start', pair: at(1, 6), group: at(1, 6) },
      { hinge: 'end', pair: at(1, 6), group: at(1, 6) },
      { hinge: 'start', pair: at(3, 6), group: at(1, 6) },
    ]);
  });

  it('never groups doors turned differently, on another line or with a gap', () => {
    const leaves = doorLeaves([door(4, 6, 0), door(5, 6, 180), door(4, 7, 0), door(7, 6, 0), door(8, 6, 90)], WIDTH);
    for (const leaf of leaves) expect(leaf).toMatchObject({ hinge: 'start', pair: leaf.index, group: leaf.index });
  });
});

describe('officeDoors: open and closed (#223)', () => {
  /** A network position whose body center is at (cx, cy). */
  const standingAt = (cx: number, cy: number) => {
    const body = physicalBodyRect({ x: 0, y: 0 });
    return { x: cx - (body.x + body.width / 2), y: cy - (body.y + body.height / 2) };
  };
  /** The anchors open, whatever side they swing to. */
  const openAnchors = (...args: Parameters<typeof openDoorLeaves>) => new Set(openDoorLeaves(...args).keys());

  it('opens a leaf while an avatar is lined up with it and on its tiles or a few pixels past them, and closes it otherwise', () => {
    const leaves = doorLeaves([door(4, 6, 0)], WIDTH);
    // The door's tiles are (4, 5) and (4, 6): x 128..160, y 160..224.
    expect(openAnchors(leaves, [])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(144, 200)])).toEqual(new Set([at(4, 6)]));
    expect(openAnchors(leaves, [standingAt(144, 170)])).toEqual(new Set([at(4, 6)]));
    // Just within reach below the door, then just beyond it.
    expect(openAnchors(leaves, [standingAt(144, 224 + DOOR_OPEN_REACH_PX - 1)])).toEqual(new Set([at(4, 6)]));
    expect(openAnchors(leaves, [standingAt(144, 224 + DOOR_OPEN_REACH_PX)])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(300, 300)])).toEqual(new Set());
  });

  it('stays shut for an avatar walking past alongside the wall, outside the door span (S14)', () => {
    const horizontal = doorLeaves([door(4, 6, 0)], WIDTH);
    // The neighbouring columns, on the door's own rows, one on each side of the wall line.
    for (const cy of [6 * 32 - 10, 6 * 32 + 10]) {
      expect(openAnchors(horizontal, [standingAt(3 * 32 + 16, cy)])).toEqual(new Set());
      expect(openAnchors(horizontal, [standingAt(5 * 32 + 16, cy)])).toEqual(new Set());
    }
    // The span's ends are in, the first pixel past them is out.
    expect(openAnchors(horizontal, [standingAt(128, 6 * 32 - 10)])).toEqual(new Set([at(4, 6)]));
    expect(openAnchors(horizontal, [standingAt(128 - 1, 6 * 32 - 10)])).toEqual(new Set());
    expect(openAnchors(horizontal, [standingAt(160 - 1, 6 * 32 - 10)])).toEqual(new Set([at(4, 6)]));
    expect(openAnchors(horizontal, [standingAt(160, 6 * 32 - 10)])).toEqual(new Set());
    // The same for a door on a vertical edge (tiles (3, 2) and (4, 2): x 96..160, y 64..96).
    const vertical = doorLeaves([door(4, 2, 90)], WIDTH);
    expect(openAnchors(vertical, [standingAt(4 * 32 - 10, 3 * 32 + 16)])).toEqual(new Set());
    expect(openAnchors(vertical, [standingAt(4 * 32 + 10, 1 * 32 + 16)])).toEqual(new Set());
    expect(openAnchors(vertical, [standingAt(4 * 32 - 10, 2 * 32 + 16)])).toEqual(new Set([at(4, 2)]));
  });

  it('opens both leaves of a double door together, over the span of the pair, never the next pair of the run', () => {
    const leaves = doorLeaves([door(1, 6), door(2, 6), door(3, 6), door(4, 6)], WIDTH);
    expect(openAnchors(leaves, [standingAt(1 * 32 + 16, 6 * 32 + 10)])).toEqual(new Set([at(1, 6), at(2, 6)]));
    expect(openAnchors(leaves, [standingAt(2 * 32 + 16, 6 * 32 + 10)])).toEqual(new Set([at(1, 6), at(2, 6)]));
    expect(openAnchors(leaves, [standingAt(4 * 32 + 16, 6 * 32 + 10)])).toEqual(new Set([at(3, 6), at(4, 6)]));
    // Past the pair's span on its far side: out.
    expect(openAnchors(leaves, [standingAt(5 * 32 + 16, 6 * 32 + 10)])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(0 * 32 + 16, 6 * 32 + 10)])).toEqual(new Set());
  });

  it('swings away from the side the avatar comes from, whatever way the door was placed (S14)', () => {
    // Each rotation opens into its inside; `before` is a body center outside the edge line, `after` one inside it.
    const cases: [DecorItem['rotation'], { x: number; y: number }, { x: number; y: number }][] = [
      [0, { x: 144, y: 6 * 32 - 10 }, { x: 144, y: 6 * 32 + 10 }],
      [180, { x: 144, y: 6 * 32 + 10 }, { x: 144, y: 6 * 32 - 10 }],
      [90, { x: 4 * 32 - 10, y: 6 * 32 + 16 }, { x: 4 * 32 + 10, y: 6 * 32 + 16 }],
      [270, { x: 4 * 32 + 10, y: 6 * 32 + 16 }, { x: 4 * 32 - 10, y: 6 * 32 + 16 }],
    ];
    for (const [rotation, outside, inside] of cases) {
      const leaves = doorLeaves([door(4, 6, rotation)], WIDTH);
      // From the outside it swings into the room, from the inside out of it: never into the walker.
      expect(openDoorLeaves(leaves, [standingAt(outside.x, outside.y)]), `rotation ${rotation} from outside`).toEqual(new Map([[at(4, 6), 'inside']]));
      expect(openDoorLeaves(leaves, [standingAt(inside.x, inside.y)]), `rotation ${rotation} from inside`).toEqual(new Map([[at(4, 6), 'outside']]));
    }
  });

  it('draws the swing the other way round by turning the leaf half a turn, so its hinge stays at the same end (S14)', () => {
    const [leaf] = doorLeaves([door(4, 6, 90)], WIDTH);
    expect(doorSwingRotation(leaf!.rotation, 'inside')).toBe(90);
    expect(doorSwingRotation(leaf!.rotation, 'outside')).toBe(270);
    expect(doorSwingRotation(180, 'outside')).toBe(0);
    expect(doorSwingRotation(270, 'outside')).toBe(90);
  });

  it('keeps the swing while the avatar passes the edge line, and drops it when the door closes (S14)', () => {
    const leaves = doorLeaves([door(4, 6, 0)], WIDTH);
    const edgeY = 6 * 32;
    let swings = openDoorLeaves(leaves, [standingAt(144, edgeY - 12)]);
    expect(swings.get(at(4, 6))).toBe('inside');
    // Mid-crossing, on the line and past it: it does not flip.
    for (const cy of [edgeY, edgeY + 1, edgeY + 12]) {
      swings = openDoorLeaves(leaves, [standingAt(144, cy)], new Set(), swings);
      expect(swings.get(at(4, 6)), `at ${cy}`).toBe('inside');
    }
    // Walked away: closed, and the next one to come from inside gets a fresh swing.
    swings = openDoorLeaves(leaves, [standingAt(144, edgeY + 3 * 32)], new Set(), swings);
    expect(swings).toEqual(new Map());
    expect(openDoorLeaves(leaves, [standingAt(144, edgeY + 12)], new Set(), swings).get(at(4, 6))).toBe('outside');
  });

  it('keeps the swing it has when two avatars come from opposite sides, else the first one to open (S14)', () => {
    const leaves = doorLeaves([door(4, 6, 0)], WIDTH);
    const outside = standingAt(144, 6 * 32 - 12);
    const inside = standingAt(144, 6 * 32 + 12);
    expect(openDoorLeaves(leaves, [outside, inside]).get(at(4, 6))).toBe('inside');
    expect(openDoorLeaves(leaves, [inside, outside]).get(at(4, 6))).toBe('outside');
    expect(openDoorLeaves(leaves, [outside, inside], new Set(), new Map([[at(4, 6), 'outside']])).get(at(4, 6))).toBe('outside');
  });

  it('swings both leaves of a double door the same way, from whichever leaf the avatar is at (S14)', () => {
    const leaves = doorLeaves([door(4, 6), door(5, 6)], WIDTH);
    expect(openDoorLeaves(leaves, [standingAt(5 * 32 + 16, 6 * 32 - 10)])).toEqual(
      new Map([
        [at(4, 6), 'inside'],
        [at(5, 6), 'inside'],
      ]),
    );
    expect(openDoorLeaves(leaves, [standingAt(4 * 32 + 16, 6 * 32 + 10)])).toEqual(
      new Map([
        [at(4, 6), 'outside'],
        [at(5, 6), 'outside'],
      ]),
    );
  });
});

describe('officeDoors: locks (#223, S13)', () => {
  /** A network position whose body center is at (cx, cy). */
  const centeredAt = (cx: number, cy: number) => {
    const body = physicalBodyRect({ x: 0, y: 0 });
    return { x: cx - (body.x + body.width / 2), y: cy - (body.y + body.height / 2) };
  };
  // A double door on the top edges of tiles (4, 6) and (5, 6), opening down: inside is row 6.
  const DOUBLE: DecorItem[] = [door(4, 6, 0), door(5, 6, 0)];

  it('finds the door group whose inside tile the avatar stands in, and nothing outside it or away from it', () => {
    expect(doorLockGroup(DOUBLE, WIDTH, centeredAt(5 * 32 + 16, 6 * 32 + 16))).toEqual([at(4, 6), at(5, 6)]);
    expect(doorLockGroup(DOUBLE, WIDTH, centeredAt(4 * 32 + 3, 6 * 32 + 30))).toEqual([at(4, 6), at(5, 6)]);
    // Outside (row 5), beside it (6, 6) or two tiles in: no door within reach.
    expect(doorLockGroup(DOUBLE, WIDTH, centeredAt(4 * 32 + 16, 5 * 32 + 16))).toBeNull();
    expect(doorLockGroup(DOUBLE, WIDTH, centeredAt(6 * 32 + 16, 6 * 32 + 16))).toBeNull();
    expect(doorLockGroup(DOUBLE, WIDTH, centeredAt(4 * 32 + 16, 7 * 32 + 16))).toBeNull();
    // A door turned 270 opens left: its inside is the tile west of its edge.
    expect(doorLockGroup([door(7, 2, 270)], WIDTH, centeredAt(6 * 32 + 16, 2 * 32 + 16))).toEqual([at(7, 2)]);
    expect(doorLockGroup([door(7, 2, 270)], WIDTH, centeredAt(7 * 32 + 16, 2 * 32 + 16))).toBeNull();
  });

  it('toggles the whole group, and keeps only the locks of doors that still stand', () => {
    const inside = centeredAt(4 * 32 + 16, 6 * 32 + 16);
    const locked = toggleDoorLock(DOUBLE, WIDTH, new Set(), inside);
    expect(locked).toEqual(new Set([at(4, 6), at(5, 6)]));
    expect(toggleDoorLock(DOUBLE, WIDTH, locked!, inside)).toEqual(new Set());
    expect(toggleDoorLock(DOUBLE, WIDTH, new Set(), centeredAt(4 * 32 + 16, 5 * 32 + 16))).toBeNull();
    expect(liveDoorLocks([door(4, 6, 0)], locked!)).toEqual(new Set([at(4, 6)]));
    expect(liveDoorLocks([{ index: at(5, 6), piece: 'chair-wood', rotation: 0 }], locked!)).toEqual(new Set());
  });

  it('writes the locks as sorted anchors joined by commas, and reads them back', () => {
    expect(encodeDoorLocks(new Set([at(5, 6), at(4, 6)]))).toBe(`${at(4, 6)},${at(5, 6)}`);
    expect(encodeDoorLocks(new Set())).toBe('');
    expect(decodeDoorLocks(`${at(4, 6)},${at(5, 6)}`)).toEqual(new Set([at(4, 6), at(5, 6)]));
    expect(decodeDoorLocks('')).toEqual(new Set());
    expect(decodeDoorLocks('4,x')).toBeNull();
    expect(decodeDoorLocks(7)).toBeNull();
  });

  it('refuses a body center crossing a locked edge from outside to inside, never leaving or passing beside it', () => {
    const leaves = doorLeaves(DOUBLE, WIDTH);
    const locked = new Set([at(4, 6), at(5, 6)]);
    const edgeY = 6 * 32;
    expect(crossesLockedDoor(leaves, locked, { x: 144, y: edgeY - 10 }, { x: 144, y: edgeY + 4 })).toBe(true);
    expect(crossesLockedDoor(leaves, locked, { x: 176, y: edgeY }, { x: 176, y: edgeY + 1 })).toBe(true);
    expect(crossesLockedDoor(leaves, locked, { x: 144, y: edgeY + 4 }, { x: 144, y: edgeY - 10 })).toBe(false);
    expect(crossesLockedDoor(leaves, locked, { x: 144, y: edgeY - 10 }, { x: 144, y: edgeY - 1 })).toBe(false);
    expect(crossesLockedDoor(leaves, locked, { x: 220, y: edgeY - 10 }, { x: 220, y: edgeY + 10 })).toBe(false);
    expect(crossesLockedDoor(leaves, new Set(), { x: 144, y: edgeY - 10 }, { x: 144, y: edgeY + 4 })).toBe(false);
    const west = doorLeaves([door(7, 2, 270)], WIDTH);
    expect(crossesLockedDoor(west, new Set([at(7, 2)]), { x: 7 * 32 + 5, y: 80 }, { x: 7 * 32 - 5, y: 80 })).toBe(true);
    expect(crossesLockedDoor(west, new Set([at(7, 2)]), { x: 7 * 32 - 5, y: 80 }, { x: 7 * 32 + 5, y: 80 })).toBe(false);
  });

  it('names the locked leaves that bar an avatar standing outside them: their opening and inside tile', () => {
    const leaves = doorLeaves(DOUBLE, WIDTH);
    const locked = new Set([at(4, 6)]);
    expect(lockedDoorBarriers(leaves, locked, centeredAt(144, 6 * 32 - 20))).toEqual([
      { index: at(4, 6), rect: { x: 128, y: 6 * 32 - 8, w: 32, h: 16 }, inside: { tx: 4, ty: 6 } },
    ]);
    expect(lockedDoorBarriers(leaves, locked, centeredAt(144, 6 * 32 + 20))).toEqual([]);
  });

  it('opens a locked leaf only for avatars on its inside, and swings it outward (S13, S14)', () => {
    const leaves = doorLeaves([door(4, 6, 0)], WIDTH);
    const locked = new Set([at(4, 6)]);
    expect(openDoorLeaves(leaves, [centeredAt(144, 6 * 32 - 10)], locked)).toEqual(new Map());
    expect(openDoorLeaves(leaves, [centeredAt(144, 6 * 32 + 10)], locked)).toEqual(new Map([[at(4, 6), 'outside']]));
    // A swing remembered from before the lock never turns it into the one who is inside.
    expect(openDoorLeaves(leaves, [centeredAt(144, 6 * 32 + 10)], locked, new Map([[at(4, 6), 'inside']]))).toEqual(new Map([[at(4, 6), 'outside']]));
    expect(openDoorLeaves(leaves, [centeredAt(144, 6 * 32 - 10)])).toEqual(new Map([[at(4, 6), 'inside']]));
  });
});

describe('officeDoors: rooms close the walls (#223, S16)', () => {
  const room = ring(3, 2, 8, 6);

  it('takes a door between posts of two materials when it closes a room', () => {
    const mixed = ring(3, 2, 8, 6, 'wall-brick', { '4,2': 'wall-plaster', '5,2': 'wall-glass' });
    expect(doorOnWall(mixed, door(4, 2, 0))).toBe(true);
    // Different materials on both ends of the edge: still one wall.
    expect(doorOnWall(ring(3, 2, 8, 6, 'wall-stone', { '5,2': 'wall-plaster' }), door(4, 2, 0))).toBe(true);
  });

  it('refuses a door when neither side is a closed room', () => {
    // An open wall, a ring with a missing post, and a wall across the whole map: every side reaches the map border.
    expect(doorOnWall(wallGrid([[3, 2], [4, 2], [5, 2], [6, 2]]), door(4, 2, 0))).toBe(false);
    const gap = ring(3, 2, 8, 6);
    gap.walls[at(8, 4)] = null;
    expect(doorOnWall(gap, door(4, 2, 0))).toBe(false);
    const across = wallGrid(Array.from({ length: WIDTH }, (_, x) => [x, 4] as const));
    expect(doorOnWall(across, door(4, 4, 0))).toBe(false);
  });

  it('counts a room closed on either side, and the walls of a nested room too', () => {
    // The ring closes its inside; the outside of its door reaches the border.
    expect(doorOnWall(room, door(5, 6, 0))).toBe(true);
    // An inner room inside the ring: its door has two closed sides.
    const nested = ring(3, 2, 10, 8);
    for (const [x, y] of [[5, 4], [6, 4], [7, 4], [5, 6], [6, 6], [7, 6], [5, 5], [7, 5]] as const) nested.walls[at(x, y)] = 'wall-stone';
    expect(doorOnWall(nested, door(6, 4, 0))).toBe(true);
  });

  it('does not bound a room by terrain, only by walls and doors', () => {
    // A closed ring whose edge a second door also stands on: the doors still close it.
    expect(doorOnWall(room, door(5, 2, 0))).toBe(true);
    const map = roomMap(room);
    expect(map(5, 4)).toEqual(map(4, 3));
    expect(map(5, 4)?.closed).toBe(true);
    expect(map(1, 1)?.closed).toBe(false);
    expect(map(-1, 0)).toBeNull();
    expect(map(5, 4)?.id).not.toBe(map(1, 1)?.id);
  });

  it('gives up on a region past the tile bound and calls it open', () => {
    const big = (side: number) => {
      const size = 80;
      const walls = new Array<string | null>(size * size).fill(null);
      for (let i = 0; i <= side; i += 1) for (const [x, y] of [[1 + i, 1], [1 + i, 1 + side], [1, 1 + i], [1 + side, 1 + i]]) walls[y! * size + x!] = 'wall-brick';
      return { width: size, height: size, walls };
    };
    expect(ROOM_MAX_TILES).toBe(4096);
    expect(roomMap(big(60))(10, 10)?.closed).toBe(true);
    expect(roomMap(big(65))(10, 10)?.closed).toBe(false);
  });

  it('takes the closed side as the inside, whatever the rotation', () => {
    const rooms = roomMap(room);
    const inside = (item: DecorItem) => doorInsideTile(item, WIDTH, rooms);
    // Top edge of the ring (row 2): the room lies below.
    expect(inside(door(4, 2, 0))).toEqual({ tx: 4, ty: 2 });
    expect(inside(door(4, 2, 180))).toEqual({ tx: 4, ty: 2 });
    // Bottom edge (row 6): the room lies above.
    expect(inside(door(4, 6, 0))).toEqual({ tx: 4, ty: 5 });
    expect(inside(door(4, 6, 180))).toEqual({ tx: 4, ty: 5 });
    // Left (col 3) and right (col 8) edges.
    expect(inside(door(3, 3, 90))).toEqual({ tx: 3, ty: 3 });
    expect(inside(door(3, 3, 270))).toEqual({ tx: 3, ty: 3 });
    expect(inside(door(8, 3, 90))).toEqual({ tx: 7, ty: 3 });
    expect(inside(door(8, 3, 270))).toEqual({ tx: 7, ty: 3 });
    // The leaf is drawn and guarded the same way: its rotation faces the room.
    expect(doorLeaves([door(4, 6, 0)], WIDTH, rooms)[0]).toMatchObject({ rotation: 180, placed: 0 });
    expect(doorLeaves([door(4, 2, 0)], WIDTH, rooms)[0]).toMatchObject({ rotation: 0, placed: 0 });
  });

  it('lets the rotation break the tie when both sides are closed, and decides it when neither is', () => {
    const nested = ring(3, 2, 10, 8);
    for (const [x, y] of [[5, 4], [6, 4], [7, 4], [5, 6], [6, 6], [7, 6], [5, 5], [7, 5]] as const) nested.walls[at(x, y)] = 'wall-stone';
    const rooms = roomMap(nested);
    expect(doorInsideTile(door(6, 4, 0), WIDTH, rooms)).toEqual({ tx: 6, ty: 4 });
    expect(doorInsideTile(door(6, 4, 180), WIDTH, rooms)).toEqual({ tx: 6, ty: 3 });
    const open = roomMap(wallGrid([[4, 6], [5, 6]]));
    expect(doorInsideTile(door(4, 6, 180), WIDTH, open)).toEqual({ tx: 4, ty: 5 });
    expect(doorLeaves([door(4, 6, 180)], WIDTH, open)[0]!.room).toBeNull();
  });

  it('knows the doors of one room by its id, and not the doors of another', () => {
    const leaves = doorLeaves([door(4, 2, 0), door(3, 4, 90), door(4, 6, 0)], WIDTH, roomMap(room));
    expect(new Set(leaves.map((leaf) => leaf.room)).size).toBe(1);
    expect(leaves[0]!.room).not.toBeNull();
  });
});

describe('officeDoors: one lock for the room (#223, S16)', () => {
  const centeredAt = (cx: number, cy: number) => {
    const body = physicalBodyRect({ x: 0, y: 0 });
    return { x: cx - (body.x + body.width / 2), y: cy - (body.y + body.height / 2) };
  };
  const grid = ring(3, 2, 8, 6);
  const rooms = roomMap(grid);
  // Three doors of the room, turned any way: the north one (4, 2), the west one (3, 4) and the south one (6, 6).
  const DOORS: DecorItem[] = [door(4, 2, 180), door(3, 4, 270), door(6, 6, 0)];
  const all = new Set(DOORS.map((item) => item.index));
  const nextToNorth = centeredAt(4 * 32 + 16, 2 * 32 + 16);

  it('locks every door of the room from inside any of them, and unlocks them all at once', () => {
    const locked = toggleDoorLock(DOORS, WIDTH, new Set(), nextToNorth, rooms);
    expect(locked).toEqual(all);
    expect(toggleDoorLock(DOORS, WIDTH, locked!, centeredAt(5 * 32 + 16, 4 * 32 + 16), rooms)).toBeNull();
    expect(toggleDoorLock(DOORS, WIDTH, locked!, centeredAt(3 * 32 + 16, 4 * 32 + 16), rooms)).toEqual(new Set());
    // One lock left means unlock: a door locked alone is not a locked room.
    expect(toggleDoorLock(DOORS, WIDTH, new Set([DOORS[2]!.index]), nextToNorth, rooms)).toEqual(new Set());
  });

  it('ignores X from outside the room, and from inside but away from every door', () => {
    expect(doorLockGroup(DOORS, WIDTH, centeredAt(4 * 32 + 16, 1 * 32 + 16), rooms)).toBeNull();
    expect(doorLockGroup(DOORS, WIDTH, centeredAt(5 * 32 + 16, 4 * 32 + 16), rooms)).toBeNull();
    expect(new Set(doorLockGroup(DOORS, WIDTH, nextToNorth, rooms))).toEqual(all);
  });

  it('leaves the doors of another room alone', () => {
    const both = ring(3, 2, 8, 6);
    const neighbor = ring(10, 6, 11, 9);
    neighbor.walls.forEach((wall, tile) => {
      if (wall != null) both.walls[tile] = wall;
    });
    const map = roomMap(both);
    const items = [door(4, 2, 0), door(10, 6, 0)];
    expect(doorLockGroup(items, WIDTH, nextToNorth, map)).toEqual([at(4, 2)]);
    expect(toggleDoorLock(items, WIDTH, new Set([at(4, 2)]), centeredAt(10 * 32 + 16, 6 * 32 + 16), map)).toEqual(new Set([at(4, 2), at(10, 6)]));
  });

  it('refuses walking into the room through any locked door from outside, and lets people leave', () => {
    const leaves = doorLeaves(DOORS, WIDTH, rooms);
    // North (rotation 180 stored, the room lies below), west and south doors.
    const north = { x: 4 * 32 + 16, y: 2 * 32 };
    expect(crossesLockedDoor(leaves, all, { x: north.x, y: north.y - 10 }, { x: north.x, y: north.y + 4 })).toBe(true);
    expect(crossesLockedDoor(leaves, all, { x: north.x, y: north.y + 4 }, { x: north.x, y: north.y - 10 })).toBe(false);
    const west = { x: 3 * 32, y: 4 * 32 + 16 };
    expect(crossesLockedDoor(leaves, all, { x: west.x - 10, y: west.y }, { x: west.x + 4, y: west.y })).toBe(true);
    expect(crossesLockedDoor(leaves, all, { x: west.x + 4, y: west.y }, { x: west.x - 10, y: west.y })).toBe(false);
    const south = { x: 6 * 32 + 16, y: 6 * 32 };
    expect(crossesLockedDoor(leaves, all, { x: south.x, y: south.y + 10 }, { x: south.x, y: south.y - 4 })).toBe(true);
    expect(crossesLockedDoor(leaves, all, { x: south.x, y: south.y - 4 }, { x: south.x, y: south.y + 10 })).toBe(false);
    // An unlocked room lets everyone in.
    expect(crossesLockedDoor(leaves, new Set(), { x: south.x, y: south.y + 10 }, { x: south.x, y: south.y - 4 })).toBe(false);
  });

  it('falls back to the rotation and to the double door when an edit opens the room', () => {
    // A post of the ring is gone: no closed room is left, doors keep their stored rotation and lock as one run.
    const broken = ring(3, 2, 8, 6);
    broken.walls[at(8, 4)] = null;
    const open = roomMap(broken);
    const items = [door(4, 2, 180), door(5, 2, 180)];
    expect(doorLeaves(items, WIDTH, open).map((leaf) => [leaf.rotation, leaf.room])).toEqual([[180, null], [180, null]]);
    expect(doorLockGroup(items, WIDTH, centeredAt(4 * 32 + 16, 1 * 32 + 16), open)).toEqual([at(4, 2), at(5, 2)]);
    expect(doorLockGroup(items, WIDTH, nextToNorth, open)).toBeNull();
  });
});
