/**
 * Terrain transition tiles (#123). Every material is its floor motif cut on the dual grid of the
 * art contract: a cell's four corners are the centers of four map tiles, and a tile of mask `m`
 * covers the corners in `m` (`terrainCellLayers` stacks them). Coverage comes from a field that is
 * 1 on covered corners and 0 on the others:
 *
 * - `organic` (natural ground): the corners blended bilinearly, plus smooth noise that repeats
 *   with the 96px motif. Both depend only on the shared corners and the world position, so an edge
 *   runs on from one cell into the next without a seam, and it never crosses a cell side where both
 *   corners agree. On top of that, each of the TERRAIN_VARIANTS edge variants adds its own noise
 *   through a window that is zero on all four cell sides: the edge takes another shape inside the
 *   cell, but the field on its sides is the same whatever variant a neighbor picks. Without it the
 *   motif-periodic noise drew the same curve on every side of every 9x9 block.
 * - `square` (built floors): each quarter of the cell takes its corner, so the edge is the map
 *   tile line, like the walls standing on it.
 *
 * Near the edge the material gets a darker rim inside and a translucent indigo contact shadow
 * outside, drawn over whatever lies below; one tile works over any lower neighbor. Built floors
 * keep a one pixel rim: a two pixel one on a straight tile line read as a wall, not as a floor.
 * They cast no shadow either: it painted two pixels past the tile line, so the floor looked wider
 * than its walkable tiles. Over water that same shadow comes back as a bank tile per corner mask
 * (`terrainBankTile`), drawn right over the water, so the water still reads as sunk below them.
 *
 * Against the void (no terrain) the materials run on under the void corners and a void cap
 * (`terrainVoidCapTile`) covers those quarters in the void color, so every edge against the void
 * is straight on the tile line, with the built floors' one pixel rim on the terrain side. An
 * organic edge in a cell with void corners comes from its own tile (`terrainVoidEdgeTile`), whose
 * field turns square near the void quarters, so a shore meets the void line on the tile line too.
 */
import { OUTLINE_INK } from '../../../src/game/artColor.ts';
import {
  ART_TILE,
  FLOOR_MOTIF_SIZE,
  TERRAIN_CORNER_BITS,
  TERRAIN_VARIANTS,
  TERRAIN_VOID_COLOR,
  isTerrainBuiltFloor,
  terrainVoidEdgeIndex,
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
  /** Width of the darker rim inside the edge, in pixels: 2 (strong, then soft) or 1 (strong). */
  readonly rim: 1 | 2;
  /** Whether a translucent contact shadow is drawn two pixels outside the edge. */
  readonly shadow: boolean;
}

/** The contract's built floors (`TERRAIN_BUILT_FLOORS`) decide the style, so the bank and the edges never disagree. */
function edgeOf(material: TerrainMaterial, amplitude: number, seed: number): TerrainEdge {
  return isTerrainBuiltFloor(material)
    ? { style: 'square', amplitude: 0, seed, rim: 1, shadow: false }
    : { style: 'organic', amplitude, seed, rim: 2, shadow: true };
}

export const TERRAIN_EDGES: Readonly<Record<TerrainMaterial, TerrainEdge>> = {
  water: edgeOf('water', 0.15, 101),
  grass: edgeOf('grass', 0.22, 102),
  dirt: edgeOf('dirt', 0.18, 103),
  sand: edgeOf('sand', 0.16, 104),
  cobblestone: edgeOf('cobblestone', 0.1, 105),
  wood: edgeOf('wood', 0, 106),
  tile: edgeOf('tile', 0, 107),
  carpet: edgeOf('carpet', 0, 108),
};

/** One pixel of field, in cells: the shadow, when drawn, is two pixels wide, the rim one or two (`TerrainEdge.rim`). */
const PIXEL = 1 / ART_TILE;
const SHADOW_NEAR = rgba(28, 18, 44, 72);
const SHADOW_FAR = rgba(28, 18, 44, 36);

/** The contact shadow at a field level: two pixels just outside the 0.5 edge, none elsewhere. */
function contactShadow(field: number): Rgba | null {
  if (field >= 0.5) return null;
  if (field >= 0.5 - PIXEL) return SHADOW_NEAR;
  if (field >= 0.5 - 2 * PIXEL) return SHADOW_FAR;
  return null;
}

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

const variantNoiseCache = new Map<string, Noise>();

/** How each variant bends the edge: variant 0 keeps the shared curve, 1 swells the cover, 2 shrinks it. */
const VARIANT_BIAS = [0, 1, -1] as const;
if (VARIANT_BIAS.length !== TERRAIN_VARIANTS) throw new Error('One edge bias per terrain variant');

/**
 * Noise in [-1, 1] of one edge variant, one cell wide (the window pins it to the cell). A pure
 * random noise was sometimes flat, so two variants drew the same edge; a signed bias plus a smaller
 * smooth wobble always pushes the edge one way, by a different amount along it.
 */
function variantNoise(material: TerrainMaterial, variant: number): Noise {
  const key = `${material}:${variant}`;
  const cached = variantNoiseCache.get(key);
  if (cached) return cached;
  const bias = VARIANT_BIAS[variant] as number;
  const seed = TERRAIN_EDGES[material].seed * 31 + 7919 * (variant + 1);
  const wobble = periodicNoise(seed, ART_TILE, 4);
  const noise: Noise = bias === 0 ? () => 0 : (x, y) => bias * (0.7 + 0.3 * (wobble(x, y) * 2 - 1));
  variantNoiseCache.set(key, noise);
  return noise;
}

/** Coverage field of one pixel of a cell: covered at 0.5 and above. `x`, `y` -0.5 and 31.5 are the cell sides. */
export function terrainField(material: TerrainMaterial, mask: number, phase: number, variant: number, x: number, y: number): number {
  if (!Number.isInteger(variant) || variant < 0 || variant >= TERRAIN_VARIANTS) throw new Error(`Invalid terrain variant ${variant}`);
  const u = (x + 0.5) / ART_TILE;
  const v = (y + 0.5) / ART_TILE;
  if (TERRAIN_EDGES[material].style === 'square') return squareField(mask, u, v);
  return organicField(material, mask, phase, x, y) + variantTerm(material, mask, variant, x, y);
}

/** The organic field shared by every variant: the corners blended bilinearly plus the motif-periodic noise. */
function organicField(material: TerrainMaterial, mask: number, phase: number, x: number, y: number): number {
  const origin = terrainPhaseOrigin(phase);
  const noise = TERRAIN_EDGES[material].amplitude * edgeNoise(material)(origin.x + x + 0.5, origin.y + y + 0.5);
  return bilinear(mask, (x + 0.5) / ART_TILE, (y + 0.5) / ART_TILE) + noise;
}

/** What an edge variant adds to the organic field: its noise through a window that is zero on the cell sides. */
function variantTerm(material: TerrainMaterial, mask: number, variant: number, x: number, y: number): number {
  // The full mask has no edge to vary; the extra noise could only darken its middle into a stray rim.
  if (mask === 15) return 0;
  const u = (x + 0.5) / ART_TILE;
  const v = (y + 0.5) / ART_TILE;
  const window = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  return TERRAIN_EDGES[material].amplitude * window * variantNoise(material, variant)(x + 0.5, y + 0.5);
}

const validVoidEdges = new Set<string>();

/** Throws for a pair `terrainVoidEdgeIndex` has no tile for; remembered, since the field runs per pixel. */
function checkVoidEdge(material: TerrainMaterial, mask: number, voidMask: number, phase: number): void {
  const key = `${material}:${mask}:${voidMask}:${phase}`;
  if (validVoidEdges.has(key)) return;
  terrainVoidEdgeIndex(material, mask, voidMask, phase);
  validVoidEdges.add(key);
}

/**
 * Weight of the edge noise in a cell with the void corners `voidMask`, at pixel (x, y): the
 * Chebyshev distance to the nearest void quarter over half a cell, clamped to 1. It is 1 on every
 * cell side away from the void and depends only on the void corners of a side along it, so the
 * neighbor across any side sees the same weight there.
 */
export function terrainVoidWeight(voidMask: number, x: number, y: number): number {
  const u = (x + 0.5) / ART_TILE;
  const v = (y + 0.5) / ART_TILE;
  let weight = 1;
  for (const corner of CORNERS) {
    if (bit(voidMask, corner.bit) === 0) continue;
    const distance = Math.max(0, Math.abs(u - corner.u) - 0.5, Math.abs(v - corner.v) - 0.5);
    weight = Math.min(weight, Math.min(1, distance / 0.5));
  }
  return weight;
}

/**
 * Coverage field of an organic material's void edge tile: the plain field weighted by
 * `terrainVoidWeight` (eased), the square field taking over next to the void quarters. Fading only the
 * noise was not enough: the bilinear edge itself leaves a corner of the cell diagonally, so a
 * three-corner arc still ran a wedge of the higher material down the void line. With the square
 * field there, an edge meets the void line square on the tile line, and the weight keeps every
 * side seamless: 1 away from the void, the same on both sides of a void corner.
 */
export function terrainVoidEdgeField(material: TerrainMaterial, mask: number, voidMask: number, phase: number, x: number, y: number): number {
  checkVoidEdge(material, mask, voidMask, phase);
  // Eased, so the square field holds a little longer by the void: with the linear weight, a pixel
  // where the void line meets another quarter still took the higher material.
  const linear = terrainVoidWeight(voidMask, x, y);
  const weight = linear * linear * (3 - 2 * linear);
  const square = squareField(mask, (x + 0.5) / ART_TILE, (y + 0.5) / ART_TILE);
  if (weight === 0) return square;
  return weight * organicField(material, mask, phase, x, y) + (1 - weight) * square;
}

const motifCache = new Map<TerrainMaterial, PixelBuffer>();

function motifOf(material: TerrainMaterial): PixelBuffer {
  const cached = motifCache.get(material);
  if (cached) return cached;
  const motif = terrainTile(material);
  motifCache.set(material, motif);
  return motif;
}

/** Paints a tile of `material` from its coverage field: the motif, the rim inside the edge and, where `shaded`, the contact shadow outside. */
function paintEdgeTile(material: TerrainMaterial, phase: number, fieldAt: (x: number, y: number) => number, shaded: (x: number, y: number) => boolean): PixelBuffer {
  const motif = motifOf(material);
  const origin = terrainPhaseOrigin(phase);
  const { rim, shadow } = TERRAIN_EDGES[material];
  const tile = new PixelBuffer(ART_TILE, ART_TILE);
  for (let y = 0; y < ART_TILE; y += 1) {
    for (let x = 0; x < ART_TILE; x += 1) {
      const field = fieldAt(x, y);
      if (field >= 0.5) {
        const color = motif.getPixel((origin.x + x) % FLOOR_MOTIF_SIZE, (origin.y + y) % FLOOR_MOTIF_SIZE);
        if (field < 0.5 + PIXEL) tile.setPixel(x, y, mixRgba(color, OUTLINE_INK, 0.38));
        else if (rim === 2 && field < 0.5 + 2 * PIXEL) tile.setPixel(x, y, mixRgba(color, OUTLINE_INK, 0.16));
        else tile.setPixel(x, y, color);
      } else if (shadow && shaded(x, y)) {
        const shade = contactShadow(field);
        if (shade !== null) tile.setPixel(x, y, shade);
      }
    }
  }
  return tile;
}

/** The tile of `material` covering the corners in `mask` (1-15), for one motif phase and edge variant. */
export function terrainEdgeTile(material: TerrainMaterial, mask: number, phase: number, variant: number): PixelBuffer {
  return paintEdgeTile(material, phase, (x, y) => terrainField(material, mask, phase, variant, x, y), () => true);
}

/**
 * The tile of an organic `material` over `mask` in a cell whose void corners are `voidMask`
 * (`terrainVoidEdgeField`). It casts no shadow in the two pixels next to a void quarter: the
 * material there runs on under the void cap, whose own rim is the edge, and the neighbor across a
 * side may not draw this material at all, so a shadow there would stop short at the cell side.
 */
export function terrainVoidEdgeTile(material: TerrainMaterial, mask: number, voidMask: number, phase: number): PixelBuffer {
  terrainVoidEdgeIndex(material, mask, voidMask, phase);
  return paintEdgeTile(
    material,
    phase,
    (x, y) => terrainVoidEdgeField(material, mask, voidMask, phase, x, y),
    (x, y) => terrainVoidWeight(voidMask, x, y) >= 4 * PIXEL,
  );
}

/**
 * The water bank of mask `m` (1-15): the square contact shadow a built floor over the corners in
 * `m` would cast, alone. It does not depend on the phase, so one row of the tileset holds them all.
 */
export function terrainBankTile(mask: number): PixelBuffer {
  const tile = new PixelBuffer(ART_TILE, ART_TILE);
  for (let y = 0; y < ART_TILE; y += 1) {
    for (let x = 0; x < ART_TILE; x += 1) {
      const shade = contactShadow(squareField(mask, (x + 0.5) / ART_TILE, (y + 0.5) / ART_TILE));
      if (shade !== null) tile.setPixel(x, y, shade);
    }
  }
  return tile;
}

const VOID = rgba((TERRAIN_VOID_COLOR >> 16) & 0xff, (TERRAIN_VOID_COLOR >> 8) & 0xff, TERRAIN_VOID_COLOR & 0xff);
/** The built floors' one pixel rim, alone: drawn over whatever material runs on under the void. */
const VOID_RIM: Rgba = { ...OUTLINE_INK, a: Math.round(0.38 * 255) };

/**
 * The void cap of mask `m` (1-15): the square quarters of the corners in `m` painted opaque in the
 * void color, and a one pixel translucent rim just outside them, over the material's side. Like the
 * banks it does not depend on the phase or the variant, so one row of the tileset holds them all.
 */
export function terrainVoidCapTile(mask: number): PixelBuffer {
  const tile = new PixelBuffer(ART_TILE, ART_TILE);
  for (let y = 0; y < ART_TILE; y += 1) {
    for (let x = 0; x < ART_TILE; x += 1) {
      const field = squareField(mask, (x + 0.5) / ART_TILE, (y + 0.5) / ART_TILE);
      if (field >= 0.5) tile.setPixel(x, y, VOID);
      else if (field >= 0.5 - PIXEL) tile.setPixel(x, y, VOID_RIM);
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
