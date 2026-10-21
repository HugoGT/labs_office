import { describe, expect, it, vi } from 'vitest';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_SEATS as BASE_MAP_SEATS } from '../../../src/test/legacyOffice.ts';
import type { DecorItem, DecorPieceInfo } from '../../../src/game/officeDecor.ts';
import {
  collisionWorld,
  decodeCollisionTable,
  isPositionBlocked,
  staticCollisionInstances,
} from '../../../src/game/pieceCollisions.ts';
import { createMemoryCollisions } from './memoryCollisions.ts';
import { CollisionProtectedError } from './collisionRules.ts';
import { createCollisionRuntime } from './collisionRuntime.ts';

const NOBODY = (): { x: number; y: number }[] => [];
const tree = BASE_LAYOUT.props.find((prop) => prop.kind === 'tree')!;
/** A position whose feet-aligned body center is the middle of the tree's tile. */
const onTree = { x: tree.tx * 32 + 16, y: tree.ty * 32 + 5 };
const W = BASE_LAYOUT.width;
const INFO: Record<string, DecorPieceInfo> = {
  'chair-oak': { kind: 'chair', footprint: { w: 1, h: 1 } },
  'chair-gamer': { kind: 'chair', footprint: { w: 1, h: 1 } },
  'chair-wood': { kind: 'chair', footprint: { w: 1, h: 1 } },
  'desk-wood': { kind: 'desk', footprint: { w: 3, h: 1 } },
};
const decorInfo = (piece: string) => INFO[piece] ?? null;
/** A decor chair on tile (21, 51): the decor layer collides by its pieces. */
const CHAIR: DecorItem = { index: 51 * W + 21, piece: 'chair-oak', rotation: 0 };
/** Body center in the middle of that tile. */
const onChairTile = { x: 21 * 32 + 16, y: 51 * 32 + 16 - 11 };

function runtime(seed: [string, { x: number; y: number; w: number; h: number }[]][] = [], items: DecorItem[] = []) {
  const store = createMemoryCollisions(seed);
  return { store, collisions: createCollisionRuntime({ layout: BASE_LAYOUT, seats: BASE_MAP_SEATS, store, decor: () => items, decorInfo }) };
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

  it('loads the saved pieces and places the decor layer', async () => {
    const { collisions } = runtime([['tree-oak', []], ['chair-oak', [{ x: -8, y: -8, w: 16, h: 16 }]]], [CHAIR]);

    await collisions.load();

    expect(collisions.editable).toBe(true);
    expect(decodeCollisionTable(collisions.encoded())).toEqual(collisions.table());
    expect(collisions.table().get('tree-oak')).toEqual([]);
    expect(isPositionBlocked(collisions.rects(), onChairTile.x, onChairTile.y)).toBe(true);
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
    const { collisions, store } = runtime([], [CHAIR]);
    await collisions.load();

    await expect(
      collisions.setRects({ pieceId: 'chair-oak', rects: [{ x: -40, y: -40, w: 80, h: 80 }], actorId: 'admin-1' }, () => [onChairTile]),
    ).rejects.toBeInstanceOf(CollisionProtectedError);
    expect((await store.loadCollisions()).size).toBe(0);
    expect(isPositionBlocked(collisions.rects(), onChairTile.x, onChairTile.y)).toBe(false);

    // A reset that would bring the footprint back over someone is refused too.
    const withTree = runtime([[tree.piece, []]]);
    await withTree.collisions.load();
    await expect(withTree.collisions.reset({ pieceId: tree.piece, actorId: null }, () => [onTree])).rejects.toBeInstanceOf(CollisionProtectedError);
  });

  it('blocks a decor desk table along its row out of the box, and frees the floor around it', async () => {
    // A table anchored on tile (21, 52): its middle tile center is (688, 1680).
    const items: DecorItem[] = [{ index: 52 * W + 21, piece: 'desk-wood', rotation: 0 }];
    const collisions = createCollisionRuntime({ layout: BASE_LAYOUT, seats: BASE_MAP_SEATS, store: createMemoryCollisions([]), decor: () => items, decorInfo });
    await collisions.load();

    expect(isPositionBlocked(collisions.rects(), 688, 1680 - 11)).toBe(true);
    expect(isPositionBlocked(collisions.rects(), 688, 1616 - 11)).toBe(false);
  });

  it('follows the decor layer when it changes, each item with its own piece', async () => {
    const items: DecorItem[] = [];
    const store = createMemoryCollisions([['chair-gamer', [{ x: -8, y: -8, w: 16, h: 16 }]]]);
    const collisions = createCollisionRuntime({ layout: BASE_LAYOUT, seats: BASE_MAP_SEATS, store, decor: () => items, decorInfo });
    await collisions.load();
    /** Body center in the middle of tile (67, 22). */
    const onChair = { x: 67 * 32 + 16, y: 22 * 32 + 16 - 11 };
    const onWood = { x: 68 * 32 + 16, y: 22 * 32 + 16 - 11 };
    expect(isPositionBlocked(collisions.rects(), onChair.x, onChair.y)).toBe(false);

    items.push({ index: 22 * W + 67, piece: 'chair-gamer', rotation: 0 }, { index: 22 * W + 68, piece: 'chair-wood', rotation: 0 });
    await collisions.refreshDecor();

    expect(isPositionBlocked(collisions.rects(), onChair.x, onChair.y)).toBe(true);
    expect(isPositionBlocked(collisions.rects(), onWood.x, onWood.y)).toBe(false);
    // The trap check of an edit sees the decor too.
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
