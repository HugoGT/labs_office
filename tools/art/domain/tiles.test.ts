import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CHARACTER_HEIGHT, FRAME_HEIGHT } from './camera.ts';
import { CHARACTERS } from './characters.ts';
import { hexToRgba } from './color.ts';
import { buildCharacterSprites } from './spriteSheet.ts';
import { grassTile, plainTile, terrainTile, TERRAINS, TILE_SIZE, waterTile, woodTile } from './tiles.ts';

function opaqueRows(image: { width: number; height: number; alphaAt(x: number, y: number): number }): number[] {
  const rows: number[] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.alphaAt(x, y) > 0) {
        rows.push(y);
        break;
      }
    }
  }
  return rows;
}

test('CHARACTER_HEIGHT matches the tallest standing sprite', () => {
  const heights = CHARACTERS.map((character) => {
    const rows = opaqueRows(buildCharacterSprites(character).idle).filter((y) => y < FRAME_HEIGHT);
    return Math.max(...rows) - Math.min(...rows) + 1;
  });
  assert.equal(Math.max(...heights), CHARACTER_HEIGHT);
});

test('tiles are square and twice as tall as a character', () => {
  assert.equal(TILE_SIZE, CHARACTER_HEIGHT * 2);
  for (const terrain of TERRAINS) {
    const tile = terrainTile(terrain);
    assert.equal(tile.width, TILE_SIZE, terrain);
    assert.equal(tile.height, TILE_SIZE, terrain);
    assert.equal(tile.countOpaque(), TILE_SIZE * TILE_SIZE, `${terrain} must be fully opaque`);
  }
});

test('tiles are deterministic for a given seed', () => {
  assert.deepEqual(grassTile(3).data, grassTile(3).data);
  assert.notDeepEqual(waterTile(3).data, waterTile(4).data);
});

test('each terrain reads as its own material', () => {
  const average = (tile: ReturnType<typeof woodTile>): { r: number; g: number; b: number } => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < tile.data.length; i += 4) {
      r += tile.data[i] ?? 0;
      g += tile.data[i + 1] ?? 0;
      b += tile.data[i + 2] ?? 0;
    }
    const n = tile.data.length / 4;
    return { r: r / n, g: g / n, b: b / n };
  };
  const grass = average(grassTile());
  const water = average(waterTile());
  const wood = average(woodTile());
  assert.ok(grass.g > grass.r && grass.g > grass.b, 'grass is green');
  assert.ok(water.b > water.r && water.b > water.g, 'water is blue');
  assert.ok(wood.r > wood.g && wood.g > wood.b, 'wood is warm brown');
});

test('the plain tile takes its color from the picker and keeps small details', () => {
  const tile = plainTile('#d04a4a');
  const base = hexToRgba('#d04a4a');
  const center = tile.getPixel(TILE_SIZE / 2, TILE_SIZE / 2);
  let matches = 0;
  let details = 0;
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const p = tile.getPixel(x, y);
      if (p.r === base.r && p.g === base.g && p.b === base.b) matches += 1;
      else details += 1;
    }
  }
  assert.ok(center.r > center.g, 'reddish');
  assert.ok(matches > TILE_SIZE * TILE_SIZE * 0.7, 'mostly the chosen color');
  assert.ok(details > 100, 'has speckles and edges');
  assert.notDeepEqual(plainTile('#3060c0').data, tile.data);
});

test('water stays smooth: no detail is darker than the base water color', () => {
  const tile = waterTile();
  const luma = (p: { r: number; g: number; b: number }): number => p.r * 0.3 + p.g * 0.59 + p.b * 0.11;
  const counts = new Map<number, number>();
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const value = luma(tile.getPixel(x, y));
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const base = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  const darkest = Math.min(...counts.keys());
  assert.ok(darkest >= base - 1, `darkest ${darkest} vs base ${base}`);
});
