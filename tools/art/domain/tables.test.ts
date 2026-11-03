import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PixelBuffer } from '../../../src/art/pixelBuffer.ts';
import { FACINGS } from '../../../src/art/seating.ts';
import { DEFAULT_GAMER_LIGHT, DEFAULT_TABLE_COLOR, TABLE_MATERIALS, tableSprite } from './tables.ts';

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
    assert.ok(width <= 96 && height <= 104, `${name}: ${width}x${height}`);
  }
});

test('a table is about 2.5 tiles long on screen, horizontal or vertical, so it sits centered on a 3-tile desk edge', () => {
  // The floor run of the top along the long side: 80px, 2.4 to 2.6 tiles, the outline aside.
  for (const { material, facing, sprite } of ALL) {
    const name = `${material} ${facing}`;
    const { floorLength } = sprite;
    assert.ok(floorLength >= 2.4 * 32 && floorLength <= 2.6 * 32, `${name}: ${floorLength}`);
    const drawn = facing === 'up' || facing === 'down' ? sprite.image.width : sprite.image.height;
    assert.ok(drawn >= floorLength && drawn < 3 * 32 + 8, `${name}: ${drawn}`);
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
    // The long top leaves a wide knee space facing up, where the contact shadow shows: still well under glass.
    else assert.ok(translucent < area * 0.3, `${material} ${facing}: only the contact shadow is translucent`);
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

test('the gamer desk is all black but for the lights along its two sides, which take any color', () => {
  for (const facing of FACINGS) {
    const exported = tableSprite('gamer', facing).image;
    const teal = tableSprite('gamer', facing, '#2ec4b6').image;
    assert.equal(alphaMask(teal), alphaMask(exported), `${facing}: same silhouette`);
    let lights = 0;
    let body = 0;
    let bright = 0;
    for (let i = 0; i < exported.data.length; i += 4) {
      if ((exported.data[i + 3] ?? 0) !== 255) continue;
      const before = [exported.data[i] ?? 0, exported.data[i + 1] ?? 0, exported.data[i + 2] ?? 0];
      const after = [teal.data[i] ?? 0, teal.data[i + 1] ?? 0, teal.data[i + 2] ?? 0];
      if (before.join() !== after.join()) {
        lights += 1;
        continue;
      }
      body += 1;
      if (luma({ r: before[0]!, g: before[1]!, b: before[2]! }) > 70) bright += 1;
    }
    assert.ok(lights >= 20, `${facing}: ${lights} light pixels take the color`);
    assert.ok(body > lights * 2, `${facing}: the lights are a trim, not the desk`);
    assert.equal(bright, 0, `${facing}: everything but the lights is black`);
  }
  assert.deepEqual(tableSprite('gamer', 'up').image.data, tableSprite('gamer', 'up', DEFAULT_GAMER_LIGHT).image.data);
});

test('the gamer lights run along the two short sides of the top, and nowhere in the middle', () => {
  const image = tableSprite('gamer', 'up').image;
  const painted = tableSprite('gamer', 'up', '#2ec4b6').image;
  const changed = (x: number, y: number): boolean => image.getPixel(x, y).g !== painted.getPixel(x, y).g;
  const columns = new Set<number>();
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) if (changed(x, y)) columns.add(x);
  const middle = image.width / 2;
  assert.ok([...columns].every((x) => Math.abs(x - middle) > image.width / 3), `light columns ${[...columns].join(',')}`);
  assert.ok([...columns].some((x) => x < middle) && [...columns].some((x) => x > middle), 'lights on both sides');
});

test('the curved desk rounds off its far corners and opens a half-ring at the front for the sitter', () => {
  const curved = tableSprite('curved', 'up');
  const wood = tableSprite('wood', 'up');
  const { image } = curved;
  // Facing up the far side is at the top of the sprite: its corners are cut where the wooden desk's are solid.
  const topRow = (sprite: typeof curved): number => {
    for (let y = 0; y < sprite.image.height; y += 1) if (sprite.image.alphaAt(sprite.center.x, y) === 255) return y;
    return -1;
  };
  const top = topRow(curved);
  assert.equal(wood.image.alphaAt(2, topRow(wood) + 1), 255, 'wood: square far corner');
  assert.ok(image.alphaAt(2, top + 1) < 255, 'curved: left far corner cut');
  assert.ok(image.alphaAt(image.width - 3, top + 1) < 255, 'curved: right far corner cut');
  // Facing down the sitter's side is the top edge of the sprite: the notch starts the top lower in the middle than beside it.
  const firstOpaque = (image: PixelBuffer, x: number): number => {
    for (let y = 0; y < image.height; y += 1) if (image.alphaAt(x, y) === 255) return y;
    return -1;
  };
  const down = tableSprite('curved', 'down').image;
  assert.ok(firstOpaque(down, down.width / 2) - firstOpaque(down, down.width / 4) >= 4, 'curved: the half-ring is cut into the sitter side');
});
