import { describe, expect, it } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { TILE } from './mapData';
import { DESK_SLOT_COUNT, deskSlotRect } from './deskLayout';
import { rotationForFacing } from './pieceCollisions';
import {
  CHAIR_PIECES,
  DECOR_SEAT_SLOTS,
  DESK_SEAT_FACING,
  decorChairAt,
  decorChairPiece,
  decorChairs,
  decorSeatFacing,
  decorSeatGround,
  decorSeatId,
  decorSeatTiles,
  MAX_CHAIR_EDITS,
  chairGround,
  chairSeatId,
  chairSeatTiles,
  decodeTerrainChairs,
  encodeTerrainChairs,
  isChairPieceId,
  withChairs,
  SEATING_TILE,
  deskSeatId,
  deskSeatTiles,
  inSeatReach,
  mapSeatId,
  mapSeatTiles,
  parseBaseMapSeats,
  parseSeatRef as parseReference,
  seatIdOf as readSeatId,
  type MapSeat,
} from './seating';
import { LEGACY_SEATS as BASE_MAP_SEATS } from '../test/legacyOffice';
const parseSeatRef = (raw: unknown) => parseReference(raw, BASE_MAP_SEATS.length);
const seatIdOf = (raw: unknown) => readSeatId(raw, BASE_MAP_SEATS.length);

describe('seating: seat references', () => {
  it('restates the map tile, since it cannot import mapData', () => {
    expect(SEATING_TILE).toBe(TILE);
  });

  it('names a base map chair by its index, a desk seat by its desk and a placed chair by its tile', () => {
    expect(mapSeatId(3)).toBe('map-3');
    expect(chairSeatId(4321)).toBe('chair-4321');
    expect(deskSeatId('0f5e2c1a-1111-4111-8111-111111111111')).toBe('desk-0f5e2c1a-1111-4111-8111-111111111111');
  });

  it('parses both kinds back', () => {
    expect(parseSeatRef('map-0')).toEqual({ kind: 'map', index: 0 });
    expect(parseSeatRef('desk-abc-123')).toEqual({ kind: 'desk', deskId: 'abc-123' });
    expect(parseSeatRef('chair-0')).toEqual({ kind: 'chair', index: 0 });
    expect(parseSeatRef('chair-25514')).toEqual({ kind: 'chair', index: 25514 });
  });

  it('rejects anything else, a base chair that does not exist included', () => {
    for (const raw of [undefined, null, 7, '', 'map-', 'map--1', `map-${BASE_MAP_SEATS.length}`, 'map-01', 'desk-', 'desk-a b', 'chair-', 'chair-01', 'chair--1', 'chair-1234567', `desk-${'x'.repeat(65)}`]) {
      expect(parseSeatRef(raw)).toBeNull();
    }
  });

  it('seatIdOf keeps a well formed reference and drops the rest (an older server sends none)', () => {
    expect(seatIdOf('map-2')).toBe('map-2');
    expect(seatIdOf('chair-17')).toBe('chair-17');
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

describe('seating: placed chairs', () => {
  const WIDTH = 10;
  const TILES = WIDTH * 8;

  it('names exactly the chair pieces of the art pack', () => {
    const pack = JSON.parse(exportedManifest) as { pieces: { id: string; kind: string }[] };
    expect([...CHAIR_PIECES].sort()).toEqual(pack.pieces.filter((piece) => piece.kind === 'chair').map((piece) => piece.id).sort());
    for (const piece of CHAIR_PIECES) expect(isChairPieceId(piece)).toBe(true);
    expect(isChairPieceId('chair-throne')).toBe(false);
    expect(isChairPieceId(null)).toBe(false);
    expect(MAX_CHAIR_EDITS).toBe(500);
  });

  it('stands on its tile: the ground point is the tile middle and the reach is that one tile', () => {
    expect(chairGround(WIDTH, 23)).toEqual({ x: 3.5 * TILE, y: 2.5 * TILE });
    expect(chairSeatTiles(WIDTH, 23)).toEqual({ x0: 3, y0: 2, x1: 3, y1: 2 });
    expect(inSeatReach({ x: 2 * TILE + 1, y: 1 * TILE + 1 }, chairSeatTiles(WIDTH, 23))).toBe(true);
    expect(inSeatReach({ x: 5 * TILE + 1, y: 2 * TILE + 1 }, chairSeatTiles(WIDTH, 23))).toBe(false);
  });

  it('places, turns and removes chairs one per tile, sorted by tile, leaving the input alone', () => {
    const none: readonly { index: number; piece: 'chair-wood'; facing: 'down' }[] = [];
    const placed = withChairs(none, [
      { index: 9, chair: { piece: 'chair-gamer', facing: 'left' } },
      { index: 2, chair: { piece: 'chair-wood', facing: 'down' } },
    ]);
    const turned = withChairs(placed, [{ index: 9, chair: { piece: 'chair-gamer', facing: 'up' } }]);
    const removed = withChairs(turned, [{ index: 2, chair: null }, { index: 50, chair: null }]);

    expect(placed).toEqual([
      { index: 2, piece: 'chair-wood', facing: 'down' },
      { index: 9, piece: 'chair-gamer', facing: 'left' },
    ]);
    expect(turned[1]).toEqual({ index: 9, piece: 'chair-gamer', facing: 'up' });
    expect(removed).toEqual([{ index: 9, piece: 'chair-gamer', facing: 'up' }]);
    expect(none).toEqual([]);
  });

  it('round-trips the chairs through a sparse wire form, and refuses anything else', () => {
    const chairs = withChairs([], [
      { index: 0, chair: { piece: 'chair-wood', facing: 'down' } },
      { index: TILES - 1, chair: { piece: 'chair-leather', facing: 'right' } },
      { index: 7, chair: { piece: 'chair-metal', facing: 'up' } },
    ]);
    const encoded = encodeTerrainChairs(chairs);

    expect(encoded).toBe(`0:wood:down,7:metal:up,${TILES - 1}:leather:right`);
    expect(decodeTerrainChairs(encoded, TILES)).toEqual(chairs);
    expect(encodeTerrainChairs([])).toBe('');
    expect(decodeTerrainChairs('', TILES)).toEqual([]);
    for (const garbage of [`${TILES}:wood:down`, '-1:wood:down', '3:throne:down', '3:wood:north', '3:wood', '3:wood:down,3:metal:up', ',', ' 3:wood:down']) {
      expect(decodeTerrainChairs(garbage, TILES), garbage).toBeNull();
    }
    expect(decodeTerrainChairs(42, TILES)).toBeNull();
    expect(decodeTerrainChairs(undefined, TILES)).toBeNull();
  });
});

describe('seating: decor chairs on a desk', () => {
  const DESK_ID = '0f5e2c1a-1111-4111-8111-111111111111';
  const DESK = { x: 10, y: 20 };

  it('names a decor chair by its desk and slot, and parses it back', () => {
    expect(decorSeatId(DESK_ID, 5)).toBe(`decor-${DESK_ID}-5`);
    expect(parseSeatRef(`decor-${DESK_ID}-5`)).toEqual({ kind: 'decor', deskId: DESK_ID, slot: 5 });
    expect(parseSeatRef('decor-a-0')).toEqual({ kind: 'decor', deskId: 'a', slot: 0 });
    expect(seatIdOf(`decor-${DESK_ID}-8`)).toBe(`decor-${DESK_ID}-8`);
    for (const raw of ['decor-', 'decor-a', 'decor-a-', 'decor-a-9', 'decor-a-10', 'decor--1', `decor-${'x'.repeat(65)}-1`, 'decor-a b-1']) {
      expect(parseSeatRef(raw), raw).toBeNull();
    }
  });

  it('has one seat per decor slot of the desk', () => {
    expect(DECOR_SEAT_SLOTS).toBe(DESK_SLOT_COUNT);
  });

  it('stands in its slot box: ground at the box middle, reach the box tile and the ring around it', () => {
    const desk = { x: DESK.x * TILE, y: DESK.y * TILE, w: 3 * TILE, h: 3 * TILE };
    for (let slot = 0; slot < DESK_SLOT_COUNT; slot += 1) {
      const box = deskSlotRect(desk, slot)!;
      expect(decorSeatGround(DESK, slot)).toEqual({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
      const tx = box.x / TILE;
      const ty = box.y / TILE;
      expect(decorSeatTiles(DESK, slot)).toEqual({ x0: tx, y0: ty, x1: tx, y1: ty });
    }
    expect(inSeatReach({ x: 14 * TILE - 1, y: 23 * TILE + 1 }, decorSeatTiles(DESK, 8))).toBe(true);
    expect(inSeatReach({ x: 14 * TILE, y: 23 * TILE + 1 }, decorSeatTiles(DESK, 8))).toBe(false);
  });

  it('faces down at rotation 0 and turns clockwise, the same way collisions turn a facing', () => {
    expect(decorSeatFacing(0)).toBe('down');
    expect(decorSeatFacing(90)).toBe('right');
    expect(decorSeatFacing(180)).toBe('up');
    expect(decorSeatFacing(270)).toBe('left');
    expect(decorSeatFacing(45)).toBe('down');
    for (const facing of ['left', 'right'] as const) {
      expect(rotationForFacing(facing)).toBe([0, 90, 180, 270].find((rotation) => decorSeatFacing(rotation) === facing));
    }
  });

  it('only a pack chair sheet is a decor chair', () => {
    expect(decorChairPiece('art:chair-wood:sheet')).toBe('chair-wood');
    expect(decorChairPiece('art:chair-gamer:sheet')).toBe('chair-gamer');
    for (const key of ['art:plant-ficus:sheet', 'art:chair-wood:seated', 'chair-wood', 'art:chair-:sheet', 'planta']) {
      expect(decorChairPiece(key), key).toBeNull();
    }
  });

  it('finds the decor chair of a slot among the occupant items, facing as its rotation says', () => {
    const items = [
      { slot: 1, rotation: 0, textureKey: 'art:plant-ficus:sheet' },
      { slot: 4, rotation: 270, textureKey: 'art:chair-leather:sheet' },
    ];
    expect(decorChairAt(items, 4)).toEqual({ piece: 'chair-leather', facing: 'left' });
    expect(decorChairAt(items, 1)).toBeNull();
    expect(decorChairAt(items, 2)).toBeNull();
    expect(decorChairs(items)).toEqual([{ slot: 4, piece: 'chair-leather', facing: 'left' }]);
  });
});
