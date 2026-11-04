/**
 * The decor editor's shared shapes and pure rules (#208): what a brush is,
 * when two are the same, which pieces fit a desk, and whether the ghost of a
 * brush on a tile is a placement the room would take.
 */

import { describe, expect, it } from 'vitest';
import {
  decorBrushTarget,
  decorColorKey,
  decorMoveEdits,
  decorOutlines,
  decorPickAt,
  decorPlacementAllowed,
  decorSizeLabel,
  fitsDeskArea,
  sameDecorBrush,
  withFallenTopItems,
  type DecorBrush,
  type DecorGround,
} from './decorEditor';
import { decorKey, type DecorItem, type DecorPieceInfo } from './officeDecor';
import { wallFootprintRects } from './officeLayout';
import { coveredTiles } from './pieceCollisions';

const CHAIR: DecorPieceInfo = { kind: 'chair', footprint: { w: 1, h: 1 } };
const DESK: DecorPieceInfo = { kind: 'desk', footprint: { w: 3, h: 1 } };
const PLANT: DecorPieceInfo = { kind: 'plant', footprint: { w: 1, h: 1 } };
const MEETING: DecorPieceInfo = { kind: 'table', footprint: { w: 7, h: 5 } };
const CAFETERIA: DecorPieceInfo = { kind: 'table', footprint: { w: 5, h: 3 } };

const infoOf = (piece: string): DecorPieceInfo | null =>
  piece.startsWith('chair-') ? CHAIR : piece.startsWith('desk-') ? DESK : piece.startsWith('plant-') ? PLANT : piece.startsWith('table-') ? MEETING : null;

const WIDTH = 10;
const HEIGHT = 8;
const at = (tx: number, ty: number): number => ty * WIDTH + tx;

/** A 10x8 lawn with water on column 0 and a wall touching tile (9, 0). */
function ground(): DecorGround {
  const walkable = Array.from({ length: WIDTH * HEIGHT }, (_, index) => index % WIDTH !== 0);
  const wallTiles = Array.from({ length: WIDTH * HEIGHT }, (_, index) => index === at(9, 0));
  return { width: WIDTH, height: HEIGHT, walkable, wallTiles };
}

const chairBrush = (rotation: 0 | 90 | 180 | 270 = 0): DecorBrush => ({ kind: 'piece', piece: 'chair-wood', info: CHAIR, rotation });
const deskBrush = (rotation: 0 | 90 | 180 | 270 = 0): DecorBrush => ({ kind: 'piece', piece: 'desk-wood', info: DESK, rotation });

describe('sameDecorBrush', () => {
  it('compares brushes by what they place', () => {
    expect(sameDecorBrush(chairBrush(), chairBrush())).toBe(true);
    expect(sameDecorBrush(chairBrush(), chairBrush(90))).toBe(false);
    expect(sameDecorBrush(chairBrush(), deskBrush())).toBe(false);
    expect(sameDecorBrush(null, undefined)).toBe(true);
    expect(sameDecorBrush(null, chairBrush())).toBe(false);
  });

  it('tells two colors of the same piece apart', () => {
    const painted = (color?: string): DecorBrush => ({ kind: 'piece', piece: 'desk-painted', info: { ...DESK, colorable: true }, rotation: 0, ...(color === undefined ? {} : { color }) });
    expect(sameDecorBrush(painted('#c83c3c'), painted('#c83c3c'))).toBe(true);
    expect(sameDecorBrush(painted('#c83c3c'), painted('#3c5ac8'))).toBe(false);
    expect(sameDecorBrush(painted('#c83c3c'), painted())).toBe(false);
  });
});

describe('decorSizeLabel', () => {
  it('states a footprint in tiles, columns by rows', () => {
    expect(decorSizeLabel(MEETING)).toBe('7x5');
    expect(decorSizeLabel({ kind: 'table', footprint: { w: 2, h: 1 } })).toBe('2x1');
  });
});

describe('decorColorKey', () => {
  it('gives a sofa the color of the armchair of its upholstery, and every other piece its own', () => {
    expect(decorColorKey('sofa-fabric-2')).toBe('chair-fabric');
    expect(decorColorKey('sofa-fabric-3')).toBe('chair-fabric');
    expect(decorColorKey('chair-fabric')).toBe('chair-fabric');
    expect(decorColorKey('chair-gamer')).toBe('chair-gamer');
    expect(decorColorKey('desk-painted')).toBe('desk-painted');
  });
});

describe('fitsDeskArea', () => {
  it('never offers a door to a desk (#223): only an admin opens walls', () => {
    expect(fitsDeskArea({ kind: 'door', footprint: { w: 2, h: 1 } })).toBe(false);
    expect(fitsDeskArea({ kind: 'door', footprint: { w: 4, h: 1 } })).toBe(false);
  });

  it('never offers a sofa to a desk, even one that fits: sofas furnish the office', () => {
    expect(fitsDeskArea({ kind: 'sofa', footprint: { w: 2, h: 1 } })).toBe(false);
    expect(fitsDeskArea({ kind: 'sofa', footprint: { w: 3, h: 1 }, colorable: true })).toBe(false);
  });

  it('never offers a tree to a desk, even on its 1x1 base: its crown covers the office around it', () => {
    expect(fitsDeskArea({ kind: 'tree', footprint: { w: 1, h: 1 } })).toBe(false);
  });

  it('takes chairs, desk tables and 1x1 plants, never a room table (#116): a desk holds desk tables only', () => {
    expect(fitsDeskArea(CHAIR)).toBe(true);
    expect(fitsDeskArea(DESK)).toBe(true);
    expect(fitsDeskArea(PLANT)).toBe(true);
    expect(fitsDeskArea(MEETING)).toBe(false);
    expect(fitsDeskArea(CAFETERIA)).toBe(false);
    expect(fitsDeskArea({ kind: 'table', footprint: { w: 2, h: 1 } })).toBe(false);
    expect(fitsDeskArea({ kind: 'plant', footprint: { w: 3, h: 3 } })).toBe(true);
    expect(fitsDeskArea({ kind: 'plant', footprint: { w: 4, h: 1 } })).toBe(false);
  });
});

describe('decorPlacementAllowed', () => {
  const none: readonly DecorItem[] = [];

  it('takes a piece whose whole footprint stands on free walkable ground of the map', () => {
    expect(decorPlacementAllowed(none, infoOf, ground(), null, at(4, 4), chairBrush())).toBe(true);
    // A desk table lies along a row with its anchor in the middle.
    expect(decorPlacementAllowed(none, infoOf, ground(), null, at(2, 4), deskBrush())).toBe(true);
  });

  it('refuses a footprint off the map, on water or void, or on a tile a wall touches', () => {
    expect(decorPlacementAllowed(none, infoOf, ground(), null, at(9, 4), deskBrush())).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, ground(), null, at(1, 4), deskBrush())).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, ground(), null, at(9, 0), chairBrush())).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, ground(), null, at(4, 0), deskBrush(90))).toBe(false);
  });

  it('refuses a footprint over another item, but replacing the item anchored on that tile is fine', () => {
    const items: DecorItem[] = [{ index: at(5, 4), piece: 'chair-metal', rotation: 0 }];
    expect(decorPlacementAllowed(items, infoOf, ground(), null, at(4, 4), deskBrush())).toBe(false);
    expect(decorPlacementAllowed(items, infoOf, ground(), null, at(5, 4), deskBrush())).toBe(true);
    expect(decorPlacementAllowed(items, infoOf, ground(), null, at(5, 4), chairBrush(180))).toBe(true);
  });

  it('keeps a desk-scoped brush inside the desk area', () => {
    const desk = { x: 3, y: 3, w: 3, h: 3 };
    expect(decorPlacementAllowed(none, infoOf, ground(), desk, at(4, 3), deskBrush())).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, ground(), desk, at(3, 3), deskBrush())).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, ground(), desk, at(6, 3), chairBrush())).toBe(false);
  });

  it('refuses a chair that would be the fourth on a desk, never one off every desk', () => {
    const desk = { x: 3, y: 3, w: 3, h: 3 };
    const chairs: DecorItem[] = [at(3, 3), at(4, 3), at(5, 3)].map((index) => ({ index, piece: 'chair-wood', rotation: 0 }));
    expect(decorPlacementAllowed(chairs, infoOf, ground(), null, at(3, 5), chairBrush(), [desk])).toBe(false);
    expect(decorPlacementAllowed(chairs, infoOf, ground(), null, at(7, 5), chairBrush(), [desk])).toBe(true);
    // Turning one of the three adds none.
    expect(decorPlacementAllowed(chairs, infoOf, ground(), null, at(3, 3), chairBrush(90), [desk])).toBe(true);
    expect(decorPlacementAllowed(chairs, infoOf, ground(), null, at(3, 5), chairBrush())).toBe(true);
  });

  it('judges a vertical room table on its swapped footprint', () => {
    const oval: DecorBrush = { kind: 'piece', piece: 'table-oval', info: { kind: 'table', footprint: { w: 2, h: 1 } }, rotation: 90 };
    // 1x2 standing on (4, 3) and (4, 4).
    expect(decorPlacementAllowed(none, infoOf, ground(), null, at(4, 4), oval)).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, ground(), null, at(9, 1), oval)).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, ground(), null, at(4, 0), oval)).toBe(false);
  });
});

describe('decorBrushTarget', () => {
  it('is the footprint the brush would cover', () => {
    expect(decorBrushTarget(at(2, 2), deskBrush(), WIDTH)).toEqual({ x: 1, y: 2, w: 3, h: 1 });
    expect(decorBrushTarget(at(4, 4), { kind: 'piece', piece: 'table-meeting', info: MEETING, rotation: 90 }, WIDTH)).toEqual({ x: 2, y: 1, w: 5, h: 7 });
  });
});

describe('decorPlacementAllowed: moving an item (a brush `from` its anchor)', () => {
  it('ignores the moved item\'s own place, so it can move onto tiles it covers now', () => {
    const items: DecorItem[] = [{ index: at(4, 4), piece: 'desk-wood', rotation: 0 }];
    const move: DecorBrush = { ...deskBrush(), from: at(4, 4) };
    expect(decorPlacementAllowed(items, infoOf, ground(), null, at(5, 4), move)).toBe(true);
    expect(decorPlacementAllowed(items, infoOf, ground(), null, at(5, 4), deskBrush())).toBe(false);
  });

  it('never drops onto another item\'s anchor: a move replaces nothing', () => {
    const items: DecorItem[] = [
      { index: at(4, 4), piece: 'chair-wood', rotation: 0 },
      { index: at(7, 4), piece: 'chair-metal', rotation: 0 },
    ];
    expect(decorPlacementAllowed(items, infoOf, ground(), null, at(7, 4), { ...chairBrush(), from: at(4, 4) })).toBe(false);
    expect(decorPlacementAllowed(items, infoOf, ground(), null, at(7, 4), chairBrush())).toBe(true);
  });
});

describe('decorPickAt', () => {
  const items: DecorItem[] = [
    { index: at(5, 5), piece: 'table-meeting', rotation: 0 },
    { index: at(5, 6), piece: 'chair-wood', rotation: 0 },
  ];
  const tableInfo = (piece: string): DecorPieceInfo | null => (piece.startsWith('table-') ? { kind: 'table', footprint: { w: 3, h: 3 } } : infoOf(piece));

  it('finds the item under a tile, the smallest footprint winning where they stack', () => {
    // The 3x3 table covers (4..6, 4..6); the chair stands on (5, 6) over it.
    expect(decorPickAt(items, tableInfo, WIDTH, at(5, 6), null)).toEqual(items[1]);
    expect(decorPickAt(items, tableInfo, WIDTH, at(4, 4), null)).toEqual(items[0]);
    expect(decorPickAt(items, tableInfo, WIDTH, at(9, 9), null)).toBeNull();
  });

  it('in a desk area finds only items wholly inside it', () => {
    const desk = { x: 4, y: 5, w: 3, h: 3 };
    expect(decorPickAt(items, tableInfo, WIDTH, at(5, 6), desk)).toEqual(items[1]);
    expect(decorPickAt(items, tableInfo, WIDTH, at(4, 5), desk)).toBeNull();
  });
});

describe('decorPlacementAllowed: doors and windows in tile walls (#223, #233, S6-S10)', () => {
  const DOOR: DecorPieceInfo = { kind: 'door', footprint: { w: 2, h: 1 } };
  const DOUBLE: DecorPieceInfo = { kind: 'door', footprint: { w: 3, h: 1 } };
  const brush = (piece: string, rotation: 0 | 90 | 180 | 270 = 0): DecorBrush => ({ kind: 'piece', piece, info: piece.endsWith('-double') ? DOUBLE : DOOR, rotation });
  const doorBrush = (rotation: 0 | 90 | 180 | 270 = 0): DecorBrush => brush('door-wood', rotation);
  const doubleBrush = (rotation: 0 | 90 | 180 | 270 = 0): DecorBrush => brush('door-wood-double', rotation);
  const windowBrush = (rotation: 0 | 90 | 180 | 270 = 0): DecorBrush => brush('door-glass-window', rotation);
  const doorInfo = (piece: string): DecorPieceInfo | null => (piece === 'door-wood-double' ? DOUBLE : piece.startsWith('door-') ? DOOR : infoOf(piece));
  const W = 14;
  const H = 12;
  const tile = (tx: number, ty: number): number => ty * W + tx;
  /**
   * A lawn of 14x12 with a horizontal run on row 2 (columns 1..9, plaster from 6 on) and a vertical
   * run in column 11 (rows 2..9), and the wall tiles they touch.
   */
  function walled(extra: ReadonlyArray<readonly [number, number]> = [], drop: ReadonlyArray<readonly [number, number]> = []): DecorGround {
    const walls = new Array<string | null>(W * H).fill(null);
    for (let tx = 1; tx <= 9; tx += 1) walls[tile(tx, 2)] = tx >= 6 ? 'wall-plaster' : 'wall-brick';
    for (let ty = 2; ty <= 9; ty += 1) walls[tile(11, ty)] = 'wall-brick';
    for (const [tx, ty] of extra) walls[tile(tx, ty)] = 'wall-brick';
    for (const [tx, ty] of drop) walls[tile(tx, ty)] = null;
    const wallTiles = coveredTiles(wallFootprintRects({ width: W, height: H, walls }), W, H);
    return { width: W, height: H, walkable: new Array<boolean>(W * H).fill(true), wallTiles, walls };
  }
  const none: readonly DecorItem[] = [];

  it('takes a door or a window between two walls of a horizontal run, turned either way along it, of any material (S7, S10, S11)', () => {
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(2, 2), doorBrush(0))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(4, 2), doorBrush(180))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(5, 2), doorBrush(0))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(2, 2), doubleBrush(0))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(6, 2), windowBrush(0))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(6, 2), windowBrush(180))).toBe(true);
  });

  it('refuses a door or a window with no wall past either end or under its span, or off the run (S7)', () => {
    for (const piece of [doorBrush(0), windowBrush(0)]) {
      expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(1, 2), piece)).toBe(false);
      expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(8, 2), piece)).toBe(false);
      expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(3, 3), piece)).toBe(false);
      expect(decorPlacementAllowed(none, infoOf, walled([], [[4, 2]]), null, tile(3, 2), piece)).toBe(false);
      expect(decorPlacementAllowed(none, infoOf, ground(), null, at(3, 4), piece)).toBe(false);
    }
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(7, 2), doubleBrush(0))).toBe(false);
  });

  it('never puts a window in a vertical run, where a door goes in its dark top (S8, S9)', () => {
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(11, 3), windowBrush(90))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(11, 3), windowBrush(270))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(11, 3), doorBrush(90))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(11, 3), doubleBrush(270))).toBe(true);
    // The run's face, its bottom three tiles, takes none.
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(11, 7), doorBrush(90))).toBe(false);
  });

  it('refuses a door in a vertical run whose sides are water, a wall or another item, and any door in a desk', () => {
    const wet = walled();
    const walkable = [...wet.walkable];
    walkable[tile(12, 4)] = false;
    expect(decorPlacementAllowed(none, infoOf, { ...wet, walkable }, null, tile(11, 3), doorBrush(90))).toBe(false);
    expect(decorPlacementAllowed([{ index: tile(10, 3), piece: 'chair-wood', rotation: 0 }], infoOf, walled(), null, tile(11, 3), doorBrush(90))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled([[12, 5]]), null, tile(11, 3), doorBrush(90))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), { x: 1, y: 1, w: 3, h: 3 }, tile(2, 2), doorBrush(0))).toBe(false);
  });

  it('replaces a window with a door and a door with a window, but not a door with another door nor any other piece (S6)', () => {
    const window: DecorItem = { index: tile(2, 2), piece: 'door-glass-window', rotation: 0 };
    const door: DecorItem = { index: tile(3, 2), piece: 'door-wood', rotation: 0 };
    expect(decorPlacementAllowed([window], doorInfo, walled(), null, tile(2, 2), doorBrush(0))).toBe(true);
    expect(decorPlacementAllowed([window], doorInfo, walled(), null, tile(3, 2), doorBrush(0))).toBe(true);
    expect(decorPlacementAllowed([door], doorInfo, walled(), null, tile(4, 2), windowBrush(0))).toBe(true);
    expect(decorPlacementAllowed([door], doorInfo, walled(), null, tile(2, 2), doubleBrush(0))).toBe(false);
    expect(decorPlacementAllowed([door], doorInfo, walled(), null, tile(4, 2), doorBrush(0))).toBe(false);
    // A chair over a door's doorway is refused as before.
    expect(decorPlacementAllowed([door], doorInfo, walled(), null, tile(3, 1), chairBrush())).toBe(false);
  });

  it('refuses a window over another window, and takes it right beside one (L23)', () => {
    const window: DecorItem = { index: tile(2, 2), piece: 'door-glass-window', rotation: 0 };
    expect(decorPlacementAllowed([window], doorInfo, walled(), null, tile(3, 2), windowBrush(0))).toBe(false);
    expect(decorPlacementAllowed([window], doorInfo, walled(), null, tile(1, 2), windowBrush(0))).toBe(false);
    expect(decorPlacementAllowed([window], doorInfo, walled(), null, tile(4, 2), windowBrush(0))).toBe(true);
  });

  it('takes a window right beside a door and a door right beside a window (L22)', () => {
    const door: DecorItem = { index: tile(2, 2), piece: 'door-wood', rotation: 0 };
    const window: DecorItem = { index: tile(2, 2), piece: 'door-glass-window', rotation: 0 };
    // The piece spans columns 2-3: the brush on 4-5 is right beside it.
    expect(decorPlacementAllowed([door], doorInfo, walled(), null, tile(4, 2), windowBrush(0))).toBe(true);
    expect(decorPlacementAllowed([window], doorInfo, walled(), null, tile(4, 2), doorBrush(0))).toBe(true);
    expect(decorPlacementAllowed([window], doorInfo, walled(), null, tile(4, 2), windowBrush(0))).toBe(true);
  });

  it('closes the wall of a door that leaves for a piece taking its place, as with no door there', () => {
    const door: DecorItem = { index: tile(3, 2), piece: 'door-wood', rotation: 0 };
    expect(decorPlacementAllowed([door], doorInfo, walled(), null, tile(3, 3), { ...chairBrush(), from: tile(3, 2) })).toBe(false);
    expect(decorPlacementAllowed([door], doorInfo, walled(), null, tile(3, 6), { ...chairBrush(), from: tile(3, 2) })).toBe(true);
  });

  it('still keeps every other piece off the tiles a wall touches', () => {
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(3, 3), chairBrush())).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, tile(3, 6), chairBrush())).toBe(true);
  });
});

describe('decorOutlines (#216)', () => {
  const desks = [{ x: 2, y: 3, w: 4, h: 4 }, { x: 10, y: 3, w: 4, h: 4 }];
  const rooms = [{ x: 20, y: 5, w: 9, h: 9 }];

  it('is every desk and every room for an admin, who has no area', () => {
    expect(decorOutlines(null, desks, rooms)).toEqual([
      { x0: 2, y0: 3, x1: 5, y1: 6 },
      { x0: 10, y0: 3, x1: 13, y1: 6 },
      { x0: 20, y0: 5, x1: 28, y1: 13 },
    ]);
  });

  it('is only the own desk for whoever decorates one, not the others nor the rooms', () => {
    expect(decorOutlines(desks[1]!, desks, rooms)).toEqual([{ x0: 10, y0: 3, x1: 13, y1: 6 }]);
  });
});

describe('the top layer (#121)', () => {
  // The desk table on (4, 4) covers (3..5, 4); the 3x3 room table on (7, 5) covers (6..8, 4..6).
  const desk: DecorItem = { index: at(4, 4), piece: 'desk-wood', rotation: 0 };
  const room: DecorItem = { index: at(7, 5), piece: 'table-cafe', rotation: 0 };
  const plant = (index: number, piece = 'plant-bonsai'): DecorItem => ({ index, piece, rotation: 0 });
  const topInfo = (piece: string): DecorPieceInfo | null =>
    piece === 'table-cafe' ? { kind: 'table', footprint: { w: 3, h: 3 } } : piece === 'plant-wide' ? { kind: 'plant', footprint: { w: 2, h: 1 } } : infoOf(piece);
  const plantBrush = (from?: number): DecorBrush => ({ kind: 'piece', piece: 'plant-bonsai', info: PLANT, rotation: 0, ...(from === undefined ? {} : { from }) });
  const allowed = (items: readonly DecorItem[], index: number, brush: DecorBrush, area: { x: number; y: number; w: number; h: number } | null = null) =>
    decorPlacementAllowed(items, topInfo, ground(), area, index, brush);

  it('takes a top piece on any tile of a desk table or room table, the anchor of the desk table included', () => {
    expect(allowed([desk], at(4, 4), plantBrush())).toBe(true);
    expect(allowed([desk], at(3, 4), plantBrush())).toBe(true);
    expect(allowed([room], at(8, 6), plantBrush())).toBe(true);
    // Its desk keeps a desk-scoped brush inside, as on the floor.
    expect(allowed([desk], at(5, 4), plantBrush(), { x: 3, y: 3, w: 3, h: 3 })).toBe(true);
    expect(allowed([room], at(6, 6), plantBrush(), { x: 3, y: 3, w: 3, h: 3 })).toBe(false);
  });

  it('refuses a top piece on the floor, on a chair, hanging off a surface or over another top piece; replacing the one anchored there is fine', () => {
    expect(allowed([], at(4, 4), plantBrush())).toBe(false);
    expect(allowed([{ index: at(2, 2), piece: 'chair-wood', rotation: 0 }], at(2, 2), plantBrush())).toBe(false);
    expect(allowed([desk], at(6, 4), plantBrush())).toBe(false);
    const wide: DecorBrush = { kind: 'piece', piece: 'plant-wide', info: { kind: 'plant', footprint: { w: 2, h: 1 } }, rotation: 0 };
    expect(allowed([desk], at(4, 4), wide)).toBe(true);
    expect(allowed([desk], at(3, 4), wide)).toBe(false);
    expect(allowed([desk, plant(at(3, 4))], at(4, 4), wide)).toBe(false);
    expect(allowed([desk, plant(at(4, 4))], at(4, 4), plantBrush())).toBe(true);
  });

  it('keeps the floor blind to the top layer: a desk table replaced under a plant, a chair beside it', () => {
    const items = [desk, plant(at(4, 4)), plant(at(5, 4))];
    expect(allowed(items, at(4, 4), deskBrush(180))).toBe(true);
    expect(allowed(items, at(4, 5), chairBrush())).toBe(true);
    expect(allowed(items, at(5, 4), chairBrush())).toBe(false);
  });

  it('moves a top piece across its surface, never onto another top anchor nor off the surface', () => {
    const items = [desk, plant(at(3, 4)), plant(at(5, 4))];
    expect(allowed(items, at(4, 4), plantBrush(at(3, 4)))).toBe(true);
    expect(allowed(items, at(5, 4), plantBrush(at(3, 4)))).toBe(false);
    expect(allowed(items, at(4, 6), plantBrush(at(3, 4)))).toBe(false);
    // A desk table moved off the anchor of a plant is not blocked by that plant.
    expect(allowed([desk, plant(at(4, 4))], at(4, 6), { ...deskBrush(), from: at(4, 4) })).toBe(true);
  });

  it('takes along what a click leaves off its surface: the removal of a desk table removes what stands on it, and nothing else', () => {
    const stray = plant(at(1, 1));
    const items = [desk, plant(at(3, 4)), room, plant(at(7, 5)), stray];
    expect(withFallenTopItems(items, [{ index: desk.index, item: null }], topInfo, WIDTH)).toEqual([
      { index: desk.index, item: null },
      { index: at(3, 4), item: null, layer: 'top' },
    ]);
    expect(withFallenTopItems(items, [{ index: desk.index, item: { piece: 'desk-glass', rotation: 180 } }], topInfo, WIDTH)).toEqual([
      { index: desk.index, item: { piece: 'desk-glass', rotation: 180 } },
    ]);
  });

  it('moves what stands on a desk table along with it, in one set of edits, and lets fall what it cannot carry', () => {
    const onDesk = plant(at(3, 4));
    const onAnchor = plant(at(4, 4));
    const items = [onDesk, desk, onAnchor];
    // One row down: every piece shifts with it; the anchor's own plant keeps its anchor in a new place.
    expect(decorMoveEdits(items, topInfo, WIDTH, desk.index, at(4, 5), { piece: 'desk-wood', rotation: 0 })).toEqual([
      { index: at(3, 4), item: null, layer: 'top' },
      { index: desk.index, item: null },
      { index: at(4, 4), item: null, layer: 'top' },
      { index: at(3, 5), item: { piece: 'plant-bonsai', rotation: 0 } },
      { index: at(4, 5), item: { piece: 'desk-wood', rotation: 0 } },
      { index: at(4, 5), item: { piece: 'plant-bonsai', rotation: 0 } },
    ]);
    // One tile right: a plant lands where the same plant stood, so that tile has nothing to send.
    expect(decorMoveEdits(items, topInfo, WIDTH, desk.index, at(5, 4), { piece: 'desk-wood', rotation: 0 })).toEqual([
      { index: at(3, 4), item: null, layer: 'top' },
      { index: desk.index, item: null },
      { index: at(5, 4), item: { piece: 'desk-wood', rotation: 0 } },
      { index: at(5, 4), item: { piece: 'plant-bonsai', rotation: 0 } },
    ]);
    // Turned on the way, the desk table leaves what it held behind, off any surface: it goes.
    expect(decorMoveEdits(items, topInfo, WIDTH, desk.index, at(4, 6), { piece: 'desk-wood', rotation: 90 })).toEqual([
      { index: at(3, 4), item: null, layer: 'top' },
      { index: desk.index, item: null },
      { index: at(4, 4), item: null, layer: 'top' },
      { index: at(4, 6), item: { piece: 'desk-wood', rotation: 90 } },
    ]);
    // A top piece moves alone, on its own layer.
    expect(decorMoveEdits(items, topInfo, WIDTH, at(3, 4), at(5, 4), { piece: 'plant-bonsai', rotation: 0 })).toEqual([
      { index: at(3, 4), item: null, layer: 'top' },
      { index: at(5, 4), item: { piece: 'plant-bonsai', rotation: 0 } },
    ]);
    expect(decorKey(at(3, 4), 'top')).toBeLessThan(0);
  });

  it('picks the top piece over the desk table under it', () => {
    expect(decorPickAt([desk, plant(at(4, 4))], topInfo, WIDTH, at(4, 4), null)).toEqual(plant(at(4, 4)));
    expect(decorPickAt([desk, plant(at(4, 4))], topInfo, WIDTH, at(3, 4), null)).toEqual(desk);
  });
});
