import { describe, expect, it } from 'vitest';
import { ART_TILE, TERRAIN_TILESET, terrainPhaseAt, terrainTileIndex, type ArtPackManifest, type ArtTilesetPiece } from './artContract';
import { findPiece, parseArtPackManifest } from './artPack';
import { terrainSnapshot, type LayoutMaterial, type OfficeLayout } from './officeLayout';
import { terrainColorTileData, terrainMaterialBand, terrainRecolor } from './terrainColorTiles';
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

describe('terrainColorTileData at a seam between blocks (#259)', () => {
  const band = terrainMaterialBand('carpet');
  /** Each color gets its own gid range, so a tile says which recolored band it came from. */
  const gidOf = (_material: string, color: string): number => ({ [RED]: 10_000, [GREEN]: 20_000, [BLUE]: 30_000 })[color]!;
  const carpetTile = (mask: number, cx: number, cy: number, gid?: number): number => {
    const index = terrainTileIndex('carpet', mask, terrainPhaseAt(cx, cy));
    return gid === undefined ? index : gid + index - band.firstTile;
  };
  /** The carpet tiles of one display cell across the layers. */
  const cell = (data: number[][][], cx: number, cy: number): number[] => data.map((rows) => rows[cy]![cx]!).filter((index) => index !== -1);

  it('draws each side of two colored carpets in its own color, not the first corner color over the whole cell', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'carpet', 'grass', 'grass']));
    const data = terrainColorTileData(terrain, new Map([[0, RED], [1, GREEN]]), gidOf);

    // Display cell (9, 4) sits between block 0 (left corners) and block 1 (right corners).
    expect(cell(data, 9, 4)).toEqual([carpetTile(1 | 4, 9, 4, 10_000), carpetTile(2 | 8, 9, 4, 20_000)]);
  });

  it('keeps the default art on the side of an uncolored carpet', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'carpet', 'grass', 'grass']));
    const data = terrainColorTileData(terrain, new Map([[0, RED]]), gidOf);

    expect(cell(data, 9, 4)).toEqual([carpetTile(1 | 4, 9, 4, 10_000), carpetTile(2 | 8, 9, 4)]);
  });

  it('gives each carpet that meets at a point its own quarter, and one tile to a color that appears twice', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'carpet', 'carpet', 'carpet']));
    const four = terrainColorTileData(terrain, new Map([[0, RED], [1, GREEN], [2, BLUE]]), gidOf);
    const twice = terrainColorTileData(terrain, new Map([[0, RED], [1, GREEN], [2, BLUE], [3, RED]]), gidOf);

    expect(cell(four, 9, 9)).toEqual([carpetTile(1, 9, 9, 10_000), carpetTile(2, 9, 9, 20_000), carpetTile(4, 9, 9, 30_000), carpetTile(8, 9, 9)]);
    expect(cell(twice, 9, 9)).toEqual([carpetTile(1 | 8, 9, 9, 10_000), carpetTile(2, 9, 9, 20_000), carpetTile(4, 9, 9, 30_000)]);
  });

  it('does not split a cell for a color that has no recolored band', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'carpet', 'grass', 'grass']));
    const data = terrainColorTileData(terrain, new Map([[0, RED], [1, GREEN]]), (_material, color) => (color === RED ? 10_000 : null));

    expect(cell(data, 9, 4)).toEqual([carpetTile(1 | 4, 9, 4, 10_000), carpetTile(2 | 8, 9, 4)]);
  });

  it('leaves a cell inside one colored block as a single full tile', () => {
    const terrain = terrainSnapshot(fourBlocks(['carpet', 'carpet', 'grass', 'grass']));
    const data = terrainColorTileData(terrain, new Map([[0, RED], [1, GREEN]]), gidOf);

    expect(cell(data, 4, 4)).toEqual([carpetTile(15, 4, 4, 10_000)]);
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
