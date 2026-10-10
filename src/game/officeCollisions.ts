/**
 * The office's collision instances on the client: the static office (Tiled
 * props and base chairs) plus the served desks and their decor, placed by the
 * same pure rules the room uses (`pieceCollisions.ts`), so both sides build
 * the same rectangles from the same table.
 */

import type { OfficeDesk } from './desksPort';
import { BASE_LAYOUT, type OfficeLayout } from './officeLayout';
import {
  collisionWorld,
  deskInstances,
  pieceIdOfTextureKey,
  placedChairInstances,
  staticCollisionInstances,
  type CollisionDesk,
  type CollisionInstance,
  type CollisionRect,
} from './pieceCollisions';
import { BASE_MAP_SEATS, type MapSeat, type PlacedChair } from './seating';

export const STATIC_COLLISION_INSTANCES: readonly CollisionInstance[] = staticCollisionInstances(BASE_LAYOUT.props, BASE_MAP_SEATS);
/** The static office with every piece at its default: the tiles props always blocked. */
export const BASE_COLLISION_RECTS: readonly CollisionRect[] = collisionWorld(STATIC_COLLISION_INSTANCES, new Map());

/**
 * The served desks as collision placements. A desk without an appearance (an
 * older server) has no known piece here, so it does not collide; the server
 * always sends one.
 */
export function officeDeskPlacements(desks: readonly OfficeDesk[]): CollisionDesk[] {
  return desks.map((desk) => ({
    x: desk.x,
    y: desk.y,
    w: desk.w,
    h: desk.h,
    materialId: desk.appearance?.materialId ?? null,
    items: (desk.occupant?.items ?? []).map((item) => ({ slot: item.slot, rotation: item.rotation, pieceId: pieceIdOfTextureKey(item.textureKey) })),
  }));
}

/** Every placed piece: the static office, the served desks and their decor, and the chairs placed from the terrain editor. */
export function officeCollisionInstances(
  desks: readonly OfficeDesk[],
  layout: OfficeLayout = BASE_LAYOUT,
  seats: readonly MapSeat[] = BASE_MAP_SEATS,
  chairs: readonly PlacedChair[] = [],
): CollisionInstance[] {
  return [...staticCollisionInstances(layout.props, seats), ...deskInstances(officeDeskPlacements(desks)), ...placedChairInstances(chairs, layout.width)];
}
