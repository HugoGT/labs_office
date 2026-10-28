import { describe, expect, it } from 'vitest';
import { DOOR, DOOR_HINGES, DOOR_STEPS, DOOR_VARIANTS, type DoorVariant } from '../../../src/game/artContract.ts';
import type { PixelBuffer } from '../../../src/art/pixelBuffer.ts';
import { DOOR_HANDLE, DOOR_MATERIALS, doorSprite } from './doors.ts';

const ROTATIONS = [0, 90, 180, 270] as const;
const CLOSED = 0;
const OPEN = DOOR_STEPS - 1;
const { x: AX, y: AY } = DOOR.anchor;
/** The frame post is the leaf's thickness plus a little: it reads as a frame merging into the wall. */
const JAMB_THICKNESS = DOOR.leafThickness + 4;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The opaque pixels of a frame (those `keep` accepts), as a bounding box. */
function bounds(image: PixelBuffer, keep: (x: number, y: number) => boolean = () => true): Box {
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.alphaAt(x, y) === 0 || !keep(x, y)) continue;
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x);
      box.bottom = Math.max(box.bottom, y);
    }
  }
  return box;
}

function handle(image: PixelBuffer): { x: number; y: number }[] {
  const found: { x: number; y: number }[] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const { r, g, b, a } = image.getPixel(x, y);
      if (r === DOOR_HANDLE.r && g === DOOR_HANDLE.g && b === DOOR_HANDLE.b && a === DOOR_HANDLE.a) found.push({ x, y });
    }
  }
  return found;
}

function rgbaOf(image: PixelBuffer): string[] {
  const out: string[] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const { r, g, b, a } = image.getPixel(x, y);
      out.push(`${r},${g},${b},${a}`);
    }
  }
  return out;
}

/** Half the span along the edge, and the length of one leaf (the double door has two). */
function dims(variant: DoorVariant): { half: number; leaf: number; jamb: number } {
  const spec = DOOR.variants[variant];
  return { half: (spec.span * 32) / 2, leaf: variant === 'double' ? spec.leafLength / 2 : spec.leafLength, jamb: spec.jamb };
}

describe('door sprites (#223, #233)', () => {
  it('draws every variant, rotation, hinge and state in a contract frame, its corners clear', () => {
    for (const material of DOOR_MATERIALS) {
      for (const variant of DOOR_VARIANTS) {
        for (const rotation of ROTATIONS) {
          for (const hinge of DOOR_HINGES) {
            for (const open of [CLOSED, ...Array.from({ length: DOOR_STEPS - 1 }, (_, i) => i + 1)]) {
              const sprite = doorSprite(material, variant, rotation, hinge, open);
              expect([sprite.width, sprite.height]).toEqual([DOOR.frame.width, DOOR.frame.height]);
              const corners = [[0, 0], [sprite.width - 1, 0], [0, sprite.height - 1], [sprite.width - 1, sprite.height - 1]] as const;
              expect(corners.map(([x, y]) => sprite.alphaAt(x, y)), `${material} ${variant} ${rotation} ${hinge} ${open}`).toEqual([0, 0, 0, 0]);
            }
          }
        }
      }
    }
  });

  it('spans the variant exactly: a jamb at each end of the span, the leaf between them', () => {
    for (const variant of DOOR_VARIANTS) {
      const { half, jamb } = dims(variant);
      const closed = doorSprite('wood', variant, 0, 'start', CLOSED);
      // The jambs are the posts at both ends: opaque from the span's end, jamb pixels wide, thick across.
      const box = bounds(closed);
      expect(box.left, variant).toBe(AX - half);
      expect(box.right, variant).toBe(AX + half - 1);
      expect(bounds(closed, (x) => x < AX - half + jamb).right, variant).toBe(AX - half + jamb - 1);
      for (const x of [AX - half, AX - half + jamb - 1, AX + half - jamb, AX + half - 1]) {
        const column = bounds(closed, (px) => px === x);
        expect(column.bottom - column.top + 1, `${variant} jamb column ${x}`).toBeGreaterThanOrEqual(JAMB_THICKNESS);
      }
      // Between the jambs the leaf is thinner than the frame post.
      const middle = bounds(closed, (x) => x >= AX - half + jamb && x < AX + half - jamb);
      expect(middle.left, variant).toBe(AX - half + jamb);
      expect(middle.right, variant).toBe(AX + half - jamb - 1);
      expect(middle.bottom - middle.top + 1, variant).toBeLessThan(box.bottom - box.top + 1);
      // The post stands out of the leaf's two faces, so it merges with the wall around it.
      expect(box.top).toBeLessThan(AY - DOOR.leafThickness / 2);
      expect(box.bottom).toBeGreaterThanOrEqual(AY + DOOR.leafThickness / 2);
      // The vertical edge is the same drawing turned about the diagonal.
      const vertical = bounds(doorSprite('wood', variant, 90, 'start', CLOSED));
      expect([vertical.top, vertical.bottom, vertical.left, vertical.right]).toEqual([box.left, box.right, box.top, box.bottom]);
    }
  });

  it('swings an open leaf into the side its rotation faces, from its hinge end, short of the frame edge', () => {
    for (const variant of DOOR_VARIANTS) {
      const { half, leaf, jamb } = dims(variant);
      // Rows past the frame post, so only the swung leaf is measured.
      const down = (x: number, y: number): boolean => y > AY + JAMB_THICKNESS / 2 + 1 && x >= 0;
      const opens = {
        0: bounds(doorSprite('wood', variant, 0, 'start', OPEN), down),
        180: bounds(doorSprite('wood', variant, 180, 'start', OPEN), (_x, y) => y < AY - JAMB_THICKNESS / 2 - 1),
        90: bounds(doorSprite('wood', variant, 90, 'start', OPEN), (x) => x > AX + JAMB_THICKNESS / 2 + 1),
        270: bounds(doorSprite('wood', variant, 270, 'start', OPEN), (x) => x < AX - JAMB_THICKNESS / 2 - 1),
      };
      // Reach is the leaf length less ~2px (+ the outline), and still inside the frame.
      expect(opens[0].bottom - AY, variant).toBeGreaterThanOrEqual(leaf - 3);
      expect(opens[0].bottom - AY, variant).toBeLessThanOrEqual(leaf);
      expect(AY - opens[180].top, variant).toBeGreaterThanOrEqual(leaf - 3);
      expect(AY - opens[180].top, variant).toBeLessThanOrEqual(leaf);
      expect(opens[90].right - AX, variant).toBeGreaterThanOrEqual(leaf - 3);
      expect(opens[90].right - AX, variant).toBeLessThanOrEqual(leaf);
      expect(AX - opens[270].left, variant).toBeGreaterThanOrEqual(leaf - 3);
      expect(AX - opens[270].left, variant).toBeLessThanOrEqual(leaf);
      expect(opens[0].bottom).toBeLessThan(DOOR.frame.height);
      // The leaf turns about its hinge end, just inside the jamb (the west one for `start`); its handle's outline sits a pixel further.
      expect(opens[0].left, variant).toBe(AX - half + jamb - 2);
      expect(bounds(doorSprite('wood', variant, 0, 'start', OPEN), down).left).toBeLessThan(AX);
      expect(opens[90].top, variant).toBe(AY - half + jamb - 2);
    }
    // A single door's hinge picks the end it swings from; `end` is the mirror image.
    const { half, jamb } = dims('single');
    const rows = (x: number, y: number): boolean => y > AY + JAMB_THICKNESS / 2 + 1 && x >= 0;
    const end = bounds(doorSprite('wood', 'single', 0, 'end', OPEN), rows);
    expect(end.right).toBe(AX + half - jamb + 1);
    expect(end.left).toBeGreaterThan(AX);
    expect(bounds(doorSprite('wood', 'single', 90, 'end', OPEN), (x) => x > AX + JAMB_THICKNESS / 2 + 1).top).toBeGreaterThan(AY);
  });

  it('puts the handle at the end away from the hinge, so the handles of a double door meet in the middle', () => {
    for (const open of [CLOSED, OPEN]) {
      const start = handle(doorSprite('wood', 'single', 0, 'start', open));
      const end = handle(doorSprite('wood', 'single', 0, 'end', open));
      expect(start.length, `open ${open}`).toBeGreaterThan(0);
      if (open === CLOSED) {
        expect(start.every(({ x }) => x > AX)).toBe(true);
        expect(end.every(({ x }) => x < AX)).toBe(true);
      } else {
        expect(start.every(({ y }) => y > AY + dims('single').leaf / 2)).toBe(true);
      }
      expect(handle(doorSprite('wood', 'single', 90, 'start', CLOSED)).every(({ y }) => y > AY)).toBe(true);
      expect(handle(doorSprite('wood', 'single', 90, 'end', CLOSED)).every(({ y }) => y < AY)).toBe(true);
    }
    // The double door: one handle on each side of the anchor, mirrored about it.
    const double = handle(doorSprite('wood', 'double', 0, 'start', CLOSED));
    expect(double.some(({ x }) => x < AX) && double.some(({ x }) => x >= AX)).toBe(true);
    const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;
    expect(new Set(double.map(key))).toEqual(new Set(double.map(({ x, y }) => key({ x: 2 * AX - 1 - x, y }))));
  });

  it('draws the double door as two leaves, symmetric about the anchor, whatever the hinge', () => {
    for (const open of Array.from({ length: DOOR_STEPS }, (_, i) => i)) {
      for (const rotation of ROTATIONS) {
        const start = doorSprite('wood', 'double', rotation, 'start', open);
        // Both leaves are always drawn: the `end` row repeats the `start` one.
        expect(rgbaOf(doorSprite('wood', 'double', rotation, 'end', open)), `${rotation} ${open}`).toEqual(rgbaOf(start));
        // Its silhouette mirrors about the anchor, across the edge (the light stays top-left).
        const horizontal = rotation === 0 || rotation === 180;
        // One assertion per frame (not per pixel): 16k expects a frame made this test outrun its timeout on a slow runner.
        const unmatched: string[] = [];
        for (let y = 0; y < start.height; y += 1) {
          for (let x = 0; x < start.width; x += 1) {
            const mirror = horizontal ? start.alphaAt(2 * AX - 1 - x, y) : start.alphaAt(x, 2 * AY - 1 - y);
            if (start.alphaAt(x, y) !== mirror) unmatched.push(`${x},${y}`);
          }
        }
        expect(unmatched, `${rotation} ${open}`).toEqual([]);
      }
    }
  });

  it('swings through the steps between closed and open: the leaf turns about its hinge, a bit more each frame', () => {
    for (const variant of DOOR_VARIANTS) {
      const { half, jamb } = dims(variant);
      // The leaf only: between the two jambs, below the edge row.
      const leaf = (step: number) => bounds(doorSprite('wood', variant, 0, 'start', step), (x, y) => x >= AX - half + jamb && x < AX + half - jamb && y > AY + DOOR.leafThickness / 2 + 1);
      const bottoms = [1, 2, OPEN].map((step) => leaf(step).bottom);
      expect(bottoms[0], variant).toBeGreaterThan(AY + DOOR.leafThickness / 2 + 1);
      expect(bottoms[0], variant).toBeLessThan(bottoms[1]!);
      expect(bottoms[1], variant).toBeLessThan(bottoms[2]!);
      // Its free end comes in from the edge's line toward the hinge as it swings.
      // Short of what sits against the closed leaf's free end: the far jamb's outline, or the other leaf of a double door.
      const reach = (step: number) => bounds(doorSprite('wood', variant, 0, 'start', step), (x) => x >= AX - half + jamb && x < (variant === 'double' ? AX - 2 : AX + half - jamb - 2)).right;
      expect(reach(CLOSED), variant).toBeGreaterThan(reach(1));
      expect(reach(1), variant).toBeGreaterThan(reach(2));
      expect(reach(2), variant).toBeGreaterThan(reach(OPEN));
    }
  });

  it('keeps the hinge and the handle on the leaf in the steps between', () => {
    for (const step of [1, 2]) {
      const found = handle(doorSprite('wood', 'single', 0, 'start', step));
      expect(found.length, `step ${step}`).toBeGreaterThan(0);
      // The handle rides the free end: on the side of the leaf away from the hinge, below the edge.
      expect(found.every(({ y }) => y > AY), `step ${step}`).toBe(true);
    }
  });
});
