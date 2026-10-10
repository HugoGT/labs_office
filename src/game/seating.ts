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

export const SEAT_FACINGS: readonly SeatFacing[] = ['up', 'down', 'left', 'right'];

export function isSeatFacing(value: unknown): value is SeatFacing {
  return typeof value === 'string' && (SEAT_FACINGS as readonly string[]).includes(value);
}

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

export type SeatRef =
  | { readonly kind: 'map'; readonly index: number }
  | { readonly kind: 'desk'; readonly deskId: string }
  | { readonly kind: 'chair'; readonly index: number }
  | { readonly kind: 'decor'; readonly deskId: string; readonly slot: number };

export function mapSeatId(index: number): string {
  return `map-${index}`;
}

export function deskSeatId(deskId: string): string {
  return `desk-${deskId}`;
}

/** A chair placed from the terrain editor, named by its tile (`ty * width + tx`). */
export function chairSeatId(index: number): string {
  return `chair-${index}`;
}

/** A chair someone put in a decor slot of their desk (`DeskDecorEditor`). */
export function decorSeatId(deskId: string, slot: number): string {
  return `decor-${deskId}-${slot}`;
}

const MAP_SEAT = /^map-(0|[1-9]\d{0,3})$/;
const DESK_SEAT = /^desk-([A-Za-z0-9-]{1,64})$/;
/** Six digits cover any tile of the 189x135 world and leave room for a bigger one. */
const CHAIR_SEAT = /^chair-(0|[1-9]\d{0,5})$/;
/** The desk id as in `DESK_SEAT`; the last `-<digit>` is the slot, 0..8. */
const DECOR_SEAT = /^decor-([A-Za-z0-9-]{1,64})-([0-8])$/;

/**
 * Reads a seat reference from the wire. `null` for anything malformed or for
 * a base chair that does not exist; whether a desk, a placed chair or a decor
 * chair exists is the server's to ask its store or its live terrain.
 */
export function parseSeatRef(raw: unknown, mapSeatCount = BASE_MAP_SEATS.length): SeatRef | null {
  if (typeof raw !== 'string') return null;
  const map = MAP_SEAT.exec(raw);
  if (map) {
    const index = Number(map[1]);
    return index < mapSeatCount ? { kind: 'map', index } : null;
  }
  const chair = CHAIR_SEAT.exec(raw);
  if (chair) return { kind: 'chair', index: Number(chair[1]) };
  const decor = DECOR_SEAT.exec(raw);
  if (decor) return { kind: 'decor', deskId: decor[1] as string, slot: Number(decor[2]) };
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

// --- Placed chairs (terrain editor) -------------------------------------------------------------

/**
 * The chair pieces of the art pack (pinned by a test against the manifest):
 * the only pieces the terrain editor places, one per tile.
 */
export const CHAIR_PIECES = ['chair-wood', 'chair-metal', 'chair-leather', 'chair-gamer'] as const;
export type ChairPieceId = (typeof CHAIR_PIECES)[number];

/** The most chairs one request may set: a dragged row of chairs is one request, never an unbounded one. */
export const MAX_CHAIR_EDITS = 500;

export function isChairPieceId(value: unknown): value is ChairPieceId {
  return typeof value === 'string' && (CHAIR_PIECES as readonly string[]).includes(value);
}

/**
 * A chair an admin placed: one per tile, `index` row major (`ty * width + tx`),
 * its ground point the middle of that tile, like a base map chair.
 */
export interface PlacedChair {
  readonly index: number;
  readonly piece: ChairPieceId;
  readonly facing: SeatFacing;
}

/** One tile of a chair edit: the chair to stand there, or `null` to remove the one there. */
export interface ChairEdit {
  readonly index: number;
  readonly chair: { readonly piece: ChairPieceId; readonly facing: SeatFacing } | null;
}

/** Tile column and row of a placed chair. */
function chairTile(width: number, index: number): { tx: number; ty: number } {
  return { tx: index % width, ty: Math.floor(index / width) };
}

/** Where a sitter's feet go: the middle of the chair's tile (`placeSeats` grounds base chairs the same way). */
export function chairGround(width: number, index: number): { x: number; y: number } {
  const { tx, ty } = chairTile(width, index);
  return { x: (tx + 0.5) * SEATING_TILE, y: (ty + 0.5) * SEATING_TILE };
}

/** A placed chair's own tile, like `mapSeatTiles`: the reach ring goes around it. */
export function chairSeatTiles(width: number, index: number): SeatTiles {
  const { tx, ty } = chairTile(width, index);
  return { x0: tx, y0: ty, x1: tx, y1: ty };
}

/** A copy of `chairs` with every edit applied in order, sorted by tile. */
export function withChairs(chairs: readonly PlacedChair[], edits: readonly ChairEdit[]): PlacedChair[] {
  const byTile = new Map(chairs.map((chair) => [chair.index, chair]));
  for (const { index, chair } of edits) {
    if (chair === null) byTile.delete(index);
    else byTile.set(index, { index, piece: chair.piece, facing: chair.facing });
  }
  return [...byTile.values()].sort((a, b) => a.index - b.index);
}

const CHAIR_PREFIX = 'chair-';

/**
 * The wire form of the placed chairs, a replicated string of the room state:
 * sparse like the walls, `<tile>:<material>:<facing>` per chair joined by
 * commas (`3:wood:down`), empty for none.
 */
export function encodeTerrainChairs(chairs: readonly PlacedChair[]): string {
  return [...chairs]
    .sort((a, b) => a.index - b.index)
    .map(({ index, piece, facing }) => `${index}:${piece.slice(CHAIR_PREFIX.length)}:${facing}`)
    .join(',');
}

/** The chairs of a wire string, sorted by tile, or `null` unless every entry is a known chair on a distinct tile of the map. */
export function decodeTerrainChairs(raw: unknown, tileCount: number): PlacedChair[] | null {
  if (typeof raw !== 'string') return null;
  if (raw === '') return [];
  const chairs = new Map<number, PlacedChair>();
  for (const part of raw.split(',')) {
    const match = /^(\d+):([a-z]+):([a-z]+)$/.exec(part);
    if (match === null) return null;
    const index = Number(match[1]);
    const piece = `${CHAIR_PREFIX}${match[2]}`;
    const facing = match[3];
    if (index >= tileCount || !isChairPieceId(piece) || !isSeatFacing(facing) || chairs.has(index)) return null;
    chairs.set(index, { index, piece, facing });
  }
  return [...chairs.values()].sort((a, b) => a.index - b.index);
}

// --- Decor chairs (desk decor) ------------------------------------------------------------------

/**
 * Decor slots of a desk, one seat each: `DESK_SLOT_COUNT` of deskLayout.ts
 * (pinned by a test), a 3x3 grid by rows over the 3x3 tile desk, so every
 * slot box is exactly one tile.
 */
export const DECOR_SEAT_SLOTS = 9;
const DECOR_SLOT_COLUMNS = 3;

/** The tile of a slot box, from the desk origin in tiles. */
function decorSlotTile(desk: { readonly x: number; readonly y: number }, slot: number): { tx: number; ty: number } {
  return { tx: desk.x + (slot % DECOR_SLOT_COLUMNS), ty: desk.y + Math.floor(slot / DECOR_SLOT_COLUMNS) };
}

/** Where a decor chair's sitter's feet go: the middle of its slot box (`deskSlotRect`), like a placed chair on its tile. */
export function decorSeatGround(desk: { readonly x: number; readonly y: number }, slot: number): { x: number; y: number } {
  const { tx, ty } = decorSlotTile(desk, slot);
  return { x: (tx + 0.5) * SEATING_TILE, y: (ty + 0.5) * SEATING_TILE };
}

/** The tile the slot box covers; the reach ring goes around it. */
export function decorSeatTiles(desk: { readonly x: number; readonly y: number }, slot: number): SeatTiles {
  const { tx, ty } = decorSlotTile(desk, slot);
  return { x0: tx, y0: ty, x1: tx, y1: ty };
}

/**
 * The facing of a decor chair from its item rotation: 0 is the pack's
 * default down drawing and the rotation turns it clockwise, so 90 is right,
 * 180 up and 270 left, the same pairing `rotationForFacing` of
 * pieceCollisions.ts uses (right 90, left 270). Anything else reads as down.
 */
export function decorSeatFacing(rotation: number): SeatFacing {
  if (rotation === 90) return 'right';
  if (rotation === 180) return 'up';
  if (rotation === 270) return 'left';
  return 'down';
}

const DECOR_CHAIR_KEY = /^art:(chair-[a-z0-9]+(?:-[a-z0-9]+)*):sheet$/;

/** The chair piece of a decor texture key (`art:chair-<x>:sheet`, what the pack chairs' decor assets carry), else `null`. */
export function decorChairPiece(textureKey: string): string | null {
  const match = DECOR_CHAIR_KEY.exec(textureKey);
  return match === null ? null : (match[1] as string);
}

/** The parts of a desk decor item a seat reads; both sides' `DeskItem` fit. */
export interface DecorSeatItem {
  readonly slot: number;
  readonly rotation: number;
  readonly textureKey: string;
}

/** The decor chair in `slot`, or `null` when that slot is empty or holds anything but a chair. */
export function decorChairAt(items: readonly DecorSeatItem[], slot: number): { piece: string; facing: SeatFacing } | null {
  const item = items.find((candidate) => candidate.slot === slot);
  const piece = item === undefined ? null : decorChairPiece(item.textureKey);
  return piece === null ? null : { piece, facing: decorSeatFacing(item!.rotation) };
}

/** Every decor chair of a desk's items, in item order. */
export function decorChairs(items: readonly DecorSeatItem[]): { slot: number; piece: string; facing: SeatFacing }[] {
  return items.flatMap((item) => {
    const piece = decorChairPiece(item.textureKey);
    return piece === null ? [] : [{ slot: item.slot, piece, facing: decorSeatFacing(item.rotation) }];
  });
}
