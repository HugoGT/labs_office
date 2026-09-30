import { rgba, type Rgba } from './pixelBuffer.ts';

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
