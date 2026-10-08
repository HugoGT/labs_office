/** Explicit legacy fixtures: behavior tests must not put old furniture back in production. */
import { buildLegacyLayout } from './legacyLayout.ts';
import { parseOfficeLayout, terrainSnapshot } from '../game/officeLayout.ts';
import { parseBaseMapSeats } from '../game/seating.ts';
import { TILE } from '../game/mapData.ts';
import { collisionWorld, staticCollisionInstances } from '../game/pieceCollisions.ts';

export const LEGACY_MAP = buildLegacyLayout();
export const LEGACY_LAYOUT = parseOfficeLayout(LEGACY_MAP);
export const LEGACY_TERRAIN = terrainSnapshot(LEGACY_LAYOUT);
export const LEGACY_SEATS = parseBaseMapSeats(LEGACY_MAP);
export const LEGACY_COLLISIONS = collisionWorld(staticCollisionInstances(LEGACY_LAYOUT.props, LEGACY_SEATS), new Map());
export const LEGACY_SPACES = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Sala de Juntas', x: 50 * TILE, y: 2 * TILE, w: 13 * TILE, h: 14 * TILE },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Cafetería', x: 50 * TILE, y: 18 * TILE, w: 13 * TILE, h: 14 * TILE },
];
export const LEGACY_SEED_SPACES = LEGACY_SPACES.map((space, index) => ({
  ...space, slug: index === 0 ? 'sala-de-juntas' : 'cafeteria', capacity: null,
  x: space.x / TILE, y: space.y / TILE, w: space.w / TILE, h: space.h / TILE,
}));
