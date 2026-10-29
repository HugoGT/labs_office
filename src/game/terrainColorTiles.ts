/**
 * Colored terrain blocks (#222), as plain numbers: which band of the terrain
 * tileset a colorable floor draws from, how its dual-grid cells split by color,
 * and the tile data that points those cells at a recolored copy of the band.
 * No Phaser, so it is tested under jsdom; `mapBuilder.ts` adds the copies as
 * extra tilesets of the same tilemap.
 */

import {
  ART_TILE,
  TERRAIN_MATERIALS,
  TERRAIN_TILESET,
  terrainLayerCells,
  type ArtPackManifest,
  type Rect,
  type TerrainMaterial,
} from './artContract';
import { findPiece, recolorFor, type Recolor } from './artPack';
import { blockIndexAt, isColorableTerrainMaterial, type TerrainColors, type TerrainSnapshot } from './officeLayout';
import { drawnTerrainAt, terrainTileData } from './terrainRender';

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
 * `terrainTileData` with the tiles of colored blocks moved to a recolored
 * band: `firstGidOf(material, color)` is the first tile index of that band's
 * copy, or `null` when there is none (a browser that cannot read pixels
 * back), which keeps the default art. Without colors it is `terrainTileData`
 * exactly, so terrain stored before #222 draws as it always did.
 *
 * A display cell has four corners, possibly in carpet blocks of different
 * colors: its carpet is split into one tile per color over only that color's
 * corners (#259), so a seam between two colors is the tile line instead of a
 * whole cell in the color of the first corner.
 */
export function terrainColorTileData(
  terrain: TerrainSnapshot,
  colors: TerrainColors,
  firstGidOf: (material: TerrainMaterial, color: string) => number | null,
): number[][][] {
  if (colors.size === 0) return terrainTileData(terrain);
  // A color without a recolored band draws the default art, so it joins the uncolored group instead of splitting its cell.
  const gids = new Map<string, number | null>();
  const gidOf = (material: TerrainMaterial, color: string): number | null => {
    const id = `${material}:${color}`;
    if (!gids.has(id)) gids.set(id, firstGidOf(material, color));
    return gids.get(id) ?? null;
  };
  const { tiles, groups } = terrainLayerCells(
    terrain.width,
    terrain.height,
    (tx, ty) => drawnTerrainAt(terrain, tx, ty),
    (material, tx, ty) => {
      const color = isColorableTerrainMaterial(material) ? colors.get(blockIndexAt(terrain.width, tx, ty)) : undefined;
      return color !== undefined && gidOf(material, color) !== null ? color : null;
    },
  );
  const bands = TERRAIN_MATERIALS.filter(isColorableTerrainMaterial).map((material) => ({ material, ...terrainMaterialBand(material) }));
  tiles.forEach((rows, layer) =>
    rows.forEach((row, cy) =>
      row.forEach((index, cx) => {
        const color = groups[layer]![cy]![cx]!;
        if (color === null) return;
        const band = bands.find((entry) => index >= entry.firstTile && index < entry.firstTile + entry.tileCount);
        const firstGid = band === undefined ? null : gidOf(band.material, color);
        if (band !== undefined && firstGid !== null) row[cx] = firstGid + index - band.firstTile;
      }),
    ),
  );
  return tiles;
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
