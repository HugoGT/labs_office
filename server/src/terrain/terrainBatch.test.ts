import { describe, expect, it, vi } from 'vitest';
import { SPAWN_BLOCK_INDEX } from '../../../src/game/mapData.ts';
import { BASE_LAYOUT, terrainSnapshot } from '../../../src/game/officeLayout.ts';
import { createMemoryTerrain } from './memoryTerrain.ts';
import { createTerrainRuntime } from './terrainRuntime.ts';

const none = async () => ({ placements: [], players: [] });
const layout = { ...BASE_LAYOUT, blocks: BASE_LAYOUT.blocks.map(() => 'grass' as const) };

describe('atomic terrain batch', () => {
  it('writes all edits with one notification and survives a reload', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout, store });
    const listener = vi.fn();
    runtime.subscribe(listener);
    await runtime.setBlocks([{ index: 0, material: 'sand' }, { index: 1, material: 'wood' }], 'admin', none);
    expect(listener).toHaveBeenCalledTimes(1);
    const restored = createTerrainRuntime({ layout, store });
    await restored.load();
    expect(restored.blocks()).toEqual(runtime.blocks());
    expect(store.actorOf(1)).toBe('admin');
  });

  it('rejects the entire batch when any edit floods a placement', async () => {
    for (const protections of [
      { placements: [{ x: 10, y: 1, w: 2, h: 2 }], players: [] },
    ]) {
      const store = createMemoryTerrain();
      const runtime = createTerrainRuntime({ layout, store });
      const before = terrainSnapshot(layout);
      await expect(runtime.setBlocks([{ index: 0, material: 'sand' }, { index: 1, material: 'water' }], null, async () => protections)).rejects.toThrow();
      expect(runtime.snapshot()).toEqual(before);
      expect([...(await store.loadBlocks())]).toEqual([]);
    }
  });

  it('protects the whole central wood block, even from other walkable materials', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store: createMemoryTerrain() });
    await expect(runtime.setBlocks([{ index: SPAWN_BLOCK_INDEX, material: 'grass' }], null, none)).rejects.toThrow();
    expect(runtime.blocks()[SPAWN_BLOCK_INDEX]).toBe('wood');
  });

  it('does not publish or change the snapshot on storage failure', async () => {
    const store = createMemoryTerrain();
    vi.spyOn(store, 'saveBlocks').mockRejectedValue(new Error('storage unavailable'));
    const runtime = createTerrainRuntime({ layout, store });
    const listener = vi.fn();
    runtime.subscribe(listener);
    await expect(runtime.setBlocks([{ index: 0, material: 'sand' }], null, none)).rejects.toThrow('storage unavailable');
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.blocks()).toEqual(layout.blocks);
  });

  it('serializes batches and checks the expected terrain inside that queue', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout, store });
    const expected = layout.blocks.join(',');
    const first = runtime.setBlocks([{ index: 0, material: 'sand' }], null, none, expected);
    const second = runtime.setBlocks([{ index: 1, material: 'wood' }], null, none, expected);
    await first;
    await expect(second).rejects.toThrow('terrain changed');
    expect(runtime.blocks()[1]).toBe('grass');
    expect([...(await store.loadBlocks())]).toEqual([[0, 'sand']]);
  });
});

describe('terrain block colors (#222)', () => {
  it('persists a color with its material in the same save, publishes it, and keeps it across a reload', async () => {
    const store = createMemoryTerrain();
    const saveBlocks = vi.spyOn(store, 'saveBlocks');
    const runtime = createTerrainRuntime({ layout, store });
    const listener = vi.fn(() => runtime.blockColors());
    runtime.subscribe(listener);

    await runtime.setBlocks([{ index: 0, material: 'carpet', color: '#a0b1c2' }, { index: 1, material: 'carpet' }], 'admin', none);

    expect(saveBlocks).toHaveBeenCalledTimes(1);
    expect(saveBlocks).toHaveBeenCalledWith([{ index: 0, material: 'carpet', color: '#a0b1c2' }, { index: 1, material: 'carpet' }], 'admin');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.results[0]!.value).toEqual(new Map([[0, '#a0b1c2']]));
    expect(runtime.blockColors()).toEqual(new Map([[0, '#a0b1c2']]));
    expect(new Map(await store.loadBlockColors())).toEqual(new Map([[0, '#a0b1c2']]));
    const restored = createTerrainRuntime({ layout, store });
    await restored.load();
    expect(restored.blocks()).toEqual(runtime.blocks());
    expect(restored.blockColors()).toEqual(new Map([[0, '#a0b1c2']]));
  });

  it('clears a block color when the block is painted another material, or the same one without a color', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout, store });
    await runtime.setBlocks([{ index: 0, material: 'carpet', color: '#a0b1c2' }, { index: 1, material: 'carpet', color: '#0055ff' }], 'admin', none);

    await runtime.setBlock({ index: 0, material: 'grass', actorId: 'admin' }, none);
    await runtime.setBlocks([{ index: 1, material: 'carpet' }], 'admin', none);

    expect(runtime.blocks().slice(0, 2)).toEqual(['grass', 'carpet']);
    expect(runtime.blockColors()).toEqual(new Map());
    expect(new Map(await store.loadBlockColors())).toEqual(new Map());
  });

  it('saves a color change on a block of the same material, and nothing for a repaint in the same color', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout, store });
    await runtime.setBlocks([{ index: 0, material: 'carpet', color: '#a0b1c2' }], 'admin', none);
    const saveBlocks = vi.spyOn(store, 'saveBlocks');
    const listener = vi.fn();
    runtime.subscribe(listener);

    await runtime.setBlocks([{ index: 0, material: 'carpet', color: '#a0b1c2' }], 'admin', none);
    expect(saveBlocks).not.toHaveBeenCalled();
    await runtime.setBlocks([{ index: 0, material: 'carpet', color: '#0055ff' }], 'admin', none);

    expect(saveBlocks).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(runtime.blockColors()).toEqual(new Map([[0, '#0055ff']]));
  });

  it('refuses a color on a material that takes none, saving and publishing nothing', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout, store });
    const listener = vi.fn();
    runtime.subscribe(listener);

    await expect(runtime.setBlocks([{ index: 0, material: 'carpet', color: '#a0b1c2' }, { index: 1, material: 'sand', color: '#a0b1c2' }], 'admin', none))
      .rejects.toThrow('this material takes no color');

    expect(listener).not.toHaveBeenCalled();
    expect(runtime.blocks()).toEqual(layout.blocks);
    expect(runtime.blockColors()).toEqual(new Map());
    expect([...(await store.loadBlocks())]).toEqual([]);
  });

  it('keeps the colors as they were when the save fails', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout, store });
    await runtime.setBlocks([{ index: 0, material: 'carpet', color: '#a0b1c2' }], 'admin', none);
    vi.spyOn(store, 'saveBlocks').mockRejectedValue(new Error('storage unavailable'));

    await expect(runtime.setBlocks([{ index: 0, material: 'grass' }], null, none)).rejects.toThrow('storage unavailable');

    expect(runtime.blockColors()).toEqual(new Map([[0, '#a0b1c2']]));
  });

  it('loads blocks stored without a color unchanged, with no color, and ignores a stored color the block cannot take', async () => {
    const store = createMemoryTerrain([[0, 'carpet'], [1, 'sand']]);
    const before = createTerrainRuntime({ layout, store });
    await before.load();
    expect(before.blocks().slice(0, 2)).toEqual(['carpet', 'sand']);
    expect(before.blockColors()).toEqual(new Map());

    // A row whose material no longer takes a color, or off the map, is left out but never rewritten.
    vi.spyOn(store, 'loadBlockColors').mockResolvedValue(new Map([[0, '#a0b1c2'], [1, '#0055ff'], [layout.blocks.length, '#0055ff']]));
    const saveBlocks = vi.spyOn(store, 'saveBlocks');
    const runtime = createTerrainRuntime({ layout, store });
    await runtime.load();

    expect(runtime.blocks()).toEqual(before.blocks());
    expect(runtime.blockColors()).toEqual(new Map([[0, '#a0b1c2']]));
    expect(saveBlocks).not.toHaveBeenCalled();
  });

  it('has no colors without a store', async () => {
    const runtime = createTerrainRuntime({ layout });
    await runtime.load();
    expect(runtime.blockColors()).toEqual(new Map());
  });
});
