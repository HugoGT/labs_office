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
 * `DecorPieceInfo` in. The one imports are the art contract's `doorSpanOf`
 * and `sofaSeatsOf`, pure functions of a piece id, for the doors and sofas the
 * id alone describes.
 */

import { doorSpanOf, sofaSeatsOf } from './artContract.ts';

/** 0 is the pack's default down drawing and the rotation turns it clockwise: 90 right, 180 up, 270 left. */
export type DecorRotation = 0 | 90 | 180 | 270;
export const DECOR_ROTATIONS: readonly DecorRotation[] = [0, 90, 180, 270];

/**
 * The art piece kinds the decor layer places; a door (#223) stands on a wall's
 * grid line (`officeDoors.ts`), and a sofa seats one person per tile.
 */
export type DecorKind = 'chair' | 'desk' | 'plant' | 'table' | 'door' | 'sofa' | 'tree';
export const DECOR_KINDS: readonly DecorKind[] = ['chair', 'desk', 'plant', 'table', 'door', 'sofa', 'tree'];

/**
 * The two layers of the decor (#121): the floor, where furniture stands and
 * no two items share a tile, and the top, the surface of the desk tables and
 * room tables, where a "Mi espacio" piece stands. A tile may hold one item of
 * each. An item's layer is its kind's (`decorLayerOf`), so the wire entries
 * and every stored row written before the layers existed read the same.
 */
export type DecorLayer = 'floor' | 'top';

/** The kinds that stand on top of a desk table or room table, never on the floor. */
export const ON_TOP_KINDS: ReadonlySet<DecorKind> = new Set<DecorKind>(['plant']);

/** The floor kinds whose surface holds the top layer. */
const SURFACE_KINDS: ReadonlySet<DecorKind> = new Set<DecorKind>(['desk', 'table']);

export function isOnTopKind(kind: string): boolean {
  return ON_TOP_KINDS.has(kind as DecorKind);
}

export function isDecorLayer(value: unknown): value is DecorLayer {
  return value === 'floor' || value === 'top';
}

/** The layer of a piece, by the kind its id starts with (piece ids are prefixed by kind, `decorInfoFromPieceId`). */
export function decorLayerOf(piece: string): DecorLayer {
  return isOnTopKind(piece.slice(0, piece.indexOf('-'))) ? 'top' : 'floor';
}

/**
 * One number per (anchor, layer): a floor item's key is its anchor, so every
 * caller that knew items by anchor keeps working for the floor, and a top
 * item's is negative (`-1 - index`), never any floor key. The decor editor
 * passes it through the bridge where it used to pass the anchor.
 */
export function decorKey(index: number, layer: DecorLayer): number {
  return layer === 'top' ? -1 - index : index;
}

export function decorKeyIndex(key: number): number {
  return key < 0 ? -1 - key : key;
}

export function decorKeyLayer(key: number): DecorLayer {
  return key < 0 ? 'top' : 'floor';
}

export function decorItemKey(item: Pick<DecorItem, 'index' | 'piece'>): number {
  return decorKey(item.index, decorLayerOf(item.piece));
}

/** The layer an edit touches: a placement its piece's, a removal the one it names, the floor when it names none. */
export function decorEditLayer(edit: DecorEdit): DecorLayer {
  return edit.item === null ? (edit.layer ?? 'floor') : decorLayerOf(edit.item.piece);
}

export function decorEditKey(edit: DecorEdit): number {
  return decorKey(edit.index, decorEditLayer(edit));
}

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

/**
 * One tile of a decor edit: the piece to anchor there, or `null` to remove the
 * one anchored there. A placement lands on its piece's layer; a removal of a
 * top item names it (`layer: 'top'`), absent it removes the floor item, as
 * every edit did before the layers.
 */
export interface DecorEdit {
  readonly index: number;
  readonly item: { readonly piece: string; readonly rotation: DecorRotation; readonly color?: string } | null;
  readonly layer?: DecorLayer;
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

/** Chairs, desk tables, room tables and doors turn, and a plant mirrors (#121); a tree is drawn in one frame. */
export function isRotatable(kind: DecorKind): boolean {
  return kind !== 'tree';
}

/**
 * The rotations a kind takes. A room table is symmetric, so 180 and 270
 * would draw and cover exactly what 0 and 90 do: it has a horizontal (0) and
 * a vertical (90) frame only.
 */
export function decorRotationsOf(kind: DecorKind): readonly DecorRotation[] {
  if (kind === 'table') return [0, 90];
  // A plant turns between its drawing (0) and its mirror (180), #121.
  if (kind === 'plant') return [0, 180];
  return isRotatable(kind) ? DECOR_ROTATIONS : [0];
}

/**
 * The turn a fresh brush of `kind` starts in. A desk table shows its sitter's
 * side (drawer and open knee space, facing up), the one its palette thumbnail
 * shows, instead of the closed panel a turn of 0 draws; the rest start at 0.
 */
export function defaultDecorRotation(kind: DecorKind): DecorRotation {
  return kind === 'desk' ? 180 : 0;
}

/** `rotation` as `kind` can take it: a room table's symmetric turn, 0 for a plant. */
export function decorRotationFor(kind: DecorKind, rotation: DecorRotation): DecorRotation {
  if (kind === 'table') return rotation === 90 || rotation === 270 ? 90 : 0;
  if (kind === 'plant') return rotation === 180 ? 180 : 0;
  return isRotatable(kind) ? rotation : 0;
}

/**
 * A chair is 1x1 and a desk table 3x1 whatever the manifest says (its art
 * states one footprint per facing). A door states its span along the wall
 * (2 tiles, or 3 for a double door, #233) and covers a tile on each side of
 * it (`decorFootprint`).
 */
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
  // Only desk tables, chairs, sofas and trees take a color in the art contract (`colorable` of `ArtDeskPiece`, `ArtChairPiece`, `ArtSofaPiece` and `ArtTreePiece`).
  const colorable = (piece.kind === 'desk' || piece.kind === 'chair' || piece.kind === 'sofa' || piece.kind === 'tree') && piece.colorable === true ? { colorable: true as const } : {};
  const fixed = FIXED_FOOTPRINTS[piece.kind];
  if (fixed !== undefined) return { kind: piece.kind, footprint: fixed, ...colorable };
  const footprint = piece.footprint;
  if (footprint === undefined || !Number.isInteger(footprint.w) || !Number.isInteger(footprint.h) || footprint.w < 1 || footprint.h < 1) return null;
  return { kind: piece.kind, footprint: { w: footprint.w, h: footprint.h }, ...colorable };
}

/**
 * What the id alone says when no catalog knows the piece: chairs, desk
 * tables have a fixed footprint, a door's span is in its id (`doorSpanOf`), so
 * are a sofa's seats (`sofaSeatsOf`), and plants and trees take one tile (a
 * tree stands on its base, whatever its crown covers); a room
 * table's footprint only its catalog entry has, so it is `null`. Whether a
 * sofa takes a color is its catalog's to say.
 */
export function decorInfoFromPieceId(piece: string): DecorPieceInfo | null {
  const kind = piece.slice(0, piece.indexOf('-'));
  if (kind === 'chair' || kind === 'desk') return decorPieceInfo({ kind });
  if (kind === 'door') return decorPieceInfo({ kind, footprint: { w: doorSpanOf(piece), h: 1 } });
  if (kind === 'sofa') {
    const seats = sofaSeatsOf(piece);
    return seats === null ? null : decorPieceInfo({ kind, footprint: { w: seats, h: 1 } });
  }
  if (kind === 'plant' || kind === 'tree') return decorPieceInfo({ kind, footprint: { w: 1, h: 1 } });
  return null;
}

/**
 * The tiles an item covers. A chair stands on its anchor; a desk table lies
 * along a row (0, 180) or a column (90, 270) with its anchor the middle tile,
 * the old decor table's edge middle; a plant or a room table is centered on
 * its anchor (`floor(w / 2)`, `floor(h / 2)` from its top-left), a room
 * table turned vertical (90) on its footprint swapped. A door or window
 * (#223, tile walls) stands in a wall run from its anchor, the wall tile of
 * its first column (0 and 180) or row (90 and 270), for its span
 * (`footprint.w`): across a horizontal run it covers the wall's three tiles,
 * across a vertical one the column and the tile on each side, where its leaf
 * swings. A sofa is centered like a room
 * table, along a row facing down or up (0, 180) and along a column turned
 * sideways (90, 270). An unknown
 * piece (`null`) keeps its anchor tile alone, so stored rows are never lost.
 */
export function decorFootprint(item: DecorPlacement, info: DecorPieceInfo | null, width: number): DecorTileRect {
  const tx = item.index % width;
  const ty = Math.floor(item.index / width);
  if (info === null) return { x: tx, y: ty, w: 1, h: 1 };
  if (info.kind === 'chair') return { x: tx, y: ty, w: 1, h: 1 };
  if (info.kind === 'door') {
    const span = info.footprint.w;
    return item.rotation === 0 || item.rotation === 180 ? { x: tx, y: ty - 1, w: span, h: 3 } : { x: tx - 1, y: ty, w: 3, h: span };
  }
  if (info.kind === 'desk') {
    const horizontal = item.rotation === 0 || item.rotation === 180;
    return horizontal ? { x: tx - 1, y: ty, w: 3, h: 1 } : { x: tx, y: ty - 1, w: 1, h: 3 };
  }
  const vertical =
    (info.kind === 'table' && decorRotationFor('table', item.rotation) === 90) || (info.kind === 'sofa' && (item.rotation === 90 || item.rotation === 270));
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
 * other and could not be reached any other way. A top item (#121) wins over
 * any floor item for the same reason, whatever their sizes.
 */
export function decorItemCovering(
  items: readonly DecorItem[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  width: number,
  tile: number,
): DecorItem | null {
  let best: DecorItem | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const rect = decorFootprint(item, infoOf(item.piece), width);
    // Every top item ranks under every floor one: no footprint covers the whole map.
    const rank = rect.w * rect.h - (decorLayerOf(item.piece) === 'top' ? width * width * width : 0);
    if (!rectTiles(rect, width).includes(tile) || rank >= bestRank) continue;
    best = item;
    bestRank = rank;
  }
  return best;
}

/**
 * The next rotation of a brush (the wheel, R): one step turns a chair or a
 * desk table down, left, up, right, the order the chair brush always had,
 * and the other step back. A room table toggles between horizontal and
 * vertical either way, a plant between its drawing and its mirror (#121).
 */
export function nextDecorRotation(rotation: DecorRotation, step: 1 | -1, kind: DecorKind = 'chair'): DecorRotation {
  if (kind === 'table') return decorRotationFor('table', rotation) === 0 ? 90 : 0;
  if (kind === 'plant') return decorRotationFor('plant', rotation) === 0 ? 180 : 0;
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

/** Whether a piece of the layer is a sofa: one seat per tile of its footprint. */
export function isDecorSofaPiece(piece: string): boolean {
  return piece.startsWith('sofa-');
}

/** A seat of the layer, by the tile it stands on (`chair-<index>` on the wire, `chairSeatId`). */
export interface DecorSeat {
  readonly index: number;
  readonly piece: string;
  readonly facing: DecorFacing;
  readonly color?: string;
}

/**
 * Every seat of the layer, in item order: a chair on its anchor tile, and a
 * sofa on each tile of its footprint (sized by its id, `decorInfoFromPieceId`,
 * so the room and every client agree without a catalog), all facing the way
 * the piece faces. The seats run across a sofa, so several people sit on it,
 * one per tile.
 */
export function decorSeats(items: readonly DecorItem[], width: number): DecorSeat[] {
  return items.flatMap(({ index, piece, rotation, color }) => {
    const seat = { piece, facing: decorChairFacing(rotation), ...(color === undefined ? {} : { color }) };
    if (isDecorChairPiece(piece)) return [{ index, ...seat }];
    if (!isDecorSofaPiece(piece)) return [];
    const info = decorInfoFromPieceId(piece);
    return info === null ? [] : decorTiles({ index, rotation }, info, width).map((tile) => ({ index: tile, ...seat }));
  });
}

/** The chairs of the layer, by their anchor tile, facing their rotation: what `placeChairs` draws. */
export function decorChairs(items: readonly DecorItem[]): { index: number; piece: string; facing: DecorFacing; color?: string }[] {
  return items.flatMap(({ index, piece, rotation, color }) =>
    isDecorChairPiece(piece) ? [{ index, piece, facing: decorChairFacing(rotation), ...(color === undefined ? {} : { color }) }] : [],
  );
}

/** Anchor order, and on one anchor the floor item before the top one: the order of the layer everywhere. */
function byAnchor(a: DecorItem, b: DecorItem): number {
  return a.index - b.index || Number(decorLayerOf(a.piece) === 'top') - Number(decorLayerOf(b.piece) === 'top');
}

/** A copy of `items` with every edit applied in order, each on its own layer (`decorEditKey`), sorted by anchor. */
export function withDecor(items: readonly DecorItem[], edits: readonly DecorEdit[]): DecorItem[] {
  const byKey = new Map(items.map((item) => [decorItemKey(item), item]));
  for (const edit of edits) {
    const { index, item } = edit;
    if (item === null) byKey.delete(decorEditKey(edit));
    else byKey.set(decorEditKey(edit), { index, piece: item.piece, rotation: item.rotation, ...(item.color === undefined ? {} : { color: item.color }) });
  }
  return [...byKey.values()].sort(byAnchor);
}

/** The edits that turn `before` into `after`, one per (anchor, layer) that differs, a top removal naming its layer. */
export function diffDecor(before: readonly DecorItem[], after: readonly DecorItem[]): DecorEdit[] {
  const old = new Map(before.map((item) => [decorItemKey(item), item]));
  const changes: DecorEdit[] = [];
  for (const item of after) {
    const key = decorItemKey(item);
    const current = old.get(key);
    old.delete(key);
    if (current !== undefined && current.piece === item.piece && current.rotation === item.rotation && current.color === item.color) continue;
    changes.push({ index: item.index, item: { piece: item.piece, rotation: item.rotation, ...(item.color === undefined ? {} : { color: item.color }) } });
  }
  for (const item of old.values()) changes.push(decorLayerOf(item.piece) === 'top' ? { index: item.index, item: null, layer: 'top' } : { index: item.index, item: null });
  return changes;
}

/**
 * Whether the floor desk tables and room tables of `items` cover every tile
 * of `item`'s footprint: the only place a top item stands (#121). It may
 * span several of them, side by side.
 */
export function topItemSupported(
  item: DecorPlacement,
  items: readonly DecorItem[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  width: number,
): boolean {
  const surface = new Set<number>();
  for (const candidate of items) {
    const info = infoOf(candidate.piece);
    if (info === null || !SURFACE_KINDS.has(info.kind) || decorLayerOf(candidate.piece) !== 'floor') continue;
    for (const tile of decorTiles(candidate, info, width)) surface.add(tile);
  }
  return decorTiles(item, item.piece === undefined ? null : infoOf(item.piece), width).every((tile) => surface.has(tile));
}

/**
 * The top items of `after` a change leaves off their surface: what goes in
 * the same save as the desk table or room table removed, replaced, turned or
 * moved from under them. One that already stood on nothing in `before`
 * (a stored row, kept like every other) is no change's doing and stays, and
 * so do the `placed` ones (keys): the batch's own placements are judged, not
 * dropped.
 */
export function fallenTopItems(
  before: readonly DecorItem[],
  after: readonly DecorItem[],
  infoOf: (piece: string) => DecorPieceInfo | null,
  width: number,
  placed: ReadonlySet<number> = new Set(),
): DecorItem[] {
  const old = new Map(before.map((item) => [decorItemKey(item), item]));
  return after.filter((item) => {
    const key = decorItemKey(item);
    if (decorLayerOf(item.piece) !== 'top' || placed.has(key) || topItemSupported(item, after, infoOf, width)) return false;
    const was = old.get(key);
    const unchanged = was !== undefined && was.piece === item.piece && was.rotation === item.rotation;
    return !(unchanged && !topItemSupported(was, before, infoOf, width));
  });
}

/**
 * The wire form of the layer, a replicated string of the room state:
 * `<index>:<piece>:<rotation>[:<color>]` per item joined by commas, sorted by
 * anchor (the floor item before the top one on a shared anchor, #121; the
 * layer is the piece's, so no entry spells it), empty for none; the color only on a painted piece, so entries
 * written before colors existed read the same. Piece ids never hold a `:` or
 * a `,` (`isDecorPieceId`), and colors are `#rrggbb`.
 */
export function encodeOfficeDecor(items: readonly DecorItem[]): string {
  return [...items]
    .sort(byAnchor)
    .map(({ index, piece, rotation, color }) => `${index}:${piece}:${rotation}${color === undefined ? '' : `:${color}`}`)
    .join(',');
}

/** The items of a wire string, sorted by anchor, or `null` unless every entry is well formed and on a distinct (tile, layer) of the map. */
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
    if (index >= tileCount || !isDecorPieceId(piece) || !isDecorRotation(rotation) || items.has(decorKey(index, decorLayerOf(piece)))) return null;
    if (color !== undefined && !isDecorColor(color)) return null;
    items.set(decorKey(index, decorLayerOf(piece)), { index, piece, rotation, ...(color === undefined ? {} : { color }) });
  }
  return [...items.values()].sort(byAnchor);
}
