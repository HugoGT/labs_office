/**
 * The decor editor's shared shapes and pure rules (#208): what a brush is,
 * when two are the same, which pieces fit a desk, and whether the ghost of a
 * brush on a tile is a placement the room would take.
 */

import { describe, expect, it } from 'vitest';
import {
  decorBrushTarget,
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
  it('takes chairs, desk tables and 1x1 plants, never a room table bigger than a desk', () => {
    expect(fitsDeskArea(CHAIR)).toBe(true);
    expect(fitsDeskArea(DESK)).toBe(true);
    expect(fitsDeskArea(PLANT)).toBe(true);
    expect(fitsDeskArea(MEETING)).toBe(false);
    expect(fitsDeskArea(CAFETERIA)).toBe(false);
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
