/**
 * Renders a connected group of wall pieces at screen resolution. The pieces are laid out in floor
 * pixels, each pixel written exactly once (so translucent glass is never composited twice), then
 * sampled nearest-neighbor at screen pixel centers like the rest of the scene. At a fractional
 * scale one floor pixel can cover two screen pixels, and below 1x some are skipped, so the rim is
 * decided on screen: only the screen pixels that touch the outside of the group are outline, the
 * screen pixels right inside them show the sprite's ring (found by stepping from the sampled pixel
 * toward the outside), and a screen pixel that samples an outline pixel further in takes the color
 * of the nearest inner pixel instead.
 */
import { PixelBuffer, type Rgba } from './pixelBuffer.ts';
import type { Rect, WallGroup } from './wallGeometry.ts';
import { bodySprite, jointSprite, RIM_OUTLINE, RIM_RING, wallOutline, type WallSprite } from './walls.ts';

export interface RenderedWalls {
  readonly image: PixelBuffer;
  /** Screen position of the image's top-left pixel. */
  readonly left: number;
  readonly top: number;
}

interface Layer {
  readonly x0: number;
  readonly y0: number;
  readonly image: PixelBuffer;
  readonly covered: Uint8Array;
  readonly rim: Uint8Array;
}

const NEIGHBORS = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const;
const DIAGONALS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;
const AROUND = [...NEIGHBORS, ...DIAGONALS];

/** The group in floor pixels. Throws if two pieces claim the same pixel. */
function composeGroup(group: WallGroup): Layer {
  const pieces: { rect: Rect; sprite: WallSprite }[] = [
    ...group.joints.map((joint) => ({ rect: joint.rect, sprite: jointSprite(group.material, joint.mask) })),
    ...group.bodies.map((body) => ({ rect: body.rect, sprite: bodySprite(group.material, body.edge.axis) })),
  ];
  const x0 = Math.min(...pieces.map(({ rect }) => rect.x));
  const y0 = Math.min(...pieces.map(({ rect }) => rect.y));
  const width = Math.max(...pieces.map(({ rect }) => rect.x + rect.width)) - x0;
  const height = Math.max(...pieces.map(({ rect }) => rect.y + rect.height)) - y0;
  const image = new PixelBuffer(width, height);
  const covered = new Uint8Array(width * height);
  const rim = new Uint8Array(width * height);
  for (const { rect, sprite } of pieces) {
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        const lx = rect.x - x0 + x;
        const ly = rect.y - y0 + y;
        const index = ly * width + lx;
        if (covered[index]) throw new Error(`Wall pieces overlap at floor pixel (${lx + x0}, ${ly + y0})`);
        covered[index] = 1;
        rim[index] = sprite.rim[y * rect.width + x] ?? 0;
        image.setPixel(lx, ly, sprite.image.getPixel(x, y));
      }
    }
  }
  return { x0, y0, image, covered, rim };
}

/** The wall layer in floor pixels, at scale 1: what the group looks like before screen sampling. */
export function composeWalls(group: WallGroup): { readonly image: PixelBuffer; readonly left: number; readonly top: number } {
  const layer = composeGroup(group);
  return { image: layer.image, left: layer.x0, top: layer.y0 };
}

export function renderWallGroup(group: WallGroup, scale: number): RenderedWalls {
  const layer = composeGroup(group);
  const { image: source, x0, y0 } = layer;
  const at = (sx: number, sy: number): number => (source.contains(sx, sy) ? sy * source.width + sx : -1);
  const inside = (sx: number, sy: number): boolean => layer.covered[at(sx, sy)] === 1;
  const isOutline = (sx: number, sy: number): boolean => layer.rim[at(sx, sy)] === RIM_OUTLINE;
  const isRing = (sx: number, sy: number): boolean => layer.rim[at(sx, sy)] === RIM_RING;
  const innerColor = (sx: number, sy: number): Rgba | undefined => {
    const inner = AROUND.find(([ox, oy]) => inside(sx + ox, sy + oy) && !isOutline(sx + ox, sy + oy));
    return inner && source.getPixel(sx + inner[0], sy + inner[1]);
  };
  /** The sprite ring pixel nearest to (sx, sy) toward the outside, which lies in direction (ox, oy). */
  const ringToward = (sx: number, sy: number, ox: number, oy: number): Rgba | undefined => {
    for (let step = 0; step <= Math.ceil(1 / scale) + 1; step += 1) {
      const x = sx + ox * step;
      const y = sy + oy * step;
      if (isRing(x, y)) return source.getPixel(x, y);
      if (!inside(x, y) || isOutline(x, y)) return undefined;
    }
    return undefined;
  };

  const first = (origin: number): number => Math.ceil(origin * scale - 0.5);
  const left = first(x0);
  const top = first(y0);
  const width = first(x0 + source.width) - left;
  const height = first(y0 + source.height) - top;
  const sourceX = (dx: number): number => Math.floor((left + dx + 0.5) / scale) - x0;
  const sourceY = (dy: number): number => Math.floor((top + dy + 0.5) / scale) - y0;
  const covers = (dx: number, dy: number): boolean => inside(sourceX(dx), sourceY(dy));

  const outlineColor = wallOutline(group.material);
  const image = new PixelBuffer(width, height);
  const edge = new Uint8Array(width * height);
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      if (covers(dx, dy) && AROUND.some(([ox, oy]) => !covers(dx + ox, dy + oy))) edge[dy * width + dx] = 1;
    }
  }
  const onEdge = (dx: number, dy: number): boolean => dx >= 0 && dy >= 0 && dx < width && dy < height && edge[dy * width + dx] === 1;
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      if (!covers(dx, dy)) continue;
      if (onEdge(dx, dy)) {
        image.setPixel(dx, dy, outlineColor);
        continue;
      }
      const sx = sourceX(dx);
      const sy = sourceY(dy);
      const outward = AROUND.find(([ox, oy]) => onEdge(dx + ox, dy + oy));
      const ring = outward && ringToward(sx, sy, outward[0], outward[1]);
      const color = ring ?? (isOutline(sx, sy) ? (innerColor(sx, sy) ?? outlineColor) : source.getPixel(sx, sy));
      image.setPixel(dx, dy, color);
    }
  }
  return { image, left, top };
}
