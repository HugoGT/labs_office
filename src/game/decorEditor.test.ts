/**
 * The decor editor's shared shapes and pure rules (#208): what a brush is,
 * when two are the same, which pieces fit a desk, and whether the ghost of a
 * brush on a tile is a placement the room would take.
 */

import { describe, expect, it } from 'vitest';
import {
  decorBrushTarget,
  decorPlacementAllowed,
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
    expect(sameDecorBrush({ kind: 'eraser' }, { kind: 'eraser' })).toBe(true);
    expect(sameDecorBrush({ kind: 'eraser' }, chairBrush())).toBe(false);
    expect(sameDecorBrush(null, undefined)).toBe(true);
    expect(sameDecorBrush(null, { kind: 'eraser' })).toBe(false);
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

  it('lets the eraser act only on an item, and a desk-scoped one only on an item wholly inside the desk', () => {
    const items: DecorItem[] = [
      { index: at(4, 4), piece: 'desk-wood', rotation: 0 },
      { index: at(7, 4), piece: 'chair-wood', rotation: 0 },
    ];
    expect(decorPlacementAllowed(items, infoOf, ground(), null, at(5, 4), { kind: 'eraser' })).toBe(true);
    expect(decorPlacementAllowed(items, infoOf, ground(), null, at(5, 6), { kind: 'eraser' })).toBe(false);
    expect(decorPlacementAllowed(items, infoOf, ground(), { x: 3, y: 3, w: 3, h: 3 }, at(4, 4), { kind: 'eraser' })).toBe(true);
    expect(decorPlacementAllowed(items, infoOf, ground(), { x: 4, y: 3, w: 3, h: 3 }, at(4, 4), { kind: 'eraser' })).toBe(false);
  });
});

describe('decorBrushTarget', () => {
  it('is the footprint a piece brush would cover, or the one of the item the eraser would remove', () => {
    const items: DecorItem[] = [{ index: at(4, 4), piece: 'desk-wood', rotation: 90 }];
    expect(decorBrushTarget(items, infoOf, WIDTH, at(2, 2), deskBrush())).toEqual({ x: 1, y: 2, w: 3, h: 1 });
    expect(decorBrushTarget(items, infoOf, WIDTH, at(4, 5), { kind: 'eraser' })).toEqual({ x: 4, y: 3, w: 1, h: 3 });
    expect(decorBrushTarget(items, infoOf, WIDTH, at(7, 7), { kind: 'eraser' })).toBeNull();
  });
});
