import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PACK_FACINGS } from '../../src/game/artContract.ts';
import { recolorPixels } from '../../src/game/artColor.ts';
import { DEFAULT_TABLE_COLOR, tableSprite } from './domain/tables.ts';
import { DEFAULT_PLAIN_COLOR, plainTile } from './domain/tiles.ts';

/**
 * The office never runs the generators: it recolors the exported default-color
 * sheet at runtime (`recolorPixels`). These tests hold that runtime recolor to
 * what the exporter itself paints for the same color, so a change in the color
 * model that breaks one of the two shows up here.
 */

const COLORS = ['#c0392b', '#2c3e50', '#f1c40f', '#8e44ad', '#ffffff', '#101010'];

interface Drift {
  readonly mean: number;
  readonly offShare: number;
}

/** Mean of the worst channel error per visible pixel, and the share of pixels off by more than 8. */
function drift(actual: Uint8ClampedArray, expected: Uint8ClampedArray): Drift {
  let sum = 0;
  let off = 0;
  let count = 0;
  for (let i = 0; i < expected.length; i += 4) {
    if ((actual[i + 3] ?? 0) === 0 && (expected[i + 3] ?? 0) === 0) continue;
    let worst = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      worst = Math.max(worst, Math.abs((actual[i + channel] ?? 0) - (expected[i + channel] ?? 0)));
    }
    sum += worst;
    if (worst > 8) off += 1;
    count += 1;
  }
  return { mean: sum / count, offShare: off / count };
}

test('recoloring the exported plain floor matches the exporter painting it in that color', () => {
  const exported = plainTile().data;
  for (const color of COLORS) {
    const result = drift(recolorPixels(exported, DEFAULT_PLAIN_COLOR, color), plainTile(color).data);
    assert.ok(result.mean < 0.5, `${color}: mean drift ${result.mean}`);
    assert.equal(result.offShare, 0, `${color}: ${result.offShare} of the pixels drift`);
  }
});

test('recoloring the exported painted desk stays within a few levels of the exporter', () => {
  for (const facing of PACK_FACINGS) {
    const exported = tableSprite('painted', facing, DEFAULT_TABLE_COLOR).image.data;
    for (const color of COLORS) {
      const result = drift(recolorPixels(exported, DEFAULT_TABLE_COLOR, color), tableSprite('painted', facing, color).image.data);
      assert.ok(result.mean < 2, `${facing} ${color}: mean drift ${result.mean}`);
      assert.ok(result.offShare < 0.04, `${facing} ${color}: ${result.offShare} of the pixels drift`);
    }
  }
});
