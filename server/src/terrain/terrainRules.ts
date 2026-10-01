/**
 * Pure rules of a terrain block edit (#123 phase 2): what a valid edit is,
 * and when water may not go where it would land. Kept apart from the runtime
 * and the routes for the same reason as `spaceRules.ts`: they are tested
 * without a server, and there is one copy of them.
 *
 * Only water is ever refused. Every other material is walkable, so changing
 * between them never strands anyone or anything; drying water frees tiles.
 */

import { physicalBodyRect } from '../../../src/game/avatarGeometry.ts';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from '../../../src/game/mapData.ts';
import { LAYOUT_TILE, isLayoutMaterial, type LayoutMaterial, type OfficeLayout } from '../../../src/game/officeLayout.ts';
import type { MapSeat } from '../../../src/game/seating.ts';

/** The edit was malformed: an index off the map or an unknown material (400). */
export class InvalidTerrainEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTerrainEditError';
  }
}

/**
 * What water would land on. `placement` lasts (a room, a desk, a chair, the
 * spawn): the admin picks another block. `player` passes: it is allowed once
 * that person walks away. Two reasons because they are fixed differently.
 */
export type WaterConflict = 'placement' | 'player';

export class TerrainProtectedError extends Error {
  // A plain field, not a parameter property: Node's type stripping rejects those.
  readonly reason: WaterConflict;

  constructor(reason: WaterConflict) {
    super(`water would land under a ${reason}`);
    this.name = 'TerrainProtectedError';
    this.reason = reason;
  }
}

export interface TerrainEdit {
  index: number;
  material: LayoutMaterial;
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
 * inside them) and desks; `players` are network positions of the sessions
 * the room holds, those waiting to reconnect included.
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
 * Tiles of the static layout that water must not reach: the map chairs, the
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
 * Why water may not land on `watered` (`newlyWateredTiles`), or `null` if
 * it may. A player counts on every tile their Arcade body touches, not only
 * its center: the client's physics would push the body out of a new water
 * collider it overlaps. A placement is named first, because waiting does not
 * fix it.
 */
export function findWaterConflict(
  watered: readonly number[],
  width: number,
  staticTiles: ReadonlySet<number>,
  protections: TerrainProtections,
): WaterConflict | null {
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

  for (const position of protections.players) {
    const body = physicalBodyRect(position);
    const x0 = Math.floor(body.x / LAYOUT_TILE);
    const y0 = Math.floor(body.y / LAYOUT_TILE);
    const x1 = Math.floor((body.x + body.width - 1) / LAYOUT_TILE);
    const y1 = Math.floor((body.y + body.height - 1) / LAYOUT_TILE);
    if (floods({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 })) return 'player';
  }
  return null;
}
