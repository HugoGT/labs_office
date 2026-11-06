/**
 * The mosaic rug: a round (elliptical) rug that fills the 3x2 footprint and
 * leaves its four corners bare, as asked. Its face is laid like a floor
 * mosaic: a rim of terracotta stones cut along the curve, then a field of
 * square tesserae (3 px stones, 1 px grout) with a dotted ring and a round
 * medallion.
 *
 * The rim is measured per pixel by the inset `t` of the ellipse
 * (long - t, short - t) through it, so it stays an even band hugging the
 * outline. The field grid is mirrored from the centre, so the pattern meets
 * itself on both axes, and each stone takes its color from where its centre
 * falls: by that same inset for the ring, by radius for the medallion, which
 * keeps it round in both facings.
 */
import { PixelBuffer, type Rgba } from '../../../../src/art/pixelBuffer.ts';
import { makeRamp, mixRgba, type Ramp } from '../color.ts';
import { rugCanvas, rugFootprint, type RugFacing } from './shared.ts';

const TERRACOTTA = makeRamp('#b4553a');
const CREAM = makeRamp('#e6d6b4');
const TEAL = makeRamp('#2f7d77');
const OCHRE = makeRamp('#d29a3c');

/** The 1px outline: the deep tone of the rug's own terracotta. */
export const MOSAIC_RUG_BORDER: Rgba = TERRACOTTA.deep;
const GROUT: Rgba = mixRgba(CREAM.shadow, TERRACOTTA.shadow, 0.3);

/** Tesserae of one ramp: a few close tones so the stones read hand laid. */
function stones(ramp: Ramp): { readonly tones: readonly Rgba[]; readonly grout: Rgba } {
  return {
    tones: [ramp.base, mixRgba(ramp.base, ramp.light, 0.3), mixRgba(ramp.base, ramp.shadow, 0.25)],
    // Grout picks up the stones it holds, so a band reads as one ring of color.
    grout: mixRgba(ramp.shadow, GROUT, 0.45),
  };
}
const PALETTE = { terracotta: stones(TERRACOTTA), cream: stones(CREAM), teal: stones(TEAL), ochre: stones(OCHRE) };
type Stone = keyof typeof PALETTE;

/** Grid pitch: a 3 px stone and 1 px of grout. */
const PITCH = 4;

/** Small integer hash, so a stone's tone depends only on where it sits. */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ b, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ c, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Inset t of the ellipse (a - t, b - t) through (u, v); 0 on or outside the edge. */
function insetOf(u: number, v: number, a: number, b: number): number {
  let lo = 0;
  let hi = b;
  for (let i = 0; i < 24; i += 1) {
    const t = (lo + hi) / 2;
    if ((u / (a - t)) ** 2 + (v / (b - t)) ** 2 > 1) hi = t;
    else lo = t;
  }
  return lo;
}

/** Arc length from the long axis to parametric angle `theta` on the ellipse (a, b). */
function arcLength(a: number, b: number, theta: number): number {
  const steps = 32;
  let s = 0;
  for (let n = 0; n < steps; n += 1) {
    const t = ((n + 0.5) / steps) * theta;
    s += Math.hypot(a * Math.sin(t), b * Math.cos(t));
  }
  return (s * theta) / steps;
}

/** The rim: a ring of curved stones just inside the outline, and the grout line inside it. */
const RIM = 3.5;
const RIM_GROUT = 4.5;

/**
 * Field bands inside the rim, outside in: the inset (px) of a stone's centre
 * each one reaches. Stone centres sit at insets 4, 8, 12... on both axes; the
 * limits fall between them so a band never splits a stone row on an axis.
 */
const EDGE_BANDS: readonly { readonly until: number; readonly stone: (i: number, j: number) => Stone }[] = [
  { until: 10, stone: () => 'cream' },
  { until: 14, stone: (i, j) => ((i + j) % 2 === 0 ? 'teal' : 'ochre') },
];

/** The medallion, by the radius (px) of a stone's centre. */
function medallionStone(r: number, i: number, j: number): Stone | null {
  if (r < 1) return 'ochre';
  if (r < 6) return 'teal';
  if (r < 10) return (i + j) % 2 === 0 ? 'ochre' : 'cream';
  if (r < 13) return 'terracotta';
  return null;
}

/**
 * A rim pixel: terracotta stones cut along the ellipse, a stone and a grout
 * joint every PITCH px of arc, fitted so a stone sits centred on each axis.
 */
function rimStone(u: number, v: number, inset: number, left: boolean, top: boolean, long: number, short: number): Rgba {
  const { tones, grout } = PALETTE.terracotta;
  if (inset >= RIM) return grout;
  const a = long - RIM / 2;
  const b = short - RIM / 2;
  const quarter = arcLength(a, b, Math.PI / 2);
  const pitch = quarter / Math.round(quarter / PITCH);
  const along = arcLength(a, b, Math.atan2(v / b, u / a)) + (pitch - 1) / 2;
  const stone = Math.floor(along / pitch);
  if (along - stone * pitch >= pitch - 1) return grout;
  return tones[hash(stone, 77, (left ? 1 : 0) + (top ? 2 : 0)) % tones.length]!;
}

export function mosaicRug(facing: RugFacing): PixelBuffer {
  const rug = rugCanvas(facing);
  const { width, height } = rugFootprint(facing);
  const horizontal = facing === 'horizontal';
  const cx = width / 2;
  const cy = height / 2;
  // Semi-axes along and across the rug as it faces.
  const long = Math.max(width, height) / 2;
  const short = Math.min(width, height) / 2;
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && ((x + 0.5 - cx) / cx) ** 2 + ((y + 0.5 - cy) / cy) ** 2 <= 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
        rug.setPixel(x, y, MOSAIC_RUG_BORDER);
        continue;
      }
      const dx = Math.abs(x + 0.5 - cx);
      const dy = Math.abs(y + 0.5 - cy);
      const [pu, pv] = horizontal ? [dx, dy] : [dy, dx];
      const rim = insetOf(pu, pv, long, short);
      if (rim < RIM_GROUT) {
        rug.setPixel(x, y, rimStone(pu, pv, rim, x < cx, y < cy, long, short));
        continue;
      }
      // Mirrored grid: a 4 px keystone straddles the centre, then grout and 3 px stones.
      const kx = Math.floor(dx);
      const ky = Math.floor(dy);
      const ix = Math.floor((kx + 2) / PITCH);
      const iy = Math.floor((ky + 2) / PITCH);
      // The stone's centre, along (i, u) and across (j, v) the rug.
      const [i, j] = horizontal ? [ix, iy] : [iy, ix];
      const u = i * PITCH;
      const v = j * PITCH;
      const inset = insetOf(u, v, long, short);
      const band = EDGE_BANDS.find((b) => inset < b.until);
      const kind = band?.stone(i, j) ?? medallionStone(Math.hypot(u, v), i, j) ?? 'cream';
      const { tones, grout } = PALETTE[kind];
      if (kx % PITCH === 2 || ky % PITCH === 2) {
        rug.setPixel(x, y, grout);
        continue;
      }
      const quadrant = (x < cx ? 1 : 0) + (y < cy ? 2 : 0);
      rug.setPixel(x, y, tones[hash(ix, iy, quadrant) % tones.length]!);
    }
  }
  return rug;
}
