/**
 * Wall columns drawn in code for the four materials. A wall stands on a whole tile and reads as a
 * column three tiles tall seen from the front: a near-black top band (`WALL.topHeight`) over the
 * material's face. The face repeats every `WALL_VARIANTS` tiles across (`PERIOD`), so walls side by
 * side read as one surface and a pattern can hold pieces longer than a tile allows. It is cut into
 * the 32x32 frames of `WALL_FRAMES`, one row of them per variant: the crown (top band plus the
 * face's first rows), the face and the base, whose last row is the outline against the floor. The
 * cap frame is all top band, for the upper tiles of a vertical run; the `End` frames close the
 * right edge of the last wall of a horizontal run.
 */
import { hexToRgba, makeRamp, mixRgba, type Ramp } from './color.ts';
import { PixelBuffer, rgba, type Rgba } from '../../../src/art/pixelBuffer.ts';
import { createRng, type Rng } from './random.ts';
import { ART_TILE, WALL, WALL_FRAMES, WALL_TOP_COLOR, WALL_VARIANTS, type WallFrame } from '../../../src/game/artContract.ts';
import type { WallMaterial } from './wallMap.ts';

const WIDTH = ART_TILE;
/** Width of a whole face pattern: it repeats every `WALL_VARIANTS` tiles. */
const PERIOD = WIDTH * WALL_VARIANTS;
export const FACE_HEIGHT = WALL.heightTiles * ART_TILE - WALL.topHeight;
const TOP = hexToRgba(WALL_TOP_COLOR);

function randomInt(rng: Rng, max: number): number {
  return Math.floor(rng() * max);
}

function wrap(value: number): number {
  return ((value % PERIOD) + PERIOD) % PERIOD;
}

function fill(image: PixelBuffer, color: Rgba): void {
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) image.setPixel(x, y, color);
}

function rect(image: PixelBuffer, left: number, top: number, width: number, height: number, color: Rgba): void {
  for (let y = top; y < top + height; y += 1) for (let x = left; x < left + width; x += 1) image.setPixel(wrap(x), y, color);
}

function sameColor(a: Rgba, b: Rgba): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

// --- Brick -------------------------------------------------------------------------------------

const BRICK = makeRamp('#b5563f');
const BRICK_TONES = ['#b5563f', '#aa4f3b', '#bd5f45'].map((hex) => makeRamp(hex).base);
const MORTAR = makeRamp('#d9c7ad');
const BRICK_LENGTH = 16;
/** Six rows of brick over one of mortar. */
const COURSE = 7;

/**
 * Red bricks in running bond, every other course offset half a brick. Courses are laid from the
 * floor up, so a mortar row sits over the outline and the top course is the one the dark band trims.
 */
function brickFace(rng: Rng): PixelBuffer {
  const face = new PixelBuffer(PERIOD, FACE_HEIGHT);
  fill(face, MORTAR.base);
  for (let joint = FACE_HEIGHT - 2, course = 0; joint > 0; joint -= COURSE, course += 1) {
    const top = Math.max(0, joint - (COURSE - 1));
    const height = joint - top;
    const offset = course % 2 === 0 ? 0 : BRICK_LENGTH / 2;
    for (let start = offset; start < offset + PERIOD; start += BRICK_LENGTH) {
      const tone = BRICK_TONES[randomInt(rng, BRICK_TONES.length)] as Rgba;
      rect(face, start + 1, top, BRICK_LENGTH - 1, height, tone);
      face.setPixel(wrap(start + 1), top, mixRgba(tone, BRICK.light, 0.35));
    }
  }
  return face;
}

// --- Stone -------------------------------------------------------------------------------------

const STONE = makeRamp('#9b9a9f');
/** Courses of stone: one fewer than brick, so each is a little taller. */
const STONE_COURSES = 10;
const STONE_MIN = 16;
const STONE_MAX = 20;

/**
 * How each course of stone starts. `scattered`: at a random offset (kept to compare, drawn with
 * seed 29). `halfBond`: courses 0, 2, 4... (from the top) start with a whole block at
 * the tile edge, the others with the second half of their first block, its first half closing the
 * pattern at the far end.
 */
type StonePattern = 'scattered' | 'halfBond';
const STONE_PATTERN = 'halfBond' as StonePattern;

/** Stones of the top courses drawn a tone darker, picked with their own seed so the pattern stays put. */
const STONE_ACCENT_COURSES = 3;
const STONE_ACCENTS = 2;
const STONE_ACCENT_SEED = 7;

/**
 * The `course * 100 + index` keys of the stones drawn darker: `STONE_ACCENTS` at random among the
 * top courses, then one more in each of those courses the draw left without one.
 */
function stoneAccents(): Set<number> {
  const rng = createRng(STONE_ACCENT_SEED);
  const blocks = Math.ceil(PERIOD / STONE_MAX);
  const picked = new Set<number>();
  while (picked.size < STONE_ACCENTS) picked.add(randomInt(rng, STONE_ACCENT_COURSES) * 100 + randomInt(rng, blocks));
  for (let course = 0; course < STONE_ACCENT_COURSES; course += 1) {
    if (![...picked].some((key) => Math.floor(key / 100) === course)) picked.add(course * 100 + randomInt(rng, blocks));
  }
  return picked;
}

/**
 * Block lengths between STONE_MIN and STONE_MAX adding up to the pattern width: as few blocks as
 * fit, each starting at STONE_MIN and grown one pixel at a time at random until they fill it.
 */
function stoneLengths(rng: Rng): number[] {
  const lengths = new Array<number>(Math.ceil(PERIOD / STONE_MAX)).fill(STONE_MIN);
  for (let extra = PERIOD - lengths.length * STONE_MIN; extra > 0; extra -= 1) {
    const growable = lengths.flatMap((length, index) => (length < STONE_MAX ? [index] : []));
    const index = growable[randomInt(rng, growable.length)] as number;
    lengths[index] = (lengths[index] as number) + 1;
  }
  return lengths;
}

/**
 * Grey blocks of random length in courses, each with its own tone, a lit top and left edge and
 * dark joints. The last course sits right on the outline; the rows are shared out evenly, so
 * courses differ by one row at most.
 */
function stoneFace(rng: Rng): PixelBuffer {
  const face = new PixelBuffer(PERIOD, FACE_HEIGHT);
  fill(face, STONE.shadow);
  const blockRows = FACE_HEIGHT - 1 - (STONE_COURSES - 1);
  const blocks: { course: number; index: number; x: number; length: number; top: number; bottom: number; tone: Rgba }[] = [];
  for (let course = 0, top = 0; course < STONE_COURSES; course += 1) {
    const height = Math.floor(((course + 1) * blockRows) / STONE_COURSES) - Math.floor((course * blockRows) / STONE_COURSES);
    const bottom = top + height - 1;
    // The scattered offset is drawn before the lengths, the order its saved pattern was made in.
    const scattered = STONE_PATTERN === 'scattered' ? randomInt(rng, PERIOD) : 0;
    const lengths = stoneLengths(rng);
    let x = STONE_PATTERN === 'scattered' ? scattered : course % 2 === 0 ? 0 : -Math.floor((lengths[0] as number) / 2);
    for (const [index, length] of lengths.entries()) {
      blocks.push({ course, index, x, length, top, bottom, tone: mixRgba(STONE.base, rng() < 0.5 ? STONE.light : STONE.shadow, rng() * 0.3) });
      x += length;
    }
    top = bottom + 2;
  }
  // The darker stones of the top courses take the darkest tone of the courses below, so they
  // never read darker than any other stone of the wall.
  const accents = stoneAccents();
  const darkest = blocks
    .filter(({ course }) => course >= STONE_ACCENT_COURSES)
    .reduce((dark, { tone }) => (luma(tone) < luma(dark) ? tone : dark), STONE.base);
  for (const { course, index, x, length, top, bottom, tone } of blocks) {
    const fill = accents.has(course * 100 + index) ? darkest : tone;
    const edge = mixRgba(fill, STONE.light, 0.45);
    for (let y = top; y <= bottom; y += 1) {
      for (let dx = 1; dx < length; dx += 1) face.setPixel(wrap(x + dx), y, y === top || dx === 1 ? edge : fill);
    }
  }
  return face;
}

function luma({ r, g, b }: Rgba): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// --- Plaster -----------------------------------------------------------------------------------

const PLASTER = makeRamp('#e6dfd2');
const PLASTER_SPECK = mixRgba(PLASTER.base, PLASTER.shadow, 0.4);
const SKIRTING = makeRamp('#b9ad99');
const SKIRTING_HEIGHT = 6;

/** Smooth plaster with a few specks and a skirting board along the floor. */
function plasterFace(rng: Rng): PixelBuffer {
  const face = new PixelBuffer(PERIOD, FACE_HEIGHT);
  fill(face, PLASTER.base);
  for (let i = 0; i < 40 * WALL_VARIANTS; i += 1) face.setPixel(randomInt(rng, PERIOD), randomInt(rng, FACE_HEIGHT - SKIRTING_HEIGHT), PLASTER_SPECK);
  rect(face, 0, FACE_HEIGHT - SKIRTING_HEIGHT, PERIOD, SKIRTING_HEIGHT, SKIRTING.base);
  rect(face, 0, FACE_HEIGHT - SKIRTING_HEIGHT, PERIOD, 1, SKIRTING.light);
  return face;
}

// --- Glass -------------------------------------------------------------------------------------

const FRAME = makeRamp('#8e9aa6');
const GLASS = rgba(168, 214, 240, 110);
const GLARE = rgba(240, 250, 255, 170);
const GLARE_PERIOD = 16;
const SILL = 4;

/** Translucent panes with diagonal glare, a frame along top and bottom and a mullion every tile. */
function glassFace(): PixelBuffer {
  const face = new PixelBuffer(PERIOD, FACE_HEIGHT);
  for (let y = 0; y < FACE_HEIGHT; y += 1) {
    for (let x = 0; x < PERIOD; x += 1) {
      const phase = (x + y) % GLARE_PERIOD;
      face.setPixel(x, y, phase < 2 || phase === 5 ? GLARE : GLASS);
    }
  }
  rect(face, 0, 0, PERIOD, 2, FRAME.base);
  rect(face, 0, FACE_HEIGHT - SILL, PERIOD, SILL, FRAME.base);
  rect(face, 0, FACE_HEIGHT - SILL, PERIOD, 1, FRAME.light);
  for (let y = 0; y < FACE_HEIGHT; y += 1) {
    for (let x = 0; x < PERIOD; x += WIDTH) {
      face.setPixel(x, y, FRAME.light);
      face.setPixel(x + 1, y, FRAME.shadow);
    }
  }
  return face;
}

// --- Columns -----------------------------------------------------------------------------------

interface FaceStyle {
  readonly ramp: Ramp;
  readonly paint: (rng: Rng) => PixelBuffer;
  /**
   * The joint the last wall of a run repeats on its right edge wherever its left edge has one, so
   * a lone wall reads framed on both sides. Walls in the middle of a run leave it out: the next
   * wall's left joint is already there.
   */
  readonly endJoint?: Rgba;
  /** The random pattern this material is drawn with, when not the default one. */
  readonly seed?: number;
}

const FACES: Readonly<Record<WallMaterial, FaceStyle>> = {
  brick: { ramp: BRICK, paint: brickFace, endJoint: MORTAR.base },
  stone: { ramp: STONE, paint: stoneFace, seed: 29 },
  plaster: { ramp: SKIRTING, paint: plasterFace },
  glass: { ramp: FRAME, paint: glassFace },
};

/**
 * The face of a wall, `FACE_HEIGHT` tall and `PERIOD` wide, with its outline row against the
 * floor. The outline uses the ramp's deep tone, not its near-black outline, so it does not read
 * as the top band.
 */
export function wallFace(material: WallMaterial, seed = FACES[material].seed ?? 13): PixelBuffer {
  const { ramp, paint } = FACES[material];
  const face = paint(createRng(seed));
  rect(face, 0, FACE_HEIGHT - 1, PERIOD, 1, ramp.deep);
  return face;
}

/** The whole column, top band and face, `WALL.heightTiles` tiles tall and `PERIOD` wide. */
export function wallColumn(material: WallMaterial, seed?: number): PixelBuffer {
  const column = new PixelBuffer(PERIOD, WALL.heightTiles * ART_TILE);
  rect(column, 0, 0, PERIOD, WALL.topHeight, TOP);
  const face = wallFace(material, seed);
  for (let y = 0; y < FACE_HEIGHT; y += 1) for (let x = 0; x < PERIOD; x += 1) column.setPixel(x, WALL.topHeight + y, face.getPixel(x, y));
  return column;
}

/** One 32x32 frame of the sheet: the cap, or a tile of the column for wall variant `variant`. */
export function wallFrame(material: WallMaterial, frame: WallFrame, variant = 0, seed?: number): PixelBuffer {
  const out = new PixelBuffer(WIDTH, ART_TILE);
  if (frame === 'cap') {
    fill(out, TOP);
    return out;
  }
  const end = frame.endsWith('End');
  const tile = (end ? frame.slice(0, -'End'.length) : frame) as WallFrame;
  const column = wallColumn(material, seed);
  const row = WALL_FRAMES[tile] - WALL_FRAMES.crown;
  for (let y = 0; y < ART_TILE; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) out.setPixel(x, y, column.getPixel(variant * WIDTH + x, row * ART_TILE + y));
  }
  const joint = FACES[material].endJoint;
  if (end && joint !== undefined) {
    for (let y = 0; y < ART_TILE; y += 1) if (sameColor(out.getPixel(0, y), joint)) out.setPixel(WIDTH - 1, y, joint);
  }
  return out;
}
