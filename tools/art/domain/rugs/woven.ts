/**
 * Woven rug: a flat field crossed by short lighter weft streaks that thicken
 * into a warm glow in the middle, tasseled fringe bands on the two short ends
 * and a darker border all around.
 *
 * Colorable: every pixel is a tone of `makeRamp(hex)` or a mix of two
 * neighboring tones, so the office recolors the default sheet with
 * `recolorPixels` exactly as if the exporter had painted it in another color.
 */
import { type PixelBuffer, type Rgba } from '../../../../src/art/pixelBuffer.ts';
import { makeRamp, mixRgba } from '../color.ts';
import { createRng } from '../random.ts';
import { rugCanvas, rugFootprint, type RugFacing } from './shared.ts';

export const DEFAULT_RUG_COLOR = '#de6e3c';

/** Width of each fringe band along the long axis, border excluded. */
const FRINGE = 3;
/** One seed per facing: each facing scatters its own streaks. */
const SEEDS: Readonly<Record<RugFacing, number>> = { horizontal: 0x7e57a1, vertical: 0x7e57a2 };

export function wovenRug(facing: RugFacing, hex = DEFAULT_RUG_COLOR): PixelBuffer {
  const ramp = makeRamp(hex);
  const paint = {
    border: ramp.deep,
    tassel: ramp.shadow,
    binding: mixRgba(ramp.base, ramp.shadow, 0.5),
    field: ramp.base,
    streak: mixRgba(ramp.base, ramp.light, 0.6),
    glow: ramp.light,
  } as const;

  const rug = rugCanvas(facing);
  const { width, height } = rugFootprint(facing);
  const horizontal = facing === 'horizontal';
  // Rug-local axes: `u` runs along the long side (fringed ends at u = 0 and u = long - 1), `v` across it.
  const long = horizontal ? width : height;
  const short = horizontal ? height : width;
  const put = (u: number, v: number, color: Rgba): void => {
    if (horizontal) rug.setPixel(u, v, color);
    else rug.setPixel(v, u, color);
  };

  // Field and border.
  for (let v = 0; v < short; v += 1) {
    for (let u = 0; u < long; u += 1) {
      const onBorder = u === 0 || v === 0 || u === long - 1 || v === short - 1;
      put(u, v, onBorder ? paint.border : paint.field);
    }
  }

  // Fringe: tassel stripes running out of each short end, then a binding row where the weave starts.
  for (const [from, binding] of [
    [1, 1 + FRINGE],
    [long - 1 - FRINGE, long - 2 - FRINGE],
  ] as const) {
    for (let v = 1; v < short - 1; v += 1) {
      for (let u = from; u < from + FRINGE; u += 1) put(u, v, v % 2 === 0 ? paint.tassel : paint.field);
      put(binding, v, paint.binding);
    }
  }

  // Weft streaks: short lighter dashes along the long axis, denser and brighter toward the middle.
  const rng = createRng(SEEDS[facing]);
  const fieldStart = FRINGE + 3;
  const fieldEnd = long - FRINGE - 4;
  const centerU = (long - 1) / 2;
  const centerV = (short - 1) / 2;
  const glowAt = (u: number, v: number): number => {
    const du = (u - centerU) / (long * 0.25);
    const dv = (v - centerV) / (short * 0.32);
    return Math.max(0, 1 - Math.sqrt(du * du + dv * dv));
  };
  // Each motif is a streak, sometimes with a shorter one stitched on the next row, kept apart from
  // its neighbors by one clear pixel outside the glow so the base stays the dominant color.
  const taken = new Uint8Array(long * short);
  const free = (u: number, v: number): boolean => u >= fieldStart && u <= fieldEnd && v >= 2 && v <= short - 3 && taken[v * long + u] === 0;
  const claim = (u: number, v: number, margin: number): void => {
    for (let dv = -margin; dv <= margin; dv += 1) {
      for (let du = -1 - margin; du <= 1 + margin; du += 1) {
        const uu = u + du;
        const vv = v + dv;
        if (uu >= 0 && uu < long && vv >= 0 && vv < short) taken[vv * long + uu] = 1;
      }
    }
  };
  const fieldArea = (fieldEnd - fieldStart + 1) * (short - 4);
  for (let attempt = 0; attempt < fieldArea; attempt += 1) {
    const u0 = fieldStart + Math.floor(rng() * (fieldEnd - fieldStart + 1));
    const v0 = 2 + Math.floor(rng() * (short - 4));
    const g = glowAt(u0, v0);
    if (rng() > 0.025 + g * 1.1) continue;
    const rows = rng() < 0.45 ? 2 : 1;
    const segments: Array<{ u: number; v: number; length: number }> = [];
    const length = 3 + Math.floor(rng() * (g > 0.3 ? 6 : 5));
    segments.push({ u: u0, v: v0, length });
    if (rows === 2) segments.push({ u: u0 + Math.floor(rng() * 5) - 2, v: v0 + 1, length: 2 + Math.floor(rng() * 4) });
    const pixels: Array<{ u: number; v: number }> = [];
    for (const s of segments) {
      // A one-pixel break now and then, like a thread dipping under the weft.
      const gap = s.length >= 5 && rng() < 0.4 ? 1 + Math.floor(rng() * (s.length - 3)) : -1;
      for (let i = 0; i < s.length; i += 1) if (i !== gap) pixels.push({ u: s.u + i, v: s.v });
    }
    if (!pixels.every((p) => free(p.u, p.v))) continue;
    const bright = g > 0.4 ? rng() < 0.8 : g > 0.15 ? rng() < 0.45 : rng() < 0.15;
    const color = bright ? paint.glow : paint.streak;
    // Inside the glow motifs may touch vertically, so the middle thickens into one warm patch.
    const margin = g > 0.35 ? 0 : 1;
    for (const p of pixels) {
      put(p.u, p.v, color);
      claim(p.u, p.v, margin);
    }
  }
  return rug;
}
