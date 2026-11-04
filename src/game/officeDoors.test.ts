import { describe, expect, it } from 'vitest';
import { physicalBodyRect } from './avatarGeometry';
import type { DecorItem } from './officeDecor';
import {
  DOOR_OPEN_REACH_PX,
  DOOR_HOLD_MS,
  DOOR_SWING_MS,
  decorPieceTurns,
  doorEndPosts,
  doorFarSide,
  doorHingeStops,
  doorLeaves,
  doorLine,
  doorOnWall,
  doorOpenings,
  doorOwnWallTiles,
  doorPosts,
  doorPostSet,
  doorsReplacedBy,
  doorSpan,
  doorStepOf,
  doorSwingRotation,
  doorTiles,
  isDoorPiece,
  isWindowPiece,
  keptSwings,
  moveDoors,
  openDoorLeaves,
  wallTilesAfter,
  withReplacedDoors,
} from './officeDoors';

const T = 32;
const WIDTH = 14;
const HEIGHT = 14;
const at = (tx: number, ty: number): number => ty * WIDTH + tx;
const door = (tx: number, ty: number, rotation: DecorItem['rotation'] = 0, piece = 'door-wood'): DecorItem => ({ index: at(tx, ty), piece, rotation });
const doubleDoor = (tx: number, ty: number, rotation: DecorItem['rotation'] = 0): DecorItem => door(tx, ty, rotation, 'door-wood-double');
const windowAt = (tx: number, ty: number, rotation: DecorItem['rotation'] = 0): DecorItem => door(tx, ty, rotation, 'door-glass-window');

/** A wall grid with `piece` walls on the given tiles. */
function wallGrid(tiles: readonly (readonly [number, number, string?])[]) {
  const walls = new Array<string | null>(WIDTH * HEIGHT).fill(null);
  for (const [tx, ty, piece] of tiles) walls[at(tx, ty)] = piece ?? 'wall-brick';
  return { width: WIDTH, height: HEIGHT, walls };
}

/** A horizontal run on row 3 (columns 1..9, stone from 6 on) and a vertical one in column 11 (rows 2..10). */
const RUN: (readonly [number, number, string?])[] = [
  ...[1, 2, 3, 4, 5].map((tx) => [tx, 3] as const),
  ...[6, 7, 8, 9].map((tx) => [tx, 3, 'wall-stone'] as const),
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((ty) => [11, ty] as const),
];
const grid = wallGrid(RUN);

/** A network position whose body center is at (cx, cy). */
const standingAt = (cx: number, cy: number) => {
  const body = physicalBodyRect({ x: 0, y: 0 });
  return { x: cx - (body.x + body.width / 2), y: cy - (body.y + body.height / 2) };
};

describe('officeDoors: doors and windows in tile walls (tile walls, S7-S10)', () => {
  it('never turns a window, which only stands horizontal, and turns doors and chairs as their kind does (S8, L23)', () => {
    expect(decorPieceTurns('door-glass-window', 'door')).toBe(false);
    expect(decorPieceTurns('door-wood', 'door')).toBe(true);
    expect(decorPieceTurns('chair-wood', 'chair')).toBe(true);
    // A plant turns to its mirror (#121).
    expect(decorPieceTurns('plant-ficus', 'plant')).toBe(true);
  });

  it('never lets a window take the place of another window it overlaps, while doors and windows still replace each other (S6, L23)', () => {
    const window = windowAt(4, 3);
    expect(doorsReplacedBy([window], [windowAt(5, 3)], WIDTH)).toEqual([]);
    expect(doorsReplacedBy([window], [door(5, 3, 0)], WIDTH)).toEqual([window.index]);
    expect(doorsReplacedBy([door(4, 3, 0)], [windowAt(5, 3)], WIDTH)).toEqual([at(4, 3)]);
    // Side by side, nothing is replaced.
    expect(doorsReplacedBy([window], [windowAt(6, 3)], WIDTH)).toEqual([]);
  });

  it('knows a door by its id, single, double or a window, and a window apart', () => {
    expect(['door-wood', 'door-wood-double', 'door-glass-window', 'chair-wood'].map(isDoorPiece)).toEqual([true, true, true, false]);
    expect(['door-wood', 'door-wood-double', 'door-glass-window'].map(isWindowPiece)).toEqual([false, false, true]);
  });

  it('spans 2 wall tiles for a door or a window and 3 for a double door', () => {
    expect([door(0, 0), doubleDoor(0, 0), windowAt(0, 0)].map(doorSpan)).toEqual([2, 3, 2]);
  });

  it('runs its span from its anchor along the run, west to east or north to south, between the walls past each end', () => {
    expect(doorTiles(door(3, 3, 0), WIDTH)).toEqual([at(3, 3), at(4, 3)]);
    expect(doorTiles(doubleDoor(11, 4, 90), WIDTH)).toEqual([at(11, 4), at(11, 5), at(11, 6)]);
    expect(doorEndPosts(door(3, 3, 180), WIDTH)).toEqual([at(2, 3), at(5, 3)]);
    expect(doorPosts(door(11, 4, 270), WIDTH)).toEqual([at(11, 3), at(11, 4), at(11, 5), at(11, 6)]);
  });

  it('goes between two walls of a horizontal run, of any material, the run going on under it (S7)', () => {
    expect(doorOnWall(grid, door(3, 3, 0))).toBe(true);
    expect(doorOnWall(grid, doubleDoor(4, 3, 180))).toBe(true);
    // Brick on one side, stone on the other.
    expect(doorOnWall(grid, door(5, 3, 0))).toBe(true);
  });

  it('refuses a door or window that lacks a wall past either end or under its span, or leaves the map (S7)', () => {
    expect(doorOnWall(grid, door(1, 3, 0))).toBe(false); // nothing west of column 1
    expect(doorOnWall(grid, door(8, 3, 0))).toBe(false); // nothing east of column 9
    expect(doorOnWall(grid, door(3, 2, 0))).toBe(false); // not the run's wall tile
    expect(doorOnWall(grid, windowAt(1, 3))).toBe(false);
    const gap = wallGrid(RUN.filter(([tx, ty]) => !(tx === 4 && ty === 3)));
    expect(doorOnWall(gap, door(3, 3, 0))).toBe(false);
    expect(doorOnWall(grid, door(12, 3, 0))).toBe(false);
  });

  it('refuses a horizontal door where a wall is stacked on its columns: it stands in the face of the run', () => {
    expect(doorOnWall(wallGrid([...RUN, [3, 1]]), door(3, 3, 0))).toBe(false);
    expect(doorOnWall(wallGrid([...RUN, [4, 4]]), door(3, 3, 0))).toBe(false);
    expect(doorOnWall(wallGrid([...RUN, [2, 4]]), door(3, 3, 0))).toBe(true);
  });

  it('puts a window only between two walls of a horizontal run, never in a vertical one (S7, S8)', () => {
    expect(doorOnWall(grid, windowAt(3, 3, 0))).toBe(true);
    expect(doorOnWall(grid, windowAt(3, 3, 180))).toBe(true);
    expect(doorOnWall(grid, windowAt(11, 4, 90))).toBe(false);
    expect(doorOnWall(grid, windowAt(11, 4, 270))).toBe(false);
  });

  it('puts a door in a vertical run where it shows its dark top, above the face at its bottom (S9)', () => {
    expect(doorOnWall(grid, door(11, 4, 90))).toBe(true);
    expect(doorOnWall(grid, doubleDoor(11, 3, 270))).toBe(true);
    // Rows 9..11 are the face of the run: the door's last tile may not reach it.
    expect(doorOnWall(grid, door(11, 7, 90))).toBe(true);
    expect(doorOnWall(grid, door(11, 8, 90))).toBe(false);
    expect(doorOnWall(grid, door(11, 1, 90))).toBe(false);
  });

  it('opens the walls for every door on its wall, in layer order, and for no window nor door off its wall', () => {
    expect(doorOpenings([door(3, 3, 0), windowAt(6, 3), door(1, 3, 0), door(11, 4, 90), { index: at(2, 6), piece: 'chair-wood', rotation: 0 }], grid)).toEqual([
      { axis: 'horizontal', tx: 3, ty: 3, span: 2, inset: 10 },
      { axis: 'vertical', tx: 11, ty: 4, span: 2 },
    ]);
  });

  it('protects every wall a door or window needs from being removed: the ones it spans and the one past each end', () => {
    expect(doorPostSet([door(3, 3, 0), windowAt(7, 3)], WIDTH)).toEqual(new Set([at(2, 3), at(3, 3), at(4, 3), at(5, 3), at(6, 3), at(7, 3), at(8, 3), at(9, 3)]));
  });

  it('counts its own wall as none of the walls it must keep off: the whole column in a horizontal run, the column only in a vertical one', () => {
    expect(doorOwnWallTiles(door(3, 3, 0), WIDTH)).toEqual(new Set([at(3, 2), at(4, 2), at(3, 3), at(4, 3), at(3, 4), at(4, 4)]));
    expect(doorOwnWallTiles(door(11, 4, 90), WIDTH)).toEqual(new Set([at(11, 4), at(11, 5)]));
  });

  it('closes the wall of a door that goes for whatever takes its tiles, and keeps the ground as it is otherwise', () => {
    const openings = doorOpenings([door(3, 3, 0)], grid);
    const wallTiles = new Array<boolean>(WIDTH * HEIGHT).fill(false);
    const ground = { ...grid, openings, wallTiles };
    expect(wallTilesAfter(ground, [door(3, 3, 0)])).toBe(wallTiles);
    const closed = wallTilesAfter(ground, []);
    expect([at(3, 2), at(3, 3), at(3, 4)].map((tile) => closed[tile])).toEqual([true, true, true]);
  });
});

describe('officeDoors: a door replaces a window and the other way round (S6)', () => {
  it('replaces every door or window sharing a wall tile with the one placed, and nothing else', () => {
    const items = [windowAt(3, 3), door(6, 3, 0), { index: at(4, 6), piece: 'chair-wood', rotation: 0 as const }];
    expect(doorsReplacedBy(items, [door(4, 3, 0)], WIDTH)).toEqual([at(3, 3)]);
    expect(doorsReplacedBy(items, [windowAt(5, 3)], WIDTH)).toEqual([at(6, 3)]);
    expect(doorsReplacedBy([door(3, 3, 0)], [windowAt(3, 3)], WIDTH)).toEqual([]);
    expect(doorsReplacedBy(items, [{ index: at(4, 3), piece: 'chair-wood', rotation: 0 }], WIDTH)).toEqual([]);
  });

  it('adds the removals of what a click replaces to it, once', () => {
    const items = [windowAt(3, 3), door(7, 3, 0)];
    expect(withReplacedDoors(items, [{ index: at(4, 3), item: { piece: 'door-wood', rotation: 0 } }], WIDTH)).toEqual([
      { index: at(4, 3), item: { piece: 'door-wood', rotation: 0 } },
      { index: at(3, 3), item: null },
    ]);
    expect(withReplacedDoors(items, [{ index: at(3, 3), item: null }, { index: at(4, 3), item: { piece: 'door-wood', rotation: 0 } }], WIDTH)).toEqual([
      { index: at(3, 3), item: null },
      { index: at(4, 3), item: { piece: 'door-wood', rotation: 0 } },
    ]);
  });
});

describe('officeDoors: leaves (#223, #233)', () => {
  it('makes one leaf per door, a double door included, and none for a window', () => {
    const leaves = doorLeaves([door(3, 3, 0), windowAt(6, 3), doubleDoor(11, 3, 90)], WIDTH);
    expect(leaves).toEqual([
      expect.objectContaining({ index: at(3, 3), axis: 'horizontal', tx: 3, ty: 3, span: 2, hinge: 'start' }),
      expect.objectContaining({ index: at(11, 3), axis: 'vertical', tx: 11, ty: 3, span: 3, hinge: 'start' }),
    ]);
  });

  it('hinges a single door by its turn, at the end it points to, and a double door at its start', () => {
    const leaves = doorLeaves([door(4, 6, 0), door(4, 6, 90), door(4, 6, 180), door(4, 6, 270), doubleDoor(2, 2, 180)], WIDTH);
    expect(leaves.map(({ hinge }) => hinge)).toEqual(['start', 'end', 'end', 'start', 'start']);
  });

  it('covers the wall three tiles across a horizontal run, and the column with a tile each side in a vertical one', () => {
    const [horizontal, vertical] = doorLeaves([door(3, 3, 0), doubleDoor(11, 3, 90)], WIDTH);
    expect(horizontal!.footprint).toEqual({ x: 3, y: 2, w: 2, h: 3 });
    expect(vertical!.footprint).toEqual({ x: 10, y: 3, w: 3, h: 3 });
    expect(doorLine(horizontal!)).toBe(3.5 * T);
    expect(doorLine(vertical!)).toBe(11.5 * T);
  });
});

describe('officeDoors: open and closed (#223, #233)', () => {
  /** The anchors open, whatever side they swing to. */
  const openAnchors = (...args: Parameters<typeof openDoorLeaves>) => new Set(openDoorLeaves(...args).keys());
  // A door on row 3, columns 3..4: its wall is rows 2..4, x 96..160, y 64..160.
  const leaves = doorLeaves([door(3, 3, 0)], WIDTH);

  it('opens a door while an avatar is lined up with its span and in its wall or a few pixels past it, and closes it otherwise', () => {
    expect(openAnchors(leaves, [])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(128, 120)])).toEqual(new Set([at(3, 3)]));
    expect(openAnchors(leaves, [standingAt(128, 160 + DOOR_OPEN_REACH_PX - 1)])).toEqual(new Set([at(3, 3)]));
    expect(openAnchors(leaves, [standingAt(128, 160 + DOOR_OPEN_REACH_PX)])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(128, 64 - DOOR_OPEN_REACH_PX + 1)])).toEqual(new Set([at(3, 3)]));
    expect(openAnchors(leaves, [standingAt(300, 300)])).toEqual(new Set());
  });

  it('stays shut for an avatar walking past alongside the wall, outside the door span', () => {
    expect(openAnchors(leaves, [standingAt(96 - 1, 170)])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(160, 150)])).toEqual(new Set());
    expect(openAnchors(leaves, [standingAt(96, 150)])).toEqual(new Set([at(3, 3)]));
  });

  it('opens a door in a vertical run for an avatar beside its column', () => {
    const vertical = doorLeaves([door(11, 4, 90)], WIDTH);
    expect(openAnchors(vertical, [standingAt(10 * T + 4, 4 * T + 10)])).toEqual(new Set([at(11, 4)]));
    expect(openAnchors(vertical, [standingAt(10 * T - DOOR_OPEN_REACH_PX, 4 * T + 10)])).toEqual(new Set());
    expect(openAnchors(vertical, [standingAt(10 * T + 4, 6 * T)])).toEqual(new Set());
  });

  it('swings away from the side the avatar comes from, whatever way the door was placed', () => {
    for (const rotation of [0, 180] as const) {
      const turned = doorLeaves([door(3, 3, rotation)], WIDTH);
      const above = openDoorLeaves(turned, [standingAt(128, 70)]).get(at(3, 3));
      const below = openDoorLeaves(turned, [standingAt(128, 150)]).get(at(3, 3));
      expect(above).not.toBe(below);
    }
    expect(openDoorLeaves(leaves, [standingAt(128, 150)]).get(at(3, 3))).toBe('outside');
    expect(openDoorLeaves(leaves, [standingAt(128, 70)]).get(at(3, 3))).toBe('inside');
  });

  it('draws the swing the other way round by turning the leaf half a turn', () => {
    expect(doorSwingRotation(0, 'inside')).toBe(0);
    expect(doorSwingRotation(0, 'outside')).toBe(180);
    expect(doorSwingRotation(270, 'outside')).toBe(90);
  });

  it('keeps the swing while the avatar passes the door line, and drops it when the door closes', () => {
    const first = openDoorLeaves(leaves, [standingAt(128, 70)]);
    const crossing = openDoorLeaves(leaves, [standingAt(128, 150)], first);
    expect(crossing.get(at(3, 3))).toBe(first.get(at(3, 3)));
    expect(openDoorLeaves(leaves, [], crossing).size).toBe(0);
  });

  it('stays shut for an avatar it is kept shut for, and opens for the next one lined up with it', () => {
    const north = standingAt(128, 70);
    const south = standingAt(128, 150);
    const shutForNorth = (_leaf: unknown, position: { x: number; y: number }) => position === north;
    expect(openAnchors(leaves, [north], new Map(), shutForNorth)).toEqual(new Set());
    expect(openDoorLeaves(leaves, [north, south], new Map(), shutForNorth).get(at(3, 3))).toBe(openDoorLeaves(leaves, [south]).get(at(3, 3)));
  });
});

describe('officeDoors: where a door leads (#223)', () => {
  it('is the middle of the tile just past the wall on the other side from the body, along the body', () => {
    const [leaf] = doorLeaves([door(3, 3, 0)], WIDTH);
    expect(doorFarSide(leaf!, standingAt(110, 150))).toEqual({ x: 110, y: 1.5 * T });
    expect(doorFarSide(leaf!, standingAt(110, 70))).toEqual({ x: 110, y: 5.5 * T });
    const [vertical] = doorLeaves([door(11, 4, 90)], WIDTH);
    expect(doorFarSide(vertical!, standingAt(10 * T + 4, 150))).toEqual({ x: 12.5 * T, y: 150 });
  });

  it('is nothing for a body not lined up with the door', () => {
    const [leaf] = doorLeaves([door(3, 3, 0)], WIDTH);
    expect(doorFarSide(leaf!, standingAt(96 - 1, 120))).toBeNull();
    expect(doorFarSide(leaf!, standingAt(128, 160 + DOOR_OPEN_REACH_PX))).toBeNull();
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

describe('officeDoors: the hinge stop (#233)', () => {
  it('blocks the wall and the jamb at both ends of a single door in a horizontal run, leaving a 1.2 tile doorway, the three tiles of the wall across', () => {
    const sides = [
      { x: 3 * T, y: 2 * T, w: 13, h: 3 * T },
      { x: 5 * T - 13, y: 2 * T, w: 13, h: 3 * T },
    ];
    expect(doorHingeStops([door(3, 3, 0)], grid)).toEqual(sides);
    expect(doorHingeStops([door(3, 3, 180)], grid)).toEqual(sides);
    expect((2 * T - 2 * 13) / T).toBeCloseTo(1.2, 1);
  });

  it('blocks 16px past the hinge end of a door in a vertical run, the column across', () => {
    expect(doorHingeStops([door(11, 4, 270)], grid)).toEqual([{ x: 11 * T, y: 4 * T, w: T, h: 16 }]);
    expect(doorHingeStops([door(11, 4, 90)], grid)).toEqual([{ x: 11 * T, y: 6 * T - 16, w: T, h: 16 }]);
  });

  it('blocks past both ends of a double door, which hinges a leaf on each', () => {
    expect(doorHingeStops([doubleDoor(4, 3, 0)], grid)).toEqual([
      { x: 4 * T, y: 2 * T, w: 16, h: 3 * T },
      { x: 7 * T - 16, y: 2 * T, w: 16, h: 3 * T },
    ]);
  });

  it('adds nothing for a window, a door that is not on a wall, nor for other decor', () => {
    expect(doorHingeStops([windowAt(3, 3), door(1, 3, 0), { index: at(4, 6), piece: 'chair-wood', rotation: 0 }], grid)).toEqual([]);
  });
});
