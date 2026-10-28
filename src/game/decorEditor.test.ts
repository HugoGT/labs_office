/**
 * The decor editor's shared shapes and pure rules (#208): what a brush is,
 * when two are the same, which pieces fit a desk, and whether the ghost of a
 * brush on a tile is a placement the room would take.
 */

import { describe, expect, it } from 'vitest';
import {
  decorBrushTarget,
  decorOutlines,
  decorPickAt,
  decorPlacementAllowed,
  decorSizeLabel,
  decorTileName,
  fitsDeskArea,
  sameDecorBrush,
  type DecorBrush,
  type DecorGround,
} from './decorEditor';
import type { DecorItem, DecorPieceInfo } from './officeDecor';
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

describe('decorTileName', () => {
  it('keeps only what tells a piece apart from the others of its group, capitalized', () => {
    expect(decorTileName('chair', 'Silla de madera')).toBe('Madera');
    expect(decorTileName('chair', 'Silla de metal')).toBe('Metal');
    expect(decorTileName('chair', 'Silla de cuero')).toBe('Cuero');
    expect(decorTileName('chair', 'Silla gamer')).toBe('Gamer');
    expect(decorTileName('desk', 'Escritorio de vidrio')).toBe('Vidrio');
    expect(decorTileName('desk', 'Escritorio pintado')).toBe('Pintado');
    expect(decorTileName('table', 'Mesa de reuniones')).toBe('Reuniones');
    expect(decorTileName('table', 'Mesa de cafetería')).toBe('Cafetería');
    expect(decorTileName('table', 'Mesa ovalada')).toBe('Ovalada');
  });

  it('keeps the whole name of a piece not named after its kind, or named only by it', () => {
    expect(decorTileName('plant', 'Ficus')).toBe('Ficus');
    expect(decorTileName('chair', 'Trono de Ana')).toBe('Trono de Ana');
    expect(decorTileName('chair', 'Sillas apiladas')).toBe('Sillas apiladas');
    expect(decorTileName('chair', 'Silla')).toBe('Silla');
    expect(decorTileName('chair', 'Silla de')).toBe('Silla de');
    expect(decorTileName('chair', 'silla de bambú')).toBe('Bambú');
  });
});

describe('decorSizeLabel', () => {
  it('states a footprint in tiles, columns by rows', () => {
    expect(decorSizeLabel(MEETING)).toBe('7x5');
    expect(decorSizeLabel({ kind: 'table', footprint: { w: 2, h: 1 } })).toBe('2x1');
  });
});

describe('fitsDeskArea', () => {
  it('never offers a door to a desk (#223): only an admin opens walls', () => {
    expect(fitsDeskArea({ kind: 'door', footprint: { w: 2, h: 1 } })).toBe(false);
    expect(fitsDeskArea({ kind: 'door', footprint: { w: 4, h: 1 } })).toBe(false);
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

describe('decorPlacementAllowed: doors (#223, #233)', () => {
  const DOOR: DecorPieceInfo = { kind: 'door', footprint: { w: 2, h: 1 } };
  const DOUBLE: DecorPieceInfo = { kind: 'door', footprint: { w: 3, h: 1 } };
  const doorBrush = (rotation: 0 | 90 | 180 | 270 = 0): DecorBrush => ({ kind: 'piece', piece: 'door-wood', info: DOOR, rotation });
  const doubleBrush = (rotation: 0 | 90 | 180 | 270 = 0): DecorBrush => ({ kind: 'piece', piece: 'door-wood-double', info: DOUBLE, rotation });
  const doorInfo = (piece: string): DecorPieceInfo | null => (piece === 'door-wood-double' ? DOUBLE : piece.startsWith('door-') ? DOOR : infoOf(piece));
  /** The lawn of `ground()` with a wall post (grid vertex) of brick on each given `[col, row]`, and the wall tiles those posts touch. */
  function withPosts(posts: ReadonlyArray<readonly [number, number]>): DecorGround {
    const walls = new Array<string | null>(WIDTH * HEIGHT).fill(null);
    for (const [col, row] of posts) walls[at(col, row)] = 'wall-brick';
    const wallTiles = coveredTiles(wallFootprintRects({ width: WIDTH, height: HEIGHT, walls }), WIDTH, HEIGHT);
    return { ...ground(), walls, wallTiles };
  }
  /**
   * A closed room of tiles 2..6 x 4..6 (brick posts all round vertices
   * 2..7 x 4..7, the corner (7, 4) glass) and a brick stub on row 1 (posts 2..4).
   */
  function walled(): DecorGround {
    const posts: Array<[number, number]> = [];
    for (let tx = 2; tx <= 7; tx += 1) posts.push([tx, 4], [tx, 7]);
    for (const ty of [5, 6]) posts.push([2, ty], [7, ty]);
    for (const tx of [2, 3, 4]) posts.push([tx, 1]);
    const base = withPosts(posts);
    const walls = [...base.walls!];
    walls[at(7, 4)] = 'wall-glass';
    return { ...base, walls };
  }
  const none: readonly DecorItem[] = [];

  it('takes a door two tiles wide between a post at each end of its span, turned either way along the wall', () => {
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(3, 4), doorBrush(0))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(5, 4), doorBrush(180))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(2, 5), doorBrush(90))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(7, 5), doorBrush(270))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(3, 7), doorBrush(0))).toBe(true);
  });

  it('takes a double door three tiles wide between the posts at its two ends, and refuses it where its span has none', () => {
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(2, 4), doubleBrush(0))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(3, 7), doubleBrush(180))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, withPosts([[2, 3], [2, 6]]), null, at(2, 3), doubleBrush(90))).toBe(true);
    // The span of three needs a post three vertices away: (5, 4) has none at (8, 4), and the room's left wall has none at (2, 8).
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(5, 4), doubleBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(2, 5), doubleBrush(90))).toBe(false);
    // A door two tiles wide fits there, where the double one does not.
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(5, 4), doorBrush(0))).toBe(true);
  });

  it('takes a door between two different materials (S16)', () => {
    // Brick on one end, glass on the other.
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(5, 4), doorBrush(0))).toBe(true);
  });

  it('takes a door between two lone posts, whatever walls run from them and with no wall between (S3)', () => {
    expect(decorPlacementAllowed(none, infoOf, withPosts([[3, 4], [5, 4]]), null, at(3, 4), doorBrush(0))).toBe(true);
    expect(decorPlacementAllowed(none, infoOf, withPosts([[3, 4], [3, 6]]), null, at(3, 4), doorBrush(90))).toBe(true);
    // An L: the wall turns at the corner (3, 4) and runs down, the span goes right to a post that has another wall running up.
    const bent = withPosts([[3, 4], [3, 5], [3, 6], [3, 7], [5, 4], [5, 3], [5, 2]]);
    expect(decorPlacementAllowed(none, infoOf, bent, null, at(3, 4), doorBrush(0))).toBe(true);
    // An open room (no walls closing it) takes the door as well.
    const open = walled();
    const walls = [...open.walls!];
    walls[at(7, 5)] = null;
    expect(decorPlacementAllowed(none, infoOf, { ...open, walls }, null, at(3, 4), doorBrush(0))).toBe(true);
  });

  it('refuses a door with a post missing at either end, off a wall, across the wall line or on a wall end', () => {
    const noEnd = walled();
    const walls = [...noEnd.walls!];
    walls[at(5, 4)] = null;
    expect(decorPlacementAllowed(none, infoOf, { ...noEnd, walls }, null, at(3, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, { ...noEnd, walls }, null, at(5, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, withPosts([[3, 4]]), null, at(3, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, withPosts([[5, 4]]), null, at(3, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(3, 6), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(3, 4), doorBrush(90))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(1, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(6, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, ground(), null, at(3, 4), doorBrush(0))).toBe(false);
  });

  it('refuses a door whose span leaves the map', () => {
    expect(decorPlacementAllowed(none, infoOf, withPosts([[8, 4], [9, 4]]), null, at(8, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, withPosts([[8, 4]]), null, at(8, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, withPosts([[3, 6], [3, 7]]), null, at(3, 6), doorBrush(90))).toBe(false);
  });

  it('refuses a door whose side tiles are water or another item, and never in a desk', () => {
    const wet = walled();
    const walkable = [...wet.walkable];
    walkable[at(4, 3)] = false;
    expect(decorPlacementAllowed(none, infoOf, { ...wet, walkable }, null, at(3, 4), doorBrush(0))).toBe(false);
    // Water at the far end of a double door's span.
    const wetEnd = [...wet.walkable];
    wetEnd[at(4, 3)] = false;
    expect(decorPlacementAllowed(none, infoOf, { ...wet, walkable: wetEnd }, null, at(2, 4), doubleBrush(0))).toBe(false);
    expect(decorPlacementAllowed([{ index: at(3, 3), piece: 'plant-ficus', rotation: 0 }], infoOf, walled(), null, at(3, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed([{ index: at(4, 4), piece: 'plant-ficus', rotation: 0 }], infoOf, walled(), null, at(3, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), { x: 2, y: 3, w: 3, h: 3 }, at(3, 4), doorBrush(0))).toBe(false);
  });

  it('keeps a door off another door it overlaps, but turns one in place or moves it', () => {
    const first: DecorItem[] = [{ index: at(3, 4), piece: 'door-wood', rotation: 0 }];
    // A single door and the one next to it share a tile: a double door is its own item now, not two of these.
    expect(decorPlacementAllowed(first, doorInfo, walled(), null, at(4, 4), doorBrush(0))).toBe(false);
    expect(decorPlacementAllowed(first, doorInfo, walled(), null, at(2, 4), doubleBrush(0))).toBe(false);
    // Side by side without sharing a tile is fine, and so is turning one in place.
    expect(decorPlacementAllowed(first, doorInfo, walled(), null, at(5, 4), doorBrush(0))).toBe(true);
    expect(decorPlacementAllowed(first, doorInfo, walled(), null, at(3, 4), doorBrush(180))).toBe(true);
    expect(decorPlacementAllowed(first, doorInfo, walled(), null, at(5, 4), { ...doorBrush(0), from: at(3, 4) })).toBe(true);
  });

  it('keeps a piece that replaces a door off the wall the door leaves closed, as with no door there', () => {
    const door: DecorItem = { index: at(3, 4), piece: 'door-wood', rotation: 0 };
    // The live ground with the door open: its tiles touch no wall rectangle.
    const plain = walled();
    const openings = [{ col: 3, row: 4, axis: 'horizontal' as const }, { col: 4, row: 4, axis: 'horizontal' as const }];
    const open = { ...plain, openings, wallTiles: coveredTiles(wallFootprintRects({ width: WIDTH, height: HEIGHT, walls: plain.walls!, openings }), WIDTH, HEIGHT) };
    expect(open.wallTiles[at(3, 4)]).toBe(false);
    expect(decorPlacementAllowed([], doorInfo, plain, null, at(3, 4), chairBrush())).toBe(false);
    expect(decorPlacementAllowed([door], doorInfo, open, null, at(3, 4), chairBrush())).toBe(false);
    expect(decorPlacementAllowed([door], doorInfo, open, null, at(4, 4), chairBrush())).toBe(false);
    // Moving the door away and a chair onto its other tile: the wall closes there too.
    expect(decorPlacementAllowed([door], doorInfo, open, null, at(3, 3), { ...chairBrush(), from: at(3, 4) })).toBe(false);
    // Another door over it still goes, and a chair anywhere else is judged as before.
    expect(decorPlacementAllowed([door], doorInfo, open, null, at(3, 4), doorBrush(180))).toBe(true);
    expect(decorPlacementAllowed([door], doorInfo, open, null, at(9, 3), chairBrush())).toBe(true);
  });

  it('still keeps every other piece off the tiles a wall touches', () => {
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(3, 4), chairBrush())).toBe(false);
    expect(decorPlacementAllowed(none, infoOf, walled(), null, at(9, 3), chairBrush())).toBe(true);
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
