/**
 * Seats and the rules to take one (art migration, step 6). Shared by the
 * client, which offers a seat and draws the sitter, and by `OfficeRoom`,
 * which decides who actually sits: having a desk assigned and sitting at it
 * are different things, and only the second one is a seat.
 *
 * No imports, like `mapData.ts` and `artContract.ts`: the server loads it
 * with Node type stripping, so `TILE` and the facing names are restated.
 */

/** Same as `TILE` in mapData.ts (pinned by `seating.test.ts`). */
export const SEATING_TILE = 32;

/** Way a sitter looks, the office facing vocabulary (`Facing`). */
export type SeatFacing = 'up' | 'down' | 'left' | 'right';

export interface MapSeat {
  readonly tx: number;
  readonly ty: number;
  readonly facing: SeatFacing;
}

/**
 * Chairs of the base map, around the meeting room and cafeteria tables. Their
 * index is their identity on the wire (`map-<index>`), so new chairs go at the
 * end. `mapBuilder.ts` draws exactly these.
 */
export const BASE_MAP_SEATS: readonly MapSeat[] = (() => {
  const seats: MapSeat[] = [];
  // Sala de Juntas: both long sides of the table, then both ends.
  for (let i = 0; i < 7; i++) {
    seats.push({ tx: 53 + i, ty: 5, facing: 'down' });
    seats.push({ tx: 53 + i, ty: 11, facing: 'up' });
  }
  for (let j = 0; j < 5; j++) {
    seats.push({ tx: 52, ty: 6 + j, facing: 'right' });
    seats.push({ tx: 60, ty: 6 + j, facing: 'left' });
  }
  // Cafeteria: both long sides of its table.
  for (let i = 0; i < 5; i++) {
    seats.push({ tx: 53 + i, ty: 22, facing: 'down' });
    seats.push({ tx: 53 + i, ty: 26, facing: 'up' });
  }
  return seats;
})();

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
export function parseSeatRef(raw: unknown): SeatRef | null {
  if (typeof raw !== 'string') return null;
  const map = MAP_SEAT.exec(raw);
  if (map) {
    const index = Number(map[1]);
    return index < BASE_MAP_SEATS.length ? { kind: 'map', index } : null;
  }
  const desk = DESK_SEAT.exec(raw);
  return desk ? { kind: 'desk', deskId: desk[1] } : null;
}

/** A replicated seat as the client reads it: the reference, or `null` when standing. */
export function seatIdOf(raw: unknown): string | null {
  return parseSeatRef(raw) === null ? null : (raw as string);
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
