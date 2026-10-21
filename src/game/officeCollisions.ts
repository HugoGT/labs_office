/**
 * The office's collision instances on the client: the static office (Tiled
 * props and base chairs) plus the office decor layer (#208), placed by the
 * same pure rules the room uses (`pieceCollisions.ts`), so both sides build
 * the same rectangles from the same table. Desks place nothing: a desk is
 * only a zone, and what stands on it is decor.
 */

import type { ArtPackManifest } from './artContract';
import { findPiece } from './artPack';
import { decorInfoFromPieceId, decorPieceInfo, type DecorItem, type DecorPieceInfo } from './officeDecor';
import { BASE_LAYOUT, type OfficeLayout } from './officeLayout';
import { collisionWorld, officeDecorInstances, staticCollisionInstances, type CollisionInstance, type CollisionRect } from './pieceCollisions';
import { BASE_MAP_SEATS, type MapSeat } from './seating';

export const STATIC_COLLISION_INSTANCES: readonly CollisionInstance[] = staticCollisionInstances(BASE_LAYOUT.props, BASE_MAP_SEATS);
/** The static office with every piece at its default: the tiles props always blocked. */
export const BASE_COLLISION_RECTS: readonly CollisionRect[] = collisionWorld(STATIC_COLLISION_INSTANCES, new Map());

/**
 * How the decor rules see a piece on the client: its manifest entry (pack
 * and uploads), else what its id says (`decorInfoFromPieceId`), the same
 * fallback the server uses without a catalog.
 */
export function decorInfoFromManifest(manifest: ArtPackManifest | null): (piece: string) => DecorPieceInfo | null {
  return (piece) => {
    const entry = manifest === null ? undefined : findPiece(manifest, piece);
    return entry === undefined ? decorInfoFromPieceId(piece) : decorPieceInfo(entry);
  };
}

/** Every placed piece: the static office and the decor layer. */
export function officeCollisionInstances(
  layout: OfficeLayout = BASE_LAYOUT,
  seats: readonly MapSeat[] = BASE_MAP_SEATS,
  decor: readonly DecorItem[] = [],
  infoOf: (piece: string) => DecorPieceInfo | null = decorInfoFromPieceId,
): CollisionInstance[] {
  return [...staticCollisionInstances(layout.props, seats), ...officeDecorInstances(decor, infoOf, layout.width)];
}
