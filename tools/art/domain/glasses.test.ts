import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CHARACTERS } from './characters.ts';
import { hexToRgba } from './color.ts';
import type { Rgba } from './pixelBuffer.ts';
import { buildCharacterSprites, frameRect } from './spriteSheet.ts';

const LENS = hexToRgba('#c4e6f5');

function same(a: Rgba, b: Rgba): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

test('glasses frames do not join into a single brow line above the eyes', () => {
  const wearers = CHARACTERS.filter((character) => character.glasses);
  assert.ok(wearers.length >= 1);
  for (const character of wearers) {
    const { idle } = buildCharacterSprites(character);
    const cell = frameRect('S', 0);
    const lenses: { x: number; y: number }[] = [];
    for (let y = cell.y; y < cell.y + cell.height; y += 1) {
      for (let x = cell.x; x < cell.x + cell.width; x += 1) {
        if (same(idle.getPixel(x, y), LENS)) lenses.push({ x, y });
      }
    }
    assert.equal(lenses.length, 2, `${character.id}: expected two lenses in the front view`);
    const [left, right] = lenses as [{ x: number; y: number }, { x: number; y: number }];
    const skin = hexToRgba(character.palette.skin);
    const gap: number[] = [];
    for (let x = left.x + 1; x < right.x; x += 1) {
      if (same(idle.getPixel(x, left.y - 1), skin)) gap.push(x);
    }
    assert.equal(gap.length, 1, `${character.id}: expected one skin pixel splitting the brow line`);
  }
});
