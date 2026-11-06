import { test } from 'vitest';
import assert from 'node:assert/strict';
import { countColors } from '../../../../src/game/artContract.ts';
import { recolorPixels } from '../../../../src/game/artColor.ts';
import { makeRamp } from '../color.ts';
import { RUG_BELOW, RUG_FACINGS, rugFootprint } from './shared.ts';
import { DEFAULT_RUG_COLOR, wovenRug } from './woven.ts';

const OTHER_COLOR = '#3a7bd5';
const same = (a: { r: number; g: number; b: number; a: number }, b: { r: number; g: number; b: number; a: number }): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

for (const facing of RUG_FACINGS) {
  test(`woven ${facing}: canvas is the footprint plus RUG_BELOW rows`, () => {
    const rug = wovenRug(facing);
    const { width, height } = rugFootprint(facing);
    assert.equal(rug.width, width);
    assert.equal(rug.height, height + RUG_BELOW);
  });

  test(`woven ${facing}: the whole footprint is opaque and its perimeter is the ramp's deep tone`, () => {
    const rug = wovenRug(facing);
    const { width, height } = rugFootprint(facing);
    const border = makeRamp(DEFAULT_RUG_COLOR).deep;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        assert.equal(rug.alphaAt(x, y), 255, `(${x},${y}) opaque`);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) assert.ok(same(rug.getPixel(x, y), border), `(${x},${y}) border`);
      }
    }
  });

  test(`woven ${facing}: only the last opaque row is the outline, the row above follows the body pattern`, () => {
    const rug = wovenRug(facing);
    const { width, height } = rugFootprint(facing);
    for (let y = height; y < rug.height; y += 1) {
      for (let x = 0; x < width; x += 1) assert.equal(rug.alphaAt(x, y), 0, `(${x},${y}) below the footprint is transparent`);
    }
    const ramp = makeRamp(DEFAULT_RUG_COLOR);
    const key = (p: { r: number; g: number; b: number }): string => `${p.r},${p.g},${p.b}`;
    // Tones the body uses away from the bottom edge, the bottom-most outline row excluded.
    const body = new Set<string>();
    for (let y = 1; y < height - 2; y += 1) for (let x = 1; x < width - 1; x += 1) body.add(key(rug.getPixel(x, y)));
    const deep = key(ramp.deep);
    for (let x = 1; x < width - 1; x += 1) {
      const above = rug.getPixel(x, height - 2);
      assert.notEqual(key(above), deep, `(${x},${height - 2}) is not a second outline row`);
      assert.ok(body.has(key(above)), `(${x},${height - 2}) uses a body pattern tone`);
    }
  });

  test(`woven ${facing}: the fringe sits on the short ends`, () => {
    const rug = wovenRug(facing);
    const { width, height } = rugFootprint(facing);
    // Fringe stripes alternate along the short end; the long sides keep a plain border band.
    const distinct = (pixels: { r: number; g: number; b: number; a: number }[]): number =>
      new Set(pixels.map((p) => `${p.r},${p.g},${p.b}`)).size;
    const horizontal = facing === 'horizontal';
    const end = horizontal
      ? Array.from({ length: height - 2 }, (_, i) => rug.getPixel(2, i + 1))
      : Array.from({ length: width - 2 }, (_, i) => rug.getPixel(i + 1, 2));
    assert.ok(distinct(end) >= 2, 'fringe stripes along the short end');
    const shortSide = horizontal ? height : width;
    const longSide = horizontal ? width : height;
    assert.ok(longSide > shortSide);
  });

  test(`woven ${facing}: every opaque pixel is paint of the rug's ramp`, () => {
    const rug = wovenRug(facing);
    const recolored = recolorPixels(rug.data, DEFAULT_RUG_COLOR, OTHER_COLOR);
    const back = recolorPixels(recolored, OTHER_COLOR, DEFAULT_RUG_COLOR);
    for (let i = 0; i < rug.data.length; i += 4) {
      if ((rug.data[i + 3] ?? 0) === 0) continue;
      const before = [rug.data[i], rug.data[i + 1], rug.data[i + 2]];
      const after = [recolored[i], recolored[i + 1], recolored[i + 2]];
      assert.notDeepEqual(after, before, `pixel ${i / 4} recolors`);
      for (let c = 0; c < 3; c += 1) assert.ok(Math.abs((back[i + c] ?? 0) - (rug.data[i + c] ?? 0)) <= 3, `pixel ${i / 4} round-trips`);
    }
  });

  test(`woven ${facing}: recoloring through the parameter matches the runtime recolor`, () => {
    const painted = wovenRug(facing, OTHER_COLOR);
    const recolored = recolorPixels(wovenRug(facing).data, DEFAULT_RUG_COLOR, OTHER_COLOR);
    for (let i = 0; i < painted.data.length; i += 1) assert.ok(Math.abs((painted.data[i] ?? 0) - (recolored[i] ?? 0)) <= 3, `byte ${i}`);
  });

  test(`woven ${facing}: deterministic and within the color budget`, () => {
    const a = wovenRug(facing);
    const b = wovenRug(facing);
    assert.deepEqual(a.data, b.data);
    assert.ok(countColors(a) <= 128, `${countColors(a)} colors`);
  });
}
