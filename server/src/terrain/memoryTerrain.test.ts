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

describe('memoryTerrain walls', () => {
  it('starts with no wall, or with the wall seed', async () => {
    expect([...(await createMemoryTerrain().loadWalls())]).toEqual([]);
    expect([...(await createMemoryTerrain([], [[4, 'wall-brick']]).loadWalls())]).toEqual([[4, 'wall-brick']]);
  });

  it('places, replaces and removes walls in one save, recording who placed each', async () => {
    const store = createMemoryTerrain([], [[4, 'wall-brick'], [5, 'wall-brick']]);
    await store.saveWalls([{ index: 4, piece: 'wall-glass' }, { index: 5, piece: null }, { index: 9, piece: 'wall-stone' }], 'admin-1');

    expect(new Map(await store.loadWalls())).toEqual(new Map([[4, 'wall-glass'], [9, 'wall-stone']]));
    expect(store.wallActorOf(4)).toBe('admin-1');
    expect(store.wallActorOf(5)).toBeUndefined();
    expect([...(await store.loadBlocks())]).toEqual([]);
  });
});

describe('memoryTerrain chairs', () => {
  it('starts with no chair, or with the chair seed', async () => {
    expect(await createMemoryTerrain().loadChairs()).toEqual([]);
    expect(await createMemoryTerrain([], [], [{ index: 4, piece: 'chair-wood', facing: 'down' }]).loadChairs()).toEqual([
      { index: 4, piece: 'chair-wood', facing: 'down' },
    ]);
  });

  it('places, turns and removes chairs in one save, recording who placed each', async () => {
    const store = createMemoryTerrain([], [], [
      { index: 4, piece: 'chair-wood', facing: 'down' },
      { index: 5, piece: 'chair-wood', facing: 'down' },
    ]);
    await store.saveChairs(
      [
        { index: 4, chair: { piece: 'chair-metal', facing: 'left' } },
        { index: 5, chair: null },
        { index: 9, chair: { piece: 'chair-gamer', facing: 'up' } },
      ],
      'admin-1',
    );

    expect(await store.loadChairs()).toEqual([
      { index: 4, piece: 'chair-metal', facing: 'left' },
      { index: 9, piece: 'chair-gamer', facing: 'up' },
    ]);
    expect(store.chairActorOf(4)).toBe('admin-1');
    expect(store.chairActorOf(5)).toBeUndefined();
    expect([...(await store.loadWalls())]).toEqual([]);
  });
});
