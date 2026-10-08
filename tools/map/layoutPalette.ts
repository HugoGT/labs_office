import { ART_TILE, TERRAIN_DECALS, TERRAIN_MATERIALS, terrainDecalIndex, terrainTileIndex, type TerrainMaterial, type RgbaImage } from '../../src/game/artContract.ts';
import { PixelBuffer } from '../art/domain/pixelBuffer.ts';
import { decodePng } from '../../server/src/assets/pngCodec.ts';

export const LAYOUT_PATH = 'src/game/maps/office.json';
export const PALETTE_PATH = 'src/game/maps/layout-palette.png';
export const LAYOUT_PALETTE: readonly string[] = [...TERRAIN_MATERIALS, 'wall-brick', 'wall-stone', 'wall-plaster', 'wall-glass', 'hedge-boxwood', ...TERRAIN_DECALS];

function toBuffer(image: RgbaImage): PixelBuffer {
  return new PixelBuffer(image.width, image.height, new Uint8ClampedArray(image.data));
}

function copyTile(target: PixelBuffer, source: PixelBuffer, sx: number, sy: number, dx: number, dy: number, w = ART_TILE, h = ART_TILE): void {
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) target.setPixel(dx + x, dy + y, source.getPixel(sx + x, sy + y));
}

/** Editor palette only; the office renders the pack directly. */
export function renderLayoutPalette(readPack: (path: string) => Uint8Array): PixelBuffer {
  const out = new PixelBuffer(ART_TILE * LAYOUT_PALETTE.length, ART_TILE);
  const tileset = toBuffer(decodePng(readPack('tileset/terrain.png')));
  const tilesetTile = (index: number, dx: number): void => {
    const columns = tileset.width / ART_TILE;
    copyTile(out, tileset, (index % columns) * ART_TILE, Math.floor(index / columns) * ART_TILE, dx, 0);
  };
  LAYOUT_PALETTE.forEach((name, slot) => {
    const dx = slot * ART_TILE;
    if ((TERRAIN_MATERIALS as readonly string[]).includes(name)) {
      tilesetTile(terrainTileIndex(name as TerrainMaterial, 15, 0), dx);
    } else if ((TERRAIN_DECALS as readonly string[]).includes(name)) {
      tilesetTile(terrainDecalIndex(name as (typeof TERRAIN_DECALS)[number]), dx);
    } else if (name.startsWith('wall-')) {
      const wall = toBuffer(decodePng(readPack(`wall/${name.slice('wall-'.length)}.png`)));
      for (const [ox, oy] of [[0, 0], [16, 0], [0, 16], [16, 16]] as const) copyTile(out, wall, 0, 0, dx + ox, oy, 16, 16);
    } else {
      const hedge = toBuffer(decodePng(readPack(`hedge/${name.slice('hedge-'.length)}.png`)));
      copyTile(out, hedge, 15 * ART_TILE, hedge.height - ART_TILE, dx, 0);
    }
  });
  return out;
}
