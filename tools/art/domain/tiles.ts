/**
 * Floor tiles drawn in code at sprite resolution. Every tile is square, TILE_SIZE wide (twice the
 * height of a character) and seamless: details that cross an edge wrap around to the opposite one,
 * so tiles can repeat in any direction. Shading follows the sprites: hue-shifted ramps, light from
 * the upper left.
 */
import { CHARACTER_HEIGHT } from './camera.ts';
import { hexToRgba, makeRamp, mixRgba } from './color.ts';
import { PixelBuffer, rgba, type Rgba } from './pixelBuffer.ts';
import { createRng, type Rng } from './random.ts';

export const TILE_SIZE = CHARACTER_HEIGHT * 2;

export const TERRAINS = ['wood', 'grass', 'water', 'plain'] as const;
export type Terrain = (typeof TERRAINS)[number];

export const DEFAULT_PLAIN_COLOR = '#b9c3cc';

function wrap(value: number): number {
  return ((value % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
}

function paint(tile: PixelBuffer, x: number, y: number, color: Rgba): void {
  tile.setPixel(wrap(x), wrap(y), color);
}

function solidTile(color: Rgba): PixelBuffer {
  const tile = new PixelBuffer(TILE_SIZE, TILE_SIZE);
  tile.fillRect(0, 0, TILE_SIZE, TILE_SIZE, color);
  return tile;
}

function randomInt(rng: Rng, max: number): number {
  return Math.floor(rng() * max);
}

const PLANK_TONES = ['#cba97f', '#c6a378', '#ceae84', '#c4a175'].map(hexToRgba);
const PLANK_SEAM = hexToRgba('#b08c62');
const PLANK_ROWS = 8;

/** Light brown planks in staggered rows, one or two joints per row. */
export function woodTile(seed = 2024): PixelBuffer {
  const rng = createRng(seed);
  const tile = new PixelBuffer(TILE_SIZE, TILE_SIZE);
  for (let row = 0; row < PLANK_ROWS; row += 1) {
    const top = Math.round((row * TILE_SIZE) / PLANK_ROWS);
    const height = Math.round(((row + 1) * TILE_SIZE) / PLANK_ROWS) - top;
    const joint = randomInt(rng, TILE_SIZE);
    const first = rng() < 0.5 ? TILE_SIZE : 40 + randomInt(rng, 15);
    const planks = first === TILE_SIZE ? [TILE_SIZE] : [first, TILE_SIZE - first];
    let x = joint;
    for (const length of planks) {
      const tone = PLANK_TONES[randomInt(rng, PLANK_TONES.length)] as Rgba;
      for (let py = top; py < top + height; py += 1) {
        for (let px = x; px < x + length; px += 1) paint(tile, px, py, tone);
        paint(tile, x, py, PLANK_SEAM);
      }
      x += length;
    }
    for (let px = 0; px < TILE_SIZE; px += 1) paint(tile, px, top, PLANK_SEAM);
  }
  return tile;
}

const GRASS = makeRamp('#6aa84f');
const FLOWER_PETALS = [hexToRgba('#f4f1e6'), hexToRgba('#f6d7e4')] as const;
const FLOWER_CENTER = hexToRgba('#f2c94c');

/** Dithered disc of `color`, denser at the center, used for soft patches. */
function softPatch(tile: PixelBuffer, rng: Rng, cx: number, cy: number, radius: number, color: Rgba): void {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const d = Math.hypot(x, y * 1.3) / radius;
      if (d > 1) continue;
      if (d < 0.6 || (d < 0.85 && (x + y) % 2 === 0) || rng() < 0.15) paint(tile, cx + x, cy + y, color);
    }
  }
}

/** Short grass: soft light and dark patches, dark tufts, sunlit blades and a few flowers. */
export function grassTile(seed = 7): PixelBuffer {
  const rng = createRng(seed);
  const tile = solidTile(GRASS.base);
  const darkPatch = mixRgba(GRASS.base, GRASS.shadow, 0.45);
  const lightPatch = mixRgba(GRASS.base, GRASS.light, 0.3);
  const cell = TILE_SIZE / 3;
  for (let i = 0; i < 9; i += 1) {
    const cx = (i % 3) * cell + randomInt(rng, cell);
    const cy = Math.floor(i / 3) * cell + randomInt(rng, cell);
    softPatch(tile, rng, cx, cy, 6 + randomInt(rng, 7), i % 2 ? darkPatch : lightPatch);
  }
  for (let i = 0; i < 80; i += 1) {
    const x = randomInt(rng, TILE_SIZE);
    const y = randomInt(rng, TILE_SIZE);
    paint(tile, x - 1, y, GRASS.shadow);
    paint(tile, x + 1, y, GRASS.shadow);
    paint(tile, x, y + 1, GRASS.deep);
  }
  const bladeTip = mixRgba(GRASS.light, GRASS.base, 0.2);
  for (let i = 0; i < 110; i += 1) {
    const x = randomInt(rng, TILE_SIZE);
    const y = randomInt(rng, TILE_SIZE);
    paint(tile, x, y, bladeTip);
    paint(tile, x, y + 1, lightPatch);
  }
  for (let i = 0; i < 5; i += 1) {
    const x = randomInt(rng, TILE_SIZE);
    const y = randomInt(rng, TILE_SIZE);
    const petal = FLOWER_PETALS[i % FLOWER_PETALS.length] as Rgba;
    paint(tile, x, y - 1, petal);
    paint(tile, x - 1, y, petal);
    paint(tile, x + 1, y, petal);
    paint(tile, x, y + 1, petal);
    paint(tile, x, y, FLOWER_CENTER);
    paint(tile, x + 1, y + 1, GRASS.shadow);
  }
  return tile;
}

const WATER = makeRamp('#3f86c6');
const SPARKLE = rgba(236, 248, 255);
/** Light rim painted where water meets another terrain. */
export const WATER_FOAM = mixRgba(WATER.light, SPARKLE, 0.35);

/** Calm water: only lighter details on the base color, faint dithered swells, soft crests, a few sparkles. */
export function waterTile(seed = 11): PixelBuffer {
  const rng = createRng(seed);
  const tile = solidTile(WATER.base);
  const swell = mixRgba(WATER.base, WATER.light, 0.1);
  const phase = rng() * Math.PI * 2;
  const t = (2 * Math.PI) / TILE_SIZE;
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      // Whole periods in x and y keep the swells seamless.
      const value = Math.sin(3 * t * y + 1.2 * Math.sin(t * x + phase));
      if (value > 0.82 || (value > 0.68 && (x + y) % 2 === 0)) tile.setPixel(x, y, swell);
    }
  }
  const crest = mixRgba(WATER.base, WATER.light, 0.55);
  const crestEnd = mixRgba(WATER.base, WATER.light, 0.3);
  for (let i = 0; i < 12; i += 1) {
    const x = randomInt(rng, TILE_SIZE);
    const y = randomInt(rng, TILE_SIZE);
    const length = 4 + randomInt(rng, 3);
    for (let px = x + 1; px < x + length - 1; px += 1) paint(tile, px, y, crest);
    paint(tile, x, y + 1, crestEnd);
    paint(tile, x + length - 1, y + 1, crestEnd);
  }
  for (let i = 0; i < 4; i += 1) paint(tile, randomInt(rng, TILE_SIZE), randomInt(rng, TILE_SIZE), SPARKLE);
  return tile;
}

/**
 * Smooth floor in any color: a soft bevel on the tile edges (lit top and left, shaded bottom and
 * right), sparse speckles and a few tiny chips.
 */
export function plainTile(hex = DEFAULT_PLAIN_COLOR, seed = 5): PixelBuffer {
  const rng = createRng(seed);
  const ramp = makeRamp(hex);
  const tile = solidTile(ramp.base);
  const edgeLight = mixRgba(ramp.base, ramp.light, 0.55);
  const edgeShadow = mixRgba(ramp.base, ramp.shadow, 0.6);
  const last = TILE_SIZE - 1;
  for (let i = 0; i < TILE_SIZE; i += 1) {
    tile.setPixel(i, 0, edgeLight);
    tile.setPixel(0, i, edgeLight);
    tile.setPixel(i, last, edgeShadow);
    tile.setPixel(last, i, edgeShadow);
  }
  const speckDark = mixRgba(ramp.base, ramp.shadow, 0.45);
  const speckLight = mixRgba(ramp.base, ramp.light, 0.45);
  const inner = (): number => 2 + randomInt(rng, TILE_SIZE - 4);
  for (let i = 0; i < 130; i += 1) tile.setPixel(inner(), inner(), i % 3 === 0 ? speckLight : speckDark);
  for (let i = 0; i < 9; i += 1) {
    const x = inner();
    const y = inner();
    tile.setPixel(x, y, ramp.shadow);
    tile.setPixel(Math.min(x + 1, last - 1), y, ramp.shadow);
    tile.setPixel(x, Math.max(y - 1, 1), speckLight);
  }
  return tile;
}

export function terrainTile(terrain: Terrain, plainColor = DEFAULT_PLAIN_COLOR): PixelBuffer {
  switch (terrain) {
    case 'wood':
      return woodTile();
    case 'grass':
      return grassTile();
    case 'water':
      return waterTile();
    case 'plain':
      return plainTile(plainColor);
  }
}
