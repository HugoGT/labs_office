import { describe, expect, it } from 'vitest';
import {
  DESK_DECOR_MAX_SIDE,
  TABLE_LONG_SIDE_PX,
  TABLE_ROTATIONS,
  decorTableAt,
  decorTablePiece,
  deskDecorConflict,
  fitsDeskDecor,
  tableEdgeSlot,
  tableFacing,
  tableRotationForSlot,
  tableFloorRect,
  tableSlots,
} from './deskTable';
import { DESK_SLOT_COLUMNS, DESK_SLOT_COUNT } from './deskLayout';

describe('deskTable: a table on one edge of a desk', () => {
  it('reads the table piece of a pack or uploaded desk sheet key, nothing else', () => {
    expect(decorTablePiece('art:desk-wood:sheet')).toBe('desk-wood');
    expect(decorTablePiece('art:desk-upload-0123456789abcdef:sheet')).toBe('desk-upload-0123456789abcdef');
    for (const key of ['art:chair-wood:sheet', 'art:table-meeting:sheet', 'desk-wood', 'art:desk-wood:walk', '']) {
      expect(decorTablePiece(key)).toBeNull();
    }
  });

  it('lets the rotation pick the edge, the way a seated person at it looks', () => {
    // 0 faces down: people stand north of it, so it lies on the bottom row.
    expect(TABLE_ROTATIONS.map((rotation) => [rotation, tableFacing(rotation), tableEdgeSlot(rotation), tableSlots(rotation)])).toEqual([
      [0, 'down', 7, [6, 7, 8]],
      [90, 'right', 5, [2, 5, 8]],
      [180, 'up', 1, [0, 1, 2]],
      [270, 'left', 3, [0, 3, 6]],
    ]);
    for (const rotation of TABLE_ROTATIONS) expect(tableRotationForSlot(tableEdgeSlot(rotation))).toBe(rotation);
    expect(tableRotationForSlot(4)).toBeNull();
    expect(tableRotationForSlot(0)).toBeNull();
  });

  it('every edge is three slots of the 3x3 grid in a line', () => {
    expect(DESK_SLOT_COUNT).toBe(9);
    for (const rotation of TABLE_ROTATIONS) {
      const slots = tableSlots(rotation);
      const rows = new Set(slots.map((slot) => Math.floor(slot / DESK_SLOT_COLUMNS)));
      const columns = new Set(slots.map((slot) => slot % DESK_SLOT_COLUMNS));
      expect(rows.size === 1 || columns.size === 1).toBe(true);
    }
  });

  it('draws a table about 2.5 tiles long', () => {
    expect(TABLE_LONG_SIDE_PX / 32).toBeGreaterThanOrEqual(2.4);
    expect(TABLE_LONG_SIDE_PX / 32).toBeLessThanOrEqual(2.6);
  });

  it('finds the table of a desk decor', () => {
    const items = [
      { slot: 4, rotation: 0, textureKey: 'art:plant-ficus:sheet' },
      { slot: 1, rotation: 180, textureKey: 'art:desk-glass:sheet' },
    ];
    expect(decorTableAt(items)).toEqual({ piece: 'desk-glass', rotation: 180, facing: 'up', slots: [0, 1, 2] });
    expect(decorTableAt(items.slice(0, 1))).toBeNull();
  });
});

describe('deskTable: what fits a desk', () => {
  it('takes chairs, plants, tables and legacy bundle sprites up to the desk size', () => {
    expect(fitsDeskDecor({ textureKey: 'art:chair-wood:sheet', w: 1, h: 1 })).toBe(true);
    expect(fitsDeskDecor({ textureKey: 'art:plant-upload-0123456789abcdef:sheet', w: 1, h: 1 })).toBe(true);
    expect(fitsDeskDecor({ textureKey: 'art:desk-wood:sheet', w: 3, h: 1 })).toBe(true);
    expect(fitsDeskDecor({ textureKey: 'plant-small', w: 1, h: 1 })).toBe(true);
  });

  it('refuses room tables and every map piece, and anything larger than the desk', () => {
    expect(DESK_DECOR_MAX_SIDE).toBe(3);
    for (const key of ['art:table-meeting:sheet', 'art:table-cafeteria:sheet', 'art:tree-oak:sheet', 'art:bridge-wood:sheet', 'art:floor-wood:sheet', 'art:wall-brick:sheet', 'art:character-p01-burgundy-suit:walk']) {
      expect(fitsDeskDecor({ textureKey: key, w: 1, h: 1 }), key).toBe(false);
    }
    expect(fitsDeskDecor({ textureKey: 'big-rug', w: 7, h: 5 })).toBe(false);
    expect(fitsDeskDecor({ textureKey: 'long-bench', w: 4, h: 1 })).toBe(false);
  });
});

describe('deskTable: conflicts in a desk decor', () => {
  const table = (slot: number, rotation: number) => ({ slot, rotation, textureKey: 'art:desk-wood:sheet' });
  const plant = (slot: number) => ({ slot, rotation: 0, textureKey: 'art:plant-ficus:sheet' });

  it('accepts one table on an edge with the rest of the 3x3 free', () => {
    expect(deskDecorConflict([table(7, 0), plant(0), plant(4)])).toBeNull();
    expect(deskDecorConflict([table(3, 270), plant(2)])).toBeNull();
  });

  it('refuses a table whose slot is not the middle of the edge its rotation picks', () => {
    expect(deskDecorConflict([table(4, 0)])).toBe('table-off-edge');
    expect(deskDecorConflict([table(1, 0)])).toBe('table-off-edge');
  });

  it('refuses a second table', () => {
    expect(deskDecorConflict([table(7, 0), table(1, 180)])).toBe('second-table');
  });

  it('refuses any item on a table tile', () => {
    expect(deskDecorConflict([table(7, 0), plant(6)])).toBe('on-table');
    expect(deskDecorConflict([plant(8), table(5, 90)])).toBe('on-table');
  });
});

describe('deskTable: default collision', () => {
  it('blocks the floor under the top, along the edge, centered on the anchor', () => {
    expect(tableFloorRect(0)).toEqual({ x: -40, y: -7, w: 80, h: 14 });
    expect(tableFloorRect(180)).toEqual(tableFloorRect(0));
    expect(tableFloorRect(90)).toEqual({ x: -12, y: -40, w: 24, h: 80 });
    expect(tableFloorRect(270)).toEqual(tableFloorRect(90));
  });
});
