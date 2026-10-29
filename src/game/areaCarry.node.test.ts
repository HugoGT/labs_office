import { describe, expect, it } from 'vitest';
import { carriedDecor, onAreaOutline, replacedDecor } from './areaCarry.ts';
import { decorInfoFromPieceId, type DecorItem } from './officeDecor.ts';

const W = 40;
const at = (tx: number, ty: number) => ty * W + tx;
const chair = (tx: number, ty: number): DecorItem => ({ index: at(tx, ty), piece: 'chair-wood', rotation: 0 });
/** A two-tile door on the horizontal grid line of row `ty`, from column `tx`. */
const door = (tx: number, ty: number): DecorItem => ({ index: at(tx, ty), piece: 'door-wood', rotation: 0 });
const ROOM = { x: 10, y: 10, w: 6, h: 6 };

describe('onAreaOutline', () => {
  it('takes the grid vertices on or inside the outline of an area, not one past it', () => {
    const inside = onAreaOutline(ROOM, W);

    expect([at(10, 10), at(16, 16), at(13, 12), at(16, 10)].every(inside)).toBe(true);
    expect([at(9, 10), at(17, 12), at(12, 17), at(12, 9)].some(inside)).toBe(false);
  });
});

describe('carriedDecor', () => {
  it('carries the items wholly inside the area and the doors on its outline, leaving the rest', () => {
    const items = [chair(10, 10), chair(15, 15), chair(16, 12), door(12, 10), door(12, 9), door(15, 16)];

    expect(carriedDecor(items, ROOM, decorInfoFromPieceId, W)).toEqual([chair(10, 10), chair(15, 15), door(12, 10)]);
  });
});

describe('replacedDecor', () => {
  it('replaces every item that is not carried and shares a tile with where the area lands', () => {
    const carried = [chair(11, 11)];
    // The second and the last stand where the area lands; the others are just outside it.
    const items = [chair(11, 11), chair(20, 12), chair(19, 14), chair(26, 12), chair(25, 15)];
    const to = { x: 20, y: 10, w: 6, h: 6 };

    expect(replacedDecor(items, carried, to, decorInfoFromPieceId, W)).toEqual([chair(20, 12), chair(25, 15)]);
  });

  it('never replaces what the area carries, even where old and new places overlap', () => {
    const items = [chair(11, 11), chair(12, 11)];

    expect(replacedDecor(items, items, { x: 11, y: 10, w: 6, h: 6 }, decorInfoFromPieceId, W)).toEqual([]);
  });
});
