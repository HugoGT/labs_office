/**
 * Uploaded floors on the terrain (S13), as plain numbers: which frame of a
 * piece's 96x96 sheet each tile of a floored block shows. No Phaser, so it is
 * tested under jsdom; `mapBuilder.ts` (`renderTerrainFloors`) lays the rows on
 * one tilemap layer per piece.
 */

import { floorFrameAt } from './artContract';
import { BLOCK_TILES, type TerrainSnapshot } from './officeLayout';
import { TERRAIN_FLOOR_BASE, type TerrainFloors } from './terrainFloors';

/**
 * Per piece id, the frame to draw on each tile (row major, `-1` for none).
 * A floor shows only over the `wood` it was painted on: a block drawn as
 * anything else (an editor's pending paint of another material) shows that
 * instead, and a piece with no tile left has no entry.
 */
export function terrainFloorTileData(terrain: TerrainSnapshot, floors: TerrainFloors): Map<string, number[][]> {
  const data = new Map<string, number[][]>();
  const columns = terrain.width / BLOCK_TILES;
  for (const [index, piece] of floors) {
    if (terrain.blocks[index] !== TERRAIN_FLOOR_BASE) continue;
    let rows = data.get(piece);
    if (rows === undefined) {
      rows = Array.from({ length: terrain.height }, () => new Array<number>(terrain.width).fill(-1));
      data.set(piece, rows);
    }
    const x0 = (index % columns) * BLOCK_TILES;
    const y0 = Math.floor(index / columns) * BLOCK_TILES;
    for (let ty = y0; ty < y0 + BLOCK_TILES; ty += 1) {
      for (let tx = x0; tx < x0 + BLOCK_TILES; tx += 1) rows[ty]![tx] = floorFrameAt(tx, ty);
    }
  }
  return data;
}
