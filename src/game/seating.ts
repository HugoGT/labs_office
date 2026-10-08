/**
 * Seats and the rules to take one (art migration, step 6). Shared by the
 * client, which offers a seat and draws the sitter, and by `OfficeRoom`,
 * which decides who actually sits: having a desk assigned and sitting at it
 * are different things, and only the second one is a seat.
 *
 * No imports but the Tiled layout, like `mapData.ts` and `officeLayout.ts`:
 * the server loads it with Node type stripping, so `TILE` and the facing
 * names are restated. A JSON import needs no `.ts` extension.
 */

import officeMap from './maps/office.json' with { type: 'json' };

/** Same as `TILE` in mapData.ts (pinned by `seating.test.ts`). */
export const SEATING_TILE = 32;

/** Way a sitter looks, the office facing vocabulary (`Facing`). */
export type SeatFacing = 'up' | 'down' | 'left' | 'right';

export interface MapSeat {
  readonly tx: number;
  readonly ty: number;
  readonly facing: SeatFacing;
}

const SEAT_FACINGS: readonly SeatFacing[] = ['up', 'down', 'left', 'right'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propertyOf(object: Record<string, unknown>, name: string): unknown {
  if (!Array.isArray(object.properties)) return undefined;
  const property = object.properties.find((candidate) => isRecord(candidate) && candidate.name === name);
  return isRecord(property) ? property.value : undefined;
}

/**
 * The chairs of the `seats` object layer of a Tiled layout (`officeLayout.ts`
 * reads the rest of it): one tile-sized object per chair, with a `facing` and
 * a `seat` index. The index, not the object order, is the chair's identity on
 * the wire (`map-<index>`), so indices must run 0..n-1 with no gap: a new
 * chair takes the next one, and an index is never reused for another chair.
 */
export function parseBaseMapSeats(raw: unknown): MapSeat[] {
  const layers = isRecord(raw) && Array.isArray(raw.layers) ? raw.layers : [];
  const layer = layers.find((candidate) => isRecord(candidate) && candidate.name === 'seats' && candidate.type === 'objectgroup');
  if (!isRecord(layer) || !Array.isArray(layer.objects)) throw new Error('Invalid office layout: no seats object layer');
  const byIndex = new Map<number, MapSeat>();
  for (const object of layer.objects) {
    if (!isRecord(object)) throw new Error('Invalid office layout: a seat is not an object');
    const index = propertyOf(object, 'seat');
    const facing = propertyOf(object, 'facing');
    const tx = typeof object.x === 'number' ? object.x / SEATING_TILE : Number.NaN;
    const ty = typeof object.y === 'number' ? object.y / SEATING_TILE : Number.NaN;
    if (!Number.isInteger(index) || (index as number) < 0) throw new Error(`Invalid office layout: seat object ${String(object.id)} has no seat index`);
    if (byIndex.has(index as number)) throw new Error(`Invalid office layout: seat ${String(index)} is used twice`);
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) throw new Error(`Invalid office layout: seat ${String(index)} is not on the 32px grid`);
    if (!SEAT_FACINGS.includes(facing as SeatFacing)) throw new Error(`Invalid office layout: seat ${String(index)} has facing ${String(facing)}`);
    byIndex.set(index as number, { tx, ty, facing: facing as SeatFacing });
  }
  const seats: MapSeat[] = [];
  for (let index = 0; index < byIndex.size; index += 1) {
    const seat = byIndex.get(index);
    if (seat === undefined) throw new Error(`Invalid office layout: seat ${index} is missing; seat indices run 0..n-1`);
    seats.push(seat);
  }
  return seats;
}

/**
 * Chairs of the base map, around the meeting room and cafeteria tables, from
 * the Tiled layout. Their index is their identity on the wire (`map-<index>`),
 * so new chairs take the next index. `mapBuilder.ts` draws exactly these.
 */
export const BASE_MAP_SEATS: readonly MapSeat[] = parseBaseMapSeats(officeMap);

/**
 * A desk seat looks the way every desk faces until desks store a facing
 * (`DEFAULT_DESK_FACING` in artPlacement.ts is this value).
 */
export const DESK_SEAT_FACING: SeatFacing = 'down';

export type SeatRef = { readonly kind: 'map'; readonly index: number } | { readonly kind: 'desk'; readonly deskId: string };

export function mapSeatId(index: number): string {
  return `map-${index}`;
}

export function deskSeatId(deskId: string): string {
  return `desk-${deskId}`;
}

const MAP_SEAT = /^map-(0|[1-9]\d{0,3})$/;
const DESK_SEAT = /^desk-([A-Za-z0-9-]{1,64})$/;

/**
 * Reads a seat reference from the wire. `null` for anything malformed or for
 * a base chair that does not exist; whether a desk exists is the server's to
 * ask its store.
 */
export function parseSeatRef(raw: unknown, mapSeatCount = BASE_MAP_SEATS.length): SeatRef | null {
  if (typeof raw !== 'string') return null;
  const map = MAP_SEAT.exec(raw);
  if (map) {
    const index = Number(map[1]);
    return index < mapSeatCount ? { kind: 'map', index } : null;
  }
  const desk = DESK_SEAT.exec(raw);
  return desk ? { kind: 'desk', deskId: desk[1] } : null;
}

/** A replicated seat is a wire reference, independent of this build's default
 * chair count. The server and scene resolve its existence against their layout. */
export function seatIdOf(raw: unknown, mapSeatCount = 10000): string | null {
  return parseSeatRef(raw, mapSeatCount) === null ? null : (raw as string);
}

/** Inclusive tile rectangle. */
export interface SeatTiles {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function mapSeatTiles(seat: MapSeat): SeatTiles {
  return { x0: seat.tx, y0: seat.ty, x1: seat.tx, y1: seat.ty };
}

/** A desk origin in tiles; its area is always 3x3 (`DESK_SIDE`). */
export function deskSeatTiles(desk: { readonly x: number; readonly y: number }): SeatTiles {
  return { x0: desk.x, y0: desk.y, x1: desk.x + 2, y1: desk.y + 2 };
}

/** Tiles around the seat's own tiles from which it can be taken. */
export const SEAT_REACH_TILES = 1;

/**
 * Whether someone at `position` (network position, world pixels) is close
 * enough to sit. Measured in tiles, not pixels: a one tile ring cannot reach
 * across a wall, which is always at least one tile thick, so sitting never
 * pulls anyone into a room from outside it.
 */
export function inSeatReach(position: { readonly x: number; readonly y: number }, tiles: SeatTiles): boolean {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
  const tx = Math.floor(position.x / SEATING_TILE);
  const ty = Math.floor(position.y / SEATING_TILE);
  return (
    tx >= tiles.x0 - SEAT_REACH_TILES &&
    tx <= tiles.x1 + SEAT_REACH_TILES &&
    ty >= tiles.y0 - SEAT_REACH_TILES &&
    ty <= tiles.y1 + SEAT_REACH_TILES
  );
}
