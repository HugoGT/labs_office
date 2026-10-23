import { describe, expect, it } from 'vitest';
import { DOOR, DOOR_HINGES } from '../../../src/game/artContract.ts';
import type { PixelBuffer } from '../../../src/art/pixelBuffer.ts';
import { DOOR_HANDLE, DOOR_MATERIALS, doorSprite } from './doors.ts';

const ROTATIONS = [0, 90, 180, 270] as const;
const { x: AX, y: AY } = DOOR.anchor;
const HALF = DOOR.leafLength / 2;

/** The opaque pixels of a frame, as a bounding box. */
function bounds(image: PixelBuffer): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.alphaAt(x, y) === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, top, right, bottom };
}

describe('door sprites (#223)', () => {
  it('draws every rotation, hinge and state in a contract frame, its corners clear', () => {
    for (const material of DOOR_MATERIALS) {
      for (const rotation of ROTATIONS) {
        for (const hinge of DOOR_HINGES) {
          for (const open of [false, true]) {
            const sprite = doorSprite(material, rotation, hinge, open);
            expect([sprite.width, sprite.height]).toEqual([DOOR.frame.width, DOOR.frame.height]);
            const corners = [[0, 0], [sprite.width - 1, 0], [0, sprite.height - 1], [sprite.width - 1, sprite.height - 1]] as const;
            expect(corners.map(([x, y]) => sprite.alphaAt(x, y)), `${material} ${rotation} ${hinge} ${open}`).toEqual([0, 0, 0, 0]);
          }
        }
      }
    }
  });

  it('lays a closed leaf along its edge: across the frame for 0 and 180, down it for 90 and 270', () => {
    const horizontal = bounds(doorSprite('wood', 0, 'start', false));
    expect(horizontal.left).toBeLessThanOrEqual(AX - HALF);
    expect(horizontal.right).toBeGreaterThanOrEqual(AX + HALF - 1);
    // The plank, the handle standing out of each face and the outline.
    expect(horizontal.bottom - horizontal.top).toBeLessThanOrEqual(DOOR.leafThickness + 4);
    expect(horizontal.top).toBeLessThan(AY);
    expect(horizontal.bottom).toBeGreaterThanOrEqual(AY);
    const vertical = bounds(doorSprite('wood', 90, 'start', false));
    expect(vertical.top).toBeLessThanOrEqual(AY - HALF);
    expect(vertical.bottom).toBeGreaterThanOrEqual(AY + HALF - 1);
    expect(vertical.right - vertical.left).toBeLessThanOrEqual(DOOR.leafThickness + 4);
  });

  it('swings an open leaf into the side its rotation faces, from its hinge end', () => {
    // 0 opens down, 180 up, 90 right, 270 left.
    expect(bounds(doorSprite('wood', 0, 'start', true)).top).toBeGreaterThanOrEqual(AY - 2);
    expect(bounds(doorSprite('wood', 0, 'start', true)).bottom).toBeGreaterThan(AY + HALF);
    expect(bounds(doorSprite('wood', 180, 'start', true)).bottom).toBeLessThanOrEqual(AY + 2);
    expect(bounds(doorSprite('wood', 180, 'start', true)).top).toBeLessThan(AY - HALF);
    expect(bounds(doorSprite('wood', 90, 'start', true)).right).toBeGreaterThan(AX + HALF);
    expect(bounds(doorSprite('wood', 270, 'start', true)).left).toBeLessThan(AX - HALF);
    // The hinge picks the end it swings from: start (west or north), or end.
    expect(bounds(doorSprite('wood', 0, 'start', true)).right).toBeLessThan(AX);
    expect(bounds(doorSprite('wood', 0, 'end', true)).left).toBeGreaterThan(AX);
    expect(bounds(doorSprite('wood', 90, 'start', true)).bottom).toBeLessThan(AY);
    expect(bounds(doorSprite('wood', 90, 'end', true)).top).toBeGreaterThan(AY);
  });

  it('puts the handle at the end away from the hinge, so the handles of a double door meet in the middle', () => {
    const handle = (image: PixelBuffer): { x: number; y: number }[] => {
      const found: { x: number; y: number }[] = [];
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const { r, g, b, a } = image.getPixel(x, y);
          if (r === DOOR_HANDLE.r && g === DOOR_HANDLE.g && b === DOOR_HANDLE.b && a === DOOR_HANDLE.a) found.push({ x, y });
        }
      }
      return found;
    };
    for (const open of [false, true]) {
      const start = handle(doorSprite('wood', 0, 'start', open));
      const end = handle(doorSprite('wood', 0, 'end', open));
      expect(start.length, `open ${open}`).toBeGreaterThan(0);
      if (!open) {
        expect(start.every(({ x }) => x > AX)).toBe(true);
        expect(end.every(({ x }) => x < AX)).toBe(true);
      } else {
        expect(start.every(({ y }) => y > AY + HALF / 2)).toBe(true);
      }
      const vertical = handle(doorSprite('wood', 90, 'start', false));
      expect(vertical.every(({ y }) => y > AY)).toBe(true);
      expect(handle(doorSprite('wood', 90, 'end', false)).every(({ y }) => y < AY)).toBe(true);
    }
  });
});
