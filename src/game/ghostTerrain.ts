/**
 * The ghost of "Editar terreno": what the block under the pointer would look
 * like with the picked floor on it, as plain data (no Phaser, so it is tested
 * under jsdom). `TerrainGhost.ts` draws it with the scene's own terrain
 * renderer, so a color or an uploaded floor is seen as it will be placed.
 */

import { BLOCK_TILES, isColorableTerrainMaterial, terrainSnapshot, type LayoutMaterial, type OfficeLayout, type TerrainColors, type TerrainSnapshot } from './officeLayout';
import { TERRAIN_FLOOR_BASE, type TerrainFloors } from './terrainFloors';

/** Opacity of the ghost: nearly solid, so the color picked reads as it will be. */
export const TERRAIN_GHOST_ALPHA = 0.9;

const TILES = BLOCK_TILES * BLOCK_TILES;

/** A map of one block and nothing else: the ghost is that block on its own, drawn where the pointer is. */
export const GHOST_LAYOUT: OfficeLayout = {
  width: BLOCK_TILES,
  height: BLOCK_TILES,
  blocks: ['void'],
  ground: Array.from({ length: TILES }, () => null),
  walls: Array.from({ length: TILES }, () => null),
  hedges: Array.from({ length: TILES }, () => null),
  decals: Array.from({ length: TILES }, () => null),
  props: [],
};

export interface GhostTerrain {
  readonly snapshot: TerrainSnapshot;
  readonly colors: TerrainColors;
  readonly floors: TerrainFloors;
}

/** The floor a brush would lay, or `null` when it lays nothing to show (the void eraser). */
export function ghostTerrain(brush: { readonly material: LayoutMaterial; readonly color?: string; readonly floor?: string }): GhostTerrain | null {
  if (brush.material === 'void') return null;
  const colors: TerrainColors = isColorableTerrainMaterial(brush.material) && brush.color !== undefined ? new Map([[0, brush.color]]) : new Map();
  const floors: TerrainFloors = brush.material === TERRAIN_FLOOR_BASE && brush.floor !== undefined ? new Map([[0, brush.floor]]) : new Map();
  return { snapshot: terrainSnapshot({ ...GHOST_LAYOUT, blocks: [brush.material] }), colors, floors };
}
