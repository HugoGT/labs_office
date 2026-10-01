import { describe, expect, it } from 'vitest';
import { createMemoryTerrain } from './memoryTerrain.ts';

describe('memoryTerrain', () => {
  it('starts with no edited block, or with the seed', async () => {
    expect([...(await createMemoryTerrain().loadBlocks())]).toEqual([]);
    expect([...(await createMemoryTerrain([[3, 'sand']]).loadBlocks())]).toEqual([[3, 'sand']]);
  });

  it('keeps the last material saved for a block, and who saved it', async () => {
    const store = createMemoryTerrain();
    await store.saveBlock(35, 'water', 'admin-1');
    await store.saveBlock(35, 'sand', 'admin-2');
    await store.saveBlock(2, 'carpet', null);

    expect(new Map(await store.loadBlocks())).toEqual(new Map([[35, 'sand'], [2, 'carpet']]));
    expect(store.actorOf(35)).toBe('admin-2');
    expect(store.actorOf(2)).toBeNull();
  });
});
