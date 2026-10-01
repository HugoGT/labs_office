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

/**
 * Every floor motif of the pack. The first four came with the art project; dirt, sand,
 * cobblestone, tile and carpet complete the eight terrain materials of #123 (`plain` is the
 * colorable room floor and no terrain).
 */
export const TERRAINS = ['wood', 'grass', 'water', 'plain', 'dirt', 'sand', 'cobblestone', 'tile', 'carpet'] as const;
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

const DIRT = makeRamp('#8a6142');
const PEBBLE = makeRamp('#a39484');

/** Packed earth: soft lighter and darker patches, small pebbles lit from the upper left, a few dark grains. */
export function dirtTile(seed = 13): PixelBuffer {
  const rng = createRng(seed);
  const tile = solidTile(DIRT.base);
  const darkPatch = mixRgba(DIRT.base, DIRT.shadow, 0.4);
  const lightPatch = mixRgba(DIRT.base, DIRT.light, 0.25);
  const cell = TILE_SIZE / 3;
  for (let i = 0; i < 9; i += 1) {
    const cx = (i % 3) * cell + randomInt(rng, cell);
    const cy = Math.floor(i / 3) * cell + randomInt(rng, cell);
    softPatch(tile, rng, cx, cy, 7 + randomInt(rng, 6), i % 2 ? darkPatch : lightPatch);
  }
  for (let i = 0; i < 18; i += 1) {
    const x = randomInt(rng, TILE_SIZE);
    const y = randomInt(rng, TILE_SIZE);
    const wide = rng() < 0.5;
    paint(tile, x, y, PEBBLE.base);
    if (wide) paint(tile, x + 1, y, PEBBLE.base);
    paint(tile, x, y - 1, PEBBLE.light);
    paint(tile, wide ? x + 1 : x, y + 1, DIRT.shadow);
  }
  for (let i = 0; i < 26; i += 1) {
    const x = randomInt(rng, TILE_SIZE);
    const y = randomInt(rng, TILE_SIZE);
    paint(tile, x, y, darkPatch);
    paint(tile, x + 1, y, darkPatch);
  }
  return tile;
}

const SAND = makeRamp('#e2c48e');

/** Calm sand: faint wind ripples in whole periods (seamless), a few shell flecks and dark grains. */
export function sandTile(seed = 17): PixelBuffer {
  const rng = createRng(seed);
  const tile = solidTile(SAND.base);
  const ripple = mixRgba(SAND.base, SAND.light, 0.3);
  const trough = mixRgba(SAND.base, SAND.shadow, 0.22);
  const phase = rng() * Math.PI * 2;
  const t = (2 * Math.PI) / TILE_SIZE;
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const value = Math.sin(4 * t * y + 0.9 * Math.sin(t * x + phase) + 0.5 * Math.sin(2 * t * x));
      if (value > 0.9 || (value > 0.78 && (x + y) % 2 === 0)) tile.setPixel(x, y, ripple);
      else if (value < -0.93) tile.setPixel(x, y, trough);
    }
  }
  for (let i = 0; i < 7; i += 1) {
    const x = randomInt(rng, TILE_SIZE);
    const y = randomInt(rng, TILE_SIZE);
    paint(tile, x, y, SAND.light);
    paint(tile, x + 1, y + 1, trough);
  }
  return tile;
}

const COBBLE = makeRamp('#8f8b85');
const COBBLE_CELLS = 6;

/**
 * Rounded stones on a jittered grid that wraps, so the motif tiles. Each stone takes one of three
 * close grays, a lit upper-left rim and a shaded lower-right one; mortar shows between them.
 */
export function cobblestoneTile(seed = 19): PixelBuffer {
  const rng = createRng(seed);
  const tile = solidTile(COBBLE.base);
  const cell = TILE_SIZE / COBBLE_CELLS;
  const centers = Array.from({ length: COBBLE_CELLS * COBBLE_CELLS }, (_, i) => ({
    x: (i % COBBLE_CELLS) * cell + cell / 2 + (rng() - 0.5) * cell * 0.5,
    y: Math.floor(i / COBBLE_CELLS) * cell + cell / 2 + (rng() - 0.5) * cell * 0.5,
    tone: [COBBLE.base, mixRgba(COBBLE.base, COBBLE.light, 0.18), mixRgba(COBBLE.base, COBBLE.shadow, 0.15)][randomInt(rng, 3)] as Rgba,
  }));
  const mortar = mixRgba(COBBLE.base, COBBLE.shadow, 0.75);
  const rim = mixRgba(COBBLE.base, COBBLE.light, 0.45);
  const shade = mixRgba(COBBLE.base, COBBLE.shadow, 0.45);
  const wrapped = (d: number): number => d - Math.round(d / TILE_SIZE) * TILE_SIZE;
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      let best = { d: Infinity, dx: 0, dy: 0, tone: COBBLE.base };
      let second = Infinity;
      for (const center of centers) {
        const dx = wrapped(x + 0.5 - center.x);
        const dy = wrapped(y + 0.5 - center.y);
        const d = Math.hypot(dx, dy);
        if (d < best.d) {
          second = best.d;
          best = { d, dx, dy, tone: center.tone };
        } else if (d < second) second = d;
      }
      const gap = second - best.d;
      let color = best.tone;
      if (gap < 1.6) color = mortar;
      else if (gap < 3.2 && best.dx + best.dy < 0) color = rim;
      else if (gap < 3.2 && best.dx + best.dy > 2) color = shade;
      tile.setPixel(x, y, color);
    }
  }
  return tile;
}

const CERAMIC = makeRamp('#d8d2c4');
const CERAMIC_SIZE = 16;

/** Light ceramic floor tiles: 16px squares in a faint checker, grout lines and a lit top edge. */
export function tileFloorTile(seed = 23): PixelBuffer {
  const rng = createRng(seed);
  const tile = solidTile(CERAMIC.base);
  const alternate = mixRgba(CERAMIC.base, CERAMIC.shadow, 0.12);
  const grout = mixRgba(CERAMIC.base, CERAMIC.shadow, 0.55);
  const edge = mixRgba(CERAMIC.base, CERAMIC.light, 0.6);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const across = x % CERAMIC_SIZE;
      const down = y % CERAMIC_SIZE;
      const odd = (Math.floor(x / CERAMIC_SIZE) + Math.floor(y / CERAMIC_SIZE)) % 2 === 1;
      let color = odd ? alternate : CERAMIC.base;
      if (across === 0 || down === 0) color = grout;
      else if (down === 1 || across === 1) color = edge;
      tile.setPixel(x, y, color);
    }
  }
  const speck = mixRgba(CERAMIC.base, CERAMIC.shadow, 0.3);
  for (let i = 0; i < 14; i += 1) {
    const x = randomInt(rng, TILE_SIZE);
    const y = randomInt(rng, TILE_SIZE);
    if (x % CERAMIC_SIZE > 2 && y % CERAMIC_SIZE > 2) tile.setPixel(x, y, speck);
  }
  return tile;
}

const CARPET = makeRamp('#5a6f86');
const CARPET_SQUARE = TILE_SIZE / 2;

/**
 * Office carpet tiles: four 48px squares whose woven pile alternates direction, so the floor
 * reads as laid tiles, with a few soft worn patches. Low contrast on purpose.
 */
export function carpetTile(seed = 29): PixelBuffer {
  const rng = createRng(seed);
  const tile = solidTile(CARPET.base);
  const weave = mixRgba(CARPET.base, CARPET.shadow, 0.28);
  const seam = mixRgba(CARPET.base, CARPET.shadow, 0.45);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const horizontal = (Math.floor(x / CARPET_SQUARE) + Math.floor(y / CARPET_SQUARE)) % 2 === 0;
      const line = horizontal ? y % 3 === 0 && (x + y) % 4 !== 0 : x % 3 === 0 && (x - y) % 4 !== 0;
      if (x % CARPET_SQUARE === 0 || y % CARPET_SQUARE === 0) tile.setPixel(x, y, seam);
      else if (line) tile.setPixel(x, y, weave);
    }
  }
  const worn = mixRgba(CARPET.base, CARPET.light, 0.12);
  for (let i = 0; i < 3; i += 1) softPatch(tile, rng, randomInt(rng, TILE_SIZE), randomInt(rng, TILE_SIZE), 6 + randomInt(rng, 4), worn);
  return tile;
}

export function terrainTile(terrain: Terrain, plainColor = DEFAULT_PLAIN_COLOR): PixelBuffer {
  switch (terrain) {
    case 'dirt':
      return dirtTile();
    case 'sand':
      return sandTile();
    case 'cobblestone':
      return cobblestoneTile();
    case 'tile':
      return tileFloorTile();
    case 'carpet':
      return carpetTile();
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
