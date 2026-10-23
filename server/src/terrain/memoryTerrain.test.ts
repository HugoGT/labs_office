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
  it('saves blocks and removes walls in one save', async () => {
    const store = createMemoryTerrain([], [[4, 'wall-brick'], [5, 'wall-glass']]);
    await store.saveBlocksClearingWalls([{ index: 0, material: 'void' }], [4], 'admin-1');

    expect([...(await store.loadBlocks())]).toEqual([[0, 'void']]);
    expect(store.actorOf(0)).toBe('admin-1');
    expect([...(await store.loadWalls())]).toEqual([[5, 'wall-glass']]);
    expect(store.wallActorOf(4)).toBeUndefined();
  });
});

describe('memoryTerrain decor', () => {
  it('starts with no item, or with the decor seed', async () => {
    expect(await createMemoryTerrain().loadDecor()).toEqual([]);
    expect(await createMemoryTerrain([], [], [{ index: 4, piece: 'chair-wood', rotation: 0 }]).loadDecor()).toEqual([
      { index: 4, piece: 'chair-wood', rotation: 0 },
    ]);
  });

  it('places, turns and removes items in one save, recording who placed each', async () => {
    const store = createMemoryTerrain([], [], [
      { index: 4, piece: 'chair-wood', rotation: 0 },
      { index: 5, piece: 'chair-wood', rotation: 0 },
    ]);
    await store.saveDecor(
      [
        { index: 4, item: { piece: 'chair-metal', rotation: 270 } },
        { index: 5, item: null },
        { index: 9, item: { piece: 'table-meeting', rotation: 0 } },
      ],
      'admin-1',
    );

    expect(await store.loadDecor()).toEqual([
      { index: 4, piece: 'chair-metal', rotation: 270 },
      { index: 9, piece: 'table-meeting', rotation: 0 },
    ]);
    expect(store.decorActorOf(4)).toBe('admin-1');
    expect(store.decorActorOf(5)).toBeUndefined();
    expect([...(await store.loadWalls())]).toEqual([]);
  });

  it('keeps the color of a painted item, seeded or saved', async () => {
    const store = createMemoryTerrain([], [], [{ index: 4, piece: 'desk-painted', rotation: 0, color: '#c83c3c' }]);
    expect(await store.loadDecor()).toEqual([{ index: 4, piece: 'desk-painted', rotation: 0, color: '#c83c3c' }]);

    await store.saveDecor([{ index: 6, item: { piece: 'desk-painted', rotation: 90, color: '#3c5ac8' } }], null);
    expect(await store.loadDecor()).toContainEqual({ index: 6, piece: 'desk-painted', rotation: 90, color: '#3c5ac8' });
  });
});
