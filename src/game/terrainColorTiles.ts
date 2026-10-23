/**
 * Colored terrain blocks (#222), as plain numbers: which band of the terrain
 * tileset a colorable floor draws from, the color each dual-grid cell takes,
 * and the tile data that points those cells at a recolored copy of the band.
 * No Phaser, so it is tested under jsdom; `mapBuilder.ts` adds the copies as
 * extra tilesets of the same tilemap.
 */

import {
  ART_TILE,
  TERRAIN_MATERIALS,
  TERRAIN_TILESET,
  type ArtPackManifest,
  type Rect,
  type TerrainMaterial,
} from './artContract';
import { findPiece, recolorFor, type Recolor } from './artPack';
import { blockIndexAt, isColorableTerrainMaterial, terrainMaterialAt, type TerrainColors, type TerrainSnapshot } from './officeLayout';
import { terrainTileData } from './terrainRender';

/** The rows of the terrain tileset one material draws from: its tiles and their pixels. */
export interface TerrainMaterialBand {
  readonly firstTile: number;
  readonly tileCount: number;
  readonly rect: Rect;
}

export function terrainMaterialBand(material: TerrainMaterial): TerrainMaterialBand {
  const { columns, phases } = TERRAIN_TILESET;
  const firstRow = TERRAIN_MATERIALS.indexOf(material) * phases;
  return {
    firstTile: firstRow * columns,
    tileCount: phases * columns,
    rect: { x: 0, y: firstRow * ART_TILE, width: columns * ART_TILE, height: phases * ART_TILE },
  };
}

/**
 * The color the `material` tile of display cell (cx, cy) is drawn in, or
 * `null` for its default art. A cell has four corners, possibly in carpet
 * blocks of different colors; the first corner of that material, in the
 * order top-left, top-right, bottom-left, bottom-right, decides (D4), so a
 * seam between two colors is deterministic. Outside the map, the nearest
 * tile, like `terrainCellCorners`.
 */
export function terrainCellColor(terrain: TerrainSnapshot, colors: TerrainColors, material: TerrainMaterial, cx: number, cy: number): string | null {
  const clamp = (value: number, size: number): number => Math.min(size - 1, Math.max(0, value));
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    const tx = clamp(cx + dx, terrain.width);
    const ty = clamp(cy + dy, terrain.height);
    if (terrainMaterialAt(terrain, tx, ty) === material) return colors.get(blockIndexAt(terrain.width, tx, ty)) ?? null;
  }
  return null;
}

/**
 * `terrainTileData` with the tiles of colored blocks moved to a recolored
 * band: `firstGidOf(material, color)` is the first tile index of that band's
 * copy, or `null` when there is none (a browser that cannot read pixels
 * back), which keeps the default art. Without colors it is `terrainTileData`
 * exactly, so terrain stored before #222 draws as it always did.
 */
export function terrainColorTileData(
  terrain: TerrainSnapshot,
  colors: TerrainColors,
  firstGidOf: (material: TerrainMaterial, color: string) => number | null,
): number[][][] {
  const data = terrainTileData(terrain);
  if (colors.size === 0) return data;
  const bands = TERRAIN_MATERIALS.filter(isColorableTerrainMaterial).map((material) => ({ material, ...terrainMaterialBand(material) }));
  for (const rows of data) {
    rows.forEach((row, cy) =>
      row.forEach((index, cx) => {
        const band = bands.find((entry) => index >= entry.firstTile && index < entry.firstTile + entry.tileCount);
        if (band === undefined) return;
        const color = terrainCellColor(terrain, colors, band.material, cx, cy);
        const firstGid = color === null ? null : firstGidOf(band.material, color);
        if (firstGid !== null) row[cx] = firstGid + index - band.firstTile;
      }),
    );
  }
  return data;
}

/**
 * How the band of `material` is painted in `color`: from the default color
 * of its floor piece, the one color the tileset band is exported in, like a
 * painted desk. `null` when there is nothing to paint.
 */
export function terrainRecolor(manifest: ArtPackManifest | null, material: TerrainMaterial, color: string): Recolor | null {
  if (manifest === null) return null;
  const tileset = findPiece(manifest, 'tileset-terrain');
  const floorId = tileset?.kind === 'tileset' ? tileset.materials.find((entry) => entry.material === material)?.floor : undefined;
  const floor = floorId === undefined ? undefined : findPiece(manifest, floorId);
  return floor === undefined ? null : recolorFor(floor, color);
}
