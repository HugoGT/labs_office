/**
 * Grass rug: a mat of turf darker than the grass terrain, so it reads as a rug on any floor and
 * stays visible on grass itself. The silhouette is a rounded rectangle whose edge breaks into
 * irregular blades; a dark 1px contour follows that ragged edge, sunlit tufts crowd the inside of
 * it and the middle stays calm, with none of the terrain's flowers. It is the default rug of a new
 * room, so it avoids anything that would fight a floor: no shadow, no saturated accents.
 */
import { makeRamp, mixRgba } from '../color.ts';
import { periodicNoise } from '../noise.ts';
import { createRng, type Rng } from '../random.ts';
import { type PixelBuffer, type Rgba } from '../../../../src/art/pixelBuffer.ts';
import { rugCanvas, rugFootprint, type RugFacing } from './shared.ts';

/** Turf ramp, an olive green darker and greyer than the terrain's `#6aa84f`. */
const TURF = makeRamp('#55773a');
const TUFT = makeRamp('#86a447');

/** The contour every edge pixel of the rug takes. */
export const GRASS_RUG_BORDER: Rgba = mixRgba(TURF.outline, TURF.deep, 0.35);

const FIELD = TURF.base;
const FIELD_DARK = mixRgba(TURF.base, TURF.shadow, 0.16);
const FIELD_LIGHT = mixRgba(TURF.base, TUFT.base, 0.1);
/** The little "v" tufts scattered over the field. */
export const GRASS_RUG_TUFT: Rgba = mixRgba(TURF.base, TURF.shadow, 0.55);
const TUFT_LIGHT = mixRgba(TUFT.base, TUFT.light, 0.25);
const TUFT_MID = TUFT.base;
const TUFT_LOW = mixRgba(TUFT.base, TURF.base, 0.5);
const TUFT_GAP = mixRgba(TURF.shadow, TURF.base, 0.35);

/** Distance from the footprint edge to the plain rounded rectangle the blades grow from. */
const INSET = 5;
const CORNER = 12;

interface Blade {
  readonly at: number;
  readonly height: number;
  readonly halfWidth: number;
  /** A rounded clump rather than a pointed blade. */
  readonly round: boolean;
}

/** Arc-length position of a point around the core rectangle, and its signed distance to the rug's base edge. */
interface EdgePoint {
  readonly t: number;
  readonly distance: number;
}

interface Outline {
  readonly perimeter: number;
  edgePoint(x: number, y: number): EdgePoint;
}

/**
 * A rounded rectangle as a core rectangle grown by CORNER. Positions run clockwise from the
 * top-left end of the top side; a corner arc counts as a quarter circle a few pixels out, where the
 * blades actually sit, so they spread as evenly there as along the sides.
 */
function roundedOutline(width: number, height: number): Outline {
  const x0 = INSET + CORNER;
  const y0 = INSET + CORNER;
  const x1 = width - INSET - CORNER;
  const y1 = height - INSET - CORNER;
  const w = x1 - x0;
  const h = y1 - y0;
  const arc = (Math.PI / 2) * (CORNER + 2);
  const perimeter = 2 * w + 2 * h + 4 * arc;
  const edgePoint = (x: number, y: number): EdgePoint => {
    const px = x + 0.5;
    const py = y + 0.5;
    const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
    const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
    const outside = dx > 0 || dy > 0;
    const distance = outside ? Math.hypot(dx, dy) - CORNER : -Math.min(px - x0, x1 - px, py - y0, y1 - py) - CORNER;
    const along = (value: number, span: number): number => Math.min(span, Math.max(0, value));
    const corner = (ax: number, ay: number): number => (Math.atan2(ax, ay) / (Math.PI / 2)) * arc;
    // Inside the core the nearest side decides; outside, the region the point lies in.
    const side = outside
      ? py < y0 && px >= x0 && px <= x1
        ? 0
        : px > x1 && py >= y0 && py <= y1
          ? 1
          : py > y1 && px >= x0 && px <= x1
            ? 2
            : px < x0 && py >= y0 && py <= y1
              ? 3
              : -1
      : [py - y0, x1 - px, y1 - py, px - x0].reduce((best, d, i, all) => (d < (all[best] as number) ? i : best), 0);
    let t: number;
    if (side === 0) t = along(px - x0, w);
    else if (side === 1) t = w + arc + along(py - y0, h);
    else if (side === 2) t = w + 2 * arc + h + along(x1 - px, w);
    else if (side === 3) t = 2 * w + 3 * arc + h + along(y1 - py, h);
    else if (px > x1 && py < y0) t = w + corner(px - x1, y0 - py);
    else if (px > x1) t = w + arc + h + corner(py - y1, px - x1);
    else if (py > y1) t = 2 * w + 2 * arc + h + corner(x0 - px, py - y1);
    else t = 2 * w + 3 * arc + 2 * h + corner(y0 - py, x0 - px);
    return { t, distance };
  };
  return { perimeter, edgePoint };
}

/**
 * What grows past the base edge: broad clumps, and pointed blades scattered over and between
 * them, mostly short with now and then a tall one.
 */
function growBlades(rng: Rng, perimeter: number): Blade[] {
  const blades: Blade[] = [];
  for (let at = rng() * 4; at < perimeter; at += 5 + rng() * 6) {
    blades.push({ at, height: 1 + rng() * 2, halfWidth: 2.5 + rng() * 2.5, round: true });
  }
  for (let at = rng() * 2; at < perimeter; at += 2 + rng() * 2.5) {
    const tall = rng() < 0.3;
    blades.push({ at, height: tall ? 3.5 + rng() * 2 : 1.5 + rng() * 2, halfWidth: tall ? 1.4 + rng() * 1 : 1 + rng() * 1, round: false });
  }
  return blades;
}

/** How far past the base edge the turf reaches at a perimeter position. */
function reach(t: number, perimeter: number, blades: readonly Blade[], wave: (t: number) => number): number {
  let best = wave(t);
  for (const blade of blades) {
    const raw = Math.abs(t - blade.at);
    const gap = Math.min(raw, perimeter - raw) / blade.halfWidth;
    if (gap >= 1) continue;
    best = Math.max(best, blade.height * (blade.round ? 1 - gap * gap : 1 - gap));
  }
  return best;
}

function turfMask(width: number, height: number, rng: Rng): boolean[] {
  const outline = roundedOutline(width, height);
  const blades = growBlades(rng, outline.perimeter);
  const phases = [rng(), rng(), rng()].map((p) => p * Math.PI * 2);
  const wave = (t: number): number => {
    const u = (t / outline.perimeter) * Math.PI * 2;
    return 0.6 * Math.sin(3 * u + (phases[0] as number)) + 0.5 * Math.sin(7 * u + (phases[1] as number)) + 0.4 * Math.sin(13 * u + (phases[2] as number)) - 1.2;
  };
  const mask: boolean[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { t, distance } = outline.edgePoint(x, y);
      // Dips between blades bite at most 3px into the base shape.
      mask.push(distance <= -3 || distance <= reach(t, outline.perimeter, blades, wave));
    }
  }
  return mask;
}

/** 4-neighborhood steps from the outside: 1 on the contour, growing inward. */
function depthMap(mask: readonly boolean[], width: number, height: number): number[] {
  const depth = mask.map((inside) => (inside ? Infinity : 0));
  const queue: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const atRim = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (atRim || !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]) {
        depth[i] = 1;
        queue.push(i);
      }
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head] as number;
    const x = i % width;
    const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width];
    for (const n of next) {
      if (n < 0 || n >= depth.length || depth[n] !== Infinity) continue;
      depth[n] = (depth[i] as number) + 1;
      queue.push(n);
    }
  }
  return depth;
}

/** Sunlit band inside the contour, fading over a few pixels toward the middle. */
function bandColor(depth: number, x: number, y: number, rng: Rng): Rgba | null {
  const roll = rng();
  if (depth === 2) return roll < 0.55 ? TUFT_LIGHT : roll < 0.85 ? TUFT_MID : TUFT_GAP;
  if (depth === 3) return roll < 0.35 ? TUFT_LIGHT : roll < 0.75 ? TUFT_MID : roll < 0.9 ? TUFT_LOW : TUFT_GAP;
  if (depth === 4) return roll < 0.15 ? TUFT_LIGHT : roll < 0.6 ? TUFT_MID : roll < 0.9 ? TUFT_LOW : null;
  if (depth === 5) return roll < 0.35 ? TUFT_MID : roll < 0.75 ? TUFT_LOW : null;
  if (depth === 6) return roll < 0.1 ? TUFT_MID : roll < 0.5 ? TUFT_LOW : null;
  if (depth <= 8) return (x + y) % 2 === 0 && roll < (depth === 7 ? 0.5 : 0.25) ? TUFT_LOW : null;
  return null;
}

/** Calm middle: broad patches only a shade apart, dithered where they meet. */
function fieldColor(x: number, y: number, patches: (x: number, y: number) => number): Rgba {
  const value = patches(x, y);
  if (value < 0.3 || (value < 0.36 && (x + y) % 2 === 0)) return FIELD_DARK;
  if (value > 0.7 || (value > 0.64 && (x + y) % 2 === 0)) return FIELD_LIGHT;
  return FIELD;
}

/** Upright blades in the band: a lit tip over a mid stem, a dark gap beside it. */
function paintTufts(canvas: PixelBuffer, depth: readonly number[], width: number, height: number, rng: Rng): void {
  const depthAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= width || y >= height ? 0 : (depth[y * width + x] as number));
  for (let i = 0; i < Math.round((width + height) * 2.2); i += 1) {
    const x = Math.floor(rng() * width);
    const y = Math.floor(rng() * height);
    const d = depthAt(x, y);
    if (d < 2 || d > 10 || rng() > 1.2 - d / 10) continue;
    const tip = d <= 5 ? TUFT_LIGHT : TUFT_MID;
    const stem = d <= 5 ? TUFT_MID : TUFT_LOW;
    canvas.setPixel(x, y, tip);
    if (depthAt(x, y + 1) >= 2) canvas.setPixel(x, y + 1, stem);
    if (depthAt(x + 1, y + 1) >= 2) canvas.setPixel(x + 1, y + 1, TUFT_GAP);
  }
}

/** Depth from the contour a field tuft keeps, so it never reaches the sunlit band. */
const FIELD_DEPTH = 9;
/** Roughly one field tuft per cell of this size. */
const FIELD_CELL = { w: 12, h: 11 } as const;

/**
 * Little dark "v" tufts, like the terrain's but toned down. One per cell of a grid over the calm
 * field, jittered inside it, so they spread evenly: a purely random scatter left whole sides bare.
 */
function scatterFieldTufts(canvas: PixelBuffer, depth: readonly number[], width: number, height: number, rng: Rng): void {
  const calm = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && (depth[y * width + x] as number) >= FIELD_DEPTH;
  const fits = (x: number, y: number): boolean => calm(x, y) && calm(x - 1, y - 1) && calm(x + 1, y - 1);
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!calm(x, y)) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  const cols = Math.max(1, Math.round((right - left) / FIELD_CELL.w));
  const rows = Math.max(1, Math.round((bottom - top) / FIELD_CELL.h));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x0 = left + Math.floor(((right - left) * col) / cols);
      const x1 = left + Math.floor(((right - left) * (col + 1)) / cols);
      const y0 = top + Math.floor(((bottom - top) * row) / rows);
      const y1 = top + Math.floor(((bottom - top) * (row + 1)) / rows);
      // Keep a pixel clear of the cell's sides so neighbouring tufts never touch.
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const x = x0 + 2 + Math.floor(rng() * Math.max(1, x1 - x0 - 4));
        const y = y0 + 2 + Math.floor(rng() * Math.max(1, y1 - y0 - 3));
        if (!fits(x, y)) continue;
        canvas.setPixel(x, y, GRASS_RUG_TUFT);
        canvas.setPixel(x - 1, y - 1, GRASS_RUG_TUFT);
        canvas.setPixel(x + 1, y - 1, GRASS_RUG_TUFT);
        break;
      }
    }
  }
}

/** The grass rug of a facing, drawn natively for its own proportions. */
export function grassRug(facing: RugFacing): PixelBuffer {
  const { width, height } = rugFootprint(facing);
  const rng = createRng(facing === 'horizontal' ? 4107 : 4111);
  const canvas = rugCanvas(facing);
  const mask = turfMask(width, height, rng);
  const depth = depthMap(mask, width, height);
  const patches = periodicNoise(facing === 'horizontal' ? 71 : 73, 96, 6);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = depth[y * width + x] as number;
      if (d === 0) continue;
      if (d === 1) {
        canvas.setPixel(x, y, GRASS_RUG_BORDER);
        continue;
      }
      canvas.setPixel(x, y, bandColor(d, x, y, rng) ?? fieldColor(x, y, patches));
    }
  }
  paintTufts(canvas, depth, width, height, rng);
  scatterFieldTufts(canvas, depth, width, height, rng);
  return canvas;
}
