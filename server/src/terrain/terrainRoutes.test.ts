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
import { handleSetTerrainBlock, handleSetTerrainBlocks, type TerrainDeps } from './terrainRoutes.ts';
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

  it('answers 409 with its own code when water would land under a placement or a player', async () => {
    const underDesk = await harness({ placements: [{ x: 66, y: 21, w: 3, h: 3 }], players: [] });
    expect(await handleSetTerrainBlock(BEARER_ADMIN, LAWN, { material: 'water' }, underDesk.deps)).toEqual({
      status: 409,
      body: { error: 'terrain-under-placement' },
    });
    expect(underDesk.terrain.blocks()[35]).toBe('grass');

    const underPlayer = await harness({ placements: [], players: [{ x: 67 * TILE + 32, y: 22 * TILE + 25 }] });
    expect(await handleSetTerrainBlock(BEARER_ADMIN, LAWN, { material: 'water' }, underPlayer.deps)).toEqual({
      status: 409,
      body: { error: 'terrain-under-player' },
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
