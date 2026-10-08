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
import { LAYOUT_MATERIALS, isLayoutMaterial, type LayoutMaterial, type OfficeLayout } from '../../../src/game/officeLayout.ts';
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
  players: readonly { x: number; y: number }[];
}

/** The block of `/admin/terrain/blocks/:index` and the `material` of the body. */
export function parseTerrainEdit(index: unknown, body: unknown, count: number): TerrainEdit {
  if (typeof index !== 'string' || !/^\d+$/.test(index)) throw new InvalidTerrainEditError('the block index is not a number');
  const parsed = Number(index);
  if (parsed >= count) throw new InvalidTerrainEditError(`block ${parsed} is not on the map`);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InvalidTerrainEditError('the body is not an object');
  const { material } = body as Record<string, unknown>;
  if (!isLayoutMaterial(material)) throw new InvalidTerrainEditError('unknown material');
  return { index: parsed, material };
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
