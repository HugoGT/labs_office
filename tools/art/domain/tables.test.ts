import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PixelBuffer } from './pixelBuffer.ts';
import { FACINGS } from './seating.ts';
import { DEFAULT_TABLE_COLOR, TABLE_MATERIALS, tableSprite } from './tables.ts';

const luma = (p: { r: number; g: number; b: number }): number => p.r * 0.3 + p.g * 0.59 + p.b * 0.11;

const ALL = TABLE_MATERIALS.flatMap((material) => FACINGS.map((facing) => ({ material, facing, sprite: tableSprite(material, facing) })));

function alphaMask(image: PixelBuffer): string {
  const mask: number[] = [];
  for (let i = 3; i < image.data.length; i += 4) mask.push(image.data[i] ?? 0);
  return mask.join();
}

function mirrored(image: PixelBuffer): PixelBuffer {
  return image.mirroredHorizontally();
}

test('tables are wide facing up or down and deep facing left or right, small enough for a room with a chair', () => {
  for (const { material, facing, sprite } of ALL) {
    const { width, height } = sprite.image;
    const name = `${material} ${facing}`;
    if (facing === 'up' || facing === 'down') assert.ok(width > height * 1.4, `${name}: ${width}x${height}`);
    else assert.ok(height > width * 1.4, `${name}: ${width}x${height}`);
    assert.ok(width <= 60 && height <= 60, `${name}: ${width}x${height}`);
  }
});

test('the four facings are genuinely different drawings, not rotated or mirrored copies', () => {
  for (const material of TABLE_MATERIALS) {
    const [up, down, left, right] = FACINGS.map((facing) => tableSprite(material, facing).image);
    assert.deepEqual([up?.width, up?.height], [down?.width, down?.height]);
    assert.notDeepEqual(up?.data, down?.data, `${material}: up and down differ`);
    assert.notDeepEqual(mirrored(left as PixelBuffer).data, (right as PixelBuffer).data, `${material}: left is not a mirrored right`);
    assert.notDeepEqual(left?.data, right?.data, `${material}: left and right differ`);
  }
});

test('the chair spot is on the side a sitter with the same facing takes', () => {
  for (const { material, facing, sprite } of ALL) {
    const { chairGround, ground, center } = sprite;
    const name = `${material} ${facing}`;
    if (facing === 'up') assert.ok(chairGround.y > ground.y, `${name}: chair south of the table and drawn after it`);
    if (facing === 'down') assert.ok(chairGround.y < center.y, `${name}: chair north of the table`);
    if (facing === 'left') assert.ok(chairGround.x > center.x + sprite.image.width / 3, `${name}: chair east of the table`);
    if (facing === 'right') assert.ok(chairGround.x < center.x - sprite.image.width / 3, `${name}: chair west of the table`);
    if (facing === 'down' || facing === 'left' || facing === 'right') assert.ok(chairGround.y < ground.y, `${name}: the table is drawn after its chair`);
    // The ground point is the floor line under the front edge: below the center, inside the sprite.
    assert.ok(ground.y > center.y && ground.y < sprite.image.height && ground.x === center.x, `${name}: front contact`);
    for (const point of [chairGround, ground, center]) assert.ok(Number.isInteger(point.x) && Number.isInteger(point.y), name);
  }
});

test('beside a table, the seat stays clear of the top so the table never covers the sitter', () => {
  // A side sitter sorts before the table, so its head and chest must not reach over the top.
  const CLEARANCE = 7;
  for (const { material, facing, sprite } of ALL) {
    const { chairGround, image } = sprite;
    if (facing === 'left') assert.ok(chairGround.x >= image.width - 1 + CLEARANCE, `${material} left: ${chairGround.x}`);
    if (facing === 'right') assert.ok(chairGround.x <= -CLEARANCE, `${material} right: ${chairGround.x}`);
  }
});

test('glass tops are translucent so the legs and floor show through; other tables are opaque', () => {
  for (const { material, facing, sprite } of ALL) {
    let translucent = 0;
    for (let i = 3; i < sprite.image.data.length; i += 4) {
      const a = sprite.image.data[i] ?? 0;
      if (a > 0 && a < 200) translucent += 1;
    }
    const area = sprite.image.width * sprite.image.height;
    if (material === 'glass') assert.ok(translucent > area * 0.25, `glass ${facing}: ${translucent} translucent pixels`);
    else assert.ok(translucent < area * 0.25, `${material} ${facing}: only the contact shadow is translucent`);
  }
});

test('painted tables take any color and keep their shape', () => {
  for (const facing of FACINGS) {
    const red = tableSprite('painted', facing, '#c83c3c').image;
    const blue = tableSprite('painted', facing, '#3c5ac8').image;
    assert.equal(alphaMask(red), alphaMask(blue), `${facing}: same silhouette`);
    assert.notDeepEqual(red.data, blue.data);
    const center = red.getPixel(Math.floor(red.width / 2), Math.floor(red.height / 3));
    assert.ok(center.r > center.b, `${facing}: red table is red`);
    assert.deepEqual(tableSprite('painted', facing).image.data, tableSprite('painted', facing, DEFAULT_TABLE_COLOR).image.data);
  }
});

test('every table has a 1px dark outline', () => {
  for (const { material, facing, sprite } of ALL) {
    const image = sprite.image;
    let light = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (image.alphaAt(x, y) !== 255) continue;
        const open = [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ].some(([ox, oy]) => image.alphaAt(x + (ox as number), y + (oy as number)) === 0);
        if (open && luma(image.getPixel(x, y)) >= 60) light += 1;
      }
    }
    assert.equal(light, 0, `${material} ${facing}: light pixels on the silhouette edge`);
  }
});
