import { describe, expect, it, vi } from 'vitest';
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
    await expect(runtime.setBlocks([{ index: 77, material: 'grass' }], null, none)).rejects.toThrow();
    expect(runtime.blocks()[77]).toBe('wood');
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
