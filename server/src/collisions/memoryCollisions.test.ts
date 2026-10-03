import { describe, expect, it } from 'vitest';
import { createMemoryCollisions } from './memoryCollisions.ts';

describe('memoryCollisions', () => {
  it('stores, replaces and deletes one row per piece, remembering who saved it', async () => {
    const store = createMemoryCollisions([['tree-oak', [{ x: -8, y: -12, w: 16, h: 12 }]]]);

    await store.saveCollision('desk-wood', [], 'admin-1');
    await store.saveCollision('tree-oak', [{ x: -4, y: -8, w: 8, h: 8 }], 'admin-2');

    expect(new Map(await store.loadCollisions())).toEqual(
      new Map([
        ['tree-oak', [{ x: -4, y: -8, w: 8, h: 8 }]],
        ['desk-wood', []],
      ]),
    );
    expect(store.actorOf('tree-oak')).toBe('admin-2');

    await store.deleteCollision('tree-oak');
    await store.deleteCollision('plant-none');
    expect([...(await store.loadCollisions()).keys()]).toEqual(['desk-wood']);
  });
});
