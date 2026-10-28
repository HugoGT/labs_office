/**
 * Doors drawn in code (#223, #233), seen from above like the walls they stand between: a frame
 * post (jamb) of dark wood at each end of the span, merging with the wall at that end, and
 * between them one wooden plank (single door) or two meeting in the middle (double door). A
 * closed leaf lies along its edge; an open one is swung a quarter turn into the side it opens
 * to, and the steps between (`DOOR_STEPS`) turn it a third of that each, about the hinge. The hinge (dark metal) sits at the outer end of each leaf and the brass handle near the
 * other, so the handles of a double door meet in the middle.
 *
 * Every frame is drawn straight into its `DOOR` cell, the anchor on the middle of the span, with
 * the same light as the rest of the pack (lit top and left faces, 1px ink outline).
 */
import { OUTLINE_INK, OUTLINE_INK_MIX } from '../../../src/game/artColor.ts';
import { ART_TILE, DOOR, DOOR_STEPS, type DoorHinge, type DoorVariant } from '../../../src/game/artContract.ts';
import { makeRamp, mixRgba, type Ramp } from './color.ts';
import { PixelBuffer, rgba, type Rgba } from '../../../src/art/pixelBuffer.ts';

export const DOOR_MATERIALS = ['wood'] as const;
export type DoorMaterial = (typeof DOOR_MATERIALS)[number];

const WOOD: Readonly<Record<DoorMaterial, Ramp>> = { wood: makeRamp('#9a6a3f') };
const CLEAR = rgba(0, 0, 0, 0);
const JAMB = makeRamp('#6e4a2b');
const HINGE = makeRamp('#6b6f78');
/** The handle's brass, exported so a test can find where the handle went. */
export const DOOR_HANDLE: Rgba = makeRamp('#d9b45a').base;

/** Grain breaks every this many pixels along the plank. */
const GRAIN_BREAK = 9;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function ink(color: Rgba): Rgba {
  return mixRgba(rgba(color.r, color.g, color.b), OUTLINE_INK, OUTLINE_INK_MIX.opaque);
}

/** A plank lit on its top and left faces, with one grain line along its length. */
function plank(image: PixelBuffer, box: Box, ramp: Ramp): void {
  const along = box.w >= box.h;
  const grain = along ? box.y + Math.floor(box.h / 2) : box.x + Math.floor(box.w / 2);
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      let tone = ramp.base;
      if (y === box.y + box.h - 1 || x === box.x + box.w - 1) tone = ramp.shadow;
      else if (y === box.y || x === box.x) tone = ramp.light;
      else if ((along ? y : x) === grain && (along ? x - box.x : y - box.y) % GRAIN_BREAK !== GRAIN_BREAK - 1) tone = mixRgba(ramp.base, ramp.shadow, 0.6);
      image.setPixel(x, y, tone);
    }
  }
}

function fill(image: PixelBuffer, box: Box, color: Rgba): void {
  image.fillRect(box.x, box.y, box.w, box.h, color);
}

/** A frame post: flat dark wood, lit on its top and left faces. */
function post(image: PixelBuffer, box: Box, ramp: Ramp): void {
  fill(image, box, ramp.base);
  fill(image, { x: box.x, y: box.y, w: box.w, h: 1 }, ramp.light);
  fill(image, { x: box.x, y: box.y, w: 1, h: box.h }, ramp.light);
  fill(image, { x: box.x, y: box.y + box.h - 1, w: box.w, h: 1 }, ramp.shadow);
  fill(image, { x: box.x + box.w - 1, y: box.y, w: 1, h: box.h }, ramp.shadow);
}

/**
 * A leaf turned `angle` radians about its hinge at (`hx`, `hy`), toward the inside (+1 down, -1
 * up): every pixel whose centre falls in the rotated plank is lit on the face that looks to the
 * top-left, shaded on the other, with a hinge pin at its start and the brass handle near its free
 * end. A leaf hinged at its end is the mirror image of one hinged at its start, computed from the
 * same numbers, so the two leaves of a double door stay exactly symmetric.
 */
function swungLeaf(image: PixelBuffer, hx: number, hy: number, length: number, hingeAtStart: boolean, inside: 1 | -1, angle: number, ramp: Ramp): void {
  const thick = DOOR.leafThickness;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const side = hingeAtStart ? 1 : -1;
  // Which face looks to the top-left: the one whose outward normal points that way.
  const lowFaceLit = -side * sin + inside * cos > 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const a = side * (x + 0.5 - hx);
      const c = inside * (y + 0.5 - hy);
      const u = a * cos + c * sin;
      const v = -a * sin + c * cos;
      if (u < 0 || u >= length || v < -thick / 2 || v >= thick / 2) continue;
      const lowEdge = v < -thick / 2 + 1;
      const highEdge = v >= thick / 2 - 1;
      let tone = ramp.base;
      if (u < 2) tone = HINGE.base;
      else if (lowEdge) tone = lowFaceLit ? ramp.light : ramp.shadow;
      else if (highEdge) tone = lowFaceLit ? ramp.shadow : ramp.light;
      else if (Math.abs(v) < 0.5 && Math.floor(u) % GRAIN_BREAK !== GRAIN_BREAK - 1) tone = mixRgba(ramp.base, ramp.shadow, 0.6);
      image.setPixel(x, y, tone);
      if (u >= length - 6 && u < length - 4 && (lowEdge || highEdge)) image.setPixel(x, y, DOOR_HANDLE);
    }
  }
}

interface Leaf {
  /** Where it starts along the edge, and how long it is. */
  readonly x: number;
  readonly length: number;
  /** The hinge is at its start (west) end, the handle at the other. */
  readonly hingeAtStart: boolean;
}

/**
 * One frame of a door standing on a horizontal edge (rotations 0 and 180), in frame pixels:
 * the span runs along row `ay`, centred on the anchor, with a jamb at each end. `inside` is +1
 * when the door opens down, -1 up; `hinge` is the end a single door's leaf turns about (a double
 * door always hinges its two leaves at the outer ends).
 */
function horizontalDoor(material: DoorMaterial, variant: DoorVariant, inside: 1 | -1, hinge: DoorHinge, step: number): PixelBuffer {
  const image = new PixelBuffer(DOOR.frame.width, DOOR.frame.height);
  const { x: ax, y: ay } = DOOR.anchor;
  const { span, leafLength, jamb } = DOOR.variants[variant];
  const thick = DOOR.leafThickness;
  const left = ax - (span * ART_TILE) / 2;
  const right = ax + (span * ART_TILE) / 2;
  const postThick = thick + 4;
  post(image, { x: left, y: ay - postThick / 2, w: jamb, h: postThick }, JAMB);
  post(image, { x: right - jamb, y: ay - postThick / 2, w: jamb, h: postThick }, JAMB);
  const leaves: Leaf[] =
    variant === 'double'
      ? [
          { x: left + jamb, length: leafLength / 2, hingeAtStart: true },
          { x: ax, length: leafLength / 2, hingeAtStart: false },
        ]
      : [{ x: left + jamb, length: leafLength, hingeAtStart: hinge === 'start' }];
  const open = step === DOOR_STEPS - 1;
  for (const leaf of leaves) {
    const start = leaf.hingeAtStart;
    if (step > 0 && !open) {
      swungLeaf(image, start ? leaf.x : leaf.x + leaf.length, ay, leaf.length, start, inside, (step / (DOOR_STEPS - 1)) * (Math.PI / 2), WOOD[material]);
    } else if (!open) {
      plank(image, { x: leaf.x, y: ay - thick / 2, w: leaf.length, h: thick }, WOOD[material]);
      // The hinge pin at its end, the handle near the other, on both faces of the leaf.
      fill(image, { x: start ? leaf.x : leaf.x + leaf.length - 2, y: ay - thick / 2 - 1, w: 2, h: thick + 2 }, HINGE.base);
      const handleX = start ? leaf.x + leaf.length - 6 : leaf.x + 4;
      fill(image, { x: handleX, y: ay - thick / 2 - 1, w: 2, h: 1 }, DOOR_HANDLE);
      fill(image, { x: handleX, y: ay + thick / 2, w: 2, h: 1 }, DOOR_HANDLE);
    } else {
      // Swung a quarter turn about the hinge into the inside, flush with the frame post.
      const x = start ? leaf.x : leaf.x + leaf.length - thick;
      const reach = leaf.length - 2;
      const y = inside === 1 ? ay + 1 : ay - 1 - reach;
      plank(image, { x, y, w: thick, h: reach }, WOOD[material]);
      fill(image, { x, y: ay - 1, w: thick, h: 2 }, HINGE.base);
      const handleY = inside === 1 ? y + reach - 6 : y + 4;
      fill(image, { x: x - 1, y: handleY, w: 1, h: 2 }, DOOR_HANDLE);
      fill(image, { x: x + thick, y: handleY, w: 1, h: 2 }, DOOR_HANDLE);
    }
  }
  image.addOutline(ink);
  // The span ends against the walls on both sides: no outline past them, nothing over their bodies.
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) if (x < left || x >= right) image.setPixel(x, y, CLEAR);
  }
  return image;
}

function transposed(image: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(image.height, image.width);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) out.setPixel(y, x, image.getPixel(x, y));
  }
  return out;
}

/**
 * The frame of a door: turned `rotation` (0 opens down, 90 right, 180 up, 270 left), a single
 * door hinged at `hinge` (`start`: west or north end of its span; a double door ignores it),
 * at `step` of its swing, 0 closed up to `DOOR_STEPS - 1` open. A vertical edge (90, 270) is the horizontal drawing turned about the frame's
 * diagonal, which keeps the light top-left.
 */
export function doorSprite(material: DoorMaterial, variant: DoorVariant, rotation: 0 | 90 | 180 | 270, hinge: DoorHinge, step: number): PixelBuffer {
  if (rotation === 0) return horizontalDoor(material, variant, 1, hinge, step);
  if (rotation === 180) return horizontalDoor(material, variant, -1, hinge, step);
  return transposed(horizontalDoor(material, variant, rotation === 90 ? 1 : -1, hinge, step));
}
