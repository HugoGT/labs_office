import { describe, expect, test } from 'vitest';
import { countColors } from '../../../../src/game/artContract.ts';
import type { PixelBuffer, Rgba } from '../../../../src/art/pixelBuffer.ts';
import { hexToRgba, makeRamp, mixRgba } from '../color.ts';
import { RUG_BELOW, RUG_FACINGS, rugFootprint } from './shared.ts';
import { WOOD_RUG_COLOR, WOOD_RUG_LEG_HEIGHT, woodRug, woodRugLegs } from './wood.ts';

const luminance = ({ r, g, b }: Rgba): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function perimeter(width: number, height: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let x = 0; x < width; x += 1) points.push([x, 0], [x, height - 1]);
  for (let y = 1; y < height - 1; y += 1) points.push([0, y], [width - 1, y]);
  return points;
}

/** The original wood ramp: border and legs keep these exact colors. */
const ORIGINAL = makeRamp(WOOD_RUG_COLOR);
const LEG_SPANS = { horizontal: [3, 31, 60, 88], vertical: [3, 30, 56] } as const;

function key({ r, g, b, a }: Rgba): string {
  return `${r},${g},${b},${a}`;
}

/** Median luminance inside the footprint, border excluded: the board tone, not the seams. */
function medianLuminance(rug: PixelBuffer, width: number, height: number): number {
  const values: number[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) values.push(luminance(rug.getPixel(x, y)));
  }
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)]!;
}

function underLeg(legs: ReadonlyArray<{ x: number; width: number }>, x: number): boolean {
  return legs.some((leg) => x >= leg.x && x < leg.x + leg.width);
}

describe.each(RUG_FACINGS)('woodRug %s', (facing) => {
  const { width, height } = rugFootprint(facing);
  const rug: PixelBuffer = woodRug(facing);

  test('is the footprint plus the rows below it', () => {
    expect(rug.width).toBe(width);
    expect(rug.height).toBe(height + RUG_BELOW);
  });

  test('fills the whole footprint with opaque pixels', () => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) expect(rug.alphaAt(x, y), `(${x}, ${y})`).toBe(255);
    }
  });

  test('draws a 1px border in one darker tone of its own wood all around the footprint', () => {
    const border = rug.getPixel(0, 0);
    for (const [x, y] of perimeter(width, height)) expect(rug.getPixel(x, y), `(${x}, ${y})`).toEqual(border);
    expect(luminance(border)).toBeLessThan(luminance(hexToRgba(WOOD_RUG_COLOR)));
    expect(border.r).toBeGreaterThan(border.b);
  });

  test('stands on legs 2px tall plus a 1px outline, with the floor showing between them', () => {
    const legs = woodRugLegs(facing);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    expect(WOOD_RUG_LEG_HEIGHT).toBe(2);
    const border = rug.getPixel(0, 0);
    for (const leg of legs) {
      for (let y = height; y < height + WOOD_RUG_LEG_HEIGHT + 1; y += 1) {
        for (let x = leg.x; x < leg.x + leg.width; x += 1) expect(rug.alphaAt(x, y), `leg (${x}, ${y})`).toBe(255);
        expect(rug.getPixel(leg.x, y), `leg left outline (${leg.x}, ${y})`).toEqual(border);
        expect(rug.getPixel(leg.x + leg.width - 1, y), `leg right outline (${y})`).toEqual(border);
      }
      for (let x = leg.x; x < leg.x + leg.width; x += 1) {
        expect(rug.getPixel(x, height + WOOD_RUG_LEG_HEIGHT), `leg bottom outline (${x})`).toEqual(border);
      }
    }
    for (let y = height; y < height + RUG_BELOW; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (y < height + WOOD_RUG_LEG_HEIGHT + 1 && underLeg(legs, x)) continue;
        expect(rug.alphaAt(x, y), `between legs (${x}, ${y})`).toBe(0);
      }
    }
  });

  test('puts the legs at both ends of the bottom edge', () => {
    const legs = woodRugLegs(facing);
    const first = legs[0];
    const last = legs[legs.length - 1];
    expect(first && first.x).toBeLessThan(width / 4);
    expect(last && last.x + last.width).toBeGreaterThan((width * 3) / 4);
  });

  test('is painted one tone lighter than its source wood', () => {
    expect(medianLuminance(rug, width, height)).toBeGreaterThan(luminance(hexToRgba(WOOD_RUG_COLOR)));
  });

  test('keeps the legs exactly as they were: spans, wood and outline colors', () => {
    const legs = woodRugLegs(facing);
    expect(legs.map((leg) => leg.x)).toEqual([...LEG_SPANS[facing]]);
    const legWood = mixRgba(ORIGINAL.shadow, ORIGINAL.deep, 0.6);
    for (const leg of legs) {
      expect(leg.width).toBe(5);
      for (let y = height; y < height + WOOD_RUG_LEG_HEIGHT; y += 1) {
        expect(rug.getPixel(leg.x, y)).toEqual(ORIGINAL.deep);
        expect(rug.getPixel(leg.x + 1, y)).toEqual(ORIGINAL.shadow);
        expect(rug.getPixel(leg.x + 2, y)).toEqual(legWood);
        expect(rug.getPixel(leg.x + 3, y)).toEqual(legWood);
        expect(rug.getPixel(leg.x + 4, y)).toEqual(ORIGINAL.deep);
      }
      for (let x = leg.x; x < leg.x + leg.width; x += 1) expect(rug.getPixel(x, height + WOOD_RUG_LEG_HEIGHT)).toEqual(ORIGINAL.deep);
    }
    expect(rug.getPixel(0, 0)).toEqual(ORIGINAL.deep);
  });

  test('mirrors its planks around the center along the boards', () => {
    if (facing === 'horizontal') {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) expect(rug.getPixel(x, y), `(${x}, ${y})`).toEqual(rug.getPixel(width - 1 - x, y));
      }
    } else {
      // Boards run down the screen; the surface (rows 1..height-4) mirrors top to bottom.
      for (let y = 1; y <= height - 4; y += 1) {
        for (let x = 0; x < width; x += 1) expect(rug.getPixel(x, y), `(${x}, ${y})`).toEqual(rug.getPixel(x, height - 3 - y));
      }
    }
  });

  test('runs the planks down to a 2-row front face with no light rows above the legs', () => {
    const mode = medianLuminance(rug, width, height);
    for (let y = 1; y < height - 1; y += 1) {
      const row = Array.from({ length: width - 2 }, (_, i) => rug.getPixel(i + 1, y));
      const uniform = row.every((color) => key(color) === key(row[0]!));
      if (uniform) expect(luminance(row[0]!), `uniform light row ${y}`).toBeLessThan(mode);
    }
    for (const y of [height - 3, height - 2]) {
      for (let x = 1; x < width - 1; x += 1) expect(luminance(rug.getPixel(x, y)), `face (${x}, ${y})`).toBeLessThan(mode);
    }
    let boards = 0;
    for (let y = height - 6; y <= height - 4; y += 1) {
      for (let x = 1; x < width - 1; x += 1) if (luminance(rug.getPixel(x, y)) >= mode) boards += 1;
    }
    expect(boards, 'boards right above the face').toBeGreaterThan(0);
  });

  test('keeps the original front face right above the legs', () => {
    const face = ORIGINAL.shadow;
    const faceLow = mixRgba(ORIGINAL.shadow, ORIGINAL.deep, 0.5);
    for (let x = 1; x < width - 1; x += 1) {
      const boardEnd = facing === 'vertical' && x % 3 === 0;
      expect(rug.getPixel(x, height - 3), `face (${x})`).toEqual(boardEnd ? faceLow : face);
      expect(rug.getPixel(x, height - 2), `low face (${x})`).toEqual(faceLow);
    }
  });

  test('paints flat boards: no lit edge, end shading or grain, only seams between them', () => {
    // Plank space: `along` runs with the boards, lanes of 3 (two board rows and a seam) across.
    const along = facing === 'horizontal' ? width - 2 : height - 4;
    const lanes = facing === 'horizontal' ? (height - 4) / 3 : Math.ceil((width - 2) / 3);
    const at = (a: number, across: number): Rgba => (facing === 'horizontal' ? rug.getPixel(a, across) : rug.getPixel(across, a));
    const seam = at(1, 3);
    const mode = medianLuminance(rug, width, height);
    expect(mode - luminance(seam), 'seams sit close to the board tone').toBeLessThan(16);
    expect(mode - luminance(seam), 'seams stay visible').toBeGreaterThan(4);
    for (let lane = 0; lane < lanes; lane += 1) {
      const first = 1 + lane * 3;
      let board: string | undefined;
      for (let a = 1; a <= along; a += 1) {
        const top = at(a, first);
        if (first + 1 <= (facing === 'horizontal' ? height - 4 : width - 2)) expect(at(a, first + 1), `lane ${lane} at ${a}`).toEqual(top);
        if (key(top) === key(seam)) {
          board = undefined;
          continue;
        }
        expect(luminance(top), `board darker than the seam at lane ${lane}, ${a}`).toBeGreaterThan(luminance(seam));
        board ??= key(top);
        expect(key(top), `one flat tone per board at lane ${lane}, ${a}`).toBe(board);
      }
    }
  });

  test('is deterministic', () => {
    expect(woodRug(facing).data).toEqual(rug.data);
  });

  test('stays within the color budget of a sheet', () => {
    expect(countColors(rug)).toBeLessThanOrEqual(128);
  });
});

test('draws each facing natively instead of rotating the other', () => {
  expect(woodRug('horizontal').data).not.toEqual(woodRug('vertical').data);
});
