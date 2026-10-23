/**
 * Door leaves drawn in code (#223), seen from above like the walls they stand in: a wooden
 * plank one grid segment long lying along its edge when closed, swung a quarter turn into the
 * side it opens to when open. The hinge (dark metal) sits at one end of the edge and the brass
 * handle near the other, so two leaves hinged at the outer ends of a double door show their
 * handles meeting in the middle.
 *
 * Every frame is drawn straight into its `DOOR` cell, the anchor on the middle of the edge, with
 * the same light as the rest of the pack (lit top and left faces, 1px ink outline).
 */
import { OUTLINE_INK, OUTLINE_INK_MIX } from '../../../src/game/artColor.ts';
import { DOOR, type DoorHinge } from '../../../src/game/artContract.ts';
import { makeRamp, mixRgba, type Ramp } from './color.ts';
import { PixelBuffer, rgba, type Rgba } from '../../../src/art/pixelBuffer.ts';

export const DOOR_MATERIALS = ['wood'] as const;
export type DoorMaterial = (typeof DOOR_MATERIALS)[number];

const WOOD: Readonly<Record<DoorMaterial, Ramp>> = { wood: makeRamp('#9a6a3f') };
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

/**
 * One frame of a door standing on a horizontal edge (rotations 0 and 180), in frame pixels:
 * the edge runs from `left` to `right` on row `edgeY`. `inside` is +1 when the door opens down,
 * -1 up; `hingeX` is the end the leaf turns about.
 */
function horizontalDoor(material: DoorMaterial, inside: 1 | -1, hinge: DoorHinge, open: boolean): PixelBuffer {
  const image = new PixelBuffer(DOOR.frame.width, DOOR.frame.height);
  const { x: ax, y: ay } = DOOR.anchor;
  const length = DOOR.leafLength;
  const thick = DOOR.leafThickness;
  const left = ax - length / 2;
  const right = ax + length / 2;
  const start = hinge === 'start';
  if (!open) {
    plank(image, { x: left, y: ay - thick / 2, w: length, h: thick }, WOOD[material]);
    // The hinge pin at its end, the handle near the other, on both faces of the leaf.
    fill(image, { x: start ? left : right - 2, y: ay - thick / 2 - 1, w: 2, h: thick + 2 }, HINGE.base);
    const handleX = start ? right - 6 : left + 4;
    fill(image, { x: handleX, y: ay - thick / 2 - 1, w: 2, h: 1 }, DOOR_HANDLE);
    fill(image, { x: handleX, y: ay + thick / 2, w: 2, h: 1 }, DOOR_HANDLE);
  } else {
    // Swung a quarter turn about the hinge into the inside, flush with the frame of the opening.
    const x = start ? left : right - thick;
    const reach = length - 2;
    const y = inside === 1 ? ay + 1 : ay - 1 - reach;
    plank(image, { x, y, w: thick, h: reach }, WOOD[material]);
    fill(image, { x, y: inside === 1 ? ay - 1 : ay - 1, w: thick, h: 2 }, HINGE.base);
    const handleY = inside === 1 ? y + reach - 6 : y + 4;
    fill(image, { x: x - 1, y: handleY, w: 1, h: 2 }, DOOR_HANDLE);
    fill(image, { x: x + thick, y: handleY, w: 1, h: 2 }, DOOR_HANDLE);
  }
  image.addOutline(ink);
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
 * The frame of a door leaf: turned `rotation` (0 opens down, 90 right, 180 up, 270 left), hinged
 * at `hinge` (`start`: west or north end of its edge), closed or open. A vertical edge (90, 270)
 * is the horizontal drawing turned about the frame's diagonal, which keeps the light top-left.
 */
export function doorSprite(material: DoorMaterial, rotation: 0 | 90 | 180 | 270, hinge: DoorHinge, open: boolean): PixelBuffer {
  if (rotation === 0) return horizontalDoor(material, 1, hinge, open);
  if (rotation === 180) return horizontalDoor(material, -1, hinge, open);
  return transposed(horizontalDoor(material, rotation === 90 ? 1 : -1, hinge, open));
}
