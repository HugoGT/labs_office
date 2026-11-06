import { describe, expect, test } from 'vitest';
import { countColors } from '../../../../src/game/artContract.ts';
import type { Rgba } from '../../../../src/art/pixelBuffer.ts';
import { RUG_BELOW, RUG_FACINGS, rugFootprint } from './shared.ts';
import { HAZARD_BAND, HAZARD_PALETTE, hazardRug } from './hazard.ts';

const luma = (p: Rgba): number => p.r * 0.3 + p.g * 0.59 + p.b * 0.11;
const same = (a: Rgba, b: Rgba): boolean => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

describe.each(RUG_FACINGS)('hazard rug, %s', (facing) => {
  const rug = hazardRug(facing);
  const { width, height } = rugFootprint(facing);

  test('is the footprint plus the rows below', () => {
    expect(rug.width).toBe(width);
    expect(rug.height).toBe(height + RUG_BELOW);
  });

  test('covers the whole footprint opaquely', () => {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) expect(rug.alphaAt(x, y), `${x},${y}`).toBe(255);
  });

  test('has a 1px outline darker than the mat all around', () => {
    const field = rug.getPixel(width >> 1, height >> 1);
    const edge: Array<[number, number]> = [];
    for (let x = 0; x < width; x += 1) edge.push([x, 0], [x, height - 1]);
    for (let y = 0; y < height; y += 1) edge.push([0, y], [width - 1, y]);
    for (const [x, y] of edge) expect(same(rug.getPixel(x, y), HAZARD_PALETTE.outline), `${x},${y}`).toBe(true);
    expect(luma(HAZARD_PALETTE.outline)).toBeLessThan(luma(field));
  });

  /** The four sides of the ring `d` pixels in from the outer edge. */
  const ring = (d: number): Record<string, Rgba[]> => ({
    top: Array.from({ length: width - 2 * d }, (_, i) => rug.getPixel(d + i, d)),
    bottom: Array.from({ length: width - 2 * d }, (_, i) => rug.getPixel(d + i, height - 1 - d)),
    left: Array.from({ length: height - 2 * d }, (_, i) => rug.getPixel(d, d + i)),
    right: Array.from({ length: height - 2 * d }, (_, i) => rug.getPixel(width - 1 - d, d + i)),
  });
  const isStripe = (p: Rgba): boolean => same(p, HAZARD_PALETTE.yellow) || same(p, HAZARD_PALETTE.field);
  /** The center field starts right where the stripe band ends, with no separator line. */
  const fieldInset = HAZARD_BAND.inset + HAZARD_BAND.width;

  test('runs yellow and black stripes along every edge', () => {
    for (const [name, line] of Object.entries(ring(HAZARD_BAND.inset + (HAZARD_BAND.width >> 1)))) {
      expect(line.filter((p) => same(p, HAZARD_PALETTE.yellow)).length, name).toBeGreaterThan(line.length / 4);
      expect(line.filter((p) => same(p, HAZARD_PALETTE.field)).length, name).toBeGreaterThan(line.length / 4);
    }
  });

  test('starts the stripe band right inside the outline, so yellow touches it', () => {
    for (const [name, line] of Object.entries(ring(1))) {
      expect(line.every(isStripe), name).toBe(true);
      expect(line.some((p) => same(p, HAZARD_PALETTE.yellow)), name).toBe(true);
    }
  });

  test('paints the black stripes in the exact tone of the center field', () => {
    const counts = new Map<string, number>();
    for (let y = fieldInset; y < height - fieldInset; y += 1) {
      for (let x = fieldInset; x < width - fieldInset; x += 1) {
        const { r, g, b } = rug.getPixel(x, y);
        counts.set(`${r},${g},${b}`, (counts.get(`${r},${g},${b}`) ?? 0) + 1);
      }
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const { r, g, b } = HAZARD_PALETTE.field;
    expect(dominant).toBe(`${r},${g},${b}`);
    for (let d = HAZARD_BAND.inset; d < HAZARD_BAND.inset + HAZARD_BAND.width; d += 1) {
      for (const [name, line] of Object.entries(ring(d))) expect(line.every(isStripe), `${name} d=${d}`).toBe(true);
    }
  });

  test('goes straight from the stripe band to the center field, keeping the field 10px in', () => {
    expect(fieldInset).toBe(10);
    const key = ({ r, g, b, a }: Rgba): string => `${r},${g},${b},${a}`;
    const deeper = new Set<string>();
    for (let y = fieldInset + 1; y < height - fieldInset - 1; y += 1) {
      for (let x = fieldInset + 1; x < width - fieldInset - 1; x += 1) deeper.add(key(rug.getPixel(x, y)));
    }
    for (const [name, line] of Object.entries(ring(fieldInset))) {
      for (const [i, p] of line.entries()) expect(deeper.has(key(p)), `${name} #${i}`).toBe(true);
    }
  });

  test('keeps yellow out of the center field', () => {
    for (let y = fieldInset; y < height - fieldInset; y += 1) {
      for (let x = fieldInset; x < width - fieldInset; x += 1) expect(same(rug.getPixel(x, y), HAZARD_PALETTE.yellow), `${x},${y}`).toBe(false);
    }
  });

  test('is deterministic', () => {
    expect(hazardRug(facing).data).toEqual(rug.data);
  });

  test('stays within the sheet color budget', () => {
    expect(countColors(rug)).toBeLessThanOrEqual(128);
  });
});
