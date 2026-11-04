/**
 * Doors and windows drawn in code (#223, #233, tile walls).
 *
 * In a vertical wall run (rotations 90 and 270) a door is seen from above, like the dark top of
 * the run it replaces (S9): a frame post (jamb) of dark wood at each end of the span, merging with
 * the wall there, and between them one wooden plank (single door) or two meeting in the middle
 * (double door). A closed leaf lies along the run; an open one is swung a quarter turn into the
 * side it opens to, and the steps between (`DOOR_STEPS`) turn it a third of that each, about the
 * hinge. The hinge (dark metal) sits at the outer end of each leaf and the brass handle near the
 * other, so the handles of a double door meet in the middle.
 *
 * In a horizontal run (rotations 0 and 180) a door is seen from the front (S10): it fills the
 * bottom two tiles of the wall (`DOOR_FRONT`) with a frame that is the same whatever the wall's
 * material, and its leaves narrow toward their hinges as they swing open, leaving the doorway
 * clear. A window (S11) is seen from the front too, over the wall's face (`WINDOW_FRONT`): glass in
 * the same frame, whose top is the wall's dark band so the two merge. It stands in no vertical
 * run (S8), so its vertical frames are empty.
 *
 * Every frame is drawn straight into its `DOOR` cell, the anchor on the middle of the span, with
 * the same light as the rest of the pack (lit top and left faces, 1px ink outline).
 */
import { OUTLINE_INK, OUTLINE_INK_MIX } from '../../../src/game/artColor.ts';
import { ART_TILE, DOOR, DOOR_FRONT, DOOR_STEPS, WINDOW_FRONT, type DoorHinge, type DoorVariant } from '../../../src/game/artContract.ts';
import { makeRamp, mixRgba, type Ramp } from './color.ts';
import { PixelBuffer, rgba, type Rgba } from '../../../src/art/pixelBuffer.ts';

export const DOOR_MATERIALS = ['wood', 'glass'] as const;
export type DoorMaterial = (typeof DOOR_MATERIALS)[number];

/** The pieces of the door kind the pack draws: a wooden door, single and double, and a glass window. */
export const DOOR_PIECES: readonly { readonly material: DoorMaterial; readonly variant: DoorVariant }[] = [
  { material: 'wood', variant: 'single' },
  { material: 'wood', variant: 'double' },
  { material: 'glass', variant: 'window' },
];

const WOOD: Readonly<Record<DoorMaterial, Ramp>> = { wood: makeRamp('#9a6a3f'), glass: makeRamp('#9cc7dd') };
/** The frame of a window seen from the front: one for every wall material (S11). */
const FRAME = makeRamp('#4a4760');
/** The frame of a door seen from the front: dark wood, one for every wall material (S10). */
const DOOR_FRAME_WOOD = makeRamp('#5c3a20');
const GLASS = makeRamp('#9cc7dd');
/** How wide a window's front frame (jambs, lintel and sill) is. */
const FRONT_FRAME = 4;
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
 * One frame of a door seen from above along a horizontal line, in frame pixels: the span runs
 * along row `ay`, centred on the anchor, with a jamb at each end. `inside` is +1 when the door
 * opens down, -1 up; `hinge` is the end a single door's leaf turns about (a double door always
 * hinges its two leaves at the outer ends). Turned about the frame's diagonal, it is the door of a
 * vertical run (`doorSprite`).
 */
function topDownDoor(material: DoorMaterial, variant: DoorVariant, inside: 1 | -1, hinge: DoorHinge, step: number): PixelBuffer {
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
 * The front frame: a jamb `t` pixels wide down each side of `box` and a lintel across its top in
 * `ramp`. Each jamb is lit on its outer edge and shaded on its inner one, the same on both sides
 * so the frame's two ends look alike.
 */
function frontFrame(image: PixelBuffer, box: Box, top: Rgba | null, ramp: Ramp, t: number): void {
  fill(image, { x: box.x, y: box.y, w: t, h: box.h }, ramp.base);
  fill(image, { x: box.x + box.w - t, y: box.y, w: t, h: box.h }, ramp.base);
  fill(image, { x: box.x, y: box.y, w: 1, h: box.h }, ramp.light);
  fill(image, { x: box.x + box.w - 1, y: box.y, w: 1, h: box.h }, ramp.light);
  fill(image, { x: box.x + t - 1, y: box.y, w: 1, h: box.h }, ramp.shadow);
  fill(image, { x: box.x + box.w - t, y: box.y, w: 1, h: box.h }, ramp.shadow);
  fill(image, { x: box.x, y: box.y, w: box.w, h: t }, top ?? ramp.base);
  if (top === null) {
    fill(image, { x: box.x + t - 1, y: box.y + t - 1, w: box.w - 2 * t + 2, h: 1 }, ramp.shadow);
    // The whole outer edge is lit, the lintel's ends included: no dark break where the jambs meet it.
    fill(image, { x: box.x, y: box.y, w: box.w, h: 1 }, ramp.light);
    fill(image, { x: box.x, y: box.y, w: 1, h: box.h }, ramp.light);
    fill(image, { x: box.x + box.w - 1, y: box.y, w: 1, h: box.h }, ramp.light);
  }
}

/**
 * One front leaf of a door, `width` pixels wide as seen (narrower as it swings open), hinged on
 * its left (`atLeft`) or right edge at `hingeX`: a plank with two sunken panels, the hinge pins on
 * the hinge edge and the brass handle near the free one.
 */
function frontLeaf(image: PixelBuffer, hingeX: number, top: number, bottom: number, width: number, atLeft: boolean, ramp: Ramp): void {
  const x = atLeft ? hingeX : hingeX - width;
  const h = bottom - top;
  fill(image, { x, y: top, w: width, h }, ramp.base);
  fill(image, { x, y: top, w: 1, h }, ramp.light);
  fill(image, { x: x + width - 1, y: top, w: 1, h }, ramp.shadow);
  fill(image, { x, y: bottom - 1, w: width, h: 1 }, ramp.shadow);
  const pinX = atLeft ? x : x + width - 1;
  for (const y of [top + 4, bottom - 8]) fill(image, { x: pinX, y, w: 1, h: 3 }, HINGE.base);
  if (width < 12) return;
  // Two sunken panels: shadow on their top and left, light on their bottom and right.
  const inset = 4;
  const panelH = Math.floor((h - 3 * inset) / 2);
  for (const py of [top + inset, top + 2 * inset + panelH]) {
    const panel = { x: x + inset, y: py, w: width - 2 * inset, h: panelH };
    fill(image, { x: panel.x, y: panel.y, w: panel.w, h: 1 }, ramp.shadow);
    fill(image, { x: panel.x, y: panel.y, w: 1, h: panel.h }, ramp.shadow);
    fill(image, { x: panel.x, y: panel.y + panel.h - 1, w: panel.w, h: 1 }, ramp.light);
    fill(image, { x: panel.x + panel.w - 1, y: panel.y, w: 1, h: panel.h }, ramp.light);
  }
  const handleX = atLeft ? x + width - 4 : x + 2;
  fill(image, { x: handleX, y: top + Math.floor(h / 2), w: 2, h: 2 }, DOOR_HANDLE);
}

/**
 * One frame of a door in a horizontal wall run, seen from the front (S10): the dark wooden frame
 * round the bottom two tiles of the wall (`DOOR_FRONT`), `frontWidth` wide and centered on the
 * span (the wall shows on each side of a single door), and the leaf (or both leaves of a double
 * door) inside it. A shut leaf fills the doorway; open, it is seen edge on, a strip
 * against its hinge jamb, and the steps between narrow it as it turns. The doorway it leaves is
 * clear, so whoever walks through shows behind the frame.
 */
function frontDoor(material: DoorMaterial, variant: DoorVariant, hinge: DoorHinge, step: number): PixelBuffer {
  const image = new PixelBuffer(DOOR.frame.width, DOOR.frame.height);
  const { frontWidth } = DOOR.variants[variant];
  const left = DOOR.anchor.x - frontWidth / 2;
  const right = DOOR.anchor.x + frontWidth / 2;
  const box = { x: left, y: DOOR_FRONT.top, w: right - left, h: DOOR_FRONT.bottom - DOOR_FRONT.top };
  const t = DOOR_FRONT.frame;
  const inner = { left: left + t, right: right - t, top: DOOR_FRONT.top + t };
  const angle = (step / (DOOR_STEPS - 1)) * (Math.PI / 2);
  const seen = (full: number): number => Math.max(DOOR.leafThickness, Math.round(full * Math.cos(angle)));
  if (variant === 'double') {
    const half = (inner.right - inner.left) / 2;
    frontLeaf(image, inner.left, inner.top, DOOR_FRONT.bottom, seen(half), true, WOOD[material]);
    frontLeaf(image, inner.right, inner.top, DOOR_FRONT.bottom, seen(half), false, WOOD[material]);
  } else {
    const full = inner.right - inner.left;
    frontLeaf(image, hinge === 'start' ? inner.left : inner.right, inner.top, DOOR_FRONT.bottom, seen(full), hinge === 'start', WOOD[material]);
  }
  frontFrame(image, box, null, DOOR_FRAME_WOOD, t);
  image.addOutline(ink);
  // The door ends against the wall on both sides and its top tile: no outline past them.
  clipTo(image, { x: left, y: DOOR_FRONT.top, w: right - left, h: DOOR_FRONT.bottom - DOOR_FRONT.top });
  return image;
}

/**
 * A window in a horizontal wall run, seen from the front (S11, L22-L24): `DOOR.variants.window.frontWidth`
 * wide in the middle of its two tiles, from 0.4 tiles under the dark band down to the top of the
 * wall's bottom tile (`WINDOW_FRONT`), so the wall's own material shows between the band and the
 * window. A light-edged frame all round with a sill at the bottom, and four panes of solid glass
 * with a highlight across them: the wall does not show through, and it shows on each side of it,
 * so two windows side by side stay two.
 */
function frontWindow(): PixelBuffer {
  const image = new PixelBuffer(DOOR.frame.width, DOOR.frame.height);
  const width = DOOR.variants.window.frontWidth;
  const t = FRONT_FRAME;
  const left = DOOR.anchor.x - width / 2;
  const right = left + width;
  const top = WINDOW_FRONT.top;
  const bottom = WINDOW_FRONT.bottom;
  const glass = { x: left + t, y: top + t, w: width - 2 * t, h: bottom - top - 2 * t };
  fill(image, glass, GLASS.base);
  // A highlight running up to the right across the panes, two pixels wide.
  for (let y = glass.y; y < glass.y + glass.h; y += 1) {
    for (let x = glass.x; x < glass.x + glass.w; x += 1) {
      const d = (x - glass.x) + (y - glass.y);
      if (d % 22 === 8 || d % 22 === 9) image.setPixel(x, y, GLASS.light);
    }
  }
  fill(image, { x: glass.x, y: glass.y, w: glass.w, h: 1 }, GLASS.shadow);
  fill(image, { x: glass.x, y: glass.y, w: 1, h: glass.h }, GLASS.shadow);
  // The mullion and the transom split the glass in four.
  fill(image, { x: DOOR.anchor.x - 1, y: glass.y, w: 2, h: glass.h }, FRAME.base);
  fill(image, { x: glass.x, y: glass.y + Math.floor(glass.h / 2) - 1, w: glass.w, h: 2 }, FRAME.base);
  frontFrame(image, { x: left, y: top, w: width, h: bottom - top }, null, FRAME, t);
  // The sill: the frame's bottom, lit on top.
  fill(image, { x: left, y: bottom - t, w: width, h: t }, FRAME.base);
  fill(image, { x: left, y: bottom - t, w: width, h: 1 }, FRAME.light);
  fill(image, { x: left, y: bottom - 1, w: width, h: 1 }, FRAME.shadow);
  // The outer edge stays lit down the jambs to the sill.
  fill(image, { x: left, y: top, w: 1, h: bottom - top - 1 }, FRAME.light);
  fill(image, { x: right - 1, y: top, w: 1, h: bottom - top - 1 }, FRAME.light);
  return image;
}

/** Clears every pixel of `image` outside `box`. */
function clipTo(image: PixelBuffer, box: Box): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) if (x < box.x || x >= box.x + box.w || y < box.y || y >= box.y + box.h) image.setPixel(x, y, CLEAR);
  }
}

/**
 * The frame of a door or window: turned `rotation` (0 opens down, 90 right, 180 up, 270 left), a
 * single door hinged at `hinge` (`start`: west or north end of its span; a double door ignores
 * it), at `step` of its swing, 0 closed up to `DOOR_STEPS - 1` open. In a horizontal run (0, 180)
 * it is seen from the front, the same whichever side it opens to; in a vertical one (90, 270) from
 * above, the top-down drawing turned about the frame's diagonal, which keeps the light top-left. A
 * window is the same frame at every step and hinge, and none in a vertical run.
 */
export function doorSprite(material: DoorMaterial, variant: DoorVariant, rotation: 0 | 90 | 180 | 270, hinge: DoorHinge, step: number): PixelBuffer {
  const horizontal = rotation === 0 || rotation === 180;
  if (variant === 'window') return horizontal ? frontWindow() : new PixelBuffer(DOOR.frame.width, DOOR.frame.height);
  if (horizontal) return frontDoor(material, variant, hinge, step);
  return transposed(topDownDoor(material, variant, rotation === 90 ? 1 : -1, hinge, step));
}
