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
import { createRng } from './random.ts';
import { PixelBuffer, place, rgba, type Rgba } from '../../../src/art/pixelBuffer.ts';

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
      // Only on bare ground: drawn after an outline, it never covers the ink around a trunk's base.
      if (u * u + v * v <= 1 && image.alphaAt(x, y) === 0) image.setPixel(x, y, CONTACT_SHADOW);
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

/** One broadleaf tree, its leaves in any color (an autumn one is the same tree painted orange), and the large tree. */
// The ficus is a potted tree: it stands on the floor, unlike the plants, which stand on desks and tables (#121).
export const TREE_KINDS = ['oak', 'large', 'ficus'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

/** The leaves the broadleaf tree is exported in; the large tree keeps its own greens. */
export const DEFAULT_TREE_COLOR = '#4f8f3a';
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

const treeCache = new Map<string, PixelBuffer>();

/** A tree in its 64x96 frame, the trunk base on TREE.anchor; `color` paints the broadleaf tree's leaves. */
export function treeSprite(kind: TreeKind, color: string = DEFAULT_TREE_COLOR): PixelBuffer {
  const key = kind === 'large' ? kind : `${kind}:${color.toLowerCase()}`;
  const cached = treeCache.get(key);
  if (cached !== undefined) return cached;
  const image = kind === 'large' ? largeTreeSprite() : kind === 'ficus' ? ficusSprite() : broadleafSprite(color);
  treeCache.set(key, image);
  return image;
}

function broadleafSprite(color: string): PixelBuffer {
  const image = new PixelBuffer(TREE.frame.width, TREE.frame.height);
  const { x: ax, y: ay } = TREE.anchor;
  for (let y = ay - 30; y < ay; y += 1) {
    const flare = y >= ay - 4 ? 1 : 0;
    for (let x = ax - 3 - flare; x < ax + 3 + flare; x += 1) {
      const tone = x < ax - 1 ? BARK.light : x >= ax + 1 ? BARK.shadow : BARK.base;
      image.setPixel(x, y, (y + x) % 7 === 0 ? BARK.deep : tone);
    }
  }
  foliage(image, CROWN, makeRamp(color), periodicNoise(31, 64, 8));
  image.addOutline(ink);
  // After the outline, so the ink follows the trunk down to the ground.
  shadowEllipse(image, ax, ay - 2, 17, 5);
  return image;
}

/** Sunlit leaves on the upper left of the crown, cooling to teal on its lower right, like the reference tree. */
const LARGE_RAMPS: readonly Ramp[] = [makeRamp('#7cb846'), makeRamp('#58a040'), makeRamp('#3c8a50'), makeRamp('#2a7066')];
/** The crown, about 2 tiles across, hangs from the top of the frame down to about a tile above the ground. */
const LARGE_CENTER = { x: 32, y: 29.5 } as const;
const LARGE_RADIUS = { x: 30, y: 28 } as const;
/** How far the trunk rises from the ground before the crown covers it, about 1.5 tiles. */
const LARGE_TRUNK_HEIGHT = 52;
/** Leaf clumps around the rim scallop the silhouette instead of leaving a smooth ellipse. */
const LARGE_CROWN: readonly Blob[] = [
  { x: LARGE_CENTER.x, y: LARGE_CENTER.y, r: 1 },
  ...Array.from({ length: 22 }, (_, k): Blob => {
    const angle = (2 * Math.PI * k) / 22;
    return { x: LARGE_CENTER.x + (LARGE_RADIUS.x - 3.5) * Math.cos(angle), y: LARGE_CENTER.y + (LARGE_RADIUS.y - 3.5) * Math.sin(angle), r: 5 };
  }),
];
function insideCrown(px: number, py: number): boolean {
  const dx = (px - LARGE_CENTER.x) / (LARGE_RADIUS.x - 3.5);
  const dy = (py - LARGE_CENTER.y) / (LARGE_RADIUS.y - 3.5);
  if (dx * dx + dy * dy <= 1) return true;
  return LARGE_CROWN.some((blob) => Math.hypot(px - blob.x, py - blob.y) <= blob.r);
}

interface Leaf {
  readonly x: number;
  readonly y: number;
  readonly ramp: Ramp;
}

/** Half the size of one leaf clump, across and down. */
const LEAF_RX = 5;
const LEAF_RY = 4;

/**
 * Leaf clumps scattered over the crown on a jittered grid, sorted top to bottom so each one
 * overlaps the one above it like a shingle. A clump's color comes from where it sits on the lit
 * sphere (upper left sunlit, lower right teal), broken up a little so the bands never read as rings.
 */
function largeLeaves(): Leaf[] {
  const rng = createRng(71);
  const leaves: Leaf[] = [];
  for (let gy = LARGE_CENTER.y - LARGE_RADIUS.y; gy < LARGE_CENTER.y + LARGE_RADIUS.y + 2; gy += 4) {
    for (let gx = LARGE_CENTER.x - LARGE_RADIUS.x; gx < LARGE_CENTER.x + LARGE_RADIUS.x + 2; gx += 5) {
      const x = gx + (rng() - 0.5) * 4;
      const y = gy + (rng() - 0.5) * 3;
      const cx = (x - LARGE_CENTER.x) / LARGE_RADIUS.x;
      const cy = (y - LARGE_CENTER.y) / LARGE_RADIUS.y;
      const lit = 0.4 * cx + 0.85 * cy + 0.55 * (rng() - 0.5);
      const index = Math.max(0, Math.min(LARGE_RAMPS.length - 1, Math.floor((lit + 0.6) * 2.4)));
      leaves.push({ x, y, ramp: LARGE_RAMPS[index] as Ramp });
    }
  }
  return leaves.sort((p, q) => p.y - q.y || p.x - q.x);
}

/**
 * The large tree: the same 1x1 base as the others, about 3 tiles tall. A wide trunk, inside its
 * tile, rises about 1.5 tiles into a tall crown that hangs down to about a tile above the ground,
 * so the crown covers anyone walking behind it. The crown is shingled with overlapping leaf clumps, each lit on its upper
 * left with a shadowed lower rim, turning from sunlit green on its upper left to a cool teal on
 * its lower right.
 */
function largeTreeSprite(): PixelBuffer {
  const image = new PixelBuffer(TREE.frame.width, TREE.frame.height);
  const { x: ax, y: ay } = TREE.anchor;
  for (let y = ay - LARGE_TRUNK_HEIGHT; y < ay; y += 1) {
    // Root flare at the ground, a slight taper toward the crown.
    const half = y >= ay - 2 ? 11 : y >= ay - 5 ? 10 : y < ay - 34 ? 8 : 9;
    for (let x = ax - half; x < ax + half; x += 1) {
      const across = (x + 0.5 - ax) / half;
      const tone = across < -0.45 ? BARK.light : across > 0.5 ? BARK.shadow : BARK.base;
      // Bark grooves run up the trunk, broken here and there, never on its edge columns: there a groove would double the outline.
      const inner = x > ax - half && x < ax + half - 1;
      const groove = inner && (x - ax + 62) % 5 === 0 && (y * 3 + x) % 13 !== 0;
      image.setPixel(x, y, groove ? BARK.deep : tone);
    }
  }
  // A dark under-layer fills any gap between clumps.
  const under = LARGE_RAMPS[LARGE_RAMPS.length - 1] as Ramp;
  const top = Math.floor(LARGE_CENTER.y - LARGE_RADIUS.y);
  const bottom = Math.ceil(LARGE_CENTER.y + LARGE_RADIUS.y);
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < TREE.frame.width; x += 1) if (insideCrown(x + 0.5, y + 0.5)) image.setPixel(x, y, under.shadow);
  }
  for (const leaf of largeLeaves()) {
    for (let y = Math.floor(leaf.y - LEAF_RY); y <= Math.ceil(leaf.y + LEAF_RY); y += 1) {
      for (let x = Math.floor(leaf.x - LEAF_RX); x <= Math.ceil(leaf.x + LEAF_RX); x += 1) {
        const nx = (x + 0.5 - leaf.x) / LEAF_RX;
        const ny = (y + 0.5 - leaf.y) / LEAF_RY;
        // A leaf clump comes to a soft point at its bottom.
        if (nx * nx + ny * ny > 1 - Math.max(0, ny) * Math.abs(nx) * 0.9) continue;
        if (!insideCrown(x + 0.5, y + 0.5)) continue;
        const light = -0.6 * nx - 0.8 * ny;
        const tone = ny > 0.62 ? leaf.ramp.deep : ny > 0.3 ? leaf.ramp.shadow : light > 0.45 ? leaf.ramp.light : leaf.ramp.base;
        image.setPixel(x, y, tone);
      }
    }
  }
  image.addOutline(ink);
  // After the outline, so the ink follows the trunk down to the ground.
  shadowEllipse(image, ax, ay - 2, 24, 6);
  return image;
}

// --- Plants ------------------------------------------------------------------------------------

export const PLANT_KINDS = ['bonsai'] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];

const POT = makeRamp('#b86b45');
const PLANT_LEAVES = makeRamp('#4f9a48');
/** The crown sits high enough over the pot to show the trunk between them. */
const PLANT_CROWN: readonly Blob[] = [
  { x: 16, y: 18, r: 8 },
  { x: 10, y: 23, r: 5 },
  { x: 22, y: 23, r: 5 },
  { x: 11, y: 11, r: 5 },
  { x: 21, y: 11, r: 5 },
  { x: 16, y: 6, r: 4.5 },
];

/** The ficus pot's rows above the anchor: a two-row lip, then the body. */
const POT_HEIGHT = 12;

/**
 * The ficus pot, lit from the upper left like a trunk so it reads round rather than flat: a lip
 * with rounded ends casting a thin shadow on the body, and a body that bulges out under the lip
 * and curves back in to a narrow base.
 */
function roundPot(image: PixelBuffer, ax: number, ay: number): void {
  const top = ay - POT_HEIGHT;
  const bodyTop = top + 2;
  const ramp = [POT.deep, POT.shadow, POT.base, POT.light] as const;
  // Light from the upper left on a surface turned `across` (-1 left edge, 1 right edge) and `down` (-1 up, 1 down).
  const tone = (across: number, down: number, darker: boolean): Rgba => {
    const light = -0.8 * across - 0.3 * down;
    const step = light > 0.35 ? 3 : light > -0.2 ? 2 : light > -0.6 ? 1 : 0;
    return ramp[Math.max(0, step - (darker ? 1 : 0))] as Rgba;
  };
  for (let y = bodyTop; y < ay; y += 1) {
    const t = (y - bodyTop) / (ay - 1 - bodyTop);
    // A narrow neck under the lip, widest about 40% down, then tucking in; the bottom row rounds its corners off.
    const half = Math.round(5 + 3.5 * Math.sin(Math.PI * (0.15 + 0.85 * t))) - (y === ay - 1 ? 1 : 0);
    for (let x = ax - half; x < ax + half; x += 1) {
      const across = (x + 0.5 - ax) / half;
      // The lip shades the row under it.
      image.setPixel(x, y, tone(across, 1.6 * (t - 0.4), y === bodyTop));
    }
  }
  for (let y = top; y < bodyTop; y += 1) {
    // The lip's ends are rounded off on its top row, whose upward face catches the light.
    const half = y === top ? 7.5 : 8;
    for (let x = Math.ceil(ax - half); x < Math.floor(ax + half); x += 1) {
      const across = (x + 0.5 - ax) / half;
      image.setPixel(x, y, tone(across, y === top ? -1 : 0, false));
    }
  }
}

/** A potted plant in its 32x48 frame, the pot standing on PLANT.anchor; the bonsai is the only one for now. */
export function plantSprite(_kind: PlantKind): PixelBuffer {
  return bonsaiSprite();
}

/**
 * The ficus, drawn plant-sized (its pot on PLANT.anchor) and set in the tree frame with its pot on
 * TREE.anchor: a potted tree on the floor's 1x1 base.
 */
function ficusSprite(): PixelBuffer {
  const image = new PixelBuffer(PLANT.frame.width, PLANT.frame.height);
  const { x: ax, y: ay } = PLANT.anchor;
  roundPot(image, ax, ay);
  // A short trunk from the pot up into the crown, lit on its left like the large tree's.
  for (let y = ay - POT_HEIGHT - 1; y > 20; y -= 1) {
    image.setPixel(ax - 1, y, BARK.light);
    image.setPixel(ax, y, BARK.base);
    image.setPixel(ax + 1, y, BARK.shadow);
  }
  foliage(image, PLANT_CROWN, PLANT_LEAVES, periodicNoise(41, 32, 4));
  image.addOutline(ink);
  // After the outline, so the ink closes the pot's bottom too.
  shadowEllipse(image, ax, ay, 9, 2);
  const tree = new PixelBuffer(TREE.frame.width, TREE.frame.height);
  place(tree, image, TREE.anchor.x - ax, TREE.anchor.y - ay);
  return tree;
}

const BONSAI_POT = makeRamp('#55708f');
const BONSAI_BARK = makeRamp('#7a5640');
const MOSS = makeRamp('#7a9a3c');
const BONSAI_LEAVES = makeRamp('#4c8f3e');
/** Three flat foliage pads, each a row of small blobs: a low one on the left, one on the right and the crown. */
const BONSAI_PADS: readonly Blob[] = [
  { x: 8, y: 31, r: 3.5 },
  { x: 11.5, y: 30, r: 4 },
  { x: 15, y: 31, r: 3 },
  { x: 19, y: 27, r: 3.5 },
  { x: 22.5, y: 26.5, r: 4 },
  { x: 25.5, y: 27.5, r: 3 },
  { x: 12, y: 24, r: 4 },
  { x: 15.5, y: 23, r: 4.5 },
  { x: 19, y: 24.5, r: 3.5 },
];

/**
 * A bonsai: a shallow glazed pot with moss on top, a short twisting trunk and three flat pads of
 * foliage, kept low so it reads as a desk-sized plant next to the ficus.
 */
function bonsaiSprite(): PixelBuffer {
  const image = new PixelBuffer(PLANT.frame.width, PLANT.frame.height);
  const { x: ax, y: ay } = PLANT.anchor;
  shadowEllipse(image, ax, ay - 1, 11, 2.5);
  const potTop = ay - 6;
  for (let y = potTop; y < ay; y += 1) {
    const foot = y === ay - 1;
    const half = y === potTop ? 10 : 9;
    for (let x = ax - half; x < ax + half; x += 1) {
      if (foot && x >= ax - 6 && x < ax + 6) continue;
      const tone = y === potTop ? BONSAI_POT.light : x < ax - half + 2 ? BONSAI_POT.light : x >= ax + half - 2 ? BONSAI_POT.shadow : BONSAI_POT.base;
      image.setPixel(x, y, tone);
    }
  }
  for (let x = ax - 9; x < ax + 9; x += 1) image.setPixel(x, potTop - 1, (x * 5) % 7 < 3 ? MOSS.light : MOSS.base);
  // The trunk leans left, then curls back right toward the crown, thinning as it rises.
  for (let y = potTop - 1; y > 23; y -= 1) {
    const t = (potTop - 1 - y) / (potTop - 24);
    const center = ax + 1 - 4 * Math.sin(t * Math.PI * 0.9);
    const half = t < 0.4 ? 2 : 1.5;
    for (let x = Math.round(center - half); x < Math.round(center + half); x += 1) {
      image.setPixel(x, y, x < center - 0.5 ? BONSAI_BARK.light : BONSAI_BARK.shadow);
    }
  }
  // Branches out to the two side pads.
  for (let x = ax - 6; x < ax - 2; x += 1) image.setPixel(x, 32, BONSAI_BARK.shadow);
  for (let x = ax; x < ax + 6; x += 1) image.setPixel(x, 28 + Math.floor((ax + 6 - x) / 3), BONSAI_BARK.shadow);
  foliage(image, BONSAI_PADS, BONSAI_LEAVES, periodicNoise(59, 32, 8));
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
