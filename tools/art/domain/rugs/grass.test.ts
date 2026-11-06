import { describe, expect, it } from 'vitest';
import { countColors } from '../../../../src/game/artContract.ts';
import type { PixelBuffer, Rgba } from '../../../../src/art/pixelBuffer.ts';
import { grassTile } from '../tiles.ts';
import { GRASS_RUG_BORDER, GRASS_RUG_TUFT, grassRug } from './grass.ts';
import { RUG_BELOW, RUG_FACINGS, rugFootprint } from './shared.ts';

function luma({ r, g, b }: Rgba): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const same = (a: Rgba, b: Rgba): boolean => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/** Bottom pixels of the little "v" tufts in the field: one tuft pixel with two more up-left and up-right. */
function tuftPositions(image: PixelBuffer): { x: number; y: number }[] {
  const found: { x: number; y: number }[] = [];
  for (let y = 1; y < image.height; y += 1) {
    for (let x = 1; x < image.width - 1; x += 1) {
      const isTuft = (px: number, py: number): boolean => same(image.getPixel(px, py), GRASS_RUG_TUFT);
      if (isTuft(x, y) && isTuft(x - 1, y - 1) && isTuft(x + 1, y - 1)) found.push({ x, y });
    }
  }
  return found;
}

function meanLuma(image: PixelBuffer): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = image.getPixel(x, y);
      if (pixel.a === 0) continue;
      sum += luma(pixel);
      count += 1;
    }
  }
  return sum / count;
}

describe.each(RUG_FACINGS)('grassRug(%s)', (facing) => {
  const rug = grassRug(facing);
  const { width, height } = rugFootprint(facing);

  it('is the footprint plus the rows below it', () => {
    expect(rug.width).toBe(width);
    expect(rug.height).toBe(height + RUG_BELOW);
  });

  it('paints nothing below the footprint', () => {
    for (let y = height; y < rug.height; y += 1) {
      for (let x = 0; x < width; x += 1) expect(rug.alphaAt(x, y)).toBe(0);
    }
  });

  it('covers the footprint centre with opaque pixels', () => {
    for (let y = height / 2 - 8; y < height / 2 + 8; y += 1) {
      for (let x = width / 2 - 8; x < width / 2 + 8; x += 1) expect(rug.alphaAt(x, y)).toBe(255);
    }
  });

  it('paints only fully opaque or fully transparent pixels', () => {
    for (let i = 3; i < rug.data.length; i += 4) expect([0, 255]).toContain(rug.data[i]);
  });

  it('outlines its whole ragged silhouette with the border tone', () => {
    const offsets = [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ] as const;
    let edges = 0;
    for (let y = 0; y < rug.height; y += 1) {
      for (let x = 0; x < rug.width; x += 1) {
        if (rug.alphaAt(x, y) === 0) continue;
        if (!offsets.some(([ox, oy]) => rug.alphaAt(x + ox, y + oy) === 0)) continue;
        edges += 1;
        expect(rug.getPixel(x, y), `edge pixel (${x}, ${y})`).toEqual(GRASS_RUG_BORDER);
      }
    }
    // A ragged edge is much longer than the footprint's perimeter.
    expect(edges).toBeGreaterThan(2 * (width + height));
  });

  it('scatters field tufts over the whole interior, corners and sides included', () => {
    // The calm field inside the sunlit band, split into a grid of regions: random scattering once
    // left the left side and the top-right corner bare.
    const inset = 18;
    const [cols, rows] = width > height ? [3, 2] : [2, 3];
    const cellW = (width - 2 * inset) / cols;
    const cellH = (height - 2 * inset) / rows;
    const tufts = tuftPositions(rug);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const left = inset + col * cellW;
        const top = inset + row * cellH;
        const inside = tufts.filter(({ x, y }) => x >= left && x < left + cellW && y >= top && y < top + cellH);
        expect(inside.length, `region ${col},${row} of ${facing}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the field tufts away from the contour', () => {
    for (const { x, y } of tuftPositions(rug)) {
      for (const [px, py] of [
        [x, y],
        [x - 1, y - 1],
        [x + 1, y - 1],
      ] as const) {
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            expect(same(rug.getPixel(px + dx, py + dy), GRASS_RUG_BORDER), `tuft at (${x}, ${y})`).toBe(false);
          }
        }
      }
    }
  });

  it('is a darker grass than the grass terrain', () => {
    expect(meanLuma(rug)).toBeLessThan(meanLuma(grassTile()));
  });

  it('is deterministic', () => {
    expect(grassRug(facing).data).toEqual(rug.data);
  });

  it('fits the 128 colors of a sheet', () => {
    expect(countColors(rug)).toBeLessThanOrEqual(128);
  });
});
