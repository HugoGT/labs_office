/**
 * Map props drawn in code to retire the Kenney placeholders (#4): trees, a potted plant, a
 * wooden bridge and hedge tiles. Each sprite is drawn straight into its contract frame
 * (`TREE`, `PLANT`, `BRIDGE`, `HEDGE` in artContract.ts), so the sheet is the drawing.
 *
 * Same family as the characters and furniture: masses of foliage built from overlapping blobs,
 * each shaded by its own normal toward the upper-left light and broken into leaf clumps with
 * smooth noise (no per-pixel static), 1px ink outline, warm lights and indigo-leaning shadows.
 */
import { OUTLINE_INK, OUTLINE_INK_MIX } from '../../../src/game/artColor.ts';
import {
  ART_TILE,
  BRIDGE,
  HEDGE,
  PLANT,
  TREE,
  type BridgeOrientation,
} from '../../../src/game/artContract.ts';
import { makeRamp, mixRgba, type Ramp } from './color.ts';
import { periodicNoise, type Noise } from './noise.ts';
import { PixelBuffer, rgba, type Rgba } from './pixelBuffer.ts';

/** Same contact shadow as furniture and characters. */
const CONTACT_SHADOW = rgba(46, 26, 20, 78);
/** Shadow a deck casts on the water, like the terrain edges' contact shadow. */
const WATER_SHADOW = rgba(28, 18, 44, 72);

function ink(color: Rgba): Rgba {
  return mixRgba(rgba(color.r, color.g, color.b), OUTLINE_INK, OUTLINE_INK_MIX.opaque);
}

function shadowEllipse(image: PixelBuffer, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const u = (x + 0.5 - cx) / rx;
      const v = (y + 0.5 - cy) / ry;
      if (u * u + v * v <= 1) image.setPixel(x, y, CONTACT_SHADOW);
    }
  }
}

interface Blob {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * Paints the union of `blobs` with `ramp`. A pixel takes the blob it sits deepest in; its tone
 * comes from that blob's normal toward the upper-left light, the whole mass's own lit side, and
 * a little noise so the bands break into leaf clumps.
 */
function foliage(image: PixelBuffer, blobs: readonly Blob[], ramp: Ramp, noise: Noise): void {
  const x0 = Math.min(...blobs.map((b) => b.x - b.r));
  const x1 = Math.max(...blobs.map((b) => b.x + b.r));
  const y0 = Math.min(...blobs.map((b) => b.y - b.r));
  const y1 = Math.max(...blobs.map((b) => b.y + b.r));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const span = Math.max(x1 - x0, y1 - y0) / 2;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let best: { depth: number; blob: Blob } | null = null;
      for (const blob of blobs) {
        const depth = 1 - Math.hypot(px - blob.x, py - blob.y) / blob.r;
        if (depth >= 0 && (best === null || depth > best.depth)) best = { depth, blob };
      }
      if (best === null) continue;
      const nx = (px - best.blob.x) / best.blob.r;
      const ny = (py - best.blob.y) / best.blob.r;
      const local = -0.6 * nx - 0.8 * ny;
      const global = (-0.6 * (px - cx) - 0.8 * (py - cy)) / span;
      const light = 0.55 * local + 0.45 * global + 0.5 * (noise(x, y) - 0.5);
      const tone = light > 0.42 ? ramp.light : light > 0 ? ramp.base : light > -0.42 ? ramp.shadow : ramp.deep;
      image.setPixel(x, y, tone);
    }
  }
}

// --- Trees -------------------------------------------------------------------------------------

export const TREE_KINDS = ['oak', 'maple'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

const TREE_LEAVES: Readonly<Record<TreeKind, string>> = { oak: '#4f8f3a', maple: '#d9822b' };
const BARK = makeRamp('#6b4a32');

const CROWN: readonly Blob[] = [
  { x: 32, y: 38, r: 21 },
  { x: 17, y: 45, r: 11 },
  { x: 47, y: 45, r: 11 },
  { x: 22, y: 25, r: 12 },
  { x: 42, y: 25, r: 12 },
  { x: 32, y: 54, r: 11 },
  { x: 32, y: 17, r: 10 },
];

/** A broadleaf tree in its 64x96 frame, the trunk base on TREE.anchor. */
export function treeSprite(kind: TreeKind): PixelBuffer {
  const image = new PixelBuffer(TREE.frame.width, TREE.frame.height);
  const { x: ax, y: ay } = TREE.anchor;
  shadowEllipse(image, ax, ay - 2, 17, 5);
  for (let y = ay - 30; y < ay; y += 1) {
    const flare = y >= ay - 4 ? 1 : 0;
    for (let x = ax - 3 - flare; x < ax + 3 + flare; x += 1) {
      const tone = x < ax - 1 ? BARK.light : x >= ax + 1 ? BARK.shadow : BARK.base;
      image.setPixel(x, y, (y + x) % 7 === 0 ? BARK.deep : tone);
    }
  }
  foliage(image, CROWN, makeRamp(TREE_LEAVES[kind]), periodicNoise(kind === 'oak' ? 31 : 37, 64, 8));
  image.addOutline(ink);
  return image;
}

// --- Plants ------------------------------------------------------------------------------------

export const PLANT_KINDS = ['ficus'] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];

const POT = makeRamp('#b86b45');
const PLANT_LEAVES = makeRamp('#4f9a48');
const PLANT_CROWN: readonly Blob[] = [
  { x: 16, y: 22, r: 8 },
  { x: 10, y: 27, r: 5 },
  { x: 22, y: 27, r: 5 },
  { x: 11, y: 15, r: 5 },
  { x: 21, y: 15, r: 5 },
  { x: 16, y: 10, r: 4.5 },
];

/** A potted plant in its 32x48 frame, the pot standing on PLANT.anchor. */
export function plantSprite(kind: PlantKind): PixelBuffer {
  const image = new PixelBuffer(PLANT.frame.width, PLANT.frame.height);
  const { x: ax, y: ay } = PLANT.anchor;
  shadowEllipse(image, ax, ay - 1, 9, 2.5);
  const potTop = ay - 12;
  for (let y = potTop; y < ay; y += 1) {
    const half = y < potTop + 2 ? 8 : 7 - Math.floor(((y - potTop) * 2) / 12);
    for (let x = ax - half; x < ax + half; x += 1) {
      const rim = y < potTop + 2;
      const tone = rim ? (y === potTop ? POT.light : POT.base) : x < ax - half + 3 ? POT.light : x >= ax + half - 3 ? POT.shadow : POT.base;
      image.setPixel(x, y, tone);
    }
  }
  foliage(image, PLANT_CROWN, PLANT_LEAVES, periodicNoise(kind === 'ficus' ? 41 : 43, 32, 4));
  image.addOutline(ink);
  return image;
}

// --- Bridges -----------------------------------------------------------------------------------

const DECK = makeRamp('#a0703f');
const STONE = makeRamp('#8f8b85');
const RAIL_WIDTH = 6;
const PLANK = 6;
const POST_EVERY = 24;

function transpose(image: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(image.height, image.width);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) out.setPixel(y, x, image.getPixel(x, y));
  }
  return out;
}

/** The north-south bridge: planks across the crossing, rails with posts, stone abutments on the banks. */
function northSouthBridge(): PixelBuffer {
  const image = new PixelBuffer(BRIDGE.frame.width, BRIDGE.frame.height);
  const size = BRIDGE.footprint.w * ART_TILE;
  const left = BRIDGE.anchor.x - size / 2;
  const top = BRIDGE.anchor.y - size;
  const right = left + size;
  const reach = top;
  // Abutments: stone courses on both banks, a little narrower than the deck.
  for (const [y0, y1] of [
    [0, top],
    [top + size, top + size + reach],
  ] as const) {
    for (let y = y0; y < y1; y += 1) {
      for (let x = left + 2; x < right - 2; x += 1) {
        const course = Math.floor((y - y0) / 8);
        const joint = (y - y0) % 8 === 7 || (x + (course % 2) * 6) % 12 === 0;
        image.setPixel(x, y, joint ? STONE.shadow : (y - y0) % 8 === 0 ? STONE.light : STONE.base);
      }
    }
  }
  // Deck planks run east-west, across the way people walk.
  const tones = [DECK.base, mixRgba(DECK.base, DECK.light, 0.3), mixRgba(DECK.base, DECK.shadow, 0.2)];
  for (let y = top; y < top + size; y += 1) {
    const plank = Math.floor((y - top) / PLANK);
    const seam = (y - top) % PLANK === PLANK - 1;
    for (let x = left; x < right; x += 1) {
      const nail = !seam && (y - top) % PLANK === 2 && (x === left + RAIL_WIDTH + 3 || x === right - RAIL_WIDTH - 4);
      image.setPixel(x, y, seam ? DECK.shadow : nail ? DECK.deep : (tones[plank % tones.length] as Rgba));
    }
  }
  // Rails along both sides, lit on their west face, with a post every POST_EVERY pixels.
  for (const x0 of [left, right - RAIL_WIDTH]) {
    for (let y = top; y < top + size; y += 1) {
      const post = (y - top) % POST_EVERY < 6;
      for (let x = x0; x < x0 + RAIL_WIDTH; x += 1) {
        const lit = x === x0 || (post && (y - top) % POST_EVERY === 0);
        const tone = post ? (lit ? DECK.base : DECK.deep) : lit ? DECK.light : x === x0 + RAIL_WIDTH - 1 ? DECK.deep : DECK.shadow;
        image.setPixel(x, y, tone);
      }
    }
  }
  image.addOutline(ink);
  for (let y = top; y < top + size; y += 1) {
    for (let x = left - 4; x < right + 4; x += 1) if (image.alphaAt(x, y) === 0) image.setPixel(x, y, WATER_SHADOW);
  }
  return image;
}

let northSouth: PixelBuffer | null = null;

/** A 3x3 bridge in its 128x128 frame; east-west is the north-south drawing turned. */
export function bridgeSprite(orientation: BridgeOrientation): PixelBuffer {
  northSouth ??= northSouthBridge();
  return orientation === 'north-south' ? new PixelBuffer(northSouth.width, northSouth.height, northSouth.data.slice()) : transpose(northSouth);
}

// --- Hedges ------------------------------------------------------------------------------------

const HEDGE_LEAVES = makeRamp('#3f7a3a');
const HEDGE_INSET = 3;
/** Wraps at the tile width so a straight run of hedge tiles shows one continuous mass. */
const HEDGE_NOISE = periodicNoise(47, ART_TILE, 4);

const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;

/**
 * One hedge tile for a connection mask (north 1, east 2, south 4, west 8): the top of the hedge
 * HEDGE.height over its tile, reaching the frame side toward each neighbor and inset with rounded
 * corners elsewhere, and a darker front face where no hedge continues south.
 */
export function hedgeSprite(mask: number): PixelBuffer {
  const image = new PixelBuffer(HEDGE.frame.width, HEDGE.frame.height);
  const lift = HEDGE.height;
  const faceTop = ART_TILE;
  const x0 = mask & WEST ? 0 : HEDGE_INSET;
  const x1 = mask & EAST ? ART_TILE : ART_TILE - HEDGE_INSET;
  const y0 = mask & NORTH ? 0 : HEDGE_INSET;
  const south = (mask & SOUTH) !== 0;
  const y1 = south ? ART_TILE + lift : ART_TILE + lift - 1;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cornerTop = y === y0 && !(mask & NORTH) && ((x === x0 && !(mask & WEST)) || (x === x1 - 1 && !(mask & EAST)));
      const cornerBottom = !south && y === y1 - 1 && ((x === x0 && !(mask & WEST)) || (x === x1 - 1 && !(mask & EAST)));
      if (cornerTop || cornerBottom) continue;
      const n = HEDGE_NOISE(x, y - lift);
      let tone: Rgba;
      if (!south && y >= faceTop) tone = y === faceTop ? HEDGE_LEAVES.shadow : n > 0.55 ? HEDGE_LEAVES.shadow : HEDGE_LEAVES.deep;
      else if (y === y0 && !(mask & NORTH)) tone = HEDGE_LEAVES.light;
      else tone = n > 0.66 ? HEDGE_LEAVES.light : n < 0.36 ? HEDGE_LEAVES.shadow : HEDGE_LEAVES.base;
      image.setPixel(x, y, tone);
    }
  }
  image.addOutline(ink);
  return image;
}
