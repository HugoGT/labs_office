import { describe, expect, it } from 'vitest';
import { TILE } from './mapData';
import {
  BASE_MAP_SEATS,
  DESK_SEAT_FACING,
  SEATING_TILE,
  deskSeatId,
  deskSeatTiles,
  inSeatReach,
  mapSeatId,
  mapSeatTiles,
  parseBaseMapSeats,
  parseSeatRef,
  seatIdOf,
  type MapSeat,
} from './seating';

describe('seating: seat references', () => {
  it('restates the map tile, since it cannot import mapData', () => {
    expect(SEATING_TILE).toBe(TILE);
  });

  it('names a base map chair by its index and a desk seat by its desk', () => {
    expect(mapSeatId(3)).toBe('map-3');
    expect(deskSeatId('0f5e2c1a-1111-4111-8111-111111111111')).toBe('desk-0f5e2c1a-1111-4111-8111-111111111111');
  });

  it('parses both kinds back', () => {
    expect(parseSeatRef('map-0')).toEqual({ kind: 'map', index: 0 });
    expect(parseSeatRef('desk-abc-123')).toEqual({ kind: 'desk', deskId: 'abc-123' });
  });

  it('rejects anything else, a base chair that does not exist included', () => {
    for (const raw of [undefined, null, 7, '', 'map-', 'map--1', `map-${BASE_MAP_SEATS.length}`, 'map-01', 'desk-', 'desk-a b', 'chair-1', `desk-${'x'.repeat(65)}`]) {
      expect(parseSeatRef(raw)).toBeNull();
    }
  });

  it('seatIdOf keeps a well formed reference and drops the rest (an older server sends none)', () => {
    expect(seatIdOf('map-2')).toBe('map-2');
    expect(seatIdOf('')).toBeNull();
    expect(seatIdOf(undefined)).toBeNull();
    expect(seatIdOf('nonsense')).toBeNull();
  });
});

describe('seating: base map chairs', () => {
  it('keeps the chairs of the meeting room and the cafeteria, each looking toward its table', () => {
    // 7 + 7 along the meeting table, 5 + 5 at its ends, 5 + 5 at the cafe table.
    expect(BASE_MAP_SEATS).toHaveLength(34);
    expect(BASE_MAP_SEATS[0]).toEqual({ tx: 53, ty: 5, facing: 'down' });
    expect(BASE_MAP_SEATS).toContainEqual({ tx: 53, ty: 11, facing: 'up' });
    expect(BASE_MAP_SEATS).toContainEqual({ tx: 52, ty: 6, facing: 'right' });
    expect(BASE_MAP_SEATS).toContainEqual({ tx: 60, ty: 10, facing: 'left' });
    expect(BASE_MAP_SEATS).toContainEqual({ tx: 57, ty: 26, facing: 'up' });
  });

  it('never repeats a tile', () => {
    const tiles = new Set(BASE_MAP_SEATS.map((seat) => `${seat.tx},${seat.ty}`));
    expect(tiles.size).toBe(BASE_MAP_SEATS.length);
  });

  it('keeps every chair at the index it had when the map was code: the index is its id on the wire', () => {
    // The loops `BASE_MAP_SEATS` was built with before the Tiled layout (art step 8).
    const before: MapSeat[] = [];
    for (let i = 0; i < 7; i++) {
      before.push({ tx: 53 + i, ty: 5, facing: 'down' });
      before.push({ tx: 53 + i, ty: 11, facing: 'up' });
    }
    for (let j = 0; j < 5; j++) {
      before.push({ tx: 52, ty: 6 + j, facing: 'right' });
      before.push({ tx: 60, ty: 6 + j, facing: 'left' });
    }
    for (let i = 0; i < 5; i++) {
      before.push({ tx: 53 + i, ty: 22, facing: 'down' });
      before.push({ tx: 53 + i, ty: 26, facing: 'up' });
    }

    expect(BASE_MAP_SEATS.slice(0, before.length)).toEqual(before);
  });
});

describe('seating: the seats layer of the Tiled layout', () => {
  const seatObject = (seat: number, tx: number, ty: number, facing = 'down', extra: Record<string, unknown> = {}) => ({
    id: 100 + seat,
    name: '',
    type: 'seat',
    x: tx * 32,
    y: ty * 32,
    width: 32,
    height: 32,
    rotation: 0,
    visible: true,
    properties: [
      { name: 'facing', type: 'string', value: facing },
      { name: 'seat', type: 'int', value: seat },
    ],
    ...extra,
  });
  const mapWith = (objects: unknown[]) => ({ layers: [{ type: 'objectgroup', name: 'seats', objects }] });

  it('orders the chairs by their seat property, not by where Tiled keeps the objects', () => {
    const seats = parseBaseMapSeats(mapWith([seatObject(1, 4, 5, 'up'), seatObject(0, 2, 3, 'left')]));

    expect(seats).toEqual([
      { tx: 2, ty: 3, facing: 'left' },
      { tx: 4, ty: 5, facing: 'up' },
    ]);
  });

  it('rejects a gap or a repeated index, which would rename chairs on the wire', () => {
    expect(() => parseBaseMapSeats(mapWith([seatObject(0, 1, 1), seatObject(2, 2, 2)]))).toThrow(/seat 1/);
    expect(() => parseBaseMapSeats(mapWith([seatObject(0, 1, 1), seatObject(0, 2, 2)]))).toThrow(/seat 0/);
  });

  it('rejects chairs off the grid, with an unknown facing, or a map without seats', () => {
    expect(() => parseBaseMapSeats(mapWith([seatObject(0, 1, 1, 'down', { x: 40 })]))).toThrow(/grid/);
    expect(() => parseBaseMapSeats(mapWith([seatObject(0, 1, 1, 'sideways')]))).toThrow(/facing/);
    expect(() => parseBaseMapSeats({ layers: [] })).toThrow(/seats/);
  });
});

describe('seating: reach', () => {
  it('a chair is in reach from its own tile and the eight around it', () => {
    const tiles = mapSeatTiles(BASE_MAP_SEATS[0]);
    const at = (tx: number, ty: number) => ({ x: tx * TILE + 16, y: ty * TILE + 16 });
    expect(inSeatReach(at(53, 5), tiles)).toBe(true);
    expect(inSeatReach(at(52, 4), tiles)).toBe(true);
    expect(inSeatReach(at(54, 6), tiles)).toBe(true);
    expect(inSeatReach(at(55, 5), tiles)).toBe(false);
    expect(inSeatReach(at(53, 3), tiles)).toBe(false);
  });

  it('measures by tile, so the far edge of the ring still counts and one pixel past it does not', () => {
    const tiles = mapSeatTiles({ tx: 10, ty: 10, facing: 'down' });
    expect(inSeatReach({ x: 9 * TILE, y: 9 * TILE }, tiles)).toBe(true);
    expect(inSeatReach({ x: 9 * TILE - 0.5, y: 9 * TILE }, tiles)).toBe(false);
    expect(inSeatReach({ x: 12 * TILE - 0.5, y: 12 * TILE - 0.5 }, tiles)).toBe(true);
    expect(inSeatReach({ x: 12 * TILE, y: 10 * TILE }, tiles)).toBe(false);
  });

  it('a desk seat is in reach from its 3x3 area and the ring around it', () => {
    const tiles = deskSeatTiles({ x: 10, y: 20 });
    expect(tiles).toEqual({ x0: 10, y0: 20, x1: 12, y1: 22 });
    expect(inSeatReach({ x: 9 * TILE + 1, y: 23 * TILE + 1 }, tiles)).toBe(true);
    expect(inSeatReach({ x: 14 * TILE + 1, y: 21 * TILE }, tiles)).toBe(false);
  });

  it('a desk seat looks the way desks face today', () => {
    expect(DESK_SEAT_FACING).toBe('down');
  });

  it('rejects positions that are not finite numbers', () => {
    const tiles = mapSeatTiles(BASE_MAP_SEATS[0]);
    expect(inSeatReach({ x: Number.NaN, y: 5 * TILE }, tiles)).toBe(false);
  });
});
