/**
 * Color model of the art pack, shared by the exporter (`tools/art`) and the
 * office. The exporter paints every material from a hue-shifted ramp
 * (`makeRamp`); the office recolors an exported default-color sheet with the
 * same ramps (`recolorPixels`), so a colorable piece looks the same whether the
 * exporter or the browser painted it.
 *
 * No imports on purpose, like `artContract.ts`: Node loads this file with type
 * stripping for the exporter, and the client build rejects `.ts` extensions.
 */

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return { r, g, b, a };
}

/** The tones a material can be painted with, darkest first. */
export const TONES = ['outline', 'deep', 'shadow', 'base', 'light'] as const;
export type Tone = (typeof TONES)[number];
export type Ramp = Readonly<Record<Tone, Rgba>>;

interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToRgba(hex: string): Rgba {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgba((value >> 16) & 255, (value >> 8) & 255, value & 255, 255);
}

function toHsl({ r, g, b }: Rgba): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }: Hsl): Rgba {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number): number => Math.round(Math.min(1, Math.max(0, v + m)) * 255);
  return rgba(to(r), to(g), to(b), 255);
}

/** Moves a hue toward a target hue by at most `amount` degrees along the shortest arc. */
function shiftHue(h: number, target: number, amount: number): number {
  const delta = ((target - h + 540) % 360) - 180;
  return h + Math.sign(delta) * Math.min(Math.abs(delta), amount);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Builds a hue-shifted pixel-art ramp: shadows drift toward violet, highlights toward warm yellow,
 * so shading reads like hand-picked palettes instead of plain darkening.
 */
export function makeRamp(hex: string): Ramp {
  const base = hexToRgba(hex);
  const hsl = toHsl(base);
  const grey = hsl.s < 0.08 || hsl.l > 0.88;
  const shadowHue = grey ? 245 : shiftHue(hsl.h, 255, hsl.h < 50 || hsl.h > 330 ? 6 : 12);
  const lightHue = grey ? 45 : shiftHue(hsl.h, 50, 8);
  // Light, saturated colors (skin, pastels) turn neon when darkened at full saturation.
  const shadowSat = grey ? 0.14 : Math.min(0.7, hsl.l > 0.62 ? hsl.s * 0.62 : hsl.s * 0.95);
  const shadowL = hsl.l > 0.62 ? hsl.l * 0.8 : hsl.l * 0.72;
  return {
    outline: fromHsl({ h: shiftHue(hsl.h, 260, 30), s: clamp01(Math.max(0.25, hsl.s * 0.7)), l: Math.min(0.13, hsl.l * 0.3) + 0.03 }),
    deep: fromHsl({ h: grey ? shadowHue : shiftHue(hsl.h, 258, 16), s: shadowSat * 0.85, l: shadowL * 0.7 }),
    shadow: fromHsl({ h: shadowHue, s: shadowSat, l: shadowL }),
    base,
    light: fromHsl({ h: lightHue, s: grey ? hsl.s : clamp01(hsl.s * 0.95), l: hsl.l + (1 - hsl.l) * (hsl.l < 0.2 ? 0.2 : 0.34) }),
  };
}

export function mixRgba(a: Rgba, b: Rgba, amount: number): Rgba {
  const lerp = (x: number, y: number): number => Math.round(x + (y - x) * amount);
  return rgba(lerp(a.r, b.r), lerp(a.g, b.g), lerp(a.b, b.b), 255);
}

/** The same ramp painted one step darker: each tone takes the color of the tone below it. */
export function darkenRamp(ramp: Ramp): Ramp {
  return {
    outline: ramp.outline,
    deep: mixRgba(ramp.deep, ramp.outline, 0.5),
    shadow: ramp.deep,
    base: ramp.shadow,
    light: ramp.base,
  };
}

/** Ink the furniture outline is mixed toward, over opaque and over translucent pixels. */
export const OUTLINE_INK: Rgba = hexToRgba('#140c1c');
export const OUTLINE_INK_MIX = { opaque: 0.78, translucent: 0.88 } as const;

// --- Runtime recolor ---------------------------------------------------------------------------

/**
 * How far (per RGB unit) a pixel may sit from the source ramp and still count
 * as paint. Measured on the pack: ramp tones and their mixes land within 1-2
 * units, while the parts a color must not touch (chrome pulls, glass, other
 * materials) sit tens of units away.
 */
const PAINT_DISTANCE = 12;

/** Ways the exporter derives a pixel from a ramp color: as is, or mixed toward the outline ink. */
const INK_WEIGHTS = [0, OUTLINE_INK_MIX.opaque, OUTLINE_INK_MIX.translucent] as const;

type Vec = readonly [number, number, number];

function vec(color: Rgba): Vec {
  return [color.r, color.g, color.b];
}

function vecOf(channel: (c: 0 | 1 | 2) => number): Vec {
  return [channel(0), channel(1), channel(2)];
}

function rampCurve(ramp: Ramp): Vec[] {
  return TONES.map((tone) => vec(ramp[tone]));
}

interface RampHit {
  /** Segment `segment -> segment + 1` of the ramp curve, darkest first. */
  readonly segment: number;
  readonly t: number;
  /** What is left of the pixel once the ramp point is removed, in ramp-color space. */
  readonly residual: Vec;
  readonly ink: number;
  readonly distance: number;
}

/** Closest point of the piecewise-linear ramp curve to `color`, trying each outline ink weight. */
function locateOnRamp(color: Vec, curve: readonly Vec[]): RampHit | null {
  let best: RampHit | null = null;
  const inkColor = vec(OUTLINE_INK);
  for (const ink of INK_WEIGHTS) {
    const unmixed = vecOf((c) => (color[c] - ink * inkColor[c]) / (1 - ink));
    for (let segment = 0; segment < curve.length - 1; segment += 1) {
      const p = curve[segment] as Vec;
      const q = curve[segment + 1] as Vec;
      const d: Vec = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const length = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      const along = length === 0 ? 0 : ((unmixed[0] - p[0]) * d[0] + (unmixed[1] - p[1]) * d[1] + (unmixed[2] - p[2]) * d[2]) / length;
      const t = Math.min(1, Math.max(0, along));
      const residual: Vec = [unmixed[0] - (p[0] + t * d[0]), unmixed[1] - (p[1] + t * d[1]), unmixed[2] - (p[2] + t * d[2])];
      // Measured back in pixel space: an ink mix shrinks the ramp color by `1 - ink`.
      const distance = Math.hypot(residual[0], residual[1], residual[2]) * (1 - ink);
      if (best === null || distance < best.distance - 1e-9) best = { segment, t, residual, ink, distance };
    }
  }
  return best;
}

function paintFromHit(hit: RampHit, curve: readonly Vec[]): Vec {
  const p = curve[hit.segment] as Vec;
  const q = curve[hit.segment + 1] as Vec;
  const ink = vec(OUTLINE_INK);
  return vecOf((c) => {
    const onRamp = p[c] + hit.t * (q[c] - p[c]) + hit.residual[c];
    return Math.round(onRamp * (1 - hit.ink) + hit.ink * ink[c]);
  });
}

/**
 * Repaints RGBA pixels exported in `fromHex` as if the exporter had painted
 * them in `toHex`. Each pixel is located on the source ramp (a tone, a mix of
 * two neighboring tones, or either one mixed toward the outline ink) and moved
 * to the same place on the target ramp, keeping its alpha. Pixels that are not
 * paint of that ramp, and transparent ones, are copied unchanged.
 *
 * Returns a new array: callers cache the result per material and color, so
 * this runs once per combination and never per frame.
 */
export function recolorPixels(data: Uint8ClampedArray | Uint8Array, fromHex: string, toHex: string): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  if (fromHex.toLowerCase() === toHex.toLowerCase()) return out;
  const from = rampCurve(makeRamp(fromHex));
  const to = rampCurve(makeRamp(toHex));
  // A sheet has at most MAX_COLORS_PER_IMAGE distinct values, so each is solved once.
  const solved = new Map<number, Vec | null>();
  for (let i = 0; i < out.length; i += 4) {
    if ((out[i + 3] ?? 0) === 0) continue;
    const r = out[i] ?? 0;
    const g = out[i + 1] ?? 0;
    const b = out[i + 2] ?? 0;
    const key = (r << 16) | (g << 8) | b;
    let painted = solved.get(key);
    if (painted === undefined) {
      const hit = locateOnRamp([r, g, b], from);
      painted = hit !== null && hit.distance <= PAINT_DISTANCE ? paintFromHit(hit, to) : null;
      solved.set(key, painted);
    }
    if (painted === null) continue;
    out[i] = painted[0];
    out[i + 1] = painted[1];
    out[i + 2] = painted[2];
  }
  return out;
}
