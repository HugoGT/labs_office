import { describe, expect, it } from 'vitest';
import { TABLE_LONG_SIDE_PX, TABLE_ROTATIONS, tableFacing, tableFloorRect } from './deskTable';

describe('deskTable: a desk table of the decor layer', () => {
  it('lets the rotation pick the facing, the way a seated person at it looks', () => {
    expect(TABLE_ROTATIONS.map((rotation) => [rotation, tableFacing(rotation)])).toEqual([
      [0, 'down'],
      [90, 'right'],
      [180, 'up'],
      [270, 'left'],
    ]);
    expect(tableFacing(45)).toBe('down');
  });

  it('draws a table 84px long, a little over 2.5 tiles, so neighbouring desks stand closer', () => {
    expect(TABLE_LONG_SIDE_PX).toBe(84);
    expect(TABLE_LONG_SIDE_PX / 32).toBeLessThan(3);
  });
});

describe('deskTable: default collision', () => {
  it('blocks the floor under the top, along its row or column, centered on the anchor', () => {
    expect(tableFloorRect(0)).toEqual({ x: -42, y: -8, w: 84, h: 16 });
    expect(tableFloorRect(180)).toEqual(tableFloorRect(0));
    expect(tableFloorRect(90)).toEqual({ x: -13, y: -42, w: 26, h: 84 });
    expect(tableFloorRect(270)).toEqual(tableFloorRect(90));
  });
});
