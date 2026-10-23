/**
 * Pure rules of a terrain block edit (#123 phase 2): what a valid edit is,
 * and when water or void may not go where it would land. Kept apart from the runtime
 * and the routes for the same reason as `spaceRules.ts`: they are tested
 * without a server, and there is one copy of them.
 *
 * Only the nonwalkable terrain (water and void) is ever refused. Every other
 * material is walkable, so changing between them never strands anyone or
 * anything; building over water or void frees tiles.
 */

import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from '../../../src/game/mapData.ts';
import {
  LAYOUT_MATERIALS,
  MAX_WALL_EDITS,
  isColorableTerrainMaterial,
  isLayoutMaterial,
  isTerrainColor,
  isWallPieceId,
  wallPostTiles,
  type LayoutMaterial,
  type OfficeLayout,
  type TerrainSnapshot,
  type WallEdit,
} from '../../../src/game/officeLayout.ts';
import {
  MAX_DECOR_EDITS,
  decorFootprint,
  decorTiles,
  insideMap,
  isDecorPieceId,
  isDecorColor,
  isDecorRotation,
  rectTiles,
  type DecorEdit,
  type DecorItem,
  type DecorPieceInfo,
} from '../../../src/game/officeDecor.ts';
import { doorOnWall, wallTilesAfter } from '../../../src/game/officeDoors.ts';
import type { MapSeat } from '../../../src/game/seating.ts';

/** The edit was malformed: an index off the map or an unknown material (400). */
export class InvalidTerrainEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTerrainEditError';
  }
}

/**
 * Placements and the final safe spawn cannot be flooded. Players are relocated
 * by the room after the accepted snapshot is published, never a write veto.
 */
export type UnwalkableConflict = 'placement';

export class TerrainProtectedError extends Error {
  // A plain field, not a parameter property: Node's type stripping rejects those.
  readonly reason: UnwalkableConflict;

  constructor(reason: UnwalkableConflict) {
    super(`nonwalkable terrain would land under a ${reason}`);
    this.name = 'TerrainProtectedError';
    this.reason = reason;
  }
}

export interface TerrainEdit {
  index: number;
  material: LayoutMaterial;
  /** Only on a colorable material (#222); absent, the block draws its default art. */
  color?: string;
}

export class TerrainStaleError extends Error {}

/** The longest wire string of `count` blocks (`encodeTerrainBlocks`): every block the longest material name. */
function maxEncodedLength(count: number): number {
  return count * (Math.max(...LAYOUT_MATERIALS.map((material) => material.length)) + 1);
}

export function parseTerrainBatch(body: unknown, count: number): { edits: TerrainEdit[]; expected: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InvalidTerrainEditError('invalid batch');
  const { edits, expected } = body as Record<string, unknown>;
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > count || typeof expected !== 'string' || expected.length > maxEncodedLength(count)) {
    throw new InvalidTerrainEditError('invalid batch');
  }
  const seen = new Set<number>();
  const parsed = edits.map((edit: unknown) => {
    if (typeof edit !== 'object' || edit === null || Array.isArray(edit)) throw new InvalidTerrainEditError('invalid edit');
    const { index } = edit as Record<string, unknown>;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw new InvalidTerrainEditError('invalid index');
    const value = parseTerrainEdit(String(index), edit, count);
    if (seen.has(index)) throw new InvalidTerrainEditError('duplicate block');
    seen.add(index);
    return value;
  });
  return { edits: parsed, expected };
}

/** A rectangle in tiles, like `Space` and `Desk`. */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The managed state an edit is checked against, read when the edit is made.
 * `placements` are spaces (rooms and desk cubicles: their decor is placed
 * inside them) and desks. Player observations never veto an edit; the room
 * rechecks its current state after persistence, including reserved sessions.
 */
export interface TerrainProtections {
  placements: readonly TileRect[];
  /**
   * The desks alone (they are in `placements` too): the only stored
   * placement a wall may not cover. Walls go inside and around rooms on
   * purpose. Absent means no desk.
   */
  desks?: readonly TileRect[];
  players: readonly { x: number; y: number }[];
}

/**
 * The block of `/admin/terrain/blocks/:index` and the `material` and optional
 * `color` (#222) of the body. A color is normalized to lower case like a
 * decor one, and only a colorable material takes it; `null` is no color.
 */
export function parseTerrainEdit(index: unknown, body: unknown, count: number): TerrainEdit {
  if (typeof index !== 'string' || !/^\d+$/.test(index)) throw new InvalidTerrainEditError('the block index is not a number');
  const parsed = Number(index);
  if (parsed >= count) throw new InvalidTerrainEditError(`block ${parsed} is not on the map`);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InvalidTerrainEditError('the body is not an object');
  const { material, color } = body as Record<string, unknown>;
  if (!isLayoutMaterial(material)) throw new InvalidTerrainEditError('unknown material');
  if (color === undefined || color === null) return { index: parsed, material };
  const normalized = typeof color === 'string' ? color.toLowerCase() : color;
  if (!isTerrainColor(normalized)) throw new InvalidTerrainEditError('invalid color');
  if (!isColorableTerrainMaterial(material)) throw new InvalidTerrainEditError('this material takes no color');
  return { index: parsed, material, color: normalized };
}

/** Half the spawn ring of `OfficeRoom`: everyone enters within a tile of the spawn tile. */
const SPAWN_REACH_TILES = 1;

/**
 * Tiles of the static layout that water or void must not reach: the map chairs, the
 * furniture people sit or work at (tables, desks, plants) and the spawn area.
 * Trees, hedges and walls are left out on purpose: they block over any
 * terrain, so water under them changes nothing anyone can stand on, and
 * protecting them would lock most of the wooded map. Bridges are made to
 * stand over water.
 */
export function staticProtectedTiles(layout: OfficeLayout, seats: readonly MapSeat[]): Set<number> {
  const tiles = new Set<number>();
  const add = (tx: number, ty: number): void => {
    if (tx >= 0 && ty >= 0 && tx < layout.width && ty < layout.height) tiles.add(ty * layout.width + tx);
  };
  for (const seat of seats) add(seat.tx, seat.ty);
  for (const prop of layout.props) {
    if (prop.collision !== 'solid' || prop.kind === 'tree') continue;
    for (let ty = prop.ty; ty < prop.ty + prop.h; ty += 1) {
      for (let tx = prop.tx; tx < prop.tx + prop.w; tx += 1) add(tx, ty);
    }
  }
  for (let dy = -SPAWN_REACH_TILES; dy <= SPAWN_REACH_TILES; dy += 1) {
    for (let dx = -SPAWN_REACH_TILES; dx <= SPAWN_REACH_TILES; dx += 1) add(PLAYER_SPAWN_TX + dx, PLAYER_SPAWN_TY + dy);
  }
  return tiles;
}

/**
 * Why water or void may not land on `watered` (`newlyUnwalkableTiles`), or
 * `null` if it may. Only static or stored placements veto it.
 */
export function findUnwalkableConflict(
  watered: readonly number[],
  width: number,
  staticTiles: ReadonlySet<number>,
  protections: TerrainProtections,
): UnwalkableConflict | null {
  if (watered.length === 0) return null;
  const flooded = new Set(watered);
  const floods = (rect: TileRect): boolean => {
    for (let ty = rect.y; ty < rect.y + rect.h; ty += 1) {
      for (let tx = rect.x; tx < rect.x + rect.w; tx += 1) {
        if (tx >= 0 && tx < width && flooded.has(ty * width + tx)) return true;
      }
    }
    return false;
  };

  if (watered.some((tile) => staticTiles.has(tile)) || protections.placements.some(floods)) return 'placement';

  return null;
}

/**
 * The body of `POST /admin/terrain/walls`: `{ edits: [{ index, piece }] }`,
 * one tile each, a wall piece or `null` to remove the wall. At most
 * `MAX_WALL_EDITS` tiles, each once.
 */
export function parseWallBatch(body: unknown, tileCount: number): WallEdit[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InvalidTerrainEditError('invalid wall batch');
  const { edits } = body as Record<string, unknown>;
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > MAX_WALL_EDITS) throw new InvalidTerrainEditError('invalid wall batch');
  const seen = new Set<number>();
  return edits.map((edit: unknown) => {
    if (typeof edit !== 'object' || edit === null || Array.isArray(edit)) throw new InvalidTerrainEditError('invalid wall edit');
    const { index, piece } = edit as Record<string, unknown>;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= tileCount) throw new InvalidTerrainEditError('invalid tile');
    if (piece !== null && !isWallPieceId(piece)) throw new InvalidTerrainEditError('unknown wall piece');
    if (seen.has(index)) throw new InvalidTerrainEditError('duplicate tile');
    seen.add(index);
    return { index, piece };
  });
}

/**
 * Why a wall post may not stand on one of the `placed` vertices, or `null` if
 * it may. Walls never strand anything a room holds: a post is refused when
 * its footprint (`wallPostTiles`: the four tiles around its vertex) touches a
 * static tile (seats, furniture, the spawn area) or a desk, never because of
 * a room or a player (players are relocated). A post that ends a door's edge
 * (`doorPosts`, #223) may not change at all, removed or repainted: the door
 * would be left off its wall.
 */
export function findWallConflict(
  placed: readonly number[],
  grid: Pick<OfficeLayout, 'width' | 'height'>,
  staticTiles: ReadonlySet<number>,
  protections: TerrainProtections,
  changed: readonly number[] = placed,
  doorPosts: ReadonlySet<number> = new Set(),
): UnwalkableConflict | null {
  if (changed.some((index) => doorPosts.has(index))) return 'placement';
  if (placed.length === 0) return null;
  const touched = placed.flatMap((index) => wallPostTiles(grid, index));
  if (touched.some((tile) => staticTiles.has(tile))) return 'placement';
  const onDesk = (tile: number): boolean => {
    const tx = tile % grid.width;
    const ty = Math.floor(tile / grid.width);
    return (protections.desks ?? []).some((desk) => tx >= desk.x && tx < desk.x + desk.w && ty >= desk.y && ty < desk.y + desk.h);
  };
  return touched.some(onDesk) ? 'placement' : null;
}

/**
 * The body of `POST /admin/decor` and `POST /me/decor` (#208):
 * `{ edits: [{ index, item }] }`, one anchor tile each, a piece, its
 * rotation and an optional `#rrggbb` color (`{ piece, rotation, color? }`;
 * any case, stored lower case; `null` is no color) or `null` to remove the
 * item anchored there. At most `MAX_DECOR_EDITS` tiles, each once. Whether
 * the piece exists, turns that way and takes a color is the catalog's,
 * checked by the runtime.
 */
export function parseDecorBatch(body: unknown, tileCount: number): DecorEdit[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InvalidTerrainEditError('invalid decor batch');
  const { edits } = body as Record<string, unknown>;
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > MAX_DECOR_EDITS) throw new InvalidTerrainEditError('invalid decor batch');
  const seen = new Set<number>();
  return edits.map((edit: unknown) => {
    if (typeof edit !== 'object' || edit === null || Array.isArray(edit)) throw new InvalidTerrainEditError('invalid decor edit');
    const { index, item } = edit as Record<string, unknown>;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= tileCount) throw new InvalidTerrainEditError('invalid tile');
    if (seen.has(index)) throw new InvalidTerrainEditError('duplicate tile');
    seen.add(index);
    if (item === null) return { index, item: null };
    if (typeof item !== 'object' || item === undefined || Array.isArray(item)) throw new InvalidTerrainEditError('invalid decor item');
    const { piece, rotation, color } = item as Record<string, unknown>;
    if (!isDecorPieceId(piece)) throw new InvalidTerrainEditError('invalid piece');
    if (!isDecorRotation(rotation)) throw new InvalidTerrainEditError('invalid rotation');
    if (color === undefined || color === null) return { index, item: { piece, rotation } };
    const normalized = typeof color === 'string' ? color.toLowerCase() : color;
    if (!isDecorColor(normalized)) throw new InvalidTerrainEditError('invalid color');
    return { index, item: { piece, rotation, color: normalized } };
  });
}

/**
 * Why a decor item of the batch may not stand where it is, or `null` if
 * every one may. `after` is the whole layer with the batch applied and
 * `placed` the anchors the batch places. A placed item's footprint must lie
 * on the map, on walkable ground (no water or void), off every tile a wall
 * rectangle touches (`wallTiles`) and every static tile (base seats,
 * furniture, the spawn area), and share no tile with another item. Desks,
 * rooms and players never veto it: a desk is only a zone, and creating one
 * over decor is allowed too. Stored items that already overlap (kept at
 * load) never veto an edit elsewhere.
 *
 * A door (#223) must stand on the edge between two joined posts
 * (`doorOnWall`, the rule the editor's ghost applies too); the tiles a wall
 * touches do not count for it, since its own posts touch them. The wall
 * tiles are those of `after` (`wallTilesAfter`): a door removed or replaced
 * in the batch closes its wall for what takes its place.
 */
export function findDecorConflict(
  after: readonly DecorItem[],
  placed: ReadonlySet<number>,
  infoOf: (piece: string) => DecorPieceInfo | null,
  snapshot: Pick<TerrainSnapshot, 'width' | 'height' | 'walkable' | 'wallTiles' | 'walls'> & Partial<Pick<TerrainSnapshot, 'openings'>>,
  staticTiles: ReadonlySet<number>,
): UnwalkableConflict | null {
  if (placed.size === 0) return null;
  const wallTiles = wallTilesAfter(snapshot, after);
  const taken = new Set<number>();
  for (const item of after) {
    if (!placed.has(item.index)) for (const tile of decorTiles(item, infoOf(item.piece), snapshot.width)) taken.add(tile);
  }
  for (const item of after) {
    if (!placed.has(item.index)) continue;
    const info = infoOf(item.piece);
    const door = info?.kind === 'door';
    if (door && !doorOnWall(snapshot, item)) return 'placement';
    const rect = decorFootprint(item, info, snapshot.width);
    if (!insideMap(rect, snapshot.width, snapshot.height)) return 'placement';
    for (const tile of rectTiles(rect, snapshot.width)) {
      if (!snapshot.walkable[tile] || (!door && wallTiles[tile] === true) || staticTiles.has(tile) || taken.has(tile)) return 'placement';
      taken.add(tile);
    }
  }
  return null;
}
