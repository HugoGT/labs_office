import { describe, expect, it } from 'vitest';
import { ART_TILE, TERRAIN_TILESET, terrainTileIndex, type ArtPackManifest, type ArtTilesetPiece } from './artContract';
import { findPiece, parseArtPackManifest } from './artPack';
import { terrainSnapshot, type LayoutMaterial, type OfficeLayout, type TerrainColors } from './officeLayout';
import { terrainCellColor, terrainColorTileData, terrainMaterialBand, terrainRecolor } from './terrainColorTiles';
import { terrainTileData } from './terrainRender';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';

function pack(): ArtPackManifest {
  const manifest = parseArtPackManifest(JSON.parse(exportedManifest));
  if (manifest === null) throw new Error('the exported manifest must parse');
  return manifest;
}

/** An 18x18 layout of four 9x9 blocks: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
function fourBlocks(blocks: readonly LayoutMaterial[]): OfficeLayout {
  const empty = new Array<null>(18 * 18).fill(null);
  return { width: 18, height: 18, blocks: [...blocks], ground: empty, walls: empty, hedges: empty, decals: empty, props: [] };
}

const RED = '#aa0000';
const GREEN = '#00bb00';
const BLUE = '#0000cc';

describe('terrainMaterialBand', () => {
  it('is the carpet rows of the terrain tileset, where the manifest says its tiles start', () => {
    const tileset = findPiece(pack(), 'tileset-terrain') as ArtTilesetPiece;
    const firstTile = tileset.materials.find((entry) => entry.material === 'carpet')!.firstTile;
    const band = terrainMaterialBand('carpet');

    expect(band.firstTile).toBe(firstTile);
    expect(band.tileCount).toBe(TERRAIN_TILESET.phases * TERRAIN_TILESET.columns);
    expect(band.rect).toEqual({
      x: 0,
      y: (firstTile / TERRAIN_TILESET.columns) * ART_TILE,
      width: TERRAIN_TILESET.columns * ART_TILE,
      height: TERRAIN_TILESET.phases * ART_TILE,
    });
    expect(terrainTileIndex('carpet', 15, TERRAIN_TILESET.phases - 1)).toBeLessThan(band.firstTile + band.tileCount);
  });
});

describe('terrainCellColor (#222, D4)', () => {
  // Display cell (9, 9) has one corner in each block: nw 0, ne 1, sw 2, se 3.
  it('takes the color of the first carpet block in corner order: top-left, top-right, bottom-left, bottom-right', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'carpet', 'carpet', 'carpet']));
    const colors: TerrainColors = new Map([[0, RED], [1, GREEN], [2, BLUE]]);

    expect(terrainCellColor(terrain, colors, 'carpet', 9, 9)).toBe(RED);
    expect(terrainCellColor(terrain, colors, 'carpet', 10, 9)).toBe(GREEN);
    expect(terrainCellColor(terrain, colors, 'carpet', 9, 10)).toBe(BLUE);
    expect(terrainCellColor(terrain, colors, 'carpet', 10, 10)).toBeNull();
  });

  it('skips corners of another material', () => {
    const terrain = terrainSnapshot(fourBlocks(['grass', 'wood', 'carpet', 'carpet']));
    const colors: TerrainColors = new Map([[2, BLUE], [3, GREEN]]);

    expect(terrainCellColor(terrain, colors, 'carpet', 9, 9)).toBe(BLUE);
  });

  it('draws the default art when the first carpet block has no color, whatever the others have', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'carpet', 'carpet', 'carpet']));

    expect(terrainCellColor(terrain, new Map([[1, GREEN]]), 'carpet', 9, 9)).toBeNull();
  });

  it('reads the map edge from the nearest tile, like the corners of the tilemap', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'grass', 'grass', 'grass']));

    expect(terrainCellColor(terrain, new Map([[0, RED]]), 'carpet', 0, 0)).toBe(RED);
  });
});

describe('terrainColorTileData (#222)', () => {
  const band = terrainMaterialBand('carpet');

  it('moves the carpet tiles of a colored block to the recolored band, and leaves every other tile alone', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'grass', 'grass', 'grass']));
    const asked: string[] = [];
    const data = terrainColorTileData(terrain, new Map([[0, RED]]), (material, color) => {
      asked.push(`${material}:${color}`);
      return 10_000;
    });

    const plain = terrainTileData(terrain);
    let moved = 0;
    plain.forEach((rows, layer) =>
      rows.forEach((row, cy) =>
        row.forEach((index, cx) => {
          const carpet = index >= band.firstTile && index < band.firstTile + band.tileCount;
          expect(data[layer]![cy]![cx]).toBe(carpet ? 10_000 + index - band.firstTile : index);
          if (carpet) moved += 1;
        }),
      ),
    );
    expect(moved).toBeGreaterThan(0);
    expect(new Set(asked)).toEqual(new Set([`carpet:${RED}`]));
  });

  it('draws exactly the default tiles without colors (S4)', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'carpet', 'grass', 'wood']));

    expect(terrainColorTileData(terrain, new Map(), () => 10_000)).toEqual(terrainTileData(terrain));
  });

  it('keeps the default carpet where no recolored band can be had', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'carpet', 'grass', 'wood']));

    expect(terrainColorTileData(terrain, new Map([[0, RED]]), () => null)).toEqual(terrainTileData(terrain));
  });
});

describe('terrainRecolor (#222)', () => {
  it('paints a colorable floor from the default color of its pack piece', () => {
    expect(terrainRecolor(pack(), 'carpet', RED)).toEqual({ from: '#5a6f86', to: RED });
  });

  it('has nothing to paint for the default color, a floor that takes no color or a missing catalog', () => {
    expect(terrainRecolor(pack(), 'carpet', '#5a6f86')).toBeNull();
    expect(terrainRecolor(pack(), 'wood', RED)).toBeNull();
    expect(terrainRecolor(null, 'carpet', RED)).toBeNull();
  });
});
