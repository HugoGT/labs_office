import { describe, expect, it } from 'vitest';
import { ART_TILE } from './artContract';
import { BLOCK_TILES, BASE_LAYOUT, LAYOUT_TILE } from './officeLayout';
import { BUILT_IN_SPACES, MAP_H, MAP_W, PROX_RADIUS, TILE, WORLD_H, WORLD_W } from './mapData';

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

  it('ubica la Sala de Juntas en tile (50,2) de 13x14 (app.js:56-59)', () => {
    const room = BUILT_IN_SPACES[0];
    expect(room.name).toBe('Sala de Juntas');
    expect(room.x / TILE).toBe(50);
    expect(room.y / TILE).toBe(2);
    expect(room.w / TILE).toBe(13);
    expect(room.h / TILE).toBe(14);
  });

  it('ubica la Cafeteria en tile (50,18) de 13x14 (app.js:56-59)', () => {
    const room = BUILT_IN_SPACES[1];
    expect(room.name).toBe('Cafetería');
    expect(room.x / TILE).toBe(50);
    expect(room.y / TILE).toBe(18);
    expect(room.w / TILE).toBe(13);
    expect(room.h / TILE).toBe(14);
  });

  it('cada espacio tiene un id estable, distinto entre si (#7, D2)', () => {
    expect(BUILT_IN_SPACES[0].id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(BUILT_IN_SPACES[1].id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(BUILT_IN_SPACES[0].id).not.toBe(BUILT_IN_SPACES[1].id);
  });
});
