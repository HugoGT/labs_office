/**
 * Terrain transition tiles (#123). Every material is its floor motif cut on the dual grid of the
 * art contract: a cell's four corners are the centers of four map tiles, and a tile of mask `m`
 * covers the corners in `m` (`terrainCellLayers` stacks them). Coverage comes from a field that is
 * 1 on covered corners and 0 on the others:
 *
 * - `organic` (natural ground): the corners blended bilinearly, plus smooth noise that repeats
 *   with the 96px motif. Both depend only on the shared corners and the world position, so an edge
 *   runs on from one cell into the next without a seam, and it never crosses a cell side where both
 *   corners agree.
 * - `square` (built floors): each quarter of the cell takes its corner, so the edge is the map
 *   tile line, like the walls standing on it.
 *
 * Near the edge the material gets a darker rim inside and a translucent indigo contact shadow
 * outside, drawn over whatever lies below; one tile works over any lower neighbor.
 */
import { OUTLINE_INK } from '../../../src/game/artColor.ts';
import {
  ART_TILE,
  FLOOR_MOTIF_SIZE,
  TERRAIN_CORNER_BITS,
  terrainPhaseOrigin,
  type TerrainDecal,
  type TerrainMaterial,
} from '../../../src/game/artContract.ts';
import { hexToRgba, makeRamp, mixRgba } from './color.ts';
import { periodicNoise, type Noise } from './noise.ts';
import { PixelBuffer, rgba, type Rgba } from './pixelBuffer.ts';
import { terrainTile } from './tiles.ts';

export interface TerrainEdge {
  readonly style: 'organic' | 'square';
  /** How far, in cells, the noise pushes an organic edge off its straight line. */
  readonly amplitude: number;
  readonly seed: number;
}

export const TERRAIN_EDGES: Readonly<Record<TerrainMaterial, TerrainEdge>> = {
  water: { style: 'organic', amplitude: 0.15, seed: 101 },
  grass: { style: 'organic', amplitude: 0.22, seed: 102 },
  dirt: { style: 'organic', amplitude: 0.18, seed: 103 },
  sand: { style: 'organic', amplitude: 0.16, seed: 104 },
  cobblestone: { style: 'organic', amplitude: 0.1, seed: 105 },
  wood: { style: 'square', amplitude: 0, seed: 106 },
  tile: { style: 'square', amplitude: 0, seed: 107 },
  carpet: { style: 'square', amplitude: 0, seed: 108 },
};

/** One pixel of field, in cells: the rim and the shadow are each two pixels wide. */
const PIXEL = 1 / ART_TILE;
const SHADOW_NEAR = rgba(28, 18, 44, 72);
const SHADOW_FAR = rgba(28, 18, 44, 36);

const CORNERS = [
  { bit: TERRAIN_CORNER_BITS.nw, u: 0, v: 0 },
  { bit: TERRAIN_CORNER_BITS.ne, u: 1, v: 0 },
  { bit: TERRAIN_CORNER_BITS.sw, u: 0, v: 1 },
  { bit: TERRAIN_CORNER_BITS.se, u: 1, v: 1 },
] as const;

function bit(mask: number, value: number): number {
  return (mask & value) !== 0 ? 1 : 0;
}

function bilinear(mask: number, u: number, v: number): number {
  const top = bit(mask, TERRAIN_CORNER_BITS.nw) * (1 - u) + bit(mask, TERRAIN_CORNER_BITS.ne) * u;
  const bottom = bit(mask, TERRAIN_CORNER_BITS.sw) * (1 - u) + bit(mask, TERRAIN_CORNER_BITS.se) * u;
  return top * (1 - v) + bottom * v;
}

/**
 * Square field: 0.5 plus the distance to the nearest quarter of the other state, so the 0.5 level
 * is the quarter boundary and the rim and shadow bands measure pixels from it.
 */
function squareField(mask: number, u: number, v: number): number {
  const own = CORNERS.find((corner) => Math.abs(corner.u - u) <= 0.5 && Math.abs(corner.v - v) <= 0.5) as (typeof CORNERS)[number];
  const inside = bit(mask, own.bit) === 1;
  const du = Math.abs(u - 0.5);
  const dv = Math.abs(v - 0.5);
  let nearest = 0.5;
  for (const corner of CORNERS) {
    if (corner === own || (bit(mask, corner.bit) === 1) === inside) continue;
    const sameColumn = corner.u === own.u;
    const sameRow = corner.v === own.v;
    nearest = Math.min(nearest, sameRow ? du : sameColumn ? dv : Math.max(du, dv));
  }
  return inside ? 0.5 + nearest : 0.5 - nearest;
}

const noiseCache = new Map<TerrainMaterial, Noise>();

/** Two octaves of motif-periodic noise centered on 0, in [-1, 1]. */
function edgeNoise(material: TerrainMaterial): Noise {
  const cached = noiseCache.get(material);
  if (cached) return cached;
  const { seed } = TERRAIN_EDGES[material];
  const coarse = periodicNoise(seed, FLOOR_MOTIF_SIZE, 8);
  const fine = periodicNoise(seed + 1000, FLOOR_MOTIF_SIZE, 16);
  const noise: Noise = (x, y) => ((coarse(x, y) + 0.35 * fine(x, y)) / 1.35) * 2 - 1;
  noiseCache.set(material, noise);
  return noise;
}

/** Coverage field of one pixel of a cell: covered at 0.5 and above. */
export function terrainField(material: TerrainMaterial, mask: number, phase: number, x: number, y: number): number {
  const u = (x + 0.5) / ART_TILE;
  const v = (y + 0.5) / ART_TILE;
  const edge = TERRAIN_EDGES[material];
  if (edge.style === 'square') return squareField(mask, u, v);
  const origin = terrainPhaseOrigin(phase);
  return bilinear(mask, u, v) + edge.amplitude * edgeNoise(material)(origin.x + x + 0.5, origin.y + y + 0.5);
}

const motifCache = new Map<TerrainMaterial, PixelBuffer>();

function motifOf(material: TerrainMaterial): PixelBuffer {
  const cached = motifCache.get(material);
  if (cached) return cached;
  const motif = terrainTile(material);
  motifCache.set(material, motif);
  return motif;
}

/** The tile of `material` covering the corners in `mask` (1-15), for one motif phase. */
export function terrainEdgeTile(material: TerrainMaterial, mask: number, phase: number): PixelBuffer {
  const motif = motifOf(material);
  const origin = terrainPhaseOrigin(phase);
  const tile = new PixelBuffer(ART_TILE, ART_TILE);
  for (let y = 0; y < ART_TILE; y += 1) {
    for (let x = 0; x < ART_TILE; x += 1) {
      const field = terrainField(material, mask, phase, x, y);
      if (field >= 0.5) {
        const color = motif.getPixel((origin.x + x) % FLOOR_MOTIF_SIZE, (origin.y + y) % FLOOR_MOTIF_SIZE);
        if (field < 0.5 + PIXEL) tile.setPixel(x, y, mixRgba(color, OUTLINE_INK, 0.38));
        else if (field < 0.5 + 2 * PIXEL) tile.setPixel(x, y, mixRgba(color, OUTLINE_INK, 0.16));
        else tile.setPixel(x, y, color);
      } else if (field >= 0.5 - PIXEL) tile.setPixel(x, y, SHADOW_NEAR);
      else if (field >= 0.5 - 2 * PIXEL) tile.setPixel(x, y, SHADOW_FAR);
    }
  }
  return tile;
}

// --- Decals ------------------------------------------------------------------------------------

const LEAF = makeRamp('#4f8f3a');
const STONE = makeRamp('#9c968d');

function flowers(tile: PixelBuffer, petal: Rgba, center: Rgba): void {
  for (const [x, y] of [
    [8, 9],
    [21, 13],
    [12, 22],
  ] as const) {
    tile.setPixel(x - 1, y + 2, LEAF.shadow);
    tile.setPixel(x + 1, y + 2, LEAF.base);
    tile.setPixel(x, y - 1, petal);
    tile.setPixel(x - 1, y, petal);
    tile.setPixel(x + 1, y, petal);
    tile.setPixel(x, y + 1, petal);
    tile.setPixel(x, y, center);
  }
}

function pebble(tile: PixelBuffer, x: number, y: number, wide: boolean): void {
  tile.fillRect(x, y, wide ? 3 : 2, 2, STONE.base);
  tile.setPixel(x, y, STONE.light);
  tile.fillRect(x, y + 2, wide ? 3 : 2, 1, STONE.deep);
}

/** A 32x32 transparent detail for the decal layer. */
export function decalTile(decal: TerrainDecal): PixelBuffer {
  const tile = new PixelBuffer(ART_TILE, ART_TILE);
  switch (decal) {
    case 'flowers-white':
      flowers(tile, hexToRgba('#f4f1e6'), hexToRgba('#f2c94c'));
      break;
    case 'flowers-yellow':
      flowers(tile, hexToRgba('#f2c94c'), hexToRgba('#c0582a'));
      break;
    case 'flowers-blue':
      flowers(tile, hexToRgba('#7aa7e6'), hexToRgba('#f4f1e6'));
      break;
    case 'clover':
      for (const [x, y] of [
        [9, 10],
        [20, 8],
        [15, 21],
        [24, 23],
      ] as const) {
        tile.fillRect(x, y, 2, 2, LEAF.light);
        tile.fillRect(x + 2, y + 1, 2, 2, LEAF.base);
        tile.fillRect(x, y + 2, 2, 2, LEAF.base);
        tile.setPixel(x + 2, y + 3, LEAF.shadow);
      }
      break;
    case 'pebbles':
      pebble(tile, 9, 11, true);
      pebble(tile, 19, 9, false);
      pebble(tile, 14, 20, true);
      pebble(tile, 23, 22, false);
      break;
    case 'mushrooms': {
      const cap = makeRamp('#c0473a');
      for (const [x, y] of [
        [10, 14],
        [19, 18],
      ] as const) {
        tile.fillRect(x + 1, y + 2, 2, 3, hexToRgba('#efe6d2'));
        tile.fillRect(x, y, 4, 2, cap.base);
        tile.setPixel(x + 1, y, hexToRgba('#f4f1e6'));
        tile.fillRect(x, y + 2, 4, 1, cap.shadow);
        tile.fillRect(x + 1, y + 5, 2, 1, LEAF.deep);
      }
      break;
    }
    case 'leaves': {
      const leaf = makeRamp('#cf7a32');
      for (const [x, y, light] of [
        [8, 9, true],
        [20, 11, false],
        [12, 21, false],
        [23, 22, true],
      ] as const) {
        tile.setPixel(x, y, leaf.light);
        tile.setPixel(x + 1, y + 1, light ? leaf.light : leaf.base);
        tile.setPixel(x + 1, y, leaf.base);
        tile.setPixel(x + 2, y + 1, leaf.base);
        tile.setPixel(x + 2, y + 2, leaf.shadow);
      }
      break;
    }
    case 'lily-pad': {
      const pad = makeRamp('#5c9a46');
      const [cx, cy] = [15.5, 16.5];
      for (let y = 0; y < ART_TILE; y += 1) {
        for (let x = 0; x < ART_TILE; x += 1) {
          const dx = x + 0.5 - cx;
          const dy = (y + 0.5 - cy) * 1.3;
          const d = Math.hypot(dx, dy);
          const notch = dx > 0 && Math.abs(dy) < dx * 0.35;
          if (d > 7 || notch) continue;
          tile.setPixel(x, y, d > 6 ? pad.shadow : dx + dy < -4 ? pad.light : pad.base);
        }
      }
      tile.fillRect(13, 14, 2, 2, hexToRgba('#f2b8cf'));
      tile.setPixel(14, 14, hexToRgba('#f4f1e6'));
      break;
    }
  }
  return tile;
}
