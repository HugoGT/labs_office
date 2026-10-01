/**
 * Furniture drawn in code as a handful of boxes, seen the way classic top-down RPGs draw furniture
 * next to 3/4 characters: a box shows its top and the face toward the viewer (south), never its
 * east or west side, and floor depth is shortened by DEPTH_SCALE so tops read flat next to the
 * tall faces. On screen, a point `y` pixels above the floor at floor row `z` lands on row `z - y`.
 *
 * A piece is modeled once in its own frame and turned to any facing: `u` points forward (the way
 * a seated character looks), `v` to the sitter's right and `y` up, all in screen pixels, with the
 * origin on the floor under the middle of the piece. Each part (boxes outlined as one) is painted
 * through a depth buffer so nearer surfaces win, then ringed with the characters' 1px ink outline
 * placed just behind it: parts drawn over one another get a contour line, and the silhouette gets
 * exactly one outline pixel. Light comes from the upper left, like the characters and the floor.
 */
import { OUTLINE_INK, OUTLINE_INK_MIX } from '../../../src/game/artColor.ts';
import { mixRgba, type Ramp, type Tone } from './color.ts';
import { PixelBuffer, rgba, type Rgba } from './pixelBuffer.ts';
import type { Facing, SeatPoint } from './seating.ts';

/** Floor depth (north-south) drawn this much shorter than width. */
export const DEPTH_SCALE = 0.6;

/**
 * Same ink and contact shadow as the characters (spriteRenderer.ts). The ink
 * and its mix amounts are shared with the office's runtime recolor.
 */
const SHADOW_COLOR = rgba(46, 26, 20, 78);

export type Span = readonly [number, number];

/** A model face; only the top and the one turned toward the viewer are ever drawn. */
export type ModelFace = 'top' | 'forward' | 'backward' | 'right' | 'left';

export interface SurfacePoint {
  readonly face: ModelFace;
  /** Model coordinates of the pixel center on that face. */
  readonly u: number;
  readonly v: number;
  readonly y: number;
  /** Pixel position inside the face as drawn: column from its left, row from its top. */
  readonly col: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
}

export type Shader = (point: SurfacePoint, color: Rgba) => Rgba;

/** Axis-aligned box in model space, half-open spans with whole-pixel ends. */
export interface Box {
  readonly u: Span;
  readonly v: Span;
  readonly y: Span;
  readonly ramp: Ramp;
  /** Tone of the top face (default base) and of the face toward the viewer (default shadow). */
  readonly top?: Tone;
  readonly side?: Tone;
  /** Upholstered look: the far corners of the top and the bottom corners of the face are cut. */
  readonly rounded?: boolean;
  /** Translucent material, like glass; 255 when omitted. */
  readonly alpha?: number;
  readonly shade?: Shader;
}

export type Layer = 'back' | 'front';

export interface Part {
  readonly boxes: readonly Box[];
  /** Which layer the part lands in for a facing; the back one when omitted. */
  readonly layer?: (facing: Facing) => Layer;
}

export interface FurnitureModel {
  readonly parts: readonly Part[];
  /** Floor footprint that receives the soft contact shadow. */
  readonly shadow: { readonly u: Span; readonly v: Span; readonly shape: 'ellipse' | 'rect' };
}

export interface RenderedFurniture {
  readonly back: PixelBuffer;
  readonly front: PixelBuffer;
  /** Pixel of the floor under the model origin, inside the sprite. */
  readonly origin: SeatPoint;
}

interface Orientation {
  /** Model axis drawn along screen x; the other one runs along the floor depth. */
  readonly x: 'u' | 'v';
  readonly xSign: 1 | -1;
  readonly zSign: 1 | -1;
}

/** down: x = -v, z = u. up: x = v, z = -u. right: x = u, z = v. left: x = -u, z = -v. */
const ORIENTATION: Readonly<Record<Facing, Orientation>> = {
  down: { x: 'v', xSign: -1, zSign: 1 },
  up: { x: 'v', xSign: 1, zSign: -1 },
  right: { x: 'u', xSign: 1, zSign: 1 },
  left: { x: 'u', xSign: -1, zSign: -1 },
};

function roundSymmetric(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

function signed([a, b]: Span, sign: 1 | -1): Span {
  return sign > 0 ? [a, b] : [-b, -a];
}

function depthSpan(span: Span): Span {
  const from = roundSymmetric(span[0] * DEPTH_SCALE);
  const to = roundSymmetric(span[1] * DEPTH_SCALE);
  return [from, Math.max(to, from + 1)];
}

/** Screen x span and floor row span of a model footprint for a facing. */
export function floorSpans(facing: Facing, u: Span, v: Span): { readonly x: Span; readonly z: Span } {
  const o = ORIENTATION[facing];
  const along = o.x === 'u' ? u : v;
  const across = o.x === 'u' ? v : u;
  return { x: signed(along, o.xSign), z: depthSpan(signed(across, o.zSign)) };
}

/** Floor pixel under a model point, relative to the floor pixel under the origin. */
export function floorPoint(facing: Facing, u: number, v: number): SeatPoint {
  const o = ORIENTATION[facing];
  const along = o.x === 'u' ? u : v;
  const across = o.x === 'u' ? v : u;
  return { x: Math.floor(along * o.xSign), y: roundSymmetric(across * o.zSign * DEPTH_SCALE) };
}

function modelPoint(o: Orientation, along: number, across: number): { u: number; v: number } {
  const a = along * o.xSign;
  const b = across * o.zSign;
  return o.x === 'u' ? { u: a, v: b } : { u: b, v: a };
}

function viewerFace(o: Orientation): ModelFace {
  if (o.x === 'v') return o.zSign > 0 ? 'forward' : 'backward';
  return o.zSign > 0 ? 'right' : 'left';
}

interface Pixel {
  readonly color: Rgba;
  readonly depth: number;
}

/** A sprite under construction: colors plus a depth buffer, nearer is larger. */
class Canvas {
  readonly image: PixelBuffer;
  readonly depth: Float64Array;
  readonly ox: number;
  readonly oy: number;

  constructor(size: number) {
    this.image = new PixelBuffer(size, size);
    this.depth = new Float64Array(size * size).fill(Number.NEGATIVE_INFINITY);
    this.ox = size / 2;
    this.oy = Math.round(size * 0.7);
  }

  put(x: number, y: number, pixel: Pixel): void {
    const px = x + this.ox;
    const py = y + this.oy;
    if (!this.image.contains(px, py)) throw new Error('Furniture model is larger than its canvas');
    const index = py * this.image.width + px;
    if (pixel.depth <= (this.depth[index] as number)) return;
    this.depth[index] = pixel.depth;
    if (pixel.color.a === 255) this.image.setPixel(px, py, pixel.color);
    else this.image.blendPixel(px, py, pixel.color);
  }
}

const CANVAS_SIZE = 128;

function key(x: number, y: number): number {
  return (y + CANVAS_SIZE) * CANVAS_SIZE * 4 + x + CANVAS_SIZE;
}

function toned(color: Rgba, alpha: number | undefined): Rgba {
  return alpha === undefined ? color : rgba(color.r, color.g, color.b, alpha);
}

/** The visible pixels of one box, keyed by screen position relative to the origin. */
function rasterBox(box: Box, o: Orientation, into: Map<number, Pixel & { x: number; y: number }>): void {
  const along = o.x === 'u' ? box.u : box.v;
  const across = o.x === 'u' ? box.v : box.u;
  const [x0, x1] = signed(along, o.xSign);
  const [z0, z1] = depthSpan(signed(across, o.zSign));
  const [y0, y1] = box.y;
  const width = x1 - x0;
  const { ramp } = box;
  const rounded = box.rounded === true && width >= 3;
  const plot = (x: number, y: number, color: Rgba, depth: number): void => {
    const k = key(x, y);
    const current = into.get(k);
    if (!current || depth > current.depth) into.set(k, { x, y, color, depth });
  };
  const topColor = ramp[box.top ?? 'base'];
  for (let z = z0; z < z1; z += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (rounded && z === z0 && (x === x0 || x === x1 - 1)) continue;
      const lit = width >= 3 && z1 - z0 >= 2 && (x === x0 || z === z0);
      let color = toned(lit ? mixRgba(topColor, ramp.light, 0.5) : topColor, box.alpha);
      const { u, v } = modelPoint(o, x + 0.5, (z + 0.5) / DEPTH_SCALE);
      const point = { face: 'top' as const, u, v, y: y1, col: x - x0, row: z - z0, width, height: z1 - z0 };
      if (box.shade) color = box.shade(point, color);
      plot(x, z - y1, color, z + 0.5 + y1);
    }
  }
  const face = viewerFace(o);
  const sideColor = ramp[box.side ?? 'shadow'];
  const edge = o.zSign > 0 ? across[1] : across[0];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (rounded && y === y0 && (x === x0 || x === x1 - 1)) continue;
      const shaded = width >= 3 && x === x1 - 1;
      let color = toned(shaded ? mixRgba(sideColor, ramp.deep, 0.4) : sideColor, box.alpha);
      const point = { face, ...modelPoint(o, x + 0.5, edge * o.zSign), y: y + 0.5, col: x - x0, row: y1 - 1 - y, width, height: y1 - y0 };
      if (box.shade) color = box.shade(point, color);
      plot(x, z1 - 1 - y, color, z1 + y + 0.5);
    }
  }
}

const NEIGHBORS = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const;

function paintPart(canvas: Canvas, part: Part, o: Orientation): void {
  const pixels = new Map<number, Pixel & { x: number; y: number }>();
  for (const box of part.boxes) rasterBox(box, o, pixels);
  const outline = new Map<number, Pixel & { x: number; y: number }>();
  for (const pixel of pixels.values()) {
    for (const [ox, oy] of NEIGHBORS) {
      const x = pixel.x + ox;
      const y = pixel.y + oy;
      const k = key(x, y);
      if (pixels.has(k)) continue;
      const depth = pixel.depth - 0.5;
      const current = outline.get(k);
      if (current && current.depth >= depth) continue;
      const { r, g, b, a } = pixel.color;
      // Glass is mostly the floor behind it, so its rim takes more ink to read as dark.
      outline.set(k, { x, y, depth, color: mixRgba(rgba(r, g, b), OUTLINE_INK, a === 255 ? OUTLINE_INK_MIX.opaque : OUTLINE_INK_MIX.translucent) });
    }
  }
  for (const pixel of pixels.values()) canvas.put(pixel.x, pixel.y, pixel);
  for (const pixel of outline.values()) canvas.put(pixel.x, pixel.y, pixel);
}

function paintShadow(canvas: Canvas, model: FurnitureModel, facing: Facing): void {
  const { x, z } = floorSpans(facing, model.shadow.u, model.shadow.v);
  const cx = (x[0] + x[1]) / 2;
  const cz = (z[0] + z[1]) / 2;
  const rx = (x[1] - x[0]) / 2;
  const rz = (z[1] - z[0]) / 2;
  for (let py = z[0]; py < z[1]; py += 1) {
    for (let px = x[0]; px < x[1]; px += 1) {
      const u = (px + 0.5 - cx) / rx;
      const w = (py + 0.5 - cz) / rz;
      const inside = model.shadow.shape === 'ellipse' ? u * u + w * w <= 1 : Math.abs(u) ** 6 + Math.abs(w) ** 6 <= 1;
      if (inside) canvas.image.setPixel(px + canvas.ox, py + canvas.oy, SHADOW_COLOR);
    }
  }
}

function bounds(images: readonly PixelBuffer[]): { x: number; y: number; width: number; height: number } {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const image of images) {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (image.alphaAt(x, y) === 0) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function cropped(image: PixelBuffer, rect: { x: number; y: number; width: number; height: number }): PixelBuffer {
  const out = new PixelBuffer(rect.width, rect.height);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) out.setPixel(x, y, image.getPixel(rect.x + x, rect.y + y));
  }
  return out;
}

/** Draws a model for one facing, both layers cropped to the same tight box. */
export function renderFurniture(model: FurnitureModel, facing: Facing): RenderedFurniture {
  const o = ORIENTATION[facing];
  const back = new Canvas(CANVAS_SIZE);
  const front = new Canvas(CANVAS_SIZE);
  paintShadow(back, model, facing);
  for (const part of model.parts) paintPart((part.layer?.(facing) ?? 'back') === 'front' ? front : back, part, o);
  const rect = bounds([back.image, front.image]);
  return {
    back: cropped(back.image, rect),
    front: cropped(front.image, rect),
    origin: { x: back.ox - rect.x, y: back.oy - rect.y },
  };
}
