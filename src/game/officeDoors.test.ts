import { describe, expect, it } from 'vitest';
import { physicalBodyRect } from './avatarGeometry';
import type { DecorItem } from './officeDecor';
import {
  DOOR_OPEN_REACH_PX,
  DOOR_HOLD_MS,
  DOOR_SWING_MS,
  doorEdge,
  doorEdges,
  doorEndPosts,
  doorLeaves,
  doorOnWall,
  doorOpenings,
  doorPostSet,
  doorSpan,
  doorSwingRotation,
  doorStepOf,
  isDoorPiece,
  keptSwings,
  moveDoors,
  openDoorLeaves,
} from './officeDoors';

const WIDTH = 12;
const HEIGHT = 10;
const at = (tx: number, ty: number): number => ty * WIDTH + tx;
const door = (tx: number, ty: number, rotation: DecorItem['rotation'] = 0, piece = 'door-wood'): DecorItem => ({ index: at(tx, ty), piece, rotation });
const doubleDoor = (tx: number, ty: number, rotation: DecorItem['rotation'] = 0): DecorItem => door(tx, ty, rotation, 'door-wood-double');

/** A wall grid with `piece` posts on the given vertices. */
function wallGrid(posts: readonly (readonly [number, number, string?])[]) {
  const walls = new Array<string | null>(WIDTH * HEIGHT).fill(null);
  for (const [tx, ty, piece] of posts) walls[at(tx, ty)] = piece ?? 'wall-brick';
  return { width: WIDTH, height: HEIGHT, walls };
}

/** A network position whose body center is at (cx, cy). */
const standingAt = (cx: number, cy: number) => {
  const body = physicalBodyRect({ x: 0, y: 0 });
  return { x: cx - (body.x + body.width / 2), y: cy - (body.y + body.height / 2) };
};

describe('officeDoors: the line a door stands on (#223, #233)', () => {
  it('knows a door by its id, single or double', () => {
    expect(isDoorPiece('door-wood')).toBe(true);
    expect(isDoorPiece('door-wood-double')).toBe(true);
    expect(isDoorPiece('desk-wood')).toBe(false);
  });

  it('spans 2 tiles of wall for a door and 4 for a double door', () => {
    expect(doorSpan(door(0, 0))).toBe(2);
    expect(doorSpan(doubleDoor(0, 0))).toBe(4);
  });

  it('starts on the top edge of its anchor tile for 0 and 180, on the left edge for 90 and 270', () => {
    expect(doorEdge(door(4, 6, 0), WIDTH)).toEqual({ col: 4, row: 6, axis: 'horizontal' });
    expect(doorEdge(door(4, 6, 180), WIDTH)).toEqual({ col: 4, row: 6, axis: 'horizontal' });
    expect(doorEdge(door(4, 6, 90), WIDTH)).toEqual({ col: 4, row: 6, axis: 'vertical' });
    expect(doorEdge(door(4, 6, 270), WIDTH)).toEqual({ col: 4, row: 6, axis: 'vertical' });
  });

  it('runs its span along the line, west to east or north to south', () => {
    expect(doorEdges(door(4, 6, 0), WIDTH)).toEqual([
      { col: 4, row: 6, axis: 'horizontal' },
      { col: 5, row: 6, axis: 'horizontal' },
    ]);
    expect(doorEdges(doubleDoor(4, 6, 90), WIDTH).map(({ row }) => row)).toEqual([6, 7, 8, 9]);
  });

  it('ends on the two posts at the ends of its span, the start first', () => {
    expect(doorEndPosts(door(4, 6, 0), WIDTH)).toEqual([at(4, 6), at(6, 6)]);
    expect(doorEndPosts(door(4, 6, 90), WIDTH)).toEqual([at(4, 6), at(4, 8)]);
    expect(doorEndPosts(doubleDoor(2, 6, 0), WIDTH)).toEqual([at(2, 6), at(6, 6)]);
  });

  it('goes between two standing posts and needs no wall between them', () => {
    expect(doorOnWall(wallGrid([[4, 6], [6, 6]]), door(4, 6, 0))).toBe(true);
    expect(doorOnWall(wallGrid([[4, 6], [4, 8]]), door(4, 6, 90))).toBe(true);
    expect(doorOnWall(wallGrid([[2, 6], [6, 6]]), doubleDoor(2, 6, 0))).toBe(true);
  });

  it('takes posts of any material, with any wall around them: a straight wall, a corner or an L', () => {
    expect(doorOnWall(wallGrid([[4, 6, 'wall-brick'], [5, 6], [6, 6, 'wall-stone']]), door(4, 6, 0))).toBe(true);
    // Both ends are corners: walls turn away from the line at each one.
    expect(doorOnWall(wallGrid([[4, 6], [4, 3], [6, 6], [6, 9]]), door(4, 6, 0))).toBe(true);
  });

  it('refuses a door that lacks a post at either end, or whose span leaves the map', () => {
    expect(doorOnWall(wallGrid([[4, 6]]), door(4, 6, 0))).toBe(false);
    expect(doorOnWall(wallGrid([[6, 6]]), door(4, 6, 0))).toBe(false);
    expect(doorOnWall(wallGrid([]), door(4, 6, 0))).toBe(false);
    // Posts one tile short of a double door's far end.
    expect(doorOnWall(wallGrid([[2, 6], [5, 6]]), doubleDoor(2, 6, 0))).toBe(false);
    expect(doorOnWall(wallGrid([[WIDTH - 2, 6]]), door(WIDTH - 2, 6, 0))).toBe(false);
  });

  it('opens every edge of every door of the layer, and of nothing else', () => {
    const items: DecorItem[] = [door(4, 6, 0), { index: at(0, 0), piece: 'desk-wood', rotation: 0 }, doubleDoor(2, 2, 90)];
    expect(doorOpenings(items, WIDTH)).toEqual([
      { col: 4, row: 6, axis: 'horizontal' },
      { col: 5, row: 6, axis: 'horizontal' },
      { col: 2, row: 2, axis: 'vertical' },
      { col: 2, row: 3, axis: 'vertical' },
      { col: 2, row: 4, axis: 'vertical' },
      { col: 2, row: 5, axis: 'vertical' },
    ]);
    expect(doorOpenings([{ index: at(0, 0), piece: 'desk-wood', rotation: 0 }], WIDTH)).toEqual([]);
  });

  it('protects only the two end posts of a door from being removed', () => {
    expect(doorPostSet([door(4, 6, 0)], WIDTH)).toEqual(new Set([at(4, 6), at(6, 6)]));
    expect(doorPostSet([doubleDoor(2, 6, 0)], WIDTH)).toEqual(new Set([at(2, 6), at(6, 6)]));
  });
});

describe('officeDoors: leaves (#223, #233)', () => {
  it('makes one leaf per door item, a double door included, hinged at its start', () => {
    const leaves = doorLeaves([door(4, 6, 0), doubleDoor(2, 2, 90)], WIDTH);
    expect(leaves).toEqual([
      expect.objectContaining({ index: at(4, 6), span: 2, hinge: 'start', edge: { col: 4, row: 6, axis: 'horizontal' } }),
      expect.objectContaining({ index: at(2, 2), span: 4, hinge: 'start', edge: { col: 2, row: 2, axis: 'vertical' } }),
    ]);
  });

  it('does not join neighbouring doors: each stays its own leaf', () => {
    const leaves = doorLeaves([door(4, 6, 0), door(6, 6, 0)], WIDTH);
    expect(leaves.map(({ index }) => index)).toEqual([at(4, 6), at(6, 6)]);
  });

  it('covers a tile on each side of its span', () => {
    expect(doorLeaves([door(4, 6, 0)], WIDTH)[0]!.footprint).toEqual({ x: 4, y: 5, w: 2, h: 2 });
    expect(doorLeaves([doubleDoor(4, 6, 90)], WIDTH)[0]!.footprint).toEqual({ x: 3, y: 6, w: 2, h: 4 });
  });
});

describe('officeDoors: open and closed (#223, #233)', () => {
  /** The anchors open, whatever side they swing to. */
  const openAnchors = (...args: Parameters<typeof openDoorLeaves>) => new Set(openDoorLeaves(...args).keys());

  it('opens a door while an avatar is lined up with its span and on its tiles or a few pixels past them, and closes it otherwise', () => {
    const leaves = doorLeaves([door(4, 6, 0)], WIDTH);
    // The door's tiles are (4..5, 5..6): x 128..192, y 160..224.
    expect(openAnchors(leaves, [])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(160, 200)])).toEqual(new Set([at(4, 6)]));
    expect(openAnchors(leaves, [standingAt(184, 170)])).toEqual(new Set([at(4, 6)]));
    expect(openAnchors(leaves, [standingAt(160, 224 + DOOR_OPEN_REACH_PX - 1)])).toEqual(new Set([at(4, 6)]));
    expect(openAnchors(leaves, [standingAt(160, 224 + DOOR_OPEN_REACH_PX)])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(300, 300)])).toEqual(new Set());
  });

  it('stays shut for an avatar walking past alongside the wall, outside the door span', () => {
    const leaves = doorLeaves([door(4, 6, 0)], WIDTH);
    expect(openAnchors(leaves, [standingAt(128 - 1, 6 * 32 - 10)])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(192, 6 * 32 - 10)])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(128, 6 * 32 - 10)])).toEqual(new Set([at(4, 6)]));
    expect(openAnchors(leaves, [standingAt(191, 6 * 32 - 10)])).toEqual(new Set([at(4, 6)]));
  });

  it('opens a double door over its whole 4-tile span as one door', () => {
    const leaves = doorLeaves([doubleDoor(4, 6, 0)], WIDTH);
    expect(openAnchors(leaves, [standingAt(4 * 32 + 8, 6 * 32 - 10)])).toEqual(new Set([at(4, 6)]));
    expect(openAnchors(leaves, [standingAt(8 * 32 - 8, 6 * 32 + 10)])).toEqual(new Set([at(4, 6)]));
    expect(openAnchors(leaves, [standingAt(8 * 32, 6 * 32 - 10)])).toEqual(new Set());
  });

  it('swings away from the side the avatar comes from, whatever way the door was placed', () => {
    for (const rotation of [0, 180] as const) {
      const leaves = doorLeaves([door(4, 6, rotation)], WIDTH);
      const above = openDoorLeaves(leaves, [standingAt(160, 6 * 32 - 10)]).get(at(4, 6));
      const below = openDoorLeaves(leaves, [standingAt(160, 6 * 32 + 10)]).get(at(4, 6));
      expect(above).not.toBe(below);
    }
    const down = doorLeaves([door(4, 6, 0)], WIDTH);
    expect(openDoorLeaves(down, [standingAt(160, 6 * 32 + 10)]).get(at(4, 6))).toBe('outside');
    expect(openDoorLeaves(down, [standingAt(160, 6 * 32 - 10)]).get(at(4, 6))).toBe('inside');
  });

  it('draws the swing the other way round by turning the leaf half a turn', () => {
    expect(doorSwingRotation(0, 'inside')).toBe(0);
    expect(doorSwingRotation(0, 'outside')).toBe(180);
    expect(doorSwingRotation(270, 'outside')).toBe(90);
  });

  it('keeps the swing while the avatar passes the edge line, and drops it when the door closes', () => {
    const leaves = doorLeaves([door(4, 6, 0)], WIDTH);
    const first = openDoorLeaves(leaves, [standingAt(160, 6 * 32 - 10)]);
    const crossing = openDoorLeaves(leaves, [standingAt(160, 6 * 32 + 10)], first);
    expect(crossing.get(at(4, 6))).toBe(first.get(at(4, 6)));
    expect(openDoorLeaves(leaves, [], crossing).size).toBe(0);
  });

  it('keeps the swing it has when two avatars come from opposite sides, else the first one to open', () => {
    const leaves = doorLeaves([door(4, 6, 0)], WIDTH);
    const both = [standingAt(160, 6 * 32 - 10), standingAt(160, 6 * 32 + 10)];
    const fresh = openDoorLeaves(leaves, both).get(at(4, 6));
    expect(fresh).toBe(openDoorLeaves(leaves, [both[0]!]).get(at(4, 6)));
    const kept = openDoorLeaves(leaves, both, new Map([[at(4, 6), fresh === 'inside' ? 'outside' : 'inside']])).get(at(4, 6));
    expect(kept).not.toBe(fresh);
  });
});

describe('officeDoors: the swing (#233)', () => {
  const opening = new Map([[7, 'inside' as const]]);

  it('opens a door a fraction per frame, up to fully open, and no further', () => {
    const half = moveDoors(opening, new Map(), DOOR_SWING_MS / 2);
    expect(half.get(7)).toEqual({ swing: 'inside', progress: 0.5, hold: DOOR_HOLD_MS });
    expect(moveDoors(opening, half, DOOR_SWING_MS * 5).get(7)).toEqual({ swing: 'inside', progress: 1, hold: DOOR_HOLD_MS });
  });

  it('closes a door that nobody is lined up with the same way, and forgets it once shut', () => {
    const open = new Map([[7, { swing: 'outside' as const, progress: 1, hold: 0 }]]);
    const closing = moveDoors(new Map(), open, DOOR_SWING_MS / 4);
    expect(closing.get(7)).toEqual({ swing: 'outside', progress: 0.75, hold: 0 });
    expect(moveDoors(new Map(), closing, DOOR_SWING_MS).has(7)).toBe(false);
  });

  it('keeps the side it swings to while it shows a swung frame, then takes the one of whoever opens it next', () => {
    const closing = new Map([[7, { swing: 'outside' as const, progress: 0.5, hold: 0 }]]);
    expect(moveDoors(opening, closing, 0).get(7)?.swing).toBe('outside');
    // Drawn shut already (the closed frame is the same from both sides), though not quite at rest.
    expect(moveDoors(opening, new Map([[7, { swing: 'outside' as const, progress: 0.1, hold: 0 }]]), 0).get(7)?.swing).toBe('inside');
    expect(moveDoors(opening, new Map(), 0).get(7)?.swing).toBe('inside');
  });

  it('holds a fully open door open for DOOR_HOLD_MS once nobody is lined up with it, then closes it', () => {
    expect(DOOR_HOLD_MS).toBe(360);
    const open = new Map([[7, { swing: 'inside' as const, progress: 1, hold: DOOR_HOLD_MS }]]);
    const waiting = moveDoors(new Map(), open, 300);
    expect(waiting.get(7)).toEqual({ swing: 'inside', progress: 1, hold: 60 });
    // The rest of the frame that ends the hold already closes it.
    expect(moveDoors(new Map(), waiting, 60 + DOOR_SWING_MS / 2).get(7)).toEqual({ swing: 'inside', progress: 0.5, hold: 0 });
  });

  it('starts the hold when it reaches fully open, and renews it for as long as someone stays lined up', () => {
    const arriving = moveDoors(opening, new Map([[7, { swing: 'inside' as const, progress: 0.9, hold: 0 }]]), DOOR_SWING_MS);
    expect(arriving.get(7)).toEqual({ swing: 'inside', progress: 1, hold: DOOR_HOLD_MS });
    const used = new Map([[7, { swing: 'inside' as const, progress: 1, hold: 100 }]]);
    expect(moveDoors(opening, used, 20).get(7)?.hold).toBe(DOOR_HOLD_MS);
  });

  it('lets a door that is not yet wide open when nobody is lined up finish opening, wait, and close', () => {
    const partway = new Map([[7, { swing: 'inside' as const, progress: 0.5, hold: DOOR_HOLD_MS }]]);
    // Half a swing to go, then the whole hold, then a quarter of the closing, all in one frame.
    const frame = moveDoors(new Map(), partway, DOOR_SWING_MS / 2 + DOOR_HOLD_MS + DOOR_SWING_MS / 4);
    expect(frame.get(7)).toEqual({ swing: 'inside', progress: 0.75, hold: 0 });
    expect(moveDoors(new Map(), partway, DOOR_SWING_MS / 4).get(7)).toEqual({ swing: 'inside', progress: 0.75, hold: DOOR_HOLD_MS });
  });

  it('closes a door that was already closing without waiting, and opens it again if someone comes back', () => {
    const closing = new Map([[7, { swing: 'inside' as const, progress: 0.5, hold: 0 }]]);
    expect(moveDoors(new Map(), closing, DOOR_SWING_MS / 4).get(7)).toEqual({ swing: 'inside', progress: 0.25, hold: 0 });
    expect(moveDoors(opening, closing, DOOR_SWING_MS / 4).get(7)).toEqual({ swing: 'inside', progress: 0.75, hold: DOOR_HOLD_MS });
  });

  it('commits a door to its side only while it shows a swung frame', () => {
    const motion = new Map([
      [1, { swing: 'outside' as const, progress: 0.5, hold: 0 }],
      [2, { swing: 'inside' as const, progress: 0.1, hold: 0 }],
    ]);
    expect(keptSwings(motion)).toEqual(new Map([[1, 'outside']]));
  });

  it('moves every door on its own', () => {
    const next = moveDoors(new Map([[1, 'inside' as const]]), new Map([[2, { swing: 'inside' as const, progress: 1, hold: 0 }]]), DOOR_SWING_MS / 2);
    expect(next.get(1)?.progress).toBe(0.5);
    expect(next.get(2)?.progress).toBe(0.5);
  });

  it('draws the frame nearest to the swing: closed, two between, open', () => {
    expect([0, 0.1, 0.2, 0.5, 0.84, 1].map(doorStepOf)).toEqual([0, 0, 1, 2, 3, 3]);
  });
});
