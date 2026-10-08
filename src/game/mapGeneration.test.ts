import { describe, expect, it } from 'vitest';
import { BASE_LAYOUT, BASE_TERRAIN, BLOCK_TILES, terrainSnapshot, withBlock } from './officeLayout';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from './mapData';
import { BASE_MAP_SEATS } from './seating';
import { generateMapBlocks, parseMapGeneration, SPAWN_BLOCK_INDEX } from './mapGeneration';

describe('seeded block generation', () => {
  it('is deterministic, connected to spawn, bounded, and keeps the spawn wood', () => {
    const params = { seed: 123, landBlocks: 30, material: 'grass' as const };
    const blocks = generateMapBlocks(params);
    expect(blocks).toEqual(generateMapBlocks(params));
    expect(blocks).not.toEqual(generateMapBlocks({ ...params, seed: 124 }));
    expect(blocks).toHaveLength(140);
    expect(blocks.filter((material) => material !== 'water')).toHaveLength(30);
    expect(blocks[SPAWN_BLOCK_INDEX]).toBe('wood');
    const reached = new Set([SPAWN_BLOCK_INDEX]);
    const queue = [SPAWN_BLOCK_INDEX];
    for (const index of queue) for (const neighbor of [index - 14, index + 14, ...(index % 14 > 0 ? [index - 1] : []), ...(index % 14 < 13 ? [index + 1] : [])]) {
      if (neighbor >= 0 && neighbor < 140 && blocks[neighbor] !== 'water' && !reached.has(neighbor)) { reached.add(neighbor); queue.push(neighbor); }
    }
    expect(reached.size).toBe(30);
  });

  it.each([null, {}, { seed: -1, landBlocks: 30, material: 'grass' }, { seed: 1.5, landBlocks: 30, material: 'grass' }, { seed: 1, landBlocks: 141, material: 'grass' }, { seed: 1, landBlocks: 0, material: 'grass' }, { seed: 1, landBlocks: 30, material: 'water' }])('rejects invalid generation params: %j', (params) => {
    expect(() => parseMapGeneration(params)).toThrow();
  });
});

describe('empty block-aligned office default', () => {
  it('has exactly one central wood block, no legacy objects or overlays, and a safe central spawn', () => {
    expect(BASE_LAYOUT.blocks.filter((material) => material !== 'water')).toEqual(['wood']);
    expect(BASE_LAYOUT.blocks[77]).toBe('wood');
    expect([PLAYER_SPAWN_TX, PLAYER_SPAWN_TY]).toEqual([67, 49]);
    expect(BASE_LAYOUT.props).toEqual([]);
    expect(BASE_MAP_SEATS).toEqual([]);
    for (const layer of [BASE_LAYOUT.ground, BASE_LAYOUT.decals, BASE_LAYOUT.walls, BASE_LAYOUT.hedges]) {
      expect(layer.every((cell) => cell === null)).toBe(true);
    }
    expect(BASE_TERRAIN.walkable.filter(Boolean)).toHaveLength(81);
  });

  it('paints every tile of an edited block and none of its neighbors', () => {
    const before = terrainSnapshot(BASE_LAYOUT, new Array(140).fill('water'));
    const after = terrainSnapshot(BASE_LAYOUT, withBlock(before.blocks, 76, 'wood'));
    for (let y = 0; y < 90; y += 1) for (let x = 0; x < 126; x += 1) {
      expect(after.materials[y * 126 + x]).toBe(x >= 54 && x < 63 && y >= 45 && y < 54 ? 'wood' : 'water');
    }
    expect(BLOCK_TILES).toBe(9);
  });
});
