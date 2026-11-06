import { describe, expect, it } from 'vitest';
import { countColors } from '../../../../src/game/artContract.ts';
import type { Rgba } from '../../../../src/art/pixelBuffer.ts';
import { MOSAIC_RUG_BORDER, mosaicRug } from './mosaic.ts';
import { RUG_BELOW, RUG_FACINGS, rugFootprint } from './shared.ts';

const same = (a: Rgba, b: Rgba): boolean => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
const luma = ({ r, g, b }: Rgba): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe.each(RUG_FACINGS)('mosaicRug(%s)', (facing) => {
  const rug = mosaicRug(facing);
  const { width, height } = rugFootprint(facing);

  it('is the footprint plus the rows below it, which stay empty', () => {
    expect(rug.width).toBe(width);
    expect(rug.height).toBe(height + RUG_BELOW);
    for (let y = height; y < rug.height; y += 1) for (let x = 0; x < width; x += 1) expect(rug.alphaAt(x, y)).toBe(0);
  });

  it('leaves the four footprint corners transparent', () => {
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]] as const) {
      expect(rug.alphaAt(x, y), `(${x},${y})`).toBe(0);
    }
  });

  it('fills the centre and reaches the middle of every side', () => {
    const cx = width / 2;
    const cy = height / 2;
    for (const [x, y] of [[cx, cy], [0, cy], [width - 1, cy], [cx, 0], [cx, height - 1]] as const) {
      expect(rug.alphaAt(x, y), `(${x},${y})`).toBe(255);
    }
  });

  it('is either fully opaque or fully transparent per pixel', () => {
    for (let i = 3; i < rug.data.length; i += 4) expect([0, 255]).toContain(rug.data[i]);
  });

  it('outlines its silhouette with the darker border tone', () => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (rug.alphaAt(x, y) === 0) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => rug.alphaAt(x + dx!, y + dy!) === 0);
        if (edge) expect(same(rug.getPixel(x, y), MOSAIC_RUG_BORDER), `(${x},${y}) border`).toBe(true);
      }
    }
  });

  it('keeps the border darker than the field it frames', () => {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = rug.getPixel(x, y);
        if (pixel.a === 0 || same(pixel, MOSAIC_RUG_BORDER)) continue;
        sum += luma(pixel);
        count += 1;
      }
    }
    expect(luma(MOSAIC_RUG_BORDER)).toBeLessThan(sum / count);
  });

  it('has a silhouette symmetric on both axes', () => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const a = rug.alphaAt(x, y);
        expect(rug.alphaAt(width - 1 - x, y), `mirror x of (${x},${y})`).toBe(a);
        expect(rug.alphaAt(x, height - 1 - y), `mirror y of (${x},${y})`).toBe(a);
      }
    }
  });

  it('draws the silhouette as a clean ellipse: row spans only widen toward the middle', () => {
    const span = (y: number): number => {
      let n = 0;
      for (let x = 0; x < width; x += 1) if (rug.alphaAt(x, y) > 0) n += 1;
      return n;
    };
    for (let y = 1; y < height / 2; y += 1) expect(span(y), `row ${y}`).toBeGreaterThanOrEqual(span(y - 1));
  });

  it('is deterministic and within the color budget', () => {
    expect(mosaicRug(facing).data).toEqual(rug.data);
    expect(countColors(rug)).toBeLessThanOrEqual(128);
  });
});
