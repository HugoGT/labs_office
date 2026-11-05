import { describe, expect, test } from 'vitest';
import { FACE_HEIGHT, wallFace, wallFrame, DEFAULT_PLASTER_COLOR } from './wallColumns.ts';
import { hexToRgba, makeRamp } from './color.ts';
import { ART_TILE, WALL_FRAMES, WALL_TOP_COLOR, type WallFrame } from '../../../src/game/artContract.ts';
import { WALL_MATERIALS } from './wallMap.ts';
import type { PixelBuffer } from '../../../src/art/pixelBuffer.ts';

/** The one color of each row of `face`, or `null` for a row of more than one color. */
function rowColors(face: PixelBuffer): (string | null)[] {
  return Array.from({ length: face.height }, (_, y) => {
    const colors = new Set(Array.from({ length: face.width }, (_, x) => JSON.stringify(face.getPixel(x, y))));
    return colors.size === 1 ? [...colors][0]! : null;
  });
}

describe('plaster wall face', () => {
  for (const color of [DEFAULT_PLASTER_COLOR, '#c0392b']) {
    test(`${color}: plain upper and darker lower halves, the four middle rows swapped two and two, a black line, a 1px skirting, a deep row and the dark bottom`, () => {
      const ramp = makeRamp(color);
      const [upper, lower, line, deep] = [ramp.base, ramp.shadow, hexToRgba(WALL_TOP_COLOR), ramp.deep].map((c) => JSON.stringify(c));
      const rows = rowColors(wallFace('plaster', undefined, color));
      // No specks: every row is a single color.
      expect(rows).not.toContain(null);
      const body = FACE_HEIGHT - 4;
      const middle = Math.floor(body / 2);
      const expected = Array.from({ length: FACE_HEIGHT }, (_, y) => {
        // The bottom row is the top band's color, as dark as the line.
        if (y === FACE_HEIGHT - 1) return line;
        if (y === FACE_HEIGHT - 2) return deep;
        if (y === FACE_HEIGHT - 3) return upper;
        if (y === FACE_HEIGHT - 4) return line;
        if (y >= middle - 2 && y < middle) return lower;
        if (y >= middle && y < middle + 2) return upper;
        return y < middle ? upper : lower;
      });
      expect(rows).toEqual(expected);
    });
  }

  test('defaults to its exported color', () => {
    expect(rowColors(wallFace('plaster'))).toEqual(rowColors(wallFace('plaster', undefined, DEFAULT_PLASTER_COLOR)));
  });
});

describe('wall edges', () => {
  const TOP = JSON.stringify(hexToRgba(WALL_TOP_COLOR));
  const columnOf = (image: PixelBuffer, x: number) => Array.from({ length: image.height }, (_, y) => JSON.stringify(image.getPixel(x, y)));

  test('every material ends its face on a bottom row in the top band color', () => {
    for (const material of WALL_MATERIALS) {
      expect(rowColors(wallFace(material)).at(-1), material).toBe(TOP);
    }
  });

  test('the Start frames close the left edge, the End ones the right, Both frames both, in the top band color', () => {
    for (const material of WALL_MATERIALS) {
      for (const tile of ['crown', 'face', 'base'] as const) {
        for (const variant of [0, 1, 2]) {
          const edges = (frame: WallFrame) => {
            const image = wallFrame(material, frame, variant);
            return [columnOf(image, 0).every((pixel) => pixel === TOP), columnOf(image, ART_TILE - 1).every((pixel) => pixel === TOP)];
          };
          const label = `${material} ${tile} ${variant}`;
          expect(edges(`${tile}Start` as WallFrame), label).toEqual([true, edges(tile)[1]]);
          expect(edges(`${tile}End` as WallFrame), label).toEqual([edges(tile)[0], true]);
          expect(edges(`${tile}Both` as WallFrame), label).toEqual([true, true]);
          // The edge column is the only change.
          const start = wallFrame(material, `${tile}Start` as WallFrame, variant);
          const plain = wallFrame(material, tile, variant);
          for (let x = 1; x < ART_TILE; x += 1) expect(columnOf(start, x), label).toEqual(columnOf(plain, x));
        }
      }
    }
    expect(Object.keys(WALL_FRAMES)).toEqual(['cap', 'crown', 'face', 'base', 'crownEnd', 'faceEnd', 'baseEnd', 'crownStart', 'faceStart', 'baseStart', 'crownBoth', 'faceBoth', 'baseBoth']);
  });
});
