/**
 * The terrain edit route (#123 phase 2), tested as a pure function like
 * `spacesRoutes.test.ts`. The guard order matters the same way: the role is
 * checked before the body, so a probe without rights learns nothing about
 * which blocks exist or who stands where.
 */

import { describe, expect, it, vi } from 'vitest';
import { TILE } from '../../../src/game/mapData.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT } from '../../../src/test/legacyOffice.ts';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import { createMemoryTerrain } from './memoryTerrain.ts';
import { handleSetTerrainBlock, handleSetTerrainBlocks, handleSetTerrainChairs, handleSetTerrainWalls, type TerrainDeps } from './terrainRoutes.ts';
import { encodeTerrainBlocks } from '../../../src/game/officeLayout.ts';
import type { TerrainProtections } from './terrainRules.ts';
import { createTerrainRuntime } from './terrainRuntime.ts';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const LAWN = '35';

function user(overrides: Partial<DirectoryUser> & Pick<DirectoryUser, 'id' | 'uid'>): DirectoryUser {
  return {
    email: `${overrides.id}@example.com`,
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
    ...overrides,
  };
}

const ADMIN = user({ id: 'id-admin', uid: 'uid-admin', role: 'admin' });
const EMPLEADO = user({ id: 'id-empleado', uid: 'uid-empleado', role: 'employee' });

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valido-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: `${uid}@example.com`, name: null };
  },
};

const BEARER_ADMIN = 'Bearer valido-uid-admin';
const BEARER_EMPLEADO = 'Bearer valido-uid-empleado';

async function harness(protections: TerrainProtections = { placements: [], players: [] }) {
  const store = createMemoryTerrain();
  const terrain = createTerrainRuntime({ layout: BASE_LAYOUT, store });
  await terrain.load();
  const readProtections = vi.fn(async () => protections);
  const deps: TerrainDeps = {
    directory: createMemoryDirectory({ now: () => NOW, seed: [ADMIN, EMPLEADO] }),
    auth: verifier,
    now: () => NOW,
    log: () => {},
    terrain,
    protections: readProtections,
  };
  return { deps, store, terrain, readProtections };
}

describe('handleSetTerrainBlock', () => {
  it('authorizes the whole batch before validating and atomically refuses malformed or stale requests', async () => {
    const { deps, terrain, store } = await harness();
    expect((await handleSetTerrainBlocks(undefined, null, deps)).status).toBe(401);
    expect((await handleSetTerrainBlocks(BEARER_EMPLEADO, null, deps)).status).toBe(403);
    const expected = encodeTerrainBlocks(terrain.blocks());
    for (const edits of [[], [{ index: 0, material: 'wood' }, { index: 0, material: 'sand' }], [{ index: 140, material: 'grass' }], [{ index: 0, material: 'lava' }], [{ index: 1.5, material: 'grass' }], Array.from({ length: 141 }, (_, index) => ({ index, material: 'grass' }))]) {
      expect((await handleSetTerrainBlocks(BEARER_ADMIN, { edits, expected }, deps)).status).toBe(400);
    }
    expect((await handleSetTerrainBlocks(BEARER_ADMIN, { edits: [{ index: 0, material: 'sand' }], expected: 'outdated' }, deps)).body).toEqual({ error: 'terrain-stale' });
    expect([...(await store.loadBlocks())]).toEqual([]);
  });

  it('applies a batch once, recording the actor, without publishing partial conflicts', async () => {
    const { deps, terrain, store } = await harness({ placements: [{ x: 66, y: 21, w: 3, h: 3 }], players: [] });
    const listener = vi.fn();
    terrain.subscribe(listener);
    const expected = encodeTerrainBlocks(terrain.blocks());
    const refused = await handleSetTerrainBlocks(BEARER_ADMIN, { expected, edits: [{ index: 0, material: 'sand' }, { index: 35, material: 'water' }] }, deps);
    expect(refused).toEqual({ status: 409, body: { error: 'terrain-under-placement' } });
    expect(listener).not.toHaveBeenCalled();
    expect([...(await store.loadBlocks())]).toEqual([]);
    expect((await handleSetTerrainBlocks(BEARER_ADMIN, { expected, edits: [{ index: 0, material: 'sand' }, { index: 35, material: 'wood' }] }, deps)).status).toBe(200);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.actorOf(0)).toBe(ADMIN.id);
  });
  it('lets an admin set a block, recording who did it', async () => {
    const { deps, store, terrain } = await harness();

    const result = await handleSetTerrainBlock(BEARER_ADMIN, LAWN, { material: 'water' }, deps);

    expect(result).toEqual({ status: 200, body: { index: 35, material: 'water' } });
    expect(terrain.blocks()[35]).toBe('water');
    expect(store.actorOf(35)).toBe(ADMIN.id);
  });

  it('answers 401 without a valid credential and 403 to someone who does not administer, before reading the body', async () => {
    const { deps, terrain } = await harness();

    expect((await handleSetTerrainBlock(undefined, 'nope', null, deps)).status).toBe(401);
    expect((await handleSetTerrainBlock(BEARER_EMPLEADO, 'nope', null, deps)).status).toBe(403);
    expect((await handleSetTerrainBlock(BEARER_EMPLEADO, LAWN, { material: 'water' }, deps)).status).toBe(403);
    expect(terrain.blocks()[35]).toBe('grass');
  });

  it('answers 400 to a block off the map or an unknown material', async () => {
    const { deps } = await harness();

    expect(await handleSetTerrainBlock(BEARER_ADMIN, '140', { material: 'sand' }, deps)).toEqual({
      status: 400,
      body: { error: 'invalid-request' },
    });
    expect((await handleSetTerrainBlock(BEARER_ADMIN, LAWN, { material: 'lava' }, deps)).status).toBe(400);
  });

  it('refuses water under placements, but accepts water under players', async () => {
    const underDesk = await harness({ placements: [{ x: 66, y: 21, w: 3, h: 3 }], players: [] });
    expect(await handleSetTerrainBlock(BEARER_ADMIN, LAWN, { material: 'water' }, underDesk.deps)).toEqual({
      status: 409,
      body: { error: 'terrain-under-placement' },
    });
    expect(underDesk.terrain.blocks()[35]).toBe('grass');

    const underPlayer = await harness({ placements: [], players: [{ x: 67 * TILE + 32, y: 22 * TILE + 25 }] });
    expect(await handleSetTerrainBlock(BEARER_ADMIN, LAWN, { material: 'water' }, underPlayer.deps)).toEqual({
      status: 200,
      body: { index: 35, material: 'water' },
    });
  });

  it('accepts any other material without asking who stands there', async () => {
    const { deps, readProtections } = await harness({ placements: [], players: [{ x: 67 * TILE + 32, y: 22 * TILE + 25 }] });

    expect((await handleSetTerrainBlock(BEARER_ADMIN, LAWN, { material: 'sand' }, deps)).status).toBe(200);
    expect(readProtections).not.toHaveBeenCalled();
  });

  it('lets an unexpected failure through for the wiring to answer 500', async () => {
    const { deps } = await harness();
    const failing = { ...deps, protections: async () => Promise.reject(new Error('spaces down')) };

    await expect(handleSetTerrainBlock(BEARER_ADMIN, LAWN, { material: 'water' }, failing)).rejects.toThrow('spaces down');
  });
});

describe('handleSetTerrainWalls', () => {
  const FREE = 22 * BASE_LAYOUT.width + 67;
  const DESK = { x: 66, y: 21, w: 3, h: 3 };

  it('checks the role before reading the body', async () => {
    const { deps, terrain } = await harness();

    expect((await handleSetTerrainWalls(undefined, null, deps)).status).toBe(401);
    expect((await handleSetTerrainWalls(BEARER_EMPLEADO, null, deps)).status).toBe(403);
    expect((await handleSetTerrainWalls(BEARER_EMPLEADO, { edits: [{ index: FREE, piece: 'wall-brick' }] }, deps)).status).toBe(403);
    expect(terrain.walls()[FREE]).toBeNull();
  });

  it('lets an admin place and remove walls in one request, recording who did it', async () => {
    const { deps, store, terrain } = await harness();

    const placed = await handleSetTerrainWalls(BEARER_ADMIN, { edits: [{ index: FREE, piece: 'wall-brick' }, { index: FREE + 1, piece: 'wall-glass' }] }, deps);
    expect(placed).toEqual({ status: 200, body: { updated: 2 } });
    expect(terrain.walls()[FREE + 1]).toBe('wall-glass');
    expect(store.wallActorOf(FREE)).toBe(ADMIN.id);

    expect((await handleSetTerrainWalls(BEARER_ADMIN, { edits: [{ index: FREE, piece: null }] }, deps)).status).toBe(200);
    expect([...(await store.loadWalls())]).toEqual([[FREE + 1, 'wall-glass']]);
  });

  it('answers 400 to malformed batches, without writing anything', async () => {
    const { deps, store } = await harness();
    const tiles = BASE_LAYOUT.width * BASE_LAYOUT.height;

    for (const body of [null, {}, { edits: [] }, { edits: [{ index: tiles, piece: 'wall-brick' }] }, { edits: [{ index: FREE, piece: 'wall-lava' }] },
      { edits: [{ index: FREE, piece: 'wall-brick' }, { index: FREE, piece: null }] }, { edits: Array.from({ length: 2001 }, (_, index) => ({ index, piece: 'wall-brick' })) }]) {
      expect(await handleSetTerrainWalls(BEARER_ADMIN, body, deps)).toEqual({ status: 400, body: { error: 'invalid-request' } });
    }
    expect([...(await store.loadWalls())]).toEqual([]);
  });

  it('refuses a wall on a desk with 409, but places one in a room or under a player', async () => {
    const onDesk = await harness({ placements: [DESK], desks: [DESK], players: [] });
    expect(await handleSetTerrainWalls(BEARER_ADMIN, { edits: [{ index: FREE, piece: 'wall-stone' }] }, onDesk.deps)).toEqual({
      status: 409,
      body: { error: 'terrain-under-placement' },
    });
    expect(onDesk.terrain.walls()[FREE]).toBeNull();

    const inRoom = await harness({ placements: [{ x: 60, y: 18, w: 12, h: 9 }], desks: [], players: [{ x: 67 * TILE + 16, y: 22 * TILE + 5 }] });
    expect((await handleSetTerrainWalls(BEARER_ADMIN, { edits: [{ index: FREE, piece: 'wall-stone' }] }, inRoom.deps)).status).toBe(200);
  });
});

describe('handleSetTerrainChairs', () => {
  const FREE = 22 * BASE_LAYOUT.width + 67;
  const DESK = { x: 66, y: 21, w: 3, h: 3 };
  const WOOD = { piece: 'chair-wood', facing: 'down' };

  it('checks the role before reading the body', async () => {
    const { deps, terrain } = await harness();

    expect((await handleSetTerrainChairs(undefined, null, deps)).status).toBe(401);
    expect((await handleSetTerrainChairs(BEARER_EMPLEADO, null, deps)).status).toBe(403);
    expect((await handleSetTerrainChairs(BEARER_EMPLEADO, { edits: [{ index: FREE, chair: WOOD }] }, deps)).status).toBe(403);
    expect(terrain.chairs()).toEqual([]);
  });

  it('lets an admin place, turn and remove chairs in one request, recording who did it', async () => {
    const { deps, store, terrain } = await harness();

    const placed = await handleSetTerrainChairs(BEARER_ADMIN, { edits: [{ index: FREE, chair: WOOD }, { index: FREE + 1, chair: { piece: 'chair-gamer', facing: 'left' } }] }, deps);
    expect(placed).toEqual({ status: 200, body: { updated: 2 } });
    expect(terrain.chairs()).toEqual([{ index: FREE, piece: 'chair-wood', facing: 'down' }, { index: FREE + 1, piece: 'chair-gamer', facing: 'left' }]);
    expect(store.chairActorOf(FREE)).toBe(ADMIN.id);

    expect((await handleSetTerrainChairs(BEARER_ADMIN, { edits: [{ index: FREE, chair: null }] }, deps)).status).toBe(200);
    expect(await store.loadChairs()).toEqual([{ index: FREE + 1, piece: 'chair-gamer', facing: 'left' }]);
  });

  it('answers 400 to malformed batches, without writing anything', async () => {
    const { deps, store } = await harness();
    const tiles = BASE_LAYOUT.width * BASE_LAYOUT.height;

    for (const body of [null, {}, { edits: [] }, { edits: [{ index: tiles, chair: WOOD }] }, { edits: [{ index: FREE, chair: { piece: 'chair-throne', facing: 'down' } }] },
      { edits: [{ index: FREE, chair: WOOD }, { index: FREE, chair: null }] }, { edits: Array.from({ length: 501 }, (_, index) => ({ index, chair: null })) }]) {
      expect(await handleSetTerrainChairs(BEARER_ADMIN, body, deps)).toEqual({ status: 400, body: { error: 'invalid-request' } });
    }
    expect(await store.loadChairs()).toEqual([]);
  });

  it('refuses a chair on a desk with 409, but places one in a room or under a player', async () => {
    const onDesk = await harness({ placements: [DESK], desks: [DESK], players: [] });
    expect(await handleSetTerrainChairs(BEARER_ADMIN, { edits: [{ index: FREE, chair: WOOD }] }, onDesk.deps)).toEqual({
      status: 409,
      body: { error: 'terrain-under-placement' },
    });
    expect(onDesk.terrain.chairs()).toEqual([]);

    const inRoom = await harness({ placements: [{ x: 60, y: 18, w: 12, h: 9 }], desks: [], players: [{ x: 67 * TILE + 16, y: 22 * TILE + 5 }] });
    expect((await handleSetTerrainChairs(BEARER_ADMIN, { edits: [{ index: FREE, chair: WOOD }] }, inRoom.deps)).status).toBe(200);
  });
});
