/**
 * Demo wall map: one sample per material, one per floor quadrant (brick on wood, stone on grass,
 * plaster on water, glass on the plain floor). Each sample is a 2x2 block of walls, which shows
 * the four corners, the four tees and a cross, plus a straight run with an end at each side that
 * lies on a terrain border, so its joints sit right over a change of terrain.
 */
import { WALL_MATERIALS, WallMap, type GridVertex, type WallMaterial } from './wallMap.ts';

/** Smallest map, in tiles, the demo fits in with a free tile around it. */
export const DEMO_MIN_COLS = 10;
export const DEMO_MIN_ROWS = 8;

/** Rows and columns of tiles in each demo grid of walls. */
export const DEMO_GRID_SIZE = 2;

export interface DemoGrid {
  readonly material: WallMaterial;
  /** Top-left vertex of the grid. */
  readonly origin: GridVertex;
}

/** The four 2x2 grids around the center, in WALL_MATERIALS order: brick NW, stone NE, plaster SW, glass SE. */
export function demoGrids(center: GridVertex): DemoGrid[] {
  const { col, row } = center;
  const origins = [
    { col: col - 3, row: row - 3 },
    { col: col + 1, row: row - 3 },
    { col: col - 3, row: row + 1 },
    { col: col + 1, row: row + 1 },
  ];
  return WALL_MATERIALS.map((material, index) => ({ material, origin: origins[index] as GridVertex }));
}

/**
 * `center` is the vertex where the terrain borders cross. Each run follows one half of a border
 * and stops a tile short of the center, so no two materials ever share a joint.
 */
export function demoWallMap(cols: number, rows: number, center: GridVertex): WallMap {
  const map = new WallMap(cols, rows);
  const { col, row } = center;
  if (col - 4 < 1 || col + 4 > cols - 1 || row - 3 < 1 || row + 3 > rows - 1) {
    throw new Error(`The wall demo needs a map of at least ${DEMO_MIN_COLS}x${DEMO_MIN_ROWS} tiles around its center`);
  }
  for (const grid of demoGrids(center)) map.grid(grid.origin, DEMO_GRID_SIZE, DEMO_GRID_SIZE, grid.material);
  map.run({ col: col - 4, row }, 'east', 3, 'brick');
  map.run({ col, row: row - 3 }, 'south', 2, 'stone');
  map.run({ col, row: row + 1 }, 'south', 2, 'plaster');
  map.run({ col: col + 1, row }, 'east', 3, 'glass');
  return map;
}
