/**
 * Doors and windows drawn in code (#223, #233, tile walls).
 *
 * In a vertical wall run (rotations 90 and 270) a door stands in the walls' projection (S9, S14):
 * what stands on the floor rises straight up the screen. The run above it ends with its own face
 * (`wallTileFrames`), and against it stands the frame: a box at a horizontal door's height over the
 * span's top, a dark-wood post under it down to the floor, the shut door's line along the span (only
 * its top edge shows), and the top 2px of the lower post over the wall below the span. The frame is
 * the same at every step; the leaves swing under it, a third of a quarter turn per step
 * (`DOOR_STEPS`), into the side the rotation faces: a single door's one leaf from the upper post, a
 * double door's two from both posts, the lower one's foot hidden under the wall below. Over all of
 * it, the column is shaded with the wall-top color from where the material above ends, the ceiling
 * over the doorway.
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
import {
  ART_TILE,
  DOOR,
  DOOR_FRONT,
  DOOR_STEPS,
  VERTICAL_DOOR,
  WALL,
  WALL_TOP_COLOR,
  WINDOW_FRONT,
  doorSpanAlong,
  verticalDoorFeet,
  verticalDoorLeaves,
  type DoorHinge,
  type DoorVariant,
} from '../../../src/game/artContract.ts';
import { hexToRgba, makeRamp, mixRgba, type Ramp } from './color.ts';
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

/** The ceiling's shadow over the doorway of a vertical run (S14c): the wall's top band, half seen through. */
const CEILING = hexToRgba(WALL_TOP_COLOR);

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function ink(color: Rgba): Rgba {
  return mixRgba(rgba(color.r, color.g, color.b), OUTLINE_INK, OUTLINE_INK_MIX.opaque);
}

function fill(image: PixelBuffer, box: Box, color: Rgba): void {
  image.fillRect(box.x, box.y, box.w, box.h, color);
}

/** A frame post: flat dark wood, lit on its top and left faces. */
function post(image: PixelBuffer, box: Box, ramp: Ramp, { foot = true } = {}): void {
  // Lit on the right like the end of a wall and the door line (L43), shaded on the left; `foot`
  // false leaves its bottom row unshaded, where it runs on into the door line.
  fill(image, box, ramp.base);
  fill(image, { x: box.x, y: box.y, w: box.w, h: 1 }, ramp.light);
  fill(image, { x: box.x + box.w - 1, y: box.y, w: 1, h: box.h }, ramp.light);
  if (foot) fill(image, { x: box.x, y: box.y + box.h - 1, w: box.w, h: 1 }, ramp.shadow);
  fill(image, { x: box.x, y: box.y, w: 1, h: box.h }, ramp.shadow);
}

/** How tall a vertical door's leaves rise from the floor: up to the box on its frame's top. */
const LEAF_HEIGHT = VERTICAL_DOOR.height - DOOR.variants.single.jamb;

/**
 * A leaf of a door in a vertical run seen like the walls, its height straight up (S14d): its foot
 * runs on the floor from the hinge (`hx`, `hy`), `down` the run (+1) or up it (-1) when shut,
 * turned `angle` toward +x (`inside` +1) or -x (-1), and it rises `LEAF_HEIGHT` pixels. Painted
 * from the floor up, so the higher (nearer) pixel wins. Its top edge is a plain plank (lit edge,
 * base, shaded edge, no grain line: L38); its face shows two sunken panels, the hinge pins and the
 * brass handle near the free end, the face looking left lit a little.
 */
function prismLeaf(image: PixelBuffer, hx: number, hy: number, down: 1 | -1, length: number, inside: 1 | -1, angle: number, ramp: Ramp): void {
  const t = VERTICAL_DOOR.leafThickness;
  const e = { x: inside * Math.sin(angle), y: down * Math.cos(angle) };
  const n = { x: -e.y, y: e.x };
  // Only the pixels round the leaf's foot can hold it: its corners on the floor, the height above.
  const corners = [0, length].flatMap((u) => [-t / 2, t / 2].map((v) => ({ x: u * e.x + v * n.x, y: u * e.y + v * n.y })));
  const x0 = Math.max(0, Math.floor(hx + Math.min(...corners.map((c) => c.x))) - 2);
  const x1 = Math.min(image.width - 1, Math.ceil(hx + Math.max(...corners.map((c) => c.x))) + 2);
  for (let z = 0; z <= LEAF_HEIGHT; z += 1) {
    const y0 = Math.max(0, Math.floor(hy - z + Math.min(...corners.map((c) => c.y))) - 2);
    const y1 = Math.min(image.height - 1, Math.ceil(hy - z + Math.max(...corners.map((c) => c.y))) + 2);
    for (let sy = y0; sy <= y1; sy += 1) {
      for (let sx = x0; sx <= x1; sx += 1) {
        const a = sx + 0.5 - hx;
        const b = sy + 0.5 + z - hy;
        const u = a * e.x + b * e.y;
        const v = a * n.x + b * n.y;
        if (u < 0 || u >= length || Math.abs(v) >= t / 2) continue;
        let tone: Rgba;
        if (z >= LEAF_HEIGHT - 1) {
          tone = v < -t / 2 + 1 ? ramp.light : v >= t / 2 - 1 ? ramp.shadow : ramp.base;
          if (u < 2) tone = HINGE.base;
        } else if (u >= length - 1.5 || u < 1.5) {
          tone = ramp.shadow;
        } else {
          const normalX = Math.sign(v) * n.x;
          tone = normalX < 0 ? mixRgba(ramp.base, ramp.light, 0.3) : ramp.base;
          const inU = u >= 5 && u < length - 5;
          for (const [z0, z1] of [[6, 24], [30, 48]] as const) {
            if (inU && z >= z0 && z < z1) {
              if (z === z1 - 1 || u < 6) tone = ramp.shadow;
              else if (z === z0 || u >= length - 6) tone = ramp.light;
            }
          }
          if (u < 3 && ((z >= 8 && z < 12) || (z >= 40 && z < 44))) tone = HINGE.base;
          if (u >= length - 8 && u < length - 6 && z >= 25 && z < 28) tone = DOOR_HANDLE;
        }
        image.setPixel(sx, sy, tone);
      }
    }
  }
}

/** Clears the pixels of `image` in rows `from` and down within columns `left` to `right` (exclusive). */
function clearBelow(image: PixelBuffer, from: number, left: number, right: number): void {
  for (let y = Math.max(0, from); y < image.height; y += 1) for (let x = left; x < right; x += 1) image.setPixel(x, y, CLEAR);
}

/**
 * Half the wall-top color over a pixel (S14c), as a pixel of the sprite: what shows through it,
 * drawn over whatever is under the door, is half darkened toward the band.
 */
function shaded(color: Rgba): Rgba {
  const a = color.a / 255;
  const out = 0.5 + 0.5 * a;
  const mix = (top: number, band: number): number => Math.round((0.5 * top * a + 0.5 * band) / out);
  return rgba(mix(color.r, CEILING.r), mix(color.g, CEILING.g), mix(color.b, CEILING.b), Math.round(out * 255));
}

/**
 * One frame of a door in a vertical wall run (S9, S14), swung `step` toward `inside` (+1 right,
 * -1 left), drawn back to front: the leaves (none shut), the shut door's line, the post, then the
 * box and the stub of the lower post, and the ceiling's one shadow (50%, L45) over
 * the whole column. Whatever of the leaves and the door line falls in the column under the span
 * stands behind the wall below and is cut.
 */
function verticalDoor(material: DoorMaterial, variant: DoorVariant, inside: 1 | -1, step: number): PixelBuffer {
  const { width, height } = DOOR.frame;
  const x = DOOR.anchor.x;
  const { jamb } = DOOR.variants[variant];
  const span = doorSpanAlong('vertical', DOOR.variants[variant].span);
  const top = DOOR.anchor.y - (span * ART_TILE) / 2;
  const bottom = top + span * ART_TILE;
  const column = { left: x - ART_TILE / 2, right: x + ART_TILE / 2 };
  const t = VERTICAL_DOOR.leafThickness;
  const { upper, lower } = verticalDoorFeet(variant, top);
  const image = new PixelBuffer(width, height);
  const layer = (draw: (into: PixelBuffer) => void): void => {
    const into = new PixelBuffer(width, height);
    draw(into);
    into.addOutline(ink);
    clearBelow(into, bottom, column.left, column.right);
    image.blit(into, 0, 0);
  };
  if (step > 0) {
    const angle = (step / (DOOR_STEPS - 1)) * (Math.PI / 2);
    layer((into) => {
      for (const leaf of verticalDoorLeaves(variant, top)) prismLeaf(into, x, leaf.hingeY, leaf.down, leaf.length, inside, angle, WOOD[material]);
    });
  }
  // The shut door's line stays put at every step: it reads as the frame's head (L37), in the frame's wood (L45).
  layer((into) => prismLeaf(into, x, upper, 1, lower - upper, inside, 0, JAMB));
  post(image, { x: x - t / 2, y: top - LEAF_HEIGHT, w: t, h: LEAF_HEIGHT }, JAMB, { foot: false });
  const frame = new PixelBuffer(width, height);
  post(frame, { x: x - t / 2, y: top - VERTICAL_DOOR.height, w: t, h: jamb }, JAMB);
  // The lower post's foot is under the wall below the span: only its top shows over it.
  post(frame, { x: x - t / 2, y: bottom - VERTICAL_DOOR.stubShows, w: t, h: jamb }, JAMB);
  frame.addOutline(ink);
  for (let y = 0; y < height; y += 1) {
    for (let px = 0; px < width; px += 1) if (y < top - VERTICAL_DOOR.height || y >= bottom) frame.setPixel(px, y, CLEAR);
  }
  image.blit(frame, 0, 0);
  // The ceiling's shadow, over the door too: from where the material of the run above ends (S14c).
  for (let y = top - WALL.heightTiles * ART_TILE + WALL.topHeight; y < bottom; y += 1) {
    for (let px = column.left; px < column.right; px += 1) image.setPixel(px, y, shaded(image.getPixel(px, y)));
  }
  return image;
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
 * it is seen from the front, the same whichever side it opens to; in a vertical one (90, 270) it
 * stands like the walls (`verticalDoor`), whatever the hinge: its lower post is under the wall
 * below. A window is the same frame at every step and hinge, and none in a vertical run.
 */
export function doorSprite(material: DoorMaterial, variant: DoorVariant, rotation: 0 | 90 | 180 | 270, hinge: DoorHinge, step: number): PixelBuffer {
  const horizontal = rotation === 0 || rotation === 180;
  if (variant === 'window') return horizontal ? frontWindow() : new PixelBuffer(DOOR.frame.width, DOOR.frame.height);
  if (horizontal) return frontDoor(material, variant, hinge, step);
  return verticalDoor(material, variant, rotation === 90 ? 1 : -1, step);
}
