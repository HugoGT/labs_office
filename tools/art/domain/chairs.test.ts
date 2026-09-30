import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CHAIR_MATERIALS, chairSprite, type ChairSprite } from './chairs.ts';
import { PixelBuffer } from './pixelBuffer.ts';
import { FACINGS, SEAT_BLOCK, SEAT_HEIGHT } from './seating.ts';

const luma = (p: { r: number; g: number; b: number }): number => p.r * 0.3 + p.g * 0.59 + p.b * 0.11;

const ALL = CHAIR_MATERIALS.flatMap((material) => FACINGS.map((facing) => ({ material, facing, sprite: chairSprite(material, facing) })));

/** Both layers composited, back first, as a chair without a sitter is drawn. */
function composite(sprite: ChairSprite): PixelBuffer {
  const out = new PixelBuffer(sprite.back.width, sprite.back.height, sprite.back.data.slice());
  out.blit(sprite.front, 0, 0);
  return out;
}

function opaqueRows(image: PixelBuffer, from: number, to: number): number {
  let count = 0;
  for (let y = Math.max(0, from); y < Math.min(image.height, to); y += 1) {
    for (let x = 0; x < image.width; x += 1) if (image.alphaAt(x, y) === 255) count += 1;
  }
  return count;
}

test('every chair, facing and layer fits in a SEAT_BLOCK box, shadow and outline included', () => {
  assert.equal(ALL.length, 16);
  for (const { material, facing, sprite } of ALL) {
    const name = `${material} ${facing}`;
    assert.ok(sprite.back.width <= SEAT_BLOCK && sprite.back.height <= SEAT_BLOCK, `${name}: ${sprite.back.width}x${sprite.back.height}`);
    assert.deepEqual([sprite.front.width, sprite.front.height], [sprite.back.width, sprite.back.height], `${name}: layers share size`);
    assert.ok(sprite.back.countOpaque() > 40, `${name}: back layer is drawn`);
  }
});

test('the seat point sits SEAT_HEIGHT above the ground point, both inside the sprite', () => {
  for (const { material, facing, sprite } of ALL) {
    const name = `${material} ${facing}`;
    assert.equal(sprite.seat.x, sprite.ground.x, name);
    assert.equal(sprite.seat.y, sprite.ground.y - SEAT_HEIGHT, name);
    for (const point of [sprite.seat, sprite.ground]) {
      assert.ok(Number.isInteger(point.x) && Number.isInteger(point.y), `${name}: whole pixels`);
      assert.ok(point.x >= 0 && point.y >= 0 && point.x < sprite.back.width && point.y < sprite.back.height, `${name}: inside`);
    }
    // The seat surface itself is drawn under the pelvis (or hidden right behind a backrest).
    assert.equal(composite(sprite).alphaAt(sprite.seat.x, sprite.seat.y), 255, `${name}: seat pixel is solid`);
  }
});

test('the backrest goes behind a sitter facing the viewer and in front of one facing away', () => {
  for (const material of CHAIR_MATERIALS) {
    const down = chairSprite(material, 'down');
    const up = chairSprite(material, 'up');
    assert.ok(opaqueRows(down.back, 0, down.seat.y - 4) > 20, `${material} down: backrest above the seat, behind the sitter`);
    assert.ok(opaqueRows(down.front, 0, down.seat.y - 4) === 0, `${material} down: nothing covers the sitter's torso`);
    assert.ok(opaqueRows(up.front, 0, up.seat.y) > 20, `${material} up: backrest covers the sitter's back`);
  }
});

test('armrests over the sitter legs are in front only on the near side of a side view', () => {
  for (const facing of ['left', 'right'] as const) {
    for (const material of ['leather', 'gamer'] as const) {
      const sprite = chairSprite(material, facing);
      assert.ok(sprite.front.countOpaque() > 10, `${material} ${facing}: near armrest in front`);
      assert.ok(opaqueRows(sprite.front, 0, sprite.seat.y - 8) === 0, `${material} ${facing}: the front layer stays low`);
    }
  }
  for (const facing of FACINGS) {
    for (const material of ['wood', 'metal'] as const) {
      if (facing !== 'up') assert.equal(chairSprite(material, facing).front.countOpaque(), 0, `${material} ${facing}: no arms, nothing in front`);
    }
  }
});

test('left and right face opposite ways and every chair is its own drawing', () => {
  const keys = new Set(ALL.map(({ sprite }) => [sprite.back.data.join(), sprite.front.data.join()].join('|')));
  assert.equal(keys.size, 16);
  for (const material of CHAIR_MATERIALS) {
    const right = chairSprite(material, 'right');
    const left = chairSprite(material, 'left');
    // The backrest is behind the pelvis: west of it facing right, east of it facing left.
    const massX = (image: PixelBuffer, fromY: number, toY: number): number => {
      let sum = 0;
      let n = 0;
      for (let y = fromY; y < toY; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          if (image.alphaAt(x, y) === 255) {
            sum += x;
            n += 1;
          }
        }
      }
      return sum / n;
    };
    assert.ok(massX(right.back, 0, right.seat.y - 6) < right.seat.x, `${material} right: backrest west of the seat`);
    assert.ok(massX(left.back, 0, left.seat.y - 6) > left.seat.x, `${material} left: backrest east of the seat`);
  }
});

test('every chair has a 1px dark outline and a soft contact shadow', () => {
  for (const { material, facing, sprite } of ALL) {
    const image = composite(sprite);
    let edge = 0;
    let dark = 0;
    let shadow = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const a = image.alphaAt(x, y);
        if (a > 0 && a < 255) shadow += 1;
        if (a !== 255) continue;
        const open = [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ].some(([ox, oy]) => image.alphaAt(x + (ox as number), y + (oy as number)) < 255);
        if (!open) continue;
        edge += 1;
        if (luma(image.getPixel(x, y)) < 60) dark += 1;
      }
    }
    assert.ok(dark === edge, `${material} ${facing}: ${edge - dark} light edge pixels`);
    assert.ok(shadow > 6, `${material} ${facing}: contact shadow`);
  }
});

test('the gamer chair is the tallest and carries its accent color', () => {
  for (const facing of FACINGS) {
    // Sprites are cropped to the chair, so the ground row is the chair's height above the floor.
    const heights = CHAIR_MATERIALS.map((material) => chairSprite(material, facing).ground.y);
    const gamer = heights[CHAIR_MATERIALS.indexOf('gamer')] as number;
    assert.ok(heights.every((h) => h <= gamer), `${facing}: ${heights.join(',')}`);
    const image = composite(chairSprite('gamer', facing));
    let accent = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      const [r, g, b] = [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0];
      if ((image.data[i + 3] ?? 0) === 255 && r > 150 && r > g * 2 && r > b * 2) accent += 1;
    }
    assert.ok(accent >= 4, `gamer ${facing}: ${accent} accent pixels`);
  }
});

test('chairs are cached and deterministic', () => {
  assert.equal(chairSprite('wood', 'up'), chairSprite('wood', 'up'));
});
