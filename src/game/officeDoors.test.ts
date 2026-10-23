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
  encodeDoorLocks,
  isDoorPiece,
  liveDoorLocks,
  lockedDoorBarriers,
  openDoorLeaves,
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

  it('stands on a wall only between two joined posts: both standing and of the same material', () => {
    expect(doorOnWall(wallGrid([[4, 6], [5, 6]]), door(4, 6, 0))).toBe(true);
    expect(doorOnWall(wallGrid([[4, 6], [4, 7]]), door(4, 6, 270))).toBe(true);
    expect(doorOnWall(wallGrid([[4, 6]]), door(4, 6, 0))).toBe(false);
    expect(doorOnWall(wallGrid([[4, 6], [5, 6, 'wall-glass']]), door(4, 6, 0))).toBe(false);
    // A vertical wall does not hold a horizontal door.
    expect(doorOnWall(wallGrid([[4, 6], [4, 7]]), door(4, 6, 0))).toBe(false);
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

  it('opens a leaf while an avatar stands on its tiles or within a few pixels of them, and closes it otherwise', () => {
    const leaves = doorLeaves([door(4, 6, 0)], WIDTH);
    // The door's tiles are (4, 5) and (4, 6): x 128..160, y 160..224.
    expect(openDoorLeaves(leaves, [])).toEqual(new Set());
    expect(openDoorLeaves(leaves, [standingAt(144, 200)])).toEqual(new Set([at(4, 6)]));
    expect(openDoorLeaves(leaves, [standingAt(144, 170)])).toEqual(new Set([at(4, 6)]));
    const body = physicalBodyRect({ x: 0, y: 0 });
    // Just within reach below the door, then just beyond it.
    expect(openDoorLeaves(leaves, [standingAt(144, 224 + DOOR_OPEN_REACH_PX - 1 + body.height / 2)])).toEqual(new Set([at(4, 6)]));
    expect(openDoorLeaves(leaves, [standingAt(144, 224 + DOOR_OPEN_REACH_PX + body.height / 2)])).toEqual(new Set());
    expect(openDoorLeaves(leaves, [standingAt(300, 300)])).toEqual(new Set());
  });

  it('opens both leaves of a double door together, never the next pair of the run', () => {
    const leaves = doorLeaves([door(1, 6), door(2, 6), door(3, 6), door(4, 6)], WIDTH);
    expect(openDoorLeaves(leaves, [standingAt(1 * 32 + 16, 6 * 32 + 16)])).toEqual(new Set([at(1, 6), at(2, 6)]));
    expect(openDoorLeaves(leaves, [standingAt(4 * 32 + 16, 6 * 32 + 16)])).toEqual(new Set([at(3, 6), at(4, 6)]));
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

  it('opens a locked leaf only for avatars on its inside', () => {
    const leaves = doorLeaves([door(4, 6, 0)], WIDTH);
    const locked = new Set([at(4, 6)]);
    expect(openDoorLeaves(leaves, [centeredAt(144, 6 * 32 - 10)], locked)).toEqual(new Set());
    expect(openDoorLeaves(leaves, [centeredAt(144, 6 * 32 + 10)], locked)).toEqual(new Set([at(4, 6)]));
    expect(openDoorLeaves(leaves, [centeredAt(144, 6 * 32 - 10)])).toEqual(new Set([at(4, 6)]));
  });
});
