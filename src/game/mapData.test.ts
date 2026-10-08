import { describe, expect, it } from 'vitest';
import { ART_TILE } from './artContract';
import { BLOCK_TILES, BASE_LAYOUT, BASE_TERRAIN, LAYOUT_TILE, blockIndexAt, terrainSnapshot, withBlock } from './officeLayout';
import {
  BUILT_IN_SPACES,
  MAP_BLOCK_COLUMNS,
  MAP_BLOCK_ROWS,
  MAP_H,
  MAP_W,
  PLAYER_SPAWN_TX,
  PLAYER_SPAWN_TY,
  PROX_RADIUS,
  SPAWN_BLOCK_INDEX,
  TILE,
  WORLD_H,
  WORLD_W,
} from './mapData';
import { BASE_MAP_SEATS } from './seating';
import { LEGACY_SPACES } from '../test/legacyOffice';

describe('mapData', () => {
  it('keeps the tile and the proximity radius of the prototype (app.js:6-8)', () => {
    expect(TILE).toBe(32);
    expect(PROX_RADIUS).toBe(170);
  });

  it('is the 126x90 world of the Tiled layout, 14x10 blocks of 9x9 tiles (#123)', () => {
    expect(MAP_W).toBe(126);
    expect(MAP_H).toBe(90);
    expect(WORLD_W).toBe(4032);
    expect(WORLD_H).toBe(2880);
    expect([MAP_W, MAP_H]).toEqual([BASE_LAYOUT.width, BASE_LAYOUT.height]);
    expect([MAP_W / BLOCK_TILES, MAP_H / BLOCK_TILES]).toEqual([14, 10]);
    expect(LAYOUT_TILE).toBe(TILE);
    expect(ART_TILE).toBe(TILE);
  });

  it('names the block grid and the protected spawn block from the same constants', () => {
    expect([MAP_BLOCK_COLUMNS, MAP_BLOCK_ROWS]).toEqual([MAP_W / BLOCK_TILES, MAP_H / BLOCK_TILES]);
    expect(SPAWN_BLOCK_INDEX).toBe(blockIndexAt(MAP_W, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY));
  });

  it('ubica la Sala de Juntas en tile (50,2) de 13x14 (app.js:56-59)', () => {
    const room = LEGACY_SPACES[0];
    expect(room.name).toBe('Sala de Juntas');
    expect(room.x / TILE).toBe(50);
    expect(room.y / TILE).toBe(2);
    expect(room.w / TILE).toBe(13);
    expect(room.h / TILE).toBe(14);
  });

  it('ubica la Cafeteria en tile (50,18) de 13x14 (app.js:56-59)', () => {
    const room = LEGACY_SPACES[1];
    expect(room.name).toBe('Cafetería');
    expect(room.x / TILE).toBe(50);
    expect(room.y / TILE).toBe(18);
    expect(room.w / TILE).toBe(13);
    expect(room.h / TILE).toBe(14);
  });

  it('starts without fallback rooms; existing legacy fixtures retain their stable identities', () => {
    expect(BUILT_IN_SPACES).toEqual([]);
    expect(LEGACY_SPACES[0].id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(LEGACY_SPACES[1].id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(LEGACY_SPACES[0].id).not.toBe(LEGACY_SPACES[1].id);
  });
});

describe('empty block-aligned office default', () => {
  it('has exactly one central wood block, no legacy objects or overlays, and a safe central spawn', () => {
    expect(BASE_LAYOUT.blocks.filter((material) => material !== 'water')).toEqual(['wood']);
    expect(BASE_LAYOUT.blocks[SPAWN_BLOCK_INDEX]).toBe('wood');
    expect([PLAYER_SPAWN_TX, PLAYER_SPAWN_TY]).toEqual([67, 49]);
    expect(BASE_LAYOUT.props).toEqual([]);
    expect(BASE_MAP_SEATS).toEqual([]);
    for (const layer of [BASE_LAYOUT.ground, BASE_LAYOUT.decals, BASE_LAYOUT.walls, BASE_LAYOUT.hedges]) {
      expect(layer.every((cell) => cell === null)).toBe(true);
    }
    expect(BASE_TERRAIN.walkable.filter(Boolean)).toHaveLength(81);
  });

  it('paints every tile of an edited block and none of its neighbors', () => {
    const before = terrainSnapshot(BASE_LAYOUT, new Array(MAP_BLOCK_COLUMNS * MAP_BLOCK_ROWS).fill('water'));
    const left = SPAWN_BLOCK_INDEX - 1;
    const after = terrainSnapshot(BASE_LAYOUT, withBlock(before.blocks, left, 'wood'));
    const x0 = (left % MAP_BLOCK_COLUMNS) * BLOCK_TILES;
    const y0 = Math.floor(left / MAP_BLOCK_COLUMNS) * BLOCK_TILES;
    for (let y = 0; y < MAP_H; y += 1) for (let x = 0; x < MAP_W; x += 1) {
      expect(after.materials[y * MAP_W + x]).toBe(x >= x0 && x < x0 + 9 && y >= y0 && y < y0 + 9 ? 'wood' : 'water');
    }
    expect(BLOCK_TILES).toBe(9);
  });
});
