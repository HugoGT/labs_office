/**
 * Raised wooden floor: a low Japanese-style platform of narrow planks lifted on short legs. The
 * planks echo the wood terrain but are much smaller, in a warmer wood so the platform stands out
 * when it lies on a wood floor. Boards are flat, split by soft seams.
 *
 * Planks run along the long side in both facings, in a running bond whose joints and tones
 * mirror around the center of the boards' run. The planks reach down to a 2-row shaded front face;
 * that face and the legs always sit at the bottom of the image, so the floor shows through between
 * the legs and the platform reads as lifted off the ground.
 */
import { PixelBuffer, type Rgba } from '../../../../src/art/pixelBuffer.ts';
import { hexToRgba, makeRamp, mixRgba, type Ramp } from '../color.ts';
import { createRng, type Rng } from '../random.ts';
import { rugCanvas, rugFootprint, type RugFacing } from './shared.ts';

/** Source wood. The border and legs use its ramp; the boards are painted one tone lighter. */
export const WOOD_RUG_COLOR = '#a5683f';
/** Leg height in pixels under the footprint, not counting its 1px bottom outline. */
export const WOOD_RUG_LEG_HEIGHT = 2;

const RAMP = makeRamp(WOOD_RUG_COLOR);
// One tone lighter (user correction): every board tone moves halfway to the tone above it.
const BOARDS: Ramp = {
  outline: RAMP.outline,
  deep: mixRgba(RAMP.deep, RAMP.shadow, 0.5),
  shadow: mixRgba(RAMP.shadow, RAMP.base, 0.5),
  base: mixRgba(RAMP.base, RAMP.light, 0.5),
  light: mixRgba(RAMP.light, hexToRgba('#f6e6cc'), 0.35),
};
const BORDER = RAMP.deep;
const LEG_LIT = RAMP.shadow;
const LEG = mixRgba(RAMP.shadow, RAMP.deep, 0.6);
// Soft seams (user correction): a little darker than the boards, not a dark groove.
const SEAM = mixRgba(BOARDS.base, BOARDS.shadow, 0.3);
// Flat boards (user correction): no darker variants that read as shadow, only a faint lighter one.
const PLANK_TONES: readonly Rgba[] = [BOARDS.base, mixRgba(BOARDS.base, BOARDS.light, 0.12)];
// The front face keeps the original wood the legs are drawn in, as first approved.
const FACE = RAMP.shadow;
const FACE_LOW = mixRgba(RAMP.shadow, RAMP.deep, 0.5);

/** Plank pitch across the boards: two board rows and a seam. The wood terrain uses 4px rows. */
const PLANK_PITCH = 3;
/** Plank length along the boards, joint included. */
const PLANK_LENGTH = 16;
/** Rows of the shaded front face between the last planks and the bottom border. */
const FACE_ROWS = 2;
/** Leg width including its 1px outline on both sides. */
const LEG_WIDTH = 5;
const LEG_INSET = 3;
const SEEDS: Readonly<Record<RugFacing, number>> = { horizontal: 4417, vertical: 4423 };

function randomInt(rng: Rng, max: number): number {
  return Math.floor(rng() * max);
}

/** Leg spans under the footprint's bottom edge, outline included, left to right. */
export function woodRugLegs(facing: RugFacing): ReadonlyArray<{ readonly x: number; readonly width: number }> {
  const { width } = rugFootprint(facing);
  const count = Math.max(2, Math.round(width / 32) + 1);
  const first = LEG_INSET;
  const last = width - LEG_INSET - LEG_WIDTH;
  return Array.from({ length: count }, (_, i) => ({ x: Math.round(first + ((last - first) * i) / (count - 1)), width: LEG_WIDTH }));
}

/**
 * Joints of one lane in the first half of [first, last], ascending; the second half mirrors them.
 * Even lanes put a plank on the center, odd lanes a double-length board, so the bond alternates.
 */
function laneJoints(first: number, last: number, lane: number): number[] {
  const axis = (first + last) / 2;
  const joints: number[] = [];
  for (let p = Math.floor(axis - (lane % 2 === 0 ? PLANK_LENGTH / 2 : PLANK_LENGTH)); p > first; p -= PLANK_LENGTH) joints.push(p);
  return joints.reverse();
}

/**
 * Paints one lane of flat boards over [first, last] along them: `offset` 0 and 1 are the board,
 * 2 the seam to the next lane. The first half is drawn and mirrored, so joints and tones are
 * symmetric around the center.
 */
function paintLane(rng: Rng, first: number, last: number, lane: number, put: (along: number, offset: number, color: Rgba) => void): void {
  const half = Math.floor((first + last) / 2);
  const both = (along: number, offset: number, color: Rgba): void => {
    put(along, offset, color);
    put(first + last - along, offset, color);
  };
  let start = first;
  for (const joint of [...laneJoints(first, last, lane), undefined]) {
    const end = joint === undefined ? first + last - start : joint - 1;
    const tone = PLANK_TONES[randomInt(rng, PLANK_TONES.length)] as Rgba;
    for (let a = start; a <= Math.min(end, half); a += 1) {
      both(a, 0, tone);
      both(a, 1, tone);
    }
    if (joint !== undefined) {
      both(joint, 0, SEAM);
      both(joint, 1, SEAM);
      start = joint + 1;
    }
  }
  for (let a = first; a <= last; a += 1) put(a, 2, SEAM);
}

/** The raised wooden floor for one facing, drawn natively so legs and light point down. */
export function woodRug(facing: RugFacing): PixelBuffer {
  const { width, height } = rugFootprint(facing);
  const rug = rugCanvas(facing);
  const rng = createRng(SEEDS[facing]);
  const surfaceLast = height - 2 - FACE_ROWS;
  const inside = (x: number, y: number): boolean => x >= 1 && x <= width - 2 && y >= 1 && y <= surfaceLast;
  const paint = (x: number, y: number, color: Rgba): void => {
    if (inside(x, y)) rug.setPixel(x, y, color);
  };

  if (facing === 'horizontal') {
    for (let lane = 0; lane * PLANK_PITCH < surfaceLast; lane += 1) {
      paintLane(rng, 1, width - 2, lane, (along, offset, color) => paint(along, 1 + lane * PLANK_PITCH + offset, color));
    }
  } else {
    for (let lane = 0; lane * PLANK_PITCH < width - 2; lane += 1) {
      paintLane(rng, 1, surfaceLast, lane, (along, offset, color) => paint(1 + lane * PLANK_PITCH + offset, along, color));
    }
  }

  // The shaded front face under the last boards. Vertical boards show their ends on it, so the
  // upper face row is split at every board seam.
  for (let x = 1; x < width - 1; x += 1) {
    const seam = facing === 'vertical' && x % PLANK_PITCH === 0;
    rug.setPixel(x, surfaceLast + 1, seam ? FACE_LOW : FACE);
    rug.setPixel(x, surfaceLast + 2, FACE_LOW);
  }

  for (let x = 0; x < width; x += 1) {
    rug.setPixel(x, 0, BORDER);
    rug.setPixel(x, height - 1, BORDER);
  }
  for (let y = 0; y < height; y += 1) {
    rug.setPixel(0, y, BORDER);
    rug.setPixel(width - 1, y, BORDER);
  }

  for (const leg of woodRugLegs(facing)) {
    for (let y = height; y < height + WOOD_RUG_LEG_HEIGHT; y += 1) {
      rug.setPixel(leg.x, y, BORDER);
      for (let x = leg.x + 1; x < leg.x + leg.width - 1; x += 1) rug.setPixel(x, y, x === leg.x + 1 ? LEG_LIT : LEG);
      rug.setPixel(leg.x + leg.width - 1, y, BORDER);
    }
    rug.fillRect(leg.x, height + WOOD_RUG_LEG_HEIGHT, leg.width, 1, BORDER);
  }
  return rug;
}
