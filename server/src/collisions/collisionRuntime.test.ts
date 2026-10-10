import { describe, expect, it, vi } from 'vitest';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_SEATS as BASE_MAP_SEATS } from '../../../src/test/legacyOffice.ts';
import {
  collisionWorld,
  decodeCollisionTable,
  isPositionBlocked,
  staticCollisionInstances,
  type CollisionDesk,
} from '../../../src/game/pieceCollisions.ts';
import { createMemoryCollisions } from './memoryCollisions.ts';
import { CollisionProtectedError } from './collisionRules.ts';
import { createCollisionRuntime } from './collisionRuntime.ts';

const NOBODY = (): { x: number; y: number }[] => [];
const tree = BASE_LAYOUT.props.find((prop) => prop.kind === 'tree')!;
/** A position whose feet-aligned body center is the middle of the tree's tile. */
const onTree = { x: tree.tx * 32 + 16, y: tree.ty * 32 + 5 };
const DESK: CollisionDesk = { x: 640, y: 1600, w: 96, h: 96, materialId: 'desk-oak', items: [] };
/** Body center in the middle of that desk. */
const onDesk = { x: 688, y: 1648 - 11 };

function runtime(seed: [string, { x: number; y: number; w: number; h: number }[]][] = [], desks: CollisionDesk[] = []) {
  const store = createMemoryCollisions(seed);
  const listDesks = vi.fn(async () => desks);
  return { store, listDesks, collisions: createCollisionRuntime({ layout: BASE_LAYOUT, seats: BASE_MAP_SEATS, store, listDesks }) };
}

describe('createCollisionRuntime', () => {
  it('serves the layout defaults until it loads, and without a store for good', async () => {
    const collisions = createCollisionRuntime({ layout: BASE_LAYOUT, seats: BASE_MAP_SEATS });

    await collisions.load();

    expect(collisions.editable).toBe(false);
    expect(collisions.rects()).toEqual(collisionWorld(staticCollisionInstances(BASE_LAYOUT.props, BASE_MAP_SEATS), new Map()));
    expect(isPositionBlocked(collisions.rects(), onTree.x, onTree.y)).toBe(true);
    expect(collisions.encoded()).toBe('{}');
  });

  it('loads the saved pieces and the served desks once', async () => {
    const { collisions, listDesks } = runtime([['tree-oak', []], ['desk-oak', [{ x: -8, y: -8, w: 16, h: 16 }]]], [DESK]);

    await collisions.load();

    expect(collisions.editable).toBe(true);
    expect(decodeCollisionTable(collisions.encoded())).toEqual(collisions.table());
    expect(collisions.table().get('tree-oak')).toEqual([]);
    expect(isPositionBlocked(collisions.rects(), onDesk.x, onDesk.y)).toBe(true);
    expect(listDesks).toHaveBeenCalledTimes(1);
  });

  it('saves an edit, rebuilds the rectangles and tells every subscriber the new table', async () => {
    const { collisions, store } = runtime();
    await collisions.load();
    const seen: string[] = [];
    collisions.subscribe((encoded) => seen.push(encoded));

    await collisions.setRects({ pieceId: tree.piece, rects: [], actorId: 'admin-1' }, NOBODY);

    expect(store.actorOf(tree.piece)).toBe('admin-1');
    expect(isPositionBlocked(collisions.rects(), onTree.x, onTree.y)).toBe(false);
    expect(seen).toEqual([collisions.encoded()]);
    expect(decodeCollisionTable(seen[0])?.get(tree.piece)).toEqual([]);
  });

  it('gives a piece back its default on reset', async () => {
    const { collisions } = runtime([[tree.piece, []]]);
    await collisions.load();
    const seen: string[] = [];
    collisions.subscribe((encoded) => seen.push(encoded));

    await collisions.reset({ pieceId: tree.piece, actorId: 'admin-1' }, NOBODY);

    expect(collisions.table().has(tree.piece)).toBe(false);
    expect(isPositionBlocked(collisions.rects(), onTree.x, onTree.y)).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('refuses an edit that would close a rectangle over someone, and changes nothing', async () => {
    const { collisions, store } = runtime([], [DESK]);
    await collisions.load();

    await expect(
      collisions.setRects({ pieceId: 'desk-oak', rects: [{ x: -40, y: -40, w: 80, h: 80 }], actorId: 'admin-1' }, () => [onDesk]),
    ).rejects.toBeInstanceOf(CollisionProtectedError);
    expect((await store.loadCollisions()).size).toBe(0);
    expect(isPositionBlocked(collisions.rects(), onDesk.x, onDesk.y)).toBe(false);

    // A reset that would bring the footprint back over someone is refused too.
    const withTree = runtime([[tree.piece, []]]);
    await withTree.collisions.load();
    await expect(withTree.collisions.reset({ pieceId: tree.piece, actorId: null }, () => [onTree])).rejects.toBeInstanceOf(CollisionProtectedError);
  });

  it('follows the served desks when they change', async () => {
    const desks: CollisionDesk[] = [];
    const store = createMemoryCollisions([['desk-oak', [{ x: -8, y: -8, w: 16, h: 16 }]]]);
    const collisions = createCollisionRuntime({ layout: BASE_LAYOUT, seats: BASE_MAP_SEATS, store, listDesks: async () => desks });
    await collisions.load();
    expect(isPositionBlocked(collisions.rects(), onDesk.x, onDesk.y)).toBe(false);

    desks.push(DESK);
    await collisions.refreshPlacements();

    expect(isPositionBlocked(collisions.rects(), onDesk.x, onDesk.y)).toBe(true);
  });

  it('follows the placed chairs when they change, each with its own piece', async () => {
    const chairs: { index: number; piece: 'chair-gamer' | 'chair-wood'; facing: 'down' }[] = [];
    const store = createMemoryCollisions([['chair-gamer', [{ x: -8, y: -8, w: 16, h: 16 }]]]);
    const collisions = createCollisionRuntime({ layout: BASE_LAYOUT, seats: BASE_MAP_SEATS, store, chairs: () => chairs });
    await collisions.load();
    /** Body center in the middle of tile (67, 22). */
    const onChair = { x: 67 * 32 + 16, y: 22 * 32 + 16 - 11 };
    const onWood = { x: 68 * 32 + 16, y: 22 * 32 + 16 - 11 };
    expect(isPositionBlocked(collisions.rects(), onChair.x, onChair.y)).toBe(false);

    chairs.push({ index: 22 * BASE_LAYOUT.width + 67, piece: 'chair-gamer', facing: 'down' }, { index: 22 * BASE_LAYOUT.width + 68, piece: 'chair-wood', facing: 'down' });
    await collisions.refreshChairs();

    expect(isPositionBlocked(collisions.rects(), onChair.x, onChair.y)).toBe(true);
    expect(isPositionBlocked(collisions.rects(), onWood.x, onWood.y)).toBe(false);
    // The trap check of an edit sees placed chairs too.
    await expect(collisions.setRects({ pieceId: 'chair-wood', rects: [{ x: -8, y: -8, w: 16, h: 16 }], actorId: null }, () => [onWood])).rejects.toThrow(CollisionProtectedError);
  });

  it('keeps the edits in order and survives a failed save', async () => {
    const { collisions, store } = runtime();
    await collisions.load();
    const save = vi.spyOn(store, 'saveCollision').mockRejectedValueOnce(new Error('db down'));

    const first = collisions.setRects({ pieceId: tree.piece, rects: [], actorId: null }, NOBODY);
    const second = collisions.setRects({ pieceId: 'plant-ficus', rects: [], actorId: null }, NOBODY);

    await expect(first).rejects.toThrow('db down');
    await second;
    expect(save).toHaveBeenCalledTimes(2);
    expect(collisions.table().has(tree.piece)).toBe(false);
    expect(collisions.table().get('plant-ficus')).toEqual([]);
  });

  it('cannot edit without a store', async () => {
    const collisions = createCollisionRuntime({ layout: BASE_LAYOUT, seats: BASE_MAP_SEATS });
    await expect(collisions.setRects({ pieceId: tree.piece, rects: [], actorId: null }, NOBODY)).rejects.toThrow(/store/);
  });
});
