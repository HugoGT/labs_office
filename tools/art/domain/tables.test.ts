import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PixelBuffer } from '../../../src/art/pixelBuffer.ts';
import { FACINGS } from '../../../src/art/seating.ts';
import { DESK } from '../../../src/game/artContract.ts';
import { TABLE_DEPTH_PX, TABLE_LONG_SIDE_PX, tableFloorRect } from '../../../src/game/deskTable.ts';
import { DEFAULT_GAMER_LIGHT, DEFAULT_TABLE_COLOR, TABLE_HEIGHT, TABLE_MATERIALS, tableSprite } from './tables.ts';
import { floorPoint } from './furnitureModel.ts';

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

test('a table is 84px long on screen, horizontal or vertical, so neighbouring desks stand closer (S19)', () => {
  // The floor run of the top along the long side, the outline aside: 2.625 tiles, grown from 80px.
  assert.equal(TABLE_LONG_SIDE_PX, 84);
  for (const { material, facing, sprite } of ALL) {
    const name = `${material} ${facing}`;
    assert.equal(sprite.floorLength, TABLE_LONG_SIDE_PX, name);
    const drawn = facing === 'up' || facing === 'down' ? sprite.image.width : sprite.image.height;
    assert.ok(drawn >= sprite.floorLength && drawn < 3 * 32 + 8, `${name}: ${drawn}`);
  }
});

test('the top grows in depth by the same 84/80 as in length, as close to the old 80x24 proportion as an even depth allows', () => {
  // The model is symmetric around the middle in whole pixels, so the depth is even: 26 is the even depth nearest 24 * 84 / 80.
  assert.equal(TABLE_DEPTH_PX, 26);
  const nearest = [24, 26, 28].sort((a, b) => Math.abs(80 / 24 - TABLE_LONG_SIDE_PX / a) - Math.abs(80 / 24 - TABLE_LONG_SIDE_PX / b))[0];
  assert.equal(TABLE_DEPTH_PX, nearest);
  for (const material of TABLE_MATERIALS.filter((m) => m !== 'curved')) {
    // Turned sideways the depth runs across the screen, untouched by DEPTH_SCALE.
    assert.equal(tableSprite(material, 'left').floorDepth, TABLE_DEPTH_PX, material);
    assert.equal(tableSprite(material, 'right').floorDepth, TABLE_DEPTH_PX, material);
  }
  // The horizontal facings widen by the 4px the long side gained (82 columns before, outline included).
  for (const material of TABLE_MATERIALS) for (const facing of ['up', 'down'] as const) assert.equal(tableSprite(material, facing).image.width, 86, `${material} ${facing}`);
});

test('the side facings span 100 rows and every facing still fits the 96x104 DESK cell', () => {
  // Before S19 the side facings spanned 97 rows (96 for the gamer and curved desks); the 4 rows of length round to 100 in all of them.
  for (const { material, facing, sprite } of ALL) {
    const name = `${material} ${facing}`;
    if (facing === 'left' || facing === 'right') assert.equal(sprite.image.height, 100, name);
    // Placed as deskSheet places it: the floor under its middle on DESK.anchor.
    const x = DESK.anchor.x - sprite.center.x;
    const y = DESK.anchor.y - sprite.center.y;
    assert.ok(x >= 0 && x + sprite.image.width <= DESK.frame.width, `${name}: columns ${x}..${x + sprite.image.width}`);
    assert.ok(y >= 0 && y + sprite.image.height <= DESK.frame.height, `${name}: rows ${y}..${y + sprite.image.height}`);
  }
});

test('a chair keeps the gap to the sitter edge of the top that it had at the 80px desk', () => {
  // In front of or behind the top: 3 floor rows past its edge. Beside it: 9 columns past it, so the seat stays clear of the top.
  for (const { material, facing, sprite } of ALL) {
    const name = `${material} ${facing}`;
    const { chairGround, center, floorDepth } = sprite;
    const offset = { x: chairGround.x - center.x, y: chairGround.y - center.y };
    const expected = { up: { x: 0, y: floorDepth / 2 + 3 }, down: { x: 0, y: -floorDepth / 2 - 3 }, left: { x: TABLE_DEPTH_PX / 2 + 9, y: 0 }, right: { x: -TABLE_DEPTH_PX / 2 - 9, y: 0 } }[facing];
    assert.deepEqual(offset, expected, name);
  }
});

test('the default collision under a desk is the floor its top covers', () => {
  // Shared with the server (deskTable.ts): rotation 0 faces down, 90 right.
  for (const material of TABLE_MATERIALS.filter((m) => m !== 'curved')) {
    const down = tableSprite(material, 'down');
    const right = tableSprite(material, 'right');
    assert.deepEqual([tableFloorRect(0).w, tableFloorRect(0).h], [down.floorLength, down.floorDepth], material);
    assert.deepEqual([tableFloorRect(90).w, tableFloorRect(90).h], [right.floorDepth, right.floorLength], material);
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

test('the wood, metal and curved desks have one flat color on their tops, with no lines', () => {
  // Past the curved desk's front half-ring on the far side, clear of the rims of every top.
  const SAMPLE = { wood: -10, metal: -10, curved: 6 } as const;
  for (const [material, firstU] of Object.entries(SAMPLE) as ['wood' | 'metal' | 'curved', number][]) {
    for (const facing of FACINGS) {
      const { image, center } = tableSprite(material, facing);
      const colors = new Set<string>();
      for (let u = firstU; u <= 10; u += 1) {
        for (let v = -30; v <= 30; v += 1) {
          const point = floorPoint(facing, u, v);
          const { r, g, b } = image.getPixel(center.x + point.x, center.y + point.y - TABLE_HEIGHT);
          colors.add(`${r},${g},${b}`);
        }
      }
      assert.equal(colors.size, 1, `${material} ${facing}: ${[...colors].join(' ')}`);
    }
  }
});

test('nothing on the curved desk is brighter than its flat top: the half-ring is only a cut, with no lit rim', () => {
  for (const facing of FACINGS) {
    const { image, center } = tableSprite('curved', facing);
    const point = floorPoint(facing, 8, 0);
    const flat = luma(image.getPixel(center.x + point.x, center.y + point.y - TABLE_HEIGHT));
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (image.alphaAt(x, y) === 255) assert.ok(luma(image.getPixel(x, y)) <= flat, `curved ${facing}: (${x}, ${y}) is brighter than the top`);
      }
    }
  }
});
