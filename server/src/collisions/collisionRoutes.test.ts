/**
 * The collision edit routes, tested as pure functions like
 * `terrainRoutes.test.ts`: the role is checked before the body, so a probe
 * without rights learns nothing about which pieces exist or who stands where.
 */

import { describe, expect, it, vi } from 'vitest';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_SEATS as BASE_MAP_SEATS } from '../../../src/test/legacyOffice.ts';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import { handleResetPieceCollision, handleSetPieceCollision, type CollisionDeps } from './collisionRoutes.ts';
import { createCollisionRuntime } from './collisionRuntime.ts';
import { createMemoryCollisions } from './memoryCollisions.ts';

const NOW = new Date('2026-01-15T12:00:00.000Z');

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
const tree = BASE_LAYOUT.props.find((prop) => prop.kind === 'tree')!;
const onTree = { x: tree.tx * 32 + 16, y: tree.ty * 32 + 5 };

async function harness(players: { x: number; y: number }[] = []) {
  const store = createMemoryCollisions();
  const collisions = createCollisionRuntime({ layout: BASE_LAYOUT, seats: BASE_MAP_SEATS, store });
  await collisions.load();
  const pieceExists = vi.fn(async (id: string) => id !== 'plant-ghost');
  const deps: CollisionDeps = {
    directory: createMemoryDirectory({ now: () => NOW, seed: [ADMIN, EMPLEADO] }),
    auth: verifier,
    now: () => NOW,
    log: () => {},
    collisions,
    players: () => players,
    pieceExists,
  };
  return { deps, store, collisions, pieceExists };
}

describe('handleSetPieceCollision', () => {
  it('lets an admin save the rectangles of a piece, recording who did it', async () => {
    const { deps, store, collisions } = await harness();

    const result = await handleSetPieceCollision(BEARER_ADMIN, tree.piece, { rects: [{ x: -6, y: -10, w: 12, h: 10 }] }, deps);

    expect(result).toEqual({ status: 200, body: { pieceId: tree.piece, rects: [{ x: -6, y: -10, w: 12, h: 10 }] } });
    expect(collisions.table().get(tree.piece)).toEqual([{ x: -6, y: -10, w: 12, h: 10 }]);
    expect(store.actorOf(tree.piece)).toBe(ADMIN.id);
  });

  it('answers 401 and 403 before reading anything else', async () => {
    const { deps, pieceExists } = await harness();

    expect((await handleSetPieceCollision(undefined, 'nope', null, deps)).status).toBe(401);
    expect((await handleSetPieceCollision(BEARER_EMPLEADO, tree.piece, { rects: [] }, deps)).status).toBe(403);
    expect(pieceExists).not.toHaveBeenCalled();
  });

  it('answers 400 to a piece that cannot be edited or to invalid rectangles', async () => {
    const { deps } = await harness();

    expect(await handleSetPieceCollision(BEARER_ADMIN, 'hedge-boxwood', { rects: [] }, deps)).toEqual({ status: 400, body: { error: 'invalid-request' } });
    expect((await handleSetPieceCollision(BEARER_ADMIN, tree.piece, { rects: [{ x: 0, y: 0, w: -1, h: 1 }] }, deps)).status).toBe(400);
  });

  it('answers 404 to a piece the office does not know', async () => {
    const { deps } = await harness();

    expect(await handleSetPieceCollision(BEARER_ADMIN, 'plant-ghost', { rects: [] }, deps)).toEqual({ status: 404, body: { error: 'not-found' } });
  });

  it('answers 409 collision-under-player when a rectangle would close over someone', async () => {
    const { deps, collisions } = await harness([onTree]);
    await collisions.setRects({ pieceId: tree.piece, rects: [], actorId: null }, () => []);

    expect(await handleSetPieceCollision(BEARER_ADMIN, tree.piece, { rects: [{ x: -16, y: -32, w: 32, h: 32 }] }, deps)).toEqual({
      status: 409,
      body: { error: 'collision-under-player' },
    });
    expect(collisions.table().get(tree.piece)).toEqual([]);
  });
});

describe('handleResetPieceCollision', () => {
  it('gives a piece back its default', async () => {
    const { deps, collisions } = await harness();
    await collisions.setRects({ pieceId: tree.piece, rects: [], actorId: null }, () => []);

    expect(await handleResetPieceCollision(BEARER_ADMIN, tree.piece, deps)).toEqual({ status: 200, body: { pieceId: tree.piece, rects: null } });
    expect(collisions.table().has(tree.piece)).toBe(false);
  });

  it('guards the same way', async () => {
    const { deps } = await harness([onTree]);

    expect((await handleResetPieceCollision(BEARER_EMPLEADO, tree.piece, deps)).status).toBe(403);
    expect((await handleResetPieceCollision(BEARER_ADMIN, 'wall-brick', deps)).status).toBe(400);
    expect((await handleResetPieceCollision(BEARER_ADMIN, 'plant-ghost', deps)).status).toBe(404);
    // Nothing saved: resetting is a no-op and traps nobody.
    expect((await handleResetPieceCollision(BEARER_ADMIN, tree.piece, deps)).status).toBe(200);
  });
});
