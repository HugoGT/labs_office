import { describe, expect, it, vi } from 'vitest';
import { TILE, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from '../../../src/game/mapData.ts';
import { BASE_LAYOUT as OFFICE_LAYOUT, BLOCK_TILES, blockIndexAt, blockTileRect, isPositionWalkable, isTileWalkable, type LayoutMaterial } from '../../../src/game/officeLayout.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_TERRAIN as BASE_TERRAIN } from '../../../src/test/legacyOffice.ts';
import { createMemoryTerrain } from './memoryTerrain.ts';
import type { TerrainStore } from './terrainPort.ts';
import { type TerrainProtections } from './terrainRules.ts';
import { createTerrainRuntime } from './terrainRuntime.ts';

const LAWN = 35;
const LAKE = 94;
const NONE = async (): Promise<TerrainProtections> => ({ placements: [], players: [] });

describe('createTerrainRuntime', () => {
  it.each([126, 135].flatMap((width) => (['water', 'grass', 'sand'] as const).map((material) => ({ width, material }))))(
    'ignores saved $material at the spawn block of a $width-tile layout without changing stored rows',
    async ({ width, material }) => {
      const spawn = blockIndexAt(width, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY);
      const blocks: LayoutMaterial[] = new Array((width / BLOCK_TILES) * (OFFICE_LAYOUT.height / BLOCK_TILES)).fill('water');
      blocks[spawn] = 'wood';
      const empty = () => new Array<null>(width * OFFICE_LAYOUT.height).fill(null);
      const layout = { ...OFFICE_LAYOUT, width, blocks, ground: empty(), walls: empty(), hedges: empty(), decals: empty() };
      const stored: readonly (readonly [number, LayoutMaterial])[] = [[spawn, material], [spawn - 1, 'grass']];
      const store = createMemoryTerrain(stored);
      const saveBlock = vi.spyOn(store, 'saveBlock');
      const saveBlocks = vi.spyOn(store, 'saveBlocks');
      const runtime = createTerrainRuntime({ layout, store, seats: [] });

      await runtime.load();

      expect(runtime.blocks()[spawn]).toBe('wood');
      expect(runtime.blocks()[spawn - 1]).toBe('grass');
      const { tx, ty, w, h } = blockTileRect(width, spawn);
      for (let y = ty; y < ty + h; y += 1) for (let x = tx; x < tx + w; x += 1) {
        expect(runtime.snapshot().materials[y * width + x]).toBe('wood');
        expect(isTileWalkable(runtime.snapshot(), x, y)).toBe(true);
      }
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        expect(isPositionWalkable(runtime.snapshot(), (PLAYER_SPAWN_TX + dx) * TILE + TILE / 2, (PLAYER_SPAWN_TY + dy) * TILE + TILE / 2)).toBe(true);
      }
      expect(new Map(await store.loadBlocks())).toEqual(new Map(stored));
      expect(saveBlock).not.toHaveBeenCalled();
      expect(saveBlocks).not.toHaveBeenCalled();
    },
  );

  it('serves the committed layout until it loads, and without a store for good', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT });

    await runtime.load();

    expect(runtime.blocks()).toEqual(BASE_LAYOUT.blocks);
    expect(runtime.snapshot().walkable).toEqual(BASE_TERRAIN.walkable);
    expect(runtime.editable).toBe(false);
  });

  it('builds the snapshot from the persisted blocks once, at load, ignoring blocks the map no longer has', async () => {
    const store = createMemoryTerrain([
      [LAWN, 'water'],
      [LAKE, 'grass'],
      [BASE_LAYOUT.blocks.length, 'sand'],
    ]);
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    const loadBlocks = vi.spyOn(store, 'loadBlocks');

    await runtime.load();
    runtime.snapshot();
    runtime.snapshot();

    expect(runtime.editable).toBe(true);
    expect(runtime.blocks()[LAWN]).toBe('water');
    expect(runtime.blocks()[LAKE]).toBe('grass');
    expect(runtime.blocks()).toHaveLength(BASE_LAYOUT.blocks.length);
    expect(isTileWalkable(runtime.snapshot(), 67, 22)).toBe(false);
    expect(isTileWalkable(runtime.snapshot(), 94, 58)).toBe(true);
    expect(loadBlocks).toHaveBeenCalledTimes(1);
  });

  it('persists an accepted edit, rebuilds the snapshot and tells every subscriber the new blocks', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    await runtime.load();
    const seen: (readonly LayoutMaterial[])[] = [];
    const unsubscribe = runtime.subscribe((blocks) => seen.push(blocks));

    await runtime.setBlock({ index: LAWN, material: 'water', actorId: 'admin-1' }, NONE);

    expect(new Map(await store.loadBlocks())).toEqual(new Map([[LAWN, 'water']]));
    expect(store.actorOf(LAWN)).toBe('admin-1');
    expect(isTileWalkable(runtime.snapshot(), 67, 22)).toBe(false);
    expect(seen).toEqual([runtime.blocks()]);

    unsubscribe();
    await runtime.setBlock({ index: LAWN, material: 'sand', actorId: 'admin-1' }, NONE);
    expect(seen).toHaveLength(1);
  });

  it('accepts water under a player and announces it only after saving', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);
    const someone = async (): Promise<TerrainProtections> => ({
      placements: [],
      players: [{ x: 67 * TILE + 32, y: 22 * TILE + 25 }],
    });

    await runtime.setBlock({ index: LAWN, material: 'water', actorId: null }, someone);
    expect([...(await store.loadBlocks())]).toEqual([[LAWN, 'water']]);
    expect(runtime.blocks()[LAWN]).toBe('water');
    expect(listener).toHaveBeenCalledExactlyOnceWith(runtime.blocks());
  });

  it('only reads the protections when the edit floods something', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store: createMemoryTerrain() });
    await runtime.load();
    const protections = vi.fn(NONE);

    await runtime.setBlock({ index: LAKE, material: 'grass', actorId: null }, protections);
    await runtime.setBlock({ index: LAWN, material: 'sand', actorId: null }, protections);

    expect(protections).not.toHaveBeenCalled();
  });

  it('keeps the old terrain when saving fails', async () => {
    const store: TerrainStore = {
      loadBlocks: async () => new Map(),
      saveBlock: async () => {
        throw new Error('connection lost');
      },
      saveBlocks: async () => { throw new Error('connection lost'); },
    };
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    await runtime.load();

    await expect(runtime.setBlock({ index: LAWN, material: 'water', actorId: null }, NONE)).rejects.toThrow('connection lost');

    expect(runtime.blocks()).toEqual(BASE_LAYOUT.blocks);
  });

  it('applies edits one after another, each checked against the terrain the previous one left', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store: createMemoryTerrain() });
    await runtime.load();

    const first = runtime.setBlock({ index: LAWN, material: 'water', actorId: null }, NONE);
    const second = runtime.setBlock({ index: LAWN + 1, material: 'water', actorId: null }, NONE);
    const failed = runtime.setBlock({ index: LAWN + 2, material: 'water', actorId: null }, async () => {
      throw new Error('spaces unavailable');
    });
    const third = runtime.setBlock({ index: 0, material: 'carpet', actorId: null }, NONE);

    await Promise.all([first, second, third]);
    await expect(failed).rejects.toThrow('spaces unavailable');
    expect(runtime.blocks()[LAWN]).toBe('water');
    expect(runtime.blocks()[LAWN + 1]).toBe('water');
    expect(runtime.blocks()[LAWN + 2]).toBe(BASE_LAYOUT.blocks[LAWN + 2]);
    expect(runtime.blocks()[0]).toBe('carpet');
  });

  it('refuses edits without a store', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT });

    await expect(runtime.setBlock({ index: LAWN, material: 'sand', actorId: null }, NONE)).rejects.toThrow(/no terrain store/);
  });
});
