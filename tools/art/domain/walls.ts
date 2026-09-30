/**
 * Wall sprites drawn in code, seen from above like the floor, for the four materials. A wall is
 * built from two kinds of piece that never overlap: a 16x16 body between two vertices of the 32px
 * grid, and a 16x16 joint centered on each vertex, shaped by the sides it connects to.
 *
 * Every material paints a strip one wall long (vertex to vertex) whose pattern repeats seamlessly.
 * Bodies sample it 8px in from each vertex; straight joints and end caps sample the 16px around the
 * vertex, so consecutive walls read as one continuous surface. Brick and stone corners, tees and
 * crosses sample it too, along the wall that runs through the joint, so the walls that butt into
 * it end on a mortar joint; plaster and glass get a texture of their own (a seam that turns, open
 * glass).
 *
 * Outline and bevel are derived from the shape the piece belongs to, not from its own box: the
 * dark outline, exactly 1px, only runs where the wall meets the outside, never across the
 * interface with the neighboring piece, and the ring just inside it is lit on its top/left side.
 */
import { makeRamp, mixRgba, type Ramp } from './color.ts';
import { PixelBuffer, rgba, type Rgba } from './pixelBuffer.ts';
import { createRng, type Rng } from './random.ts';
import {
  BODY_LENGTH,
  classifyJoint,
  connects,
  HALF_THICKNESS,
  JOINT_SIZE,
  SEGMENT_LENGTH,
  WALL_THICKNESS,
  type ConnectionMask,
} from './wallGeometry.ts';
import type { WallAxis, WallMaterial } from './wallMap.ts';

const LAST = WALL_THICKNESS - 1;

export const RIM_INSIDE = 0;
export const RIM_OUTLINE = 1;
export const RIM_RING = 2;

/**
 * A sprite plus, for each pixel, whether it is outline, the ring just inside it, or further in,
 * so a renderer can keep both one screen pixel wide at any scale.
 */
export interface WallSprite {
  readonly image: PixelBuffer;
  readonly rim: Uint8Array;
}

function randomInt(rng: Rng, max: number): number {
  return Math.floor(rng() * max);
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function sameColor(a: Rgba, b: Rgba): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function blank(width: number, height: number, color: Rgba): PixelBuffer {
  const image = new PixelBuffer(width, height);
  image.fillRect(0, 0, width, height, color);
  return image;
}

function transposed(image: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(image.height, image.width);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) out.setPixel(y, x, image.getPixel(x, y));
  }
  return out;
}

// --- Brick -------------------------------------------------------------------------------------

const BRICK = makeRamp('#b5563f');
const BRICK_TONES = ['#b5563f', '#aa4f3b', '#bd5f45'].map((hex) => makeRamp(hex).base);
const MORTAR = makeRamp('#d9c7ad');
/**
 * One brick plus its mortar joint. It divides both the body and the whole wall, so a course whose
 * joint lies on the body/joint interface fits whole bricks, and the other course, offset by half a
 * brick, is cut exactly in half there.
 */
const BRICK_LENGTH = JOINT_SIZE;
const BRICK_COURSES = [
  { top: 1, bottom: 7, offset: HALF_THICKNESS },
  { top: 9, bottom: 14, offset: 0 },
] as const;

function paintBrick(image: PixelBuffer, rng: Rng, left: number, top: number, right: number, bottom: number): void {
  const tone = BRICK_TONES[randomInt(rng, BRICK_TONES.length)] as Rgba;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) image.setPixel(wrap(x, image.width), y, tone);
  }
  image.setPixel(wrap(left, image.width), top, mixRgba(tone, BRICK.light, 0.35));
  image.setPixel(wrap(left + 1 + randomInt(rng, right - left - 1), image.width), top + 1 + randomInt(rng, bottom - top - 1), BRICK.shadow);
}

/**
 * Two courses of red bricks in running bond with cream mortar joints. The outer course has a joint
 * on each body/joint interface, so a joint holds one whole brick; the inner course has a joint on
 * the vertex, so a joint holds two half bricks and each body starts and ends with a half brick.
 */
function brickStrip(rng: Rng): PixelBuffer {
  const strip = blank(SEGMENT_LENGTH, WALL_THICKNESS, MORTAR.base);
  for (const { top, bottom, offset } of BRICK_COURSES) {
    for (let start = offset; start < offset + SEGMENT_LENGTH; start += BRICK_LENGTH) {
      paintBrick(strip, rng, start + 1, top, start + BRICK_LENGTH - 1, bottom);
    }
  }
  return strip;
}

// --- Stone -------------------------------------------------------------------------------------

const STONE = makeRamp('#9b9a9f');
/** A course's joint line runs along its `top` row; the outer one sits under the outline. */
const STONE_COURSES = [
  { top: 0, bottom: 7 },
  { top: 8, bottom: 14 },
] as const;
const STONE_MIN = 10;
const STONE_MAX = 20;

function paintStone(image: PixelBuffer, rng: Rng, start: number, length: number, top: number, bottom: number): void {
  const tone = mixRgba(STONE.base, rng() < 0.5 ? STONE.light : STONE.shadow, rng() * 0.3);
  const edge = mixRgba(tone, STONE.light, 0.45);
  for (let y = top + 1; y <= bottom; y += 1) {
    for (let x = start + 1; x < start + length; x += 1) image.setPixel(wrap(x, image.width), y, y === top + 1 || x === start + 1 ? edge : tone);
  }
  image.setPixel(wrap(start + 2 + randomInt(rng, length - 3), image.width), top + 2 + randomInt(rng, bottom - top - 1), STONE.shadow);
}

/**
 * Block lengths between STONE_MIN and STONE_MAX that add up to exactly `total`. On the 32px grid the
 * inner course has no room left between its two half blocks, so `total` can be 0: no block at all,
 * instead of a zero-length one whose chip would land on its neighbor.
 */
function stoneLengths(rng: Rng, total: number): number[] {
  if (total <= 0) return [];
  const lengths: number[] = [];
  let remaining = total;
  while (remaining > STONE_MAX) {
    const length = Math.min(STONE_MIN + randomInt(rng, STONE_MAX - STONE_MIN + 1), remaining - STONE_MIN);
    lengths.push(length);
    remaining -= length;
  }
  return [...lengths, remaining];
}

/**
 * Irregular grey blocks in two courses, each with its own tone, a lit top-left and dark joints.
 * Like the bricks, the outer course has a joint on each body/joint interface, with one whole block
 * in the joint, and the inner course has a joint on the vertex, with a block cut in half by each
 * interface; only the blocks inside the body vary in length.
 */
function stoneStrip(rng: Rng): PixelBuffer {
  const strip = blank(SEGMENT_LENGTH, WALL_THICKNESS, STONE.shadow);
  const [outer, inner] = STONE_COURSES;
  const courses = [
    { ...outer, start: HALF_THICKNESS, lengths: [...stoneLengths(rng, BODY_LENGTH), JOINT_SIZE] },
    { ...inner, start: 0, lengths: [JOINT_SIZE, ...stoneLengths(rng, BODY_LENGTH - JOINT_SIZE), JOINT_SIZE] },
  ];
  for (const { top, bottom, start, lengths } of courses) {
    let x = start;
    for (const length of lengths) {
      paintStone(strip, rng, x, length, top, bottom);
      x += length;
    }
  }
  return strip;
}

// --- Plaster -----------------------------------------------------------------------------------

const PLASTER = makeRamp('#e6dfd2');
const PLASTER_SPECK = mixRgba(PLASTER.base, PLASTER.shadow, 0.4);
const SEAM_LIGHT = mixRgba(PLASTER.base, PLASTER.light, 0.6);
const SEAM_SHADE = mixRgba(PLASTER.base, PLASTER.shadow, 0.5);
const SEAM = HALF_THICKNESS - 1;

/** Painted office partition: cream cap with a board seam down the middle and faint speckles. */
function plasterStrip(rng: Rng): PixelBuffer {
  const strip = blank(SEGMENT_LENGTH, WALL_THICKNESS, PLASTER.base);
  for (let x = 0; x < SEGMENT_LENGTH; x += 1) {
    strip.setPixel(x, SEAM, SEAM_LIGHT);
    strip.setPixel(x, SEAM + 1, SEAM_SHADE);
  }
  // 26 speckles per 96px of wall, the density the art was drawn with.
  for (let i = 0; i < Math.round((26 * SEGMENT_LENGTH) / 96); i += 1) strip.setPixel(randomInt(rng, SEGMENT_LENGTH), 2 + randomInt(rng, 11), PLASTER_SPECK);
  return strip;
}

/** Where walls turn or meet, the seam runs from the center toward every connected side. */
function plasterJunction(rng: Rng, mask: ConnectionMask): PixelBuffer {
  const joint = blank(JOINT_SIZE, JOINT_SIZE, PLASTER.base);
  for (let i = 0; i < 3; i += 1) joint.setPixel(2 + randomInt(rng, 12), 2 + randomInt(rng, 12), PLASTER_SPECK);
  const across = connects(mask, 'west') || connects(mask, 'east');
  const along = connects(mask, 'north') || connects(mask, 'south');
  const first = connects(mask, 'west') ? 0 : SEAM;
  const last = connects(mask, 'east') ? LAST : SEAM + 1;
  const top = connects(mask, 'north') ? 0 : SEAM;
  const bottom = connects(mask, 'south') ? LAST : SEAM + 1;
  // Light first, so the shaded side of each seam wins where the two cross.
  for (const [line, color] of [
    [SEAM, SEAM_LIGHT],
    [SEAM + 1, SEAM_SHADE],
  ] as const) {
    if (across) for (let x = first; x <= last; x += 1) joint.setPixel(x, line, color);
    if (along) for (let y = top; y <= bottom; y += 1) joint.setPixel(line, y, color);
  }
  return joint;
}

// --- Glass -------------------------------------------------------------------------------------

const FRAME = makeRamp('#8e9aa6');
const GLASS = rgba(168, 214, 240, 110);
const GLARE = rgba(240, 250, 255, 170);
/** Divides the 32px wall length, so the glare continues from one wall into the next. */
const GLARE_PERIOD = 16;

/** Diagonal glare stripes; `u + v` is the same for a pixel whether read along or across the wall. */
function isGlare(sum: number): boolean {
  const phase = wrap(sum, GLARE_PERIOD);
  return phase < 2 || phase === 5;
}

function paintMullion(image: PixelBuffer, x: number): void {
  for (let y = 0; y < WALL_THICKNESS; y += 1) {
    image.setPixel(x - 1, y, FRAME.light);
    image.setPixel(x, y, FRAME.shadow);
  }
}

/** Glass partition: translucent panes with diagonal glare and a mullion in the middle of each wall. */
function glassStrip(): PixelBuffer {
  const strip = blank(SEGMENT_LENGTH, WALL_THICKNESS, GLASS);
  for (let y = 0; y < WALL_THICKNESS; y += 1) {
    for (let x = 0; x < SEGMENT_LENGTH; x += 1) if (isGlare(x + y)) strip.setPixel(x, y, GLARE);
  }
  paintMullion(strip, SEGMENT_LENGTH / 2);
  return strip;
}

/** Where glass walls turn or meet, the pane simply continues; the frame follows the outline. */
function glassJunction(): PixelBuffer {
  const joint = blank(JOINT_SIZE, JOINT_SIZE, GLASS);
  for (let y = 0; y < JOINT_SIZE; y += 1) {
    for (let x = 0; x < JOINT_SIZE; x += 1) if (isGlare(x + y - HALF_THICKNESS)) joint.setPixel(x, y, GLARE);
  }
  return joint;
}

// --- Materials ---------------------------------------------------------------------------------

interface Material {
  readonly ramp: Ramp;
  /** Glass has no material under its rim, so the ring inside its outline is an opaque frame. */
  readonly frame: boolean;
  readonly strip: (rng: Rng) => PixelBuffer;
  /** Texture of a corner, tee or cross joint; without one, the joint samples the strip. */
  readonly junction?: (rng: Rng, mask: ConnectionMask) => PixelBuffer;
  /** Adds what a straight joint shows on top of the strip, like a glass mullion on the vertex. */
  readonly straight?: (joint: PixelBuffer) => void;
}

const MATERIALS: Readonly<Record<WallMaterial, Material>> = {
  brick: { ramp: BRICK, frame: false, strip: brickStrip },
  stone: { ramp: STONE, frame: false, strip: stoneStrip },
  plaster: { ramp: PLASTER, frame: false, strip: plasterStrip, junction: plasterJunction },
  glass: { ramp: FRAME, frame: true, strip: glassStrip, junction: glassJunction, straight: (joint) => paintMullion(joint, HALF_THICKNESS) },
};

export function wallOutline(material: WallMaterial): Rgba {
  return MATERIALS[material].ramp.outline;
}

/** Local shape a piece is part of: its own box plus the walls that continue past its connected sides. */
type Shape = (x: number, y: number) => boolean;

const inBand = (value: number): boolean => value >= 0 && value < WALL_THICKNESS;

function bodyShape(axis: WallAxis): Shape {
  return axis === 'horizontal' ? (_x, y) => inBand(y) : (x) => inBand(x);
}

function jointShape(mask: ConnectionMask): Shape {
  return (x, y) =>
    (inBand(x) && inBand(y)) ||
    (inBand(x) && ((y < 0 && connects(mask, 'north')) || (y >= JOINT_SIZE && connects(mask, 'south')))) ||
    (inBand(y) && ((x < 0 && connects(mask, 'west')) || (x >= JOINT_SIZE && connects(mask, 'east'))));
}

const AROUND = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/**
 * Outline and bevel from the shape: a pixel is outline when one of its 8 neighbors lies outside
 * the wall, and ring when it is not outline but touches it. Ring pixels just below or right of the
 * outline are lit; the others keep their color (darkening them would read as a 2px outline), and
 * a dark detail on the ring is lightened for the same reason. Glass turns its whole ring into frame.
 */
function finish(texture: PixelBuffer, shape: Shape, material: Material): WallSprite {
  const outlineAt = (x: number, y: number): boolean => shape(x, y) && AROUND.some(([ox, oy]) => !shape(x + ox, y + oy));
  const rim = new Uint8Array(texture.width * texture.height);
  const image = new PixelBuffer(texture.width, texture.height, texture.data.slice());
  const { ramp, frame } = material;
  for (let y = 0; y < texture.height; y += 1) {
    for (let x = 0; x < texture.width; x += 1) {
      if (outlineAt(x, y)) {
        image.setPixel(x, y, ramp.outline);
        rim[y * texture.width + x] = RIM_OUTLINE;
        continue;
      }
      if (!AROUND.some(([ox, oy]) => outlineAt(x + ox, y + oy))) continue;
      rim[y * texture.width + x] = RIM_RING;
      const lit = outlineAt(x, y - 1) || outlineAt(x - 1, y);
      const color = texture.getPixel(x, y);
      if (frame) image.setPixel(x, y, lit ? ramp.light : ramp.base);
      else if (lit) image.setPixel(x, y, mixRgba(sameColor(color, ramp.shadow) ? ramp.base : color, ramp.light, 0.5));
      else if (sameColor(color, ramp.shadow)) image.setPixel(x, y, ramp.base);
    }
  }
  return { image, rim };
}

/** Columns `from` to `from + width` of a strip, where column 0 is the first vertex, wrapping around. */
function sampleStrip(strip: PixelBuffer, from: number, width: number): PixelBuffer {
  const out = new PixelBuffer(width, WALL_THICKNESS);
  for (let y = 0; y < WALL_THICKNESS; y += 1) {
    for (let x = 0; x < width; x += 1) out.setPixel(x, y, strip.getPixel(wrap(from + x, strip.width), y));
  }
  return out;
}

/**
 * A wall that butts into the south or east side of a joint starts its outer course with a joint
 * line of its own (bodies start on one and end on a brick), so the joint's edge line there would
 * read 2px wide: the joint's brick or block next to it extends over it instead. On the north and
 * west sides, and along the inner course everywhere, the joint's edge line is the only one.
 */
function buttJoints(joint: PixelBuffer, mask: ConnectionMask, through: boolean, detail: Rgba): void {
  if (!connects(mask, through ? 'south' : 'east')) return;
  const at = (i: number, depth: number): Rgba => (through ? joint.getPixel(i, LAST - depth) : joint.getPixel(LAST - depth, i));
  for (let i = 1; i < HALF_THICKNESS; i += 1) {
    // A dark chip copied onto the edge would double up, so the pixel past it is used instead.
    const color = sameColor(at(i, 1), detail) ? at(i, 2) : at(i, 1);
    if (through) joint.setPixel(i, LAST, color);
    else joint.setPixel(LAST, i, color);
  }
}

interface MaterialSprites {
  readonly bodies: Readonly<Record<WallAxis, WallSprite>>;
  readonly joints: ReadonlyMap<ConnectionMask, WallSprite>;
}

function jointTexture(material: Material, strip: PixelBuffer, mask: ConnectionMask, seed: number): PixelBuffer {
  const kind = classifyJoint(mask);
  if (!kind) throw new Error('A vertex with no walls has no joint');
  const straight = kind.shape === 'straight' || kind.shape === 'end';
  if (!straight && material.junction) return material.junction(createRng(seed + mask), mask);
  const texture = sampleStrip(strip, -HALF_THICKNESS, JOINT_SIZE);
  if (kind.shape === 'straight') material.straight?.(texture);
  // The wall that runs through: the one with both sides connected, else the horizontal one.
  const horizontal = connects(mask, 'east') && connects(mask, 'west');
  const vertical = connects(mask, 'north') && connects(mask, 'south');
  const through = horizontal || (!vertical && (connects(mask, 'east') || connects(mask, 'west')));
  const oriented = through ? texture : transposed(texture);
  buttJoints(oriented, mask, through, material.ramp.shadow);
  return oriented;
}

function buildSprites(name: WallMaterial, seed: number): MaterialSprites {
  const material = MATERIALS[name];
  const strip = material.strip(createRng(seed));
  const body = sampleStrip(strip, HALF_THICKNESS, BODY_LENGTH);
  const joints = new Map<ConnectionMask, WallSprite>();
  for (let mask = 1; mask <= 0b1111; mask += 1) {
    joints.set(mask, finish(jointTexture(material, strip, mask, seed), jointShape(mask), material));
  }
  return {
    bodies: {
      horizontal: finish(body, bodyShape('horizontal'), material),
      vertical: finish(transposed(body), bodyShape('vertical'), material),
    },
    joints,
  };
}

const cache = new Map<string, MaterialSprites>();

function spritesOf(material: WallMaterial, seed: number): MaterialSprites {
  const key = `${material}:${seed}`;
  const sprites = cache.get(key) ?? buildSprites(material, seed);
  cache.set(key, sprites);
  return sprites;
}

/** The body of one wall: BODY_LENGTH x 16 when horizontal, 16 x BODY_LENGTH when vertical. */
export function bodySprite(material: WallMaterial, axis: WallAxis, seed = 13): WallSprite {
  return spritesOf(material, seed).bodies[axis];
}

/** The 16x16 joint for a vertex whose walls leave toward the sides in `mask`. */
export function jointSprite(material: WallMaterial, mask: ConnectionMask, seed = 13): WallSprite {
  const sprite = spritesOf(material, seed).joints.get(mask);
  if (!sprite) throw new Error(`No joint for connection mask ${mask}`);
  return sprite;
}

