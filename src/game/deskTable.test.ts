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

  it('draws a table about 2.5 tiles long', () => {
    expect(TABLE_LONG_SIDE_PX / 32).toBeGreaterThanOrEqual(2.4);
    expect(TABLE_LONG_SIDE_PX / 32).toBeLessThanOrEqual(2.6);
  });
});

describe('deskTable: default collision', () => {
  it('blocks the floor under the top, along its row or column, centered on the anchor', () => {
    expect(tableFloorRect(0)).toEqual({ x: -40, y: -7, w: 80, h: 14 });
    expect(tableFloorRect(180)).toEqual(tableFloorRect(0));
    expect(tableFloorRect(90)).toEqual({ x: -12, y: -40, w: 24, h: 80 });
    expect(tableFloorRect(270)).toEqual(tableFloorRect(90));
  });
});
