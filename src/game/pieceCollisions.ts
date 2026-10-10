/**
 * Collision areas per art piece (collision editor). A piece's collision is a
 * short list of axis-aligned rectangles in art pixels, measured from the
 * piece's anchor in its default (down-facing) orientation, and it applies to
 * every instance of that piece: the Tiled props, the base map chairs, the
 * served desks and the decor placed on them.
 *
 * A piece nobody edited keeps its default: the whole footprint for a layout
 * prop (exactly the tiles it blocked before this editor), nothing for the
 * pieces the database places (desks, decor, chairs). An edited piece with an
 * empty list is walk-through.
 *
 * The client collides its Arcade body with these rectangles and the room
 * refuses a `move` whose body center falls inside one, the same pairing as
 * the terrain tiles: the client body can never put its center inside
 * a rectangle it is kept out of, so the server never refuses a move the
 * client allowed.
 *
 * Avatar geometry comes from the same pure module as Phaser's setup. Explicit
 * .ts imports keep this shared code loadable by Node type stripping.
 */

import { AVATAR_BODY_CENTER_OFFSET, physicalBodyRect } from './avatarGeometry.ts';

/** Same as `TILE` in mapData.ts (pinned by a test). */
export const COLLISION_TILE = 32;
/** Rectangles per piece: enough to outline a trunk, a table and its legs, few enough to stay readable. */
export const MAX_COLLISION_RECTS = 8;
/**
 * Bound of every edge, in art pixels from the anchor. The largest frame (a
 * 256x192 room table) fits with room to spare.
 */
export const COLLISION_COORD_LIMIT = 512;
export const COLLISION_BODY_CENTER_OFFSET = AVATAR_BODY_CENTER_OFFSET;
/** `PLANT` of artContract.ts: decor plants are drawn squeezed into their slot box, so the frame sets the scale. */
export const DECOR_PLANT_FRAME = { width: 32, height: 48, anchor: { x: 16, y: 46 } } as const;

/** Pieces that stand in the world. Walls and hedges stay tile based; bridges are decks. */
export const EDITABLE_PIECE_KINDS = ['tree', 'plant', 'table', 'desk', 'chair'] as const;
export type EditablePieceKind = (typeof EDITABLE_PIECE_KINDS)[number];
const PIECE_ID = /^(tree|plant|table|desk|chair)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PIECE_ID_LENGTH = 100;

export interface CollisionPoint {
  readonly x: number;
  readonly y: number;
}

/** A rectangle: piece space (integers, from the anchor) or world pixels. */
export interface CollisionRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface WorldCollisionRect extends CollisionRect {
  readonly piece: string;
}

export interface CollisionBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Saved rectangles by piece id; a piece missing here keeps its default. */
export type CollisionTable = ReadonlyMap<string, readonly CollisionRect[]>;

export type CollisionRotation = 0 | 90 | 180 | 270;
export type CollisionFacing = 'up' | 'down' | 'left' | 'right';

export class InvalidCollisionRectsError extends Error {
  constructor(message: string) {
    super(`Invalid collision rectangles: ${message}`);
    this.name = 'InvalidCollisionRectsError';
  }
}

// --- Validation --------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRect(raw: unknown, index: number): CollisionRect {
  if (!isRecord(raw)) throw new InvalidCollisionRectsError(`rectangle ${index} is not an object`);
  const { x, y, w, h } = raw;
  for (const value of [x, y, w, h]) {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new InvalidCollisionRectsError(`rectangle ${index} needs integer x, y, w and h`);
  }
  const rect = { x: x as number, y: y as number, w: w as number, h: h as number };
  if (rect.w < 1 || rect.h < 1) throw new InvalidCollisionRectsError(`rectangle ${index} is empty`);
  const inside = (value: number): boolean => value >= -COLLISION_COORD_LIMIT && value <= COLLISION_COORD_LIMIT;
  if (!inside(rect.x) || !inside(rect.y) || !inside(rect.x + rect.w) || !inside(rect.y + rect.h)) {
    throw new InvalidCollisionRectsError(`rectangle ${index} reaches beyond ${COLLISION_COORD_LIMIT}px from the anchor`);
  }
  return rect;
}

/** The rectangles of a request body or a stored row. Throws `InvalidCollisionRectsError`. */
export function parseCollisionRects(raw: unknown): CollisionRect[] {
  if (!Array.isArray(raw)) throw new InvalidCollisionRectsError('not a list');
  if (raw.length > MAX_COLLISION_RECTS) throw new InvalidCollisionRectsError(`more than ${MAX_COLLISION_RECTS} rectangles`);
  return raw.map(parseRect);
}

export function isEditablePieceId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PIECE_ID_LENGTH && PIECE_ID.test(value);
}

/** The piece of an art sheet texture key (`art:<id>:sheet`, `artSheetKey` in artPack.ts), else `null`. */
export function pieceIdOfTextureKey(key: string): string | null {
  const match = /^art:([^:@]+):sheet$/.exec(key);
  return match === null ? null : (match[1] as string);
}

// --- Geometry ----------------------------------------------------------------------------------

/**
 * How a piece turns with its facing. Facings pick another drawing of the
 * same piece rather than rotating it: up keeps the down silhouette, and
 * left and right turn it a quarter, as their footprint does (2x1 to 1x2).
 */
export function rotationForFacing(facing: CollisionFacing | null): CollisionRotation {
  if (facing === 'right') return 90;
  if (facing === 'left') return 270;
  return 0;
}

/** Turns a point clockwise (screen y grows down, like Phaser angles) about the origin. */
function rotatePoint(point: CollisionPoint, rotation: CollisionRotation): CollisionPoint {
  switch (rotation) {
    case 90:
      return { x: -point.y, y: point.x };
    case 180:
      return { x: -point.x, y: -point.y };
    case 270:
      return { x: point.y, y: -point.x };
    default:
      return point;
  }
}

function inverse(rotation: CollisionRotation): CollisionRotation {
  return ((360 - rotation) % 360) as CollisionRotation;
}

/** `-0` reads as `0`, so rectangles compare and serialize plainly. */
function plain(value: number): number {
  return value === 0 ? 0 : value;
}

function boundsOf(corners: readonly CollisionPoint[]): CollisionRect {
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: plain(x), y: plain(y), w: plain(Math.max(...xs) - x), h: plain(Math.max(...ys) - y) };
}

function cornersOf(rect: CollisionRect): CollisionPoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x + rect.w, y: rect.y + rect.h },
  ];
}

export function rotateRect(rect: CollisionRect, rotation: CollisionRotation): CollisionRect {
  if (rotation === 0) return rect;
  return boundsOf(cornersOf(rect).map((corner) => rotatePoint(corner, rotation)));
}

// --- Instances ---------------------------------------------------------------------------------

/**
 * One placed piece. Piece space maps to the world as
 * `pivot + rotate(scale * point + offset)`: plain pieces have scale 1 and no
 * offset, decor squeezed into a slot box scales about the box center.
 */
export interface CollisionInstance {
  readonly piece: string;
  readonly pivot: CollisionPoint;
  readonly rotation: CollisionRotation;
  readonly scale: CollisionPoint;
  readonly offset: CollisionPoint;
  /** Rectangles with no saved row, around `pivot` and already in world orientation. */
  readonly defaults: readonly CollisionRect[];
  /** Where a click picks this instance in the editor, in world pixels. */
  readonly pickBox: CollisionRect;
}

const UNIT = { x: 1, y: 1 } as const;
const ORIGIN = { x: 0, y: 0 } as const;

/** The parts of a Tiled prop (`LayoutProp` of officeLayout.ts) this module reads. */
export interface CollisionLayoutProp {
  readonly piece: string;
  readonly kind: string;
  readonly tx: number;
  readonly ty: number;
  readonly w: number;
  readonly h: number;
  readonly collision: 'solid' | 'deck';
  readonly facing: CollisionFacing | null;
}

/**
 * Instances of the Tiled props. A desk is measured from its middle (its art
 * anchor sits there), every other prop from the bottom middle of its
 * footprint (`propPlacement` in artContract.ts). Bridges stay out: their deck
 * is terrain, and the tiles decide it.
 */
export function layoutPropInstances(props: readonly CollisionLayoutProp[]): CollisionInstance[] {
  const instances: CollisionInstance[] = [];
  for (const prop of props) {
    if (prop.collision !== 'solid') continue;
    const footprint = { x: prop.tx * COLLISION_TILE, y: prop.ty * COLLISION_TILE, w: prop.w * COLLISION_TILE, h: prop.h * COLLISION_TILE };
    const desk = prop.kind === 'desk';
    const pivot = { x: footprint.x + footprint.w / 2, y: desk ? footprint.y + footprint.h / 2 : footprint.y + footprint.h };
    instances.push({
      piece: prop.piece,
      pivot,
      rotation: desk ? rotationForFacing(prop.facing) : 0,
      scale: UNIT,
      offset: ORIGIN,
      defaults: [{ x: footprint.x - pivot.x, y: footprint.y - pivot.y, w: footprint.w, h: footprint.h }],
      pickBox: footprint,
    });
  }
  return instances;
}

/** Instances of the base map chairs, on their ground point (`placeSeats` in mapBuilder.ts). */
export function seatInstances(
  seats: readonly { readonly tx: number; readonly ty: number; readonly facing: CollisionFacing }[],
  chairPiece: string,
): CollisionInstance[] {
  return seats.map(({ tx, ty, facing }) => ({
    piece: chairPiece,
    pivot: { x: (tx + 0.5) * COLLISION_TILE, y: (ty + 0.5) * COLLISION_TILE },
    rotation: rotationForFacing(facing),
    scale: UNIT,
    offset: ORIGIN,
    defaults: [],
    pickBox: { x: tx * COLLISION_TILE, y: ty * COLLISION_TILE, w: COLLISION_TILE, h: COLLISION_TILE },
  }));
}

/**
 * Instances of the chairs placed from the terrain editor (`PlacedChair` of
 * seating.ts, restated here to stay import-free): each its own piece on the
 * middle of its tile, exactly like a base chair, so a chair piece's saved
 * rectangles apply to every chair of it.
 */
export function placedChairInstances(
  chairs: readonly { readonly index: number; readonly piece: string; readonly facing: CollisionFacing }[],
  width: number,
): CollisionInstance[] {
  return chairs.flatMap(({ index, piece, facing }) => seatInstances([{ tx: index % width, ty: Math.floor(index / width), facing }], piece));
}

/** The chair of the base map's rooms (`BASE_MAP_CHAIR` of mapBuilder.ts, pinned by a test). */
export const BASE_CHAIR_PIECE = 'chair-wood';

/** The instances that never change while the server runs: the Tiled props and the base map chairs. */
export function staticCollisionInstances(
  props: readonly CollisionLayoutProp[],
  seats: readonly { readonly tx: number; readonly ty: number; readonly facing: CollisionFacing }[],
): CollisionInstance[] {
  return [...layoutPropInstances(props), ...seatInstances(seats, BASE_CHAIR_PIECE)];
}

/** A served desk area in world pixels, with its material and the pieces of its decor. */
export interface CollisionDesk {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly materialId: string | null;
  readonly items: readonly { readonly slot: number; readonly rotation: number; readonly pieceId: string | null }[];
}

const SLOT_COLUMNS = 3;
const SLOT_COUNT = 9;

function isRotation(value: number): value is CollisionRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/**
 * Instances of the served desks (furniture in the middle of the area, facing
 * down like `DEFAULT_DESK_FACING`) and of the plants and chairs of their
 * decor, each in its slot box (`deskSlotRect`). A decor plant is drawn
 * squeezed into its box and turned by the item rotation, so its rectangles
 * are too; a decor chair stands 1:1 on the box middle in the facing its
 * rotation picks. Decor that is neither has no piece and never collides.
 */
export function deskInstances(desks: readonly CollisionDesk[]): CollisionInstance[] {
  const instances: CollisionInstance[] = [];
  for (const desk of desks) {
    if (desk.materialId === null) continue;
    instances.push({
      piece: desk.materialId,
      pivot: { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 },
      rotation: 0,
      scale: UNIT,
      offset: ORIGIN,
      defaults: [],
      pickBox: { x: desk.x, y: desk.y, w: desk.w, h: desk.h },
    });
    const boxW = desk.w / SLOT_COLUMNS;
    const boxH = desk.h / SLOT_COLUMNS;
    for (const item of desk.items) {
      if (item.pieceId === null) continue;
      const chair = item.pieceId.startsWith('chair-');
      if (!chair && !item.pieceId.startsWith('plant-')) continue;
      if (!Number.isInteger(item.slot) || item.slot < 0 || item.slot >= SLOT_COUNT) continue;
      const box = { x: desk.x + (item.slot % SLOT_COLUMNS) * boxW, y: desk.y + Math.floor(item.slot / SLOT_COLUMNS) * boxH, w: boxW, h: boxH };
      if (chair) {
        // A decor chair is drawn 1:1 on the middle of its box like a placed
        // chair on its tile, and its rotation picks a facing
        // (`decorSeatFacing` of seating.ts: 90 right, 180 up, 270 left), so
        // it turns as that facing does: up keeps the down rectangles.
        const rotation = item.rotation === 90 || item.rotation === 270 ? item.rotation : 0;
        instances.push({ piece: item.pieceId, pivot: { x: box.x + boxW / 2, y: box.y + boxH / 2 }, rotation, scale: UNIT, offset: ORIGIN, defaults: [], pickBox: box });
        continue;
      }
      const scale = { x: boxW / DECOR_PLANT_FRAME.width, y: boxH / DECOR_PLANT_FRAME.height };
      instances.push({
        piece: item.pieceId,
        pivot: { x: box.x + boxW / 2, y: box.y + boxH / 2 },
        rotation: isRotation(item.rotation) ? item.rotation : 0,
        scale,
        offset: { x: scale.x * DECOR_PLANT_FRAME.anchor.x - boxW / 2, y: scale.y * DECOR_PLANT_FRAME.anchor.y - boxH / 2 },
        defaults: [],
        pickBox: box,
      });
    }
  }
  return instances;
}

/** A piece-space rectangle of `instance` in the world. */
function placeRect(instance: CollisionInstance, rect: CollisionRect): CollisionRect {
  const { pivot, scale, offset, rotation } = instance;
  return boundsOf(
    cornersOf(rect).map((corner) => {
      const turned = rotatePoint({ x: scale.x * corner.x + offset.x, y: scale.y * corner.y + offset.y }, rotation);
      return { x: pivot.x + turned.x, y: pivot.y + turned.y };
    }),
  );
}

/** The world rectangles of one instance: its piece's saved ones, else its defaults. */
export function worldRectsOf(instance: CollisionInstance, table: CollisionTable): CollisionRect[] {
  const saved = table.get(instance.piece);
  if (saved !== undefined) return saved.map((rect) => placeRect(instance, rect));
  return instance.defaults.map((rect) => ({ x: instance.pivot.x + rect.x, y: instance.pivot.y + rect.y, w: rect.w, h: rect.h }));
}

/** Every collision rectangle of the world, tagged with its piece. */
export function collisionWorld(instances: readonly CollisionInstance[], table: CollisionTable): WorldCollisionRect[] {
  return instances.flatMap((instance) => worldRectsOf(instance, table).map((rect) => ({ piece: instance.piece, ...rect })));
}

// --- Checks ------------------------------------------------------------------------------------

function containsPoint(rect: CollisionRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/**
 * Whether a network position puts the avatar's body center inside a
 * rectangle: the point the client's physics keeps out, half open like a tile.
 * A position that is not a number is blocked.
 */
export function isPositionBlocked(rects: readonly CollisionRect[], x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  const cx = x + COLLISION_BODY_CENTER_OFFSET.x;
  const cy = y + COLLISION_BODY_CENTER_OFFSET.y;
  return rects.some((rect) => containsPoint(rect, cx, cy));
}

/** The Arcade body of an avatar at a network position (`physicalBodyRect`). */
export function bodyBoxAt(position: CollisionPoint): CollisionBox {
  return physicalBodyRect(position);
}

function overlaps(rect: CollisionRect, box: CollisionBox): boolean {
  return rect.x < box.x + box.width && box.x < rect.x + rect.w && rect.y < box.y + box.height && box.y < rect.y + rect.h;
}

/** Whether `box` overlaps a rectangle; touching edges do not count. */
export function boxOverlapsRects(rects: readonly CollisionRect[], box: CollisionBox): boolean {
  return rects.some((rect) => overlaps(rect, box));
}

/**
 * Tiles (row major) a rectangle overlaps at all. The tile helpers (auto-walk,
 * free tile next to someone, the e2e teleport) treat such a tile as blocked
 * even when the rectangle covers a corner of it: they pick whole tiles, and
 * a tile center may be inside the rectangle.
 */
export function coveredTiles(rects: readonly CollisionRect[], width: number, height: number): boolean[] {
  const tiles = new Array<boolean>(width * height).fill(false);
  for (const rect of rects) {
    const x0 = Math.max(0, Math.floor(rect.x / COLLISION_TILE));
    const y0 = Math.max(0, Math.floor(rect.y / COLLISION_TILE));
    const x1 = Math.min(width - 1, Math.ceil((rect.x + rect.w) / COLLISION_TILE) - 1);
    const y1 = Math.min(height - 1, Math.ceil((rect.y + rect.h) / COLLISION_TILE) - 1);
    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) tiles[ty * width + tx] = true;
    }
  }
  return tiles;
}

// --- Wire form ---------------------------------------------------------------------------------

/**
 * The table as one replicated string of the room state, like the terrain
 * blocks: a few pieces with a few rectangles each, so an edit resends it all.
 * `{"<piece>": [[x, y, w, h], ...]}`, pieces sorted.
 */
export function encodeCollisionTable(table: CollisionTable): string {
  const entries = [...table.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(Object.fromEntries(entries.map(([piece, rects]) => [piece, rects.map(({ x, y, w, h }) => [x, y, w, h])])));
}

/** The table of a wire string, without the entries that do not validate; `null` if it is not one. */
export function decodeCollisionTable(raw: unknown): Map<string, readonly CollisionRect[]> | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const table = new Map<string, readonly CollisionRect[]>();
  for (const [piece, value] of Object.entries(parsed)) {
    if (!isEditablePieceId(piece) || !Array.isArray(value)) continue;
    try {
      const rects = parseCollisionRects(
        value.map((entry: unknown) => (Array.isArray(entry) && entry.length === 4 ? { x: entry[0], y: entry[1], w: entry[2], h: entry[3] } : entry)),
      );
      table.set(piece, rects);
    } catch {
      // A bad entry is dropped alone; the rest of the table still applies.
    }
  }
  return table;
}

// --- Editing support ---------------------------------------------------------------------------

/** A world point of `instance` in its piece space (art pixels from the anchor, down-facing). */
export function toPiecePoint(instance: CollisionInstance, point: CollisionPoint): CollisionPoint {
  const turned = rotatePoint({ x: point.x - instance.pivot.x, y: point.y - instance.pivot.y }, inverse(instance.rotation));
  return { x: plain((turned.x - instance.offset.x) / instance.scale.x), y: plain((turned.y - instance.offset.y) / instance.scale.y) };
}

/** A world rectangle of `instance` in its piece space, rounded to whole art pixels. */
export function toPieceRect(instance: CollisionInstance, rect: CollisionRect): CollisionRect {
  const bounds = boundsOf(cornersOf(rect).map((corner) => toPiecePoint(instance, corner)));
  const x = Math.round(bounds.x);
  const y = Math.round(bounds.y);
  return { x: plain(x), y: plain(y), w: Math.max(1, Math.round(bounds.x + bounds.w) - x), h: Math.max(1, Math.round(bounds.y + bounds.h) - y) };
}

/**
 * What the editor starts from for the piece of `instance`: its saved
 * rectangles, or the instance's defaults turned back into piece space.
 */
export function pieceRectsOf(instance: CollisionInstance, table: CollisionTable): { rects: CollisionRect[]; saved: boolean } {
  const saved = table.get(instance.piece);
  if (saved !== undefined) return { rects: [...saved], saved: true };
  return { rects: worldRectsOf(instance, table).map((rect) => toPieceRect(instance, rect)), saved: false };
}

/**
 * The instance under a point, by its pick box or one of its rectangles. The
 * smallest hit wins, so a decor plant is picked over the desk it stands on.
 */
export function pickInstance(instances: readonly CollisionInstance[], table: CollisionTable, point: CollisionPoint): CollisionInstance | null {
  let best: CollisionInstance | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const instance of instances) {
    const hits = [instance.pickBox, ...worldRectsOf(instance, table)].filter((rect) => containsPoint(rect, point.x, point.y));
    for (const rect of hits) {
      const area = rect.w * rect.h;
      if (area < bestArea) {
        best = instance;
        bestArea = area;
      }
    }
  }
  return best;
}
