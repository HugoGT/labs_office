import { createHash } from 'node:crypto';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BASE_CHARACTERS, CHARACTERS } from './characters.ts';
import { DIRECTIONS } from './directions.ts';
import { PixelBuffer } from './pixelBuffer.ts';
import { WALK_FRAME_COUNT } from './walkCycle.ts';
import { FRAME_HEIGHT, FRAME_WIDTH, buildCharacterSprites, frameRect } from './spriteSheet.ts';

const sample = [CHARACTERS[0], CHARACTERS[5], CHARACTERS[11]].filter((c) => c !== undefined);
const sprites = sample.map((character) => buildCharacterSprites(character));

function crop(sheet: PixelBuffer, x: number, y: number): PixelBuffer {
  const cell = new PixelBuffer(FRAME_WIDTH, FRAME_HEIGHT);
  cell.blit(sheet, -x, -y);
  return cell;
}

function sameCell(a: PixelBuffer, b: PixelBuffer): boolean {
  return a.data.every((value, index) => value === b.data[index]);
}

test('the walk sheet is 8 direction rows by 10 frame columns', () => {
  for (const { walk, idle } of sprites) {
    assert.equal(walk.width, FRAME_WIDTH * WALK_FRAME_COUNT);
    assert.equal(walk.height, FRAME_HEIGHT * DIRECTIONS.length);
    assert.equal(idle.width, FRAME_WIDTH);
    assert.equal(idle.height, FRAME_HEIGHT * DIRECTIONS.length);
  }
  assert.deepEqual(frameRect('NE', 7), { x: 7 * FRAME_WIDTH, y: 3 * FRAME_HEIGHT, width: FRAME_WIDTH, height: FRAME_HEIGHT });
});

test('every frame contains a character that is not clipped by the cell border', () => {
  for (const { walk } of sprites) {
    for (const direction of DIRECTIONS) {
      for (let frame = 0; frame < WALK_FRAME_COUNT; frame += 1) {
        const rect = frameRect(direction, frame);
        const cell = crop(walk, rect.x, rect.y);
        assert.ok(cell.countOpaque() > 200, `${direction} ${frame} is too empty`);
        for (let x = 0; x < FRAME_WIDTH; x += 1) {
          assert.equal(cell.getPixel(x, 0).a, 0, `${direction} ${frame} touches the top`);
          assert.equal(cell.getPixel(x, FRAME_HEIGHT - 1).a, 0, `${direction} ${frame} touches the bottom`);
        }
        for (let y = 0; y < FRAME_HEIGHT; y += 1) {
          assert.equal(cell.getPixel(0, y).a, 0, `${direction} ${frame} touches the left edge`);
          assert.equal(cell.getPixel(FRAME_WIDTH - 1, y).a, 0, `${direction} ${frame} touches the right edge`);
        }
      }
    }
  }
});

test('the animation changes from frame to frame and each direction looks different', () => {
  for (const { walk } of sprites) {
    for (const direction of DIRECTIONS) {
      const first = frameRect(direction, 0);
      const second = frameRect(direction, 2);
      assert.ok(!sameCell(crop(walk, first.x, first.y), crop(walk, second.x, second.y)), direction);
    }
    const cells = DIRECTIONS.map((direction) => {
      const rect = frameRect(direction, 0);
      return crop(walk, rect.x, rect.y);
    });
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        assert.ok(!sameCell(cells[i] as PixelBuffer, cells[j] as PixelBuffer), `${DIRECTIONS[i]} vs ${DIRECTIONS[j]}`);
      }
    }
  }
});

/**
 * Walk plus idle pixels of every base character, hashed before the sitting rig was added. A
 * mismatch means the standing or walking look changed; update a line only for an intended edit.
 */
const WALK_IDLE_HASHES: Readonly<Record<string, string>> = {
  'p01-burgundy-suit': '9d24c10c24788550',
  'p02-beige-blazer': 'd5ba6b1740b63761',
  'p03-forest-suit': '871f47b3f0bfa487',
  'p04-coral-skirt': 'a4d8e2415bfc7840',
  'p05-charcoal-suit': '31ecb9858b030abf',
  'p06-lavender-blouse': '3bccad50f9f2f9bc',
  'p07-green-suit': 'cee41b8e103653ed',
  'p08-purple-suit': 'e2b50fd92ee3a0fa',
  'p09-mint-shirt': 'bf7ad7bda85ca083',
  'p10-orange-blazer': '586bd164149264b6',
  'p11-white-blouse': '26c73f021bc48d76',
  'p12-mint-blazer': '1eda57ccf2cbc8a2',
  'p13-red-suit': 'db76bd20bc46bb9f',
  'p14-blue-suit': '2a2d72bba60cc718',
  'p15-yellow-shirt': '8381f1ff7b9abc86',
  'p16-pink-ponytail': '266c2d1493d65093',
  'p17-blue-wide-pants': '91ade1e8c6116d51',
  'p18-yellow-coat': 'c0b7c73a89531746',
};

test('walk and idle frames of the base characters are byte-identical to the locked look', () => {
  for (const character of BASE_CHARACTERS) {
    const { walk, idle } = buildCharacterSprites(character);
    const hash = createHash('sha256').update(walk.data).update(idle.data).digest('hex').slice(0, 16);
    assert.equal(hash, WALK_IDLE_HASHES[character.id], character.id);
  }
  // Renders every base character: ~2s alone, past the 5s default on a loaded CI runner.
}, 60_000);
