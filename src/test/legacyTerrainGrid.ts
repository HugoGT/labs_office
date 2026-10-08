import { buildTerrainGrid } from '../game/terrainGrid';
import type { CollisionRect } from '../game/pieceCollisions';
import { LEGACY_LAYOUT, LEGACY_TERRAIN, LEGACY_COLLISIONS } from './legacyOffice';

export const buildLegacyTerrainGrid = (snapshot = LEGACY_TERRAIN, layout = LEGACY_LAYOUT, rects: readonly CollisionRect[] = LEGACY_COLLISIONS) => buildTerrainGrid(snapshot, layout, rects);
