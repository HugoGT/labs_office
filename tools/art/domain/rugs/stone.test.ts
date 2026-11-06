import { test } from 'vitest';
import assert from 'node:assert/strict';
import { countColors } from '../../../../src/game/artContract.ts';
import { RUG_BELOW, RUG_FACINGS, rugFootprint } from './shared.ts';
import { STONE_RUG_TONES, stoneRug } from './stone.ts';

type Pixel = { r: number; g: number; b: number; a: number };
const same = (a: Pixel, b: Pixel): boolean => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

for (const facing of RUG_FACINGS) {
  test(`stone ${facing}: canvas is the footprint plus RUG_BELOW rows`, () => {
    const rug = stoneRug(facing);
    const { width, height } = rugFootprint(facing);
    assert.equal(rug.width, width);
    assert.equal(rug.height, height + RUG_BELOW);
  });

  test(`stone ${facing}: nothing is drawn outside the footprint and the silhouette covers most of it`, () => {
    const rug = stoneRug(facing);
    const { width, height } = rugFootprint(facing);
    let opaque = 0;
    for (let y = 0; y < rug.height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const a = rug.alphaAt(x, y);
        assert.ok(a === 0 || a === 255, `(${x},${y}) is fully opaque or fully transparent`);
        if (y >= height) assert.equal(a, 0, `(${x},${y}) transparent below the footprint`);
        else if (a === 255) opaque += 1;
      }
    }
    assert.ok(opaque > width * height * 0.8, `the rug fills its footprint (${opaque}/${width * height})`);
  });

  test(`stone ${facing}: the edge follows the stones on every side instead of a straight line`, () => {
    const rug = stoneRug(facing);
    const { width, height } = rugFootprint(facing);
    const sides = {
      top: Array.from({ length: width }, (_, x) => [x, 0] as const),
      bottom: Array.from({ length: width }, (_, x) => [x, height - 1] as const),
      left: Array.from({ length: height }, (_, y) => [0, y] as const),
      right: Array.from({ length: height }, (_, y) => [width - 1, y] as const),
    };
    for (const [side, pixels] of Object.entries(sides)) {
      const opaque = pixels.filter(([x, y]) => rug.alphaAt(x, y) === 255);
      assert.ok(opaque.length > 0, `${side}: the outer stones reach the footprint edge`);
      assert.ok(opaque.length < pixels.length * 0.75, `${side}: gaps between the outer stones are transparent`);
      for (const [x, y] of opaque) assert.ok(same(rug.getPixel(x, y), STONE_RUG_TONES.border), `${side} (${x},${y}) outline`);
    }
  });

  test(`stone ${facing}: a 1px outline closes the silhouette and nothing else uses its tone`, () => {
    const rug = stoneRug(facing);
    const { width, height } = rugFootprint(facing);
    const clear = (x: number, y: number): boolean => x < 0 || y < 0 || x >= width || y >= height || rug.alphaAt(x, y) === 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (rug.alphaAt(x, y) === 0) continue;
        const touchesOutside = clear(x - 1, y) || clear(x + 1, y) || clear(x, y - 1) || clear(x, y + 1);
        const touchesOutsideDiagonally = touchesOutside || clear(x - 1, y - 1) || clear(x + 1, y - 1) || clear(x - 1, y + 1) || clear(x + 1, y + 1);
        const isBorder = same(rug.getPixel(x, y), STONE_RUG_TONES.border);
        if (touchesOutside) assert.ok(isBorder, `(${x},${y}) edge pixel is the outline`);
        if (isBorder) assert.ok(touchesOutsideDiagonally, `(${x},${y}) outline is one pixel thick`);
      }
    }
  });

  test(`stone ${facing}: stones sit on mortar inside the outline`, () => {
    const rug = stoneRug(facing);
    const { width, height } = rugFootprint(facing);
    let mortar = 0;
    let stone = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = rug.getPixel(x, y);
        if (p.a === 0 || same(p, STONE_RUG_TONES.border)) continue;
        if (STONE_RUG_TONES.mortar.some((m) => same(m, p))) mortar += 1;
        else stone += 1;
      }
    }
    const inside = mortar + stone;
    assert.ok(stone > inside * 0.6, `stones cover most of the rug (${stone}/${inside})`);
    assert.ok(mortar > inside * 0.1, `mortar shows between stones (${mortar}/${inside})`);
  });

  test(`stone ${facing}: deterministic and within the color budget`, () => {
    const a = stoneRug(facing);
    const b = stoneRug(facing);
    assert.deepEqual(a.data, b.data);
    assert.ok(countColors(a) <= 128, `${countColors(a)} colors`);
  });
}
