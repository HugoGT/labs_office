/**
 * Stone rug: rounded beige pebbles packed on grey mortar, a softer cousin of the cobblestone
 * terrain. Stones are Voronoi cells of jittered staggered rows, shrunk by a mortar joint and with
 * their corners eaten away so they read round. The rug has no straight edge: its silhouette is the
 * stones plus the mortar held between them, traced by a 1px outline that follows the rounded outer
 * stones all around. Each facing packs its own stones; nothing is rotated.
 */
import type { PixelBuffer, Rgba } from '../../../../src/art/pixelBuffer.ts';
import { makeRamp, mixRgba } from '../color.ts';
import { createRng, type Rng } from '../random.ts';
import { type RugFacing, rugCanvas, rugFootprint } from './shared.ts';

const PEBBLE = makeRamp('#b2a392');
const MORTAR = makeRamp('#7f7d7a');

const STONE_BODIES: readonly Rgba[] = [
  PEBBLE.base,
  mixRgba(PEBBLE.base, PEBBLE.light, 0.22),
  mixRgba(PEBBLE.base, PEBBLE.shadow, 0.22),
];

export const STONE_RUG_TONES = {
  border: MORTAR.deep,
  /** Plain mortar and the contact shadow it takes right under a stone. */
  mortar: [MORTAR.base, mixRgba(MORTAR.base, MORTAR.shadow, 0.55)] as readonly Rgba[],
} as const;

const SEEDS: Record<RugFacing, number> = { horizontal: 41, vertical: 47 };
/** Staggered stone grid: column and row pitch in pixels, before jitter. */
const PITCH = { x: 12, y: 9 } as const;
const JITTER = { x: 2.6, y: 1.6 } as const;
/** Horizontal distances count less, so cells come out wider than tall like the reference. */
const STRETCH = 1.3;
/** Distance margin to the next stone below which a pixel is mortar: about a 2px joint. */
const JOINT = 1.2;
/** Farthest (stretched) distance an outer stone reaches from its center: rounds its free side. */
const EDGE_REACH = 4.6;
/** Joints up to about twice this wide are mortar inside the rug; wider notches stay open. */
const CLOSING = 1;
/** Corner-eating passes: each one makes the stones rounder and the joints wider at the corners. */
const ROUNDING_PASSES = 2;
/** Stones smaller than this are left as mortar instead of reading as noise. */
const MIN_STONE = 10;

interface Center {
  readonly x: number;
  readonly y: number;
  /** Outer stones have a free side, rounded by EDGE_REACH instead of a neighbor's joint. */
  readonly edge: boolean;
}

/**
 * Jittered staggered rows fitted to the area inside the outline: the pitch stretches so a whole
 * number of rows and columns fill it, and every other row ends in a narrower stone, like a laid
 * wall. Edge stones are thus never thin slivers.
 */
function stoneCenters(width: number, height: number, rng: Rng): Center[] {
  const span = { x: width - 2, y: height - 2 };
  const rows = Math.max(1, Math.round(span.y / PITCH.y));
  const cols = Math.max(1, Math.round(span.x / PITCH.x));
  const pitch = { x: span.x / cols, y: span.y / rows };
  const centers: Center[] = [];
  for (let row = 0; row < rows; row += 1) {
    const staggered = row % 2 === 1;
    const y = 1 + pitch.y * (row + 0.5);
    for (let col = 0; col < (staggered ? cols + 1 : cols); col += 1) {
      // A staggered row's end stones pull inward so their outer side rounds off instead of being cut.
      const inset = staggered && col === 0 ? pitch.x * 0.3 : staggered && col === cols ? -pitch.x * 0.3 : 0;
      const x = 1 + pitch.x * (staggered ? col : col + 0.5) + inset;
      const edge = row === 0 || row === rows - 1 || col === 0 || col === (staggered ? cols : cols - 1);
      // Outer stones wander less, so the edge stays bumpy without deep bites between them.
      const wander = edge ? 0.5 : 1;
      const jx = inset !== 0 ? 0 : (rng() - 0.5) * 2 * JITTER.x * wander;
      centers.push({ x: x + jx, y: y + (rng() - 0.5) * 2 * JITTER.y * wander, edge });
    }
  }
  return centers;
}

/** Owner map of the footprint: the stone index of each pixel, -1 for mortar and outside. */
function packStones(width: number, height: number, rng: Rng): Int16Array {
  const owner = new Int16Array(width * height).fill(-1);
  const centers = stoneCenters(width, height, rng);
  // The footprint's outer ring is left for the outline.
  const inside = (x: number, y: number): boolean => x >= 1 && y >= 1 && x <= width - 2 && y <= height - 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;
      let best = Infinity;
      let second = Infinity;
      let id = -1;
      centers.forEach((c, i) => {
        const d = Math.hypot((x + 0.5 - c.x) / STRETCH, y + 0.5 - c.y);
        if (d < best) {
          second = best;
          best = d;
          id = i;
        } else if (d < second) second = d;
      });
      if (second - best >= JOINT && (best <= EDGE_REACH || !centers[id]?.edge)) owner[y * width + x] = id;
    }
  }
  for (let pass = 0; pass < ROUNDING_PASSES; pass += 1) roundCorners(owner, width, height);
  dropSpecks(owner);
  return owner;
}

/** Turns stone pixels with few same-stone neighbors (the cell corners) into mortar. */
function roundCorners(owner: Int16Array, width: number, height: number): void {
  const snapshot = owner.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const id = snapshot[y * width + x] ?? -1;
      if (id === -1) continue;
      let own = 0;
      for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) if (snapshot[(y + oy) * width + x + ox] === id) own += 1;
      // `own` counts the pixel itself: 4 or fewer means a corner or a one-pixel spur.
      if (own <= 4) owner[y * width + x] = -1;
    }
  }
}

function dropSpecks(owner: Int16Array): void {
  const sizes = new Map<number, number>();
  for (const id of owner) if (id !== -1) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  for (let i = 0; i < owner.length; i += 1) if ((sizes.get(owner[i] ?? -1) ?? Infinity) < MIN_STONE) owner[i] = -1;
}

/**
 * The rug's body: stones closed over the joints between them (dilate then erode), plus any mortar
 * pocket the closing could not reach from outside. Notches between outer stones stay open.
 */
function silhouette(owner: Int16Array, width: number, height: number): Uint8Array {
  const pad = CLOSING + 1;
  const w = width + pad * 2;
  const h = height + pad * 2;
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (owner[y * width + x] !== -1) mask[(y + pad) * w + x + pad] = 1;
  const step = (source: Uint8Array, grow: boolean): Uint8Array => {
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        let hit = !grow;
        for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
          const v = source[(y + oy) * w + x + ox] === 1;
          hit = grow ? hit || v : hit && v;
        }
        out[y * w + x] = hit ? 1 : 0;
      }
    }
    return out;
  };
  for (let i = 0; i < CLOSING; i += 1) mask = step(mask, true);
  for (let i = 0; i < CLOSING; i += 1) mask = step(mask, false);
  // Flood the outside through 4-connected gaps; whatever it cannot reach is enclosed mortar.
  const outside = new Uint8Array(w * h);
  const queue = [0];
  outside[0] = 1;
  while (queue.length > 0) {
    const i = queue.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (outside[n] === 1 || mask[n] === 1) continue;
      outside[n] = 1;
      queue.push(n);
    }
  }
  const body = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) body[y * width + x] = outside[(y + pad) * w + x + pad] === 1 ? 0 : 1;
  return body;
}

export function stoneRug(facing: RugFacing): PixelBuffer {
  const rng = createRng(SEEDS[facing]);
  const canvas = rugCanvas(facing);
  const { width, height } = rugFootprint(facing);
  const owner = packStones(width, height, rng);
  const body = silhouette(owner, width, height);
  const bodies = Array.from({ length: Math.max(...owner) + 1 }, () => STONE_BODIES[Math.floor(rng() * STONE_BODIES.length)] as Rgba);
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= width || y >= height ? -1 : (owner[y * width + x] ?? -1));
  const inBody = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && body[y * width + x] === 1;
  const [mortar, mortarShade] = STONE_RUG_TONES.mortar as [Rgba, Rgba];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inBody(x, y)) {
        // The outline wraps the body from outside, so it traces each outer stone's curve.
        if (inBody(x - 1, y) || inBody(x + 1, y) || inBody(x, y - 1) || inBody(x, y + 1)) canvas.setPixel(x, y, STONE_RUG_TONES.border);
        continue;
      }
      const id = at(x, y);
      if (id === -1) {
        canvas.setPixel(x, y, at(x, y - 1) !== -1 ? mortarShade : mortar);
        continue;
      }
      const stone = bodies[id] as Rgba;
      // Light from above: a lit top rim and a shaded lower edge give each pebble its volume.
      if (at(x, y - 1) !== id) canvas.setPixel(x, y, mixRgba(stone, PEBBLE.light, 0.55));
      else if (at(x, y + 1) !== id) canvas.setPixel(x, y, mixRgba(stone, PEBBLE.shadow, 0.6));
      else canvas.setPixel(x, y, stone);
    }
  }
  return canvas;
}
