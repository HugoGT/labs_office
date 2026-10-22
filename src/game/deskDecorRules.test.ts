import { describe, expect, it } from 'vitest';
import {
  MAX_DESK_CHAIRS,
  MAX_DESK_OCCUPANCY,
  MAX_DESK_TABLES,
  deskAreaAt,
  deskBetweenTables,
  deskEntryRefused,
  deskOverChairLimit,
  displacedDeskTables,
  isOnDesk,
} from './deskDecorRules';
import { decorInfoFromPieceId, type DecorItem, type DecorRotation } from './officeDecor';

const W = 40;
const TILE = 32;
const at = (tx: number, ty: number) => ty * W + tx;
const infoOf = decorInfoFromPieceId;
const DESK = { x: 10, y: 10, w: 3, h: 3 };
const table = (tx: number, ty: number, rotation: DecorRotation = 0): DecorItem => ({ index: at(tx, ty), piece: 'desk-wood', rotation });
const chair = (tx: number, ty: number): DecorItem => ({ index: at(tx, ty), piece: 'chair-wood', rotation: 0 });

describe('desk decor limits', () => {
  it('names the limits the office enforces', () => {
    expect(MAX_DESK_TABLES).toBe(1);
    expect(MAX_DESK_CHAIRS).toBe(3);
    expect(MAX_DESK_OCCUPANCY).toBe(6);
  });
});

describe('isOnDesk', () => {
  it('counts an item whose footprint shares at least one tile with the desk', () => {
    // A table along the row just above the desk: no shared tile.
    expect(isOnDesk(table(11, 9), infoOf('desk-wood'), DESK, W)).toBe(false);
    // Anchored on the column left of the desk, its right end on the desk's first column.
    expect(isOnDesk(table(9, 10), infoOf('desk-wood'), DESK, W)).toBe(true);
    expect(isOnDesk(chair(12, 12), infoOf('chair-wood'), DESK, W)).toBe(true);
    expect(isOnDesk(chair(13, 12), infoOf('chair-wood'), DESK, W)).toBe(false);
  });
});

describe('deskBetweenTables', () => {
  it('is true when the desk area touches two or more distinct desk tables', () => {
    expect(deskBetweenTables(DESK, [table(11, 10)], infoOf, W)).toBe(false);
    expect(deskBetweenTables(DESK, [table(9, 10), table(13, 12)], infoOf, W)).toBe(true);
    // Chairs and tables away from the desk do not count.
    expect(deskBetweenTables(DESK, [table(11, 10), chair(12, 12), table(20, 20)], infoOf, W)).toBe(false);
  });
});

describe('displacedDeskTables', () => {
  it('a desk table placed on a desk displaces every other desk table on it', () => {
    const items = [table(11, 10), table(11, 12), table(20, 20)];
    expect(displacedDeskTables(items, [at(11, 12)], infoOf, [DESK], W)).toEqual([at(11, 10)]);
  });

  it('displaces a table only partly on the desk, and nothing off it or on another desk', () => {
    const other = { x: 20, y: 20, w: 3, h: 3 };
    const items = [table(9, 11), table(11, 12), table(21, 20)];
    expect(displacedDeskTables(items, [at(11, 12)], infoOf, [DESK, other], W)).toEqual([at(9, 11)]);
  });

  it('in a batch the last desk table placed on a desk wins', () => {
    const items = [table(11, 10), table(11, 12)];
    expect(displacedDeskTables(items, [at(11, 10), at(11, 12)], infoOf, [DESK], W)).toEqual([at(11, 10)]);
  });

  it('ignores placements that are not desk tables and placements off every desk', () => {
    const items = [table(11, 10), chair(12, 12), table(30, 30)];
    expect(displacedDeskTables(items, [at(12, 12), at(30, 30)], infoOf, [DESK], W)).toEqual([]);
  });
});

describe('deskOverChairLimit', () => {
  const three = [chair(10, 10), chair(11, 10), chair(12, 10)];

  it('is the desk a placed chair makes hold more than three chairs', () => {
    const after = [...three, chair(10, 12)];
    expect(deskOverChairLimit(three, after, [at(10, 12)], infoOf, [DESK], W)).toEqual(DESK);
    expect(deskOverChairLimit(three.slice(0, 2), three, [at(12, 10)], infoOf, [DESK], W)).toBeNull();
  });

  it('never refuses what does not add chairs: a turn, a move inside the desk, a stored excess', () => {
    const stored = [...three, chair(10, 12)];
    const turned = stored.map((item) => (item.index === at(10, 12) ? { ...item, rotation: 90 as const } : item));
    expect(deskOverChairLimit(stored, turned, [at(10, 12)], infoOf, [DESK], W)).toBeNull();
    const moved = [...three, chair(11, 12)];
    expect(deskOverChairLimit(stored, moved, [at(11, 12)], infoOf, [DESK], W)).toBeNull();
  });

  it('ignores chairs placed off every desk', () => {
    const after = [...three, chair(20, 20)];
    expect(deskOverChairLimit(three, after, [at(20, 20)], infoOf, [DESK], W)).toBeNull();
  });
});

describe('deskAreaAt', () => {
  it('is the desk whose 3x3 area holds the point, half open in pixels', () => {
    expect(deskAreaAt({ x: 10 * TILE, y: 10 * TILE }, [DESK], TILE)).toEqual(DESK);
    expect(deskAreaAt({ x: 13 * TILE - 0.5, y: 12 * TILE + 16 }, [DESK], TILE)).toEqual(DESK);
    expect(deskAreaAt({ x: 13 * TILE, y: 11 * TILE }, [DESK], TILE)).toBeNull();
    expect(deskAreaAt({ x: 10 * TILE - 1, y: 11 * TILE }, [DESK], TILE)).toBeNull();
  });
});

describe('deskEntryRefused', () => {
  const inside = { x: 11 * TILE + 16, y: 11 * TILE + 16 };
  const outside = { x: 9 * TILE, y: 11 * TILE };
  const people = (count: number) => Array.from({ length: count }, () => ({ ...inside }));

  it('refuses entering a desk that already holds six other people', () => {
    expect(deskEntryRefused(outside, inside, [DESK], people(6), TILE)).toEqual(DESK);
    expect(deskEntryRefused(outside, inside, [DESK], people(5), TILE)).toBeNull();
  });

  it('never refuses a move that stays inside the same desk or stays outside every desk', () => {
    expect(deskEntryRefused(inside, { x: inside.x + 8, y: inside.y }, [DESK], people(9), TILE)).toBeNull();
    expect(deskEntryRefused(outside, { x: outside.x - 8, y: outside.y }, [DESK], people(9), TILE)).toBeNull();
  });

  it('only counts the people inside that desk', () => {
    const elsewhere = Array.from({ length: 8 }, () => ({ x: 30 * TILE, y: 30 * TILE }));
    expect(deskEntryRefused(outside, inside, [DESK], elsewhere, TILE)).toBeNull();
  });
});
