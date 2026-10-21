/**
 * The office decor layer (#208): every piece of furniture people put in the
 * office (chairs, desk tables, plants and room tables) lives in ONE map-level
 * layer, anchored per tile and independent of desks. A desk is only a
 * claimable 3x3 zone; whatever stands on it is decor like any other, and it
 * stays when the desk changes hands, moves or goes away.
 *
 * Shared by the room, the server's rules and routes, the collisions and the
 * scene. Import-free on purpose, like `pieceCollisions.ts`: the server loads
 * it with Node type stripping, so callers resolve a piece through their art
 * catalog (the server's `art_pieces`, the client's manifest) and pass its
 * `DecorPieceInfo` in.
 */

/** 0 is the pack's default down drawing and the rotation turns it clockwise: 90 right, 180 up, 270 left. */
export type DecorRotation = 0 | 90 | 180 | 270;
export const DECOR_ROTATIONS: readonly DecorRotation[] = [0, 90, 180, 270];

/** The art piece kinds the decor layer places. */
export type DecorKind = 'chair' | 'desk' | 'plant' | 'table';
export const DECOR_KINDS: readonly DecorKind[] = ['chair', 'desk', 'plant', 'table'];

/** The most items one request may set, like the placed chairs before them. */
export const MAX_DECOR_EDITS = 500;

/** The longest piece id the layer takes; the art vocabulary never comes close. */
const MAX_DECOR_PIECE_ID_LENGTH = 100;
/** Lower-case words joined by single hyphens: never a `:` or a `,`, which the wire form uses. */
const DECOR_PIECE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/** A color of a colorable piece: strict lower-case `#rrggbb`, the art pack's own form. */
const DECOR_COLOR = /^#[0-9a-f]{6}$/;

/**
 * One placed piece: `index` is its anchor tile, row major (`ty * width + tx`).
 * `color` only on a colorable piece painted in a color of its own; absent, it
 * draws in its manifest default.
 */
export interface DecorItem {
  readonly index: number;
  readonly piece: string;
  readonly rotation: DecorRotation;
  readonly color?: string;
}

/** One tile of a decor edit: the piece to anchor there, or `null` to remove the one anchored there. */
export interface DecorEdit {
  readonly index: number;
  readonly item: { readonly piece: string; readonly rotation: DecorRotation; readonly color?: string } | null;
}

/**
 * What the rules need of a piece: its kind and its footprint in tiles
 * (rotation 0), and `colorable` (only ever `true`, else absent) when it takes
 * a color of its own.
 */
export interface DecorPieceInfo {
  readonly kind: DecorKind;
  readonly footprint: { readonly w: number; readonly h: number };
  readonly colorable?: true;
}

/** A rectangle in tiles. */
export interface DecorTileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where an item stands and how it is turned; its piece is optional, the footprint does not read it. */
export type DecorPlacement = Pick<DecorItem, 'index' | 'rotation'> & Partial<Pick<DecorItem, 'piece'>>;

/** Way a sitter looks; the office facing vocabulary, restated to stay import-free. */
export type DecorFacing = 'up' | 'down' | 'left' | 'right';

export function isDecorRotation(value: unknown): value is DecorRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

export function isDecorKind(value: unknown): value is DecorKind {
  return typeof value === 'string' && (DECOR_KINDS as readonly string[]).includes(value);
}

export function isDecorPieceId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_DECOR_PIECE_ID_LENGTH && DECOR_PIECE_ID.test(value);
}

export function isDecorColor(value: unknown): value is string {
  return typeof value === 'string' && DECOR_COLOR.test(value);
}

/** Chairs, desk tables and room tables turn; a plant is drawn in one frame. */
export function isRotatable(kind: DecorKind): boolean {
  return kind !== 'plant';
}

/**
 * The rotations a kind takes. A room table is symmetric, so 180 and 270
 * would draw and cover exactly what 0 and 90 do: it has a horizontal (0) and
 * a vertical (90) frame only.
 */
export function decorRotationsOf(kind: DecorKind): readonly DecorRotation[] {
  if (kind === 'table') return [0, 90];
  return isRotatable(kind) ? DECOR_ROTATIONS : [0];
}

/** `rotation` as `kind` can take it: a room table's symmetric turn, 0 for a plant. */
export function decorRotationFor(kind: DecorKind, rotation: DecorRotation): DecorRotation {
  if (kind === 'table') return rotation === 90 || rotation === 270 ? 90 : 0;
  return isRotatable(kind) ? rotation : 0;
}

/** A chair is 1x1 and a desk table 3x1 whatever the manifest says (its art states one footprint per facing). */
const FIXED_FOOTPRINTS: Partial<Record<DecorKind, { w: number; h: number }>> = {
  chair: { w: 1, h: 1 },
  desk: { w: 3, h: 1 },
};

/**
 * The decor info of an art piece (a manifest entry or a catalog piece), or
 * `null` when the decor layer does not place that kind: plants and room
 * tables bring their footprint, chairs and desk tables have a fixed one.
 */
export function decorPieceInfo(piece: {
  readonly kind: string;
  readonly footprint?: { readonly w: number; readonly h: number };
  readonly colorable?: boolean;
}): DecorPieceInfo | null {
  if (!isDecorKind(piece.kind)) return null;
  const fixed = FIXED_FOOTPRINTS[piece.kind];
  // Only desk tables are colorable in the art contract (`ArtDeskPiece.colorable`).
  if (fixed !== undefined) return { kind: piece.kind, footprint: fixed, ...(piece.kind === 'desk' && piece.colorable === true ? { colorable: true as const } : {}) };
  const footprint = piece.footprint;
  if (footprint === undefined || !Number.isInteger(footprint.w) || !Number.isInteger(footprint.h) || footprint.w < 1 || footprint.h < 1) return null;
  return { kind: piece.kind, footprint: { w: footprint.w, h: footprint.h } };
}

/**
 * What the id alone says when no catalog knows the piece: chairs and desk
 * tables have a fixed footprint and plants take one tile; a room table's
 * footprint only its catalog entry has, so it is `null`.
 */
export function decorInfoFromPieceId(piece: string): DecorPieceInfo | null {
  const kind = piece.slice(0, piece.indexOf('-'));
  if (kind === 'chair' || kind === 'desk') return decorPieceInfo({ kind });
  if (kind === 'plant') return decorPieceInfo({ kind, footprint: { w: 1, h: 1 } });
  return null;
}

/**
 * The tiles an item covers. A chair stands on its anchor; a desk table lies
 * along a row (0, 180) or a column (90, 270) with its anchor the middle tile,
 * the old decor table's edge middle; a plant or a room table is centered on
 * its anchor (`floor(w / 2)`, `floor(h / 2)` from its top-left), a room
 * table turned vertical (90) on its footprint swapped. An unknown
 * piece (`null`) keeps its anchor tile alone, so stored rows are never lost.
 */
export function decorFootprint(item: DecorPlacement, info: DecorPieceInfo | null, width: number): DecorTileRect {
  const tx = item.index % width;
  const ty = Math.floor(item.index / width);
  if (info === null) return { x: tx, y: ty, w: 1, h: 1 };
  if (info.kind === 'chair') return { x: tx, y: ty, w: 1, h: 1 };
  if (info.kind === 'desk') {
    const horizontal = item.rotation === 0 || item.rotation === 180;
    return horizontal ? { x: tx - 1, y: ty, w: 3, h: 1 } : { x: tx, y: ty - 1, w: 1, h: 3 };
  }
  const vertical = info.kind === 'table' && decorRotationFor('table', item.rotation) === 90;
  const w = vertical ? info.footprint.h : info.footprint.w;
  const h = vertical ? info.footprint.w : info.footprint.h;
  return { x: tx - Math.floor(w / 2), y: ty - Math.floor(h / 2), w, h };
}

/** Every tile of a footprint rectangle, row major (`ty * width + tx`). */
export function rectTiles(rect: DecorTileRect, width: number): number[] {
  const tiles: number[] = [];
  for (let ty = rect.y; ty < rect.y + rect.h; ty += 1) {
    for (let tx = rect.x; tx < rect.x + rect.w; tx += 1) tiles.push(ty * width + tx);
  }
  return tiles;
}

/** The tiles of an item's footprint, row major. */
export function decorTiles(item: DecorPlacement, info: DecorPieceInfo | null, width: number): number[] {
  return rectTiles(decorFootprint(item, info, width), width);
}

/** Whether a footprint lies entirely on the map. */
export function insideMap(rect: DecorTileRect, width: number, height: number): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= width && rect.y + rect.h <= height;
}

/** Whether a footprint lies entirely inside a desk area (both in tiles): the only place its occupant may edit. */
export function fitsInsideDesk(footprint: DecorTileRect, desk: DecorTileRect): boolean {
  return footprint.x >= desk.x && footprint.y >= desk.y && footprint.x + footprint.w <= desk.x + desk.w && footprint.y + footprint.h <= desk.y + desk.h;
}

/**
 * The anchor of the first item whose footprint shares a tile with an earlier
 * item's, or `null` when no two items overlap.
 */
export function findDecorOverlap(items: readonly DecorItem[], infoOf: (piece: string) => DecorPieceInfo | null, width: number): number | null {
  const taken = new Set<number>();
  for (const item of items) {
    const tiles = decorTiles(item, infoOf(item.piece), width);
    if (tiles.some((tile) => taken.has(tile))) return item.index;
    for (const tile of tiles) taken.add(tile);
  }
  return null;
}

/**
 * The item whose footprint covers `tile`, the one a click on that tile is
 * about, or `null`. Where footprints stack (a chair at a room table) the
 * smallest wins, like the collision editor's pick: it is drawn over the
 * other and could not be reached any other way.
 */
export function decorItemCovering(
  items: readonly DecorItem[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  width: number,
  tile: number,
): DecorItem | null {
  let best: DecorItem | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const rect = decorFootprint(item, infoOf(item.piece), width);
    if (!rectTiles(rect, width).includes(tile) || rect.w * rect.h >= bestArea) continue;
    best = item;
    bestArea = rect.w * rect.h;
  }
  return best;
}

/**
 * The next rotation of a brush (the wheel, R): one step turns a chair or a
 * desk table down, left, up, right, the order the chair brush always had,
 * and the other step back. A room table toggles between horizontal and
 * vertical either way; a plant stays at 0.
 */
export function nextDecorRotation(rotation: DecorRotation, step: 1 | -1, kind: DecorKind = 'chair'): DecorRotation {
  if (kind === 'table') return decorRotationFor('table', rotation) === 0 ? 90 : 0;
  if (!isRotatable(kind)) return 0;
  return ((((rotation - step * 90) % 360) + 360) % 360) as DecorRotation;
}

/** A chair's facing from its rotation; 90 right and 270 left, like `rotationForFacing` of pieceCollisions.ts. */
export function decorChairFacing(rotation: DecorRotation): DecorFacing {
  if (rotation === 90) return 'right';
  if (rotation === 180) return 'up';
  if (rotation === 270) return 'left';
  return 'down';
}

/** Whether a piece of the layer is a chair, and so a seat. */
export function isDecorChairPiece(piece: string): boolean {
  return piece.startsWith('chair-');
}

/** The seats of the layer: every chair, by its anchor tile, facing its rotation. */
export function decorChairs(items: readonly DecorItem[]): { index: number; piece: string; facing: DecorFacing }[] {
  return items.flatMap(({ index, piece, rotation }) => (isDecorChairPiece(piece) ? [{ index, piece, facing: decorChairFacing(rotation) }] : []));
}

/** A copy of `items` with every edit applied in order, sorted by anchor. */
export function withDecor(items: readonly DecorItem[], edits: readonly DecorEdit[]): DecorItem[] {
  const byTile = new Map(items.map((item) => [item.index, item]));
  for (const { index, item } of edits) {
    if (item === null) byTile.delete(index);
    else byTile.set(index, { index, piece: item.piece, rotation: item.rotation, ...(item.color === undefined ? {} : { color: item.color }) });
  }
  return [...byTile.values()].sort((a, b) => a.index - b.index);
}

/**
 * The wire form of the layer, a replicated string of the room state:
 * `<index>:<piece>:<rotation>[:<color>]` per item joined by commas, sorted by
 * anchor, empty for none; the color only on a painted piece, so entries
 * written before colors existed read the same. Piece ids never hold a `:` or
 * a `,` (`isDecorPieceId`), and colors are `#rrggbb`.
 */
export function encodeOfficeDecor(items: readonly DecorItem[]): string {
  return [...items]
    .sort((a, b) => a.index - b.index)
    .map(({ index, piece, rotation, color }) => `${index}:${piece}:${rotation}${color === undefined ? '' : `:${color}`}`)
    .join(',');
}

/** The items of a wire string, sorted by anchor, or `null` unless every entry is well formed and on a distinct tile of the map. */
export function decodeOfficeDecor(raw: unknown, tileCount: number): DecorItem[] | null {
  if (typeof raw !== 'string') return null;
  if (raw === '') return [];
  const items = new Map<number, DecorItem>();
  for (const part of raw.split(',')) {
    const match = /^(\d+):([^:]+):(\d+)(?::([^:]+))?$/.exec(part);
    if (match === null) return null;
    const index = Number(match[1]);
    const piece = match[2] as string;
    const rotation = Number(match[3]);
    const color = match[4];
    if (index >= tileCount || !isDecorPieceId(piece) || !isDecorRotation(rotation) || items.has(index)) return null;
    if (color !== undefined && !isDecorColor(color)) return null;
    items.set(index, { index, piece, rotation, ...(color === undefined ? {} : { color }) });
  }
  return [...items.values()].sort((a, b) => a.index - b.index);
}
