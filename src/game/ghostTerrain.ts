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

/** Blocks per side of the ghost's map: the block shown plus one all around it. */
const GHOST_BLOCKS = 3;
const GHOST_TILES = GHOST_BLOCKS * BLOCK_TILES;
const TILES = GHOST_TILES * GHOST_TILES;

/** Where the block shown sits in the ghost's map, in tiles: the drawing is cut to it. */
export const GHOST_CENTER = { x: BLOCK_TILES, y: BLOCK_TILES };

/**
 * The map the ghost is drawn on: a 3x3 of blocks, all of the picked floor. The
 * block shown is the middle one, so its sides have the same floor on the other
 * side and the terrain renderer draws no edge there (an edge blends half a
 * tile outside the block); the scene cuts the drawing to that block.
 */
export const GHOST_LAYOUT: OfficeLayout = {
  width: GHOST_TILES,
  height: GHOST_TILES,
  blocks: Array.from({ length: GHOST_BLOCKS * GHOST_BLOCKS }, () => 'void' as const),
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
  const blocks = GHOST_LAYOUT.blocks.map(() => brush.material);
  const everyBlock = <T>(value: T): Map<number, T> => new Map(blocks.map((_, index) => [index, value]));
  const colors: TerrainColors = isColorableTerrainMaterial(brush.material) && brush.color !== undefined ? everyBlock(brush.color) : new Map();
  const floors: TerrainFloors = brush.material === TERRAIN_FLOOR_BASE && brush.floor !== undefined ? everyBlock(brush.floor) : new Map();
  return { snapshot: terrainSnapshot(GHOST_LAYOUT, blocks), colors, floors };
}
