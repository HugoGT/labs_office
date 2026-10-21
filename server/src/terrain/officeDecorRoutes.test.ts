/**
 * The office decor routes (#208), tested as pure functions like
 * `terrainRoutes.test.ts`. `POST /admin/decor` is administration anywhere on
 * the map; `POST /me/decor` lets anyone signed in decorate the desk they
 * occupy, and nothing outside it.
 */

import { describe, expect, it } from 'vitest';
import { LEGACY_LAYOUT as BASE_LAYOUT } from '../../../src/test/legacyOffice.ts';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import type { Desk } from '../desks/desksPort.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import { createMemoryTerrain } from './memoryTerrain.ts';
import { handleSetMyDecor, handleSetOfficeDecor, type OfficeDecorDeps } from './officeDecorRoutes.ts';
import { createTerrainRuntime } from './terrainRuntime.ts';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const W = BASE_LAYOUT.width;
const at = (tx: number, ty: number) => ty * W + tx;
const FREE = at(67, 22);
const DESK = { x: 66, y: 21 };
const CHAIR = { piece: 'chair-wood', rotation: 0 } as const;
const CATALOG = [
  { id: 'chair-wood', kind: 'chair', retired: false },
  { id: 'desk-wood', kind: 'desk', retired: false },
  { id: 'plant-ficus', kind: 'plant', footprint: { w: 1, h: 1 }, retired: false },
];

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
const OTRO = user({ id: 'id-otro', uid: 'uid-otro', role: 'employee' });

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valido-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: `${uid}@example.com`, name: null };
  },
};

const BEARER_ADMIN = 'Bearer valido-uid-admin';
const BEARER_EMPLEADO = 'Bearer valido-uid-empleado';
const BEARER_OTRO = 'Bearer valido-uid-otro';

function desk(occupantId: string | null): Desk {
  return { id: 'desk-1', label: '', x: DESK.x, y: DESK.y, occupantId, materialId: 'desk-wood', color: null, createdAt: NOW, updatedAt: NOW };
}

async function harness(desks: Desk[] = [desk(EMPLEADO.id)], seed = createMemoryTerrain()) {
  const terrain = createTerrainRuntime({ layout: BASE_LAYOUT, store: seed, decorPieces: async () => CATALOG });
  await terrain.load();
  const deps: OfficeDecorDeps = {
    directory: createMemoryDirectory({ now: () => NOW, seed: [ADMIN, EMPLEADO, OTRO] }),
    auth: verifier,
    now: () => NOW,
    log: () => {},
    terrain,
    desks: { listDesks: async () => desks },
  };
  return { deps, store: seed, terrain };
}

describe('handleSetOfficeDecor (POST /admin/decor)', () => {
  it('checks the role before reading the body', async () => {
    const { deps, terrain } = await harness();

    expect((await handleSetOfficeDecor(undefined, null, deps)).status).toBe(401);
    expect((await handleSetOfficeDecor(BEARER_EMPLEADO, null, deps)).status).toBe(403);
    expect((await handleSetOfficeDecor(BEARER_EMPLEADO, { edits: [{ index: FREE, item: CHAIR }] }, deps)).status).toBe(403);
    expect(terrain.decor()).toEqual([]);
  });

  it('lets an admin place, turn and remove items anywhere in one request, recording who did it', async () => {
    const { deps, store, terrain } = await harness();

    const placed = await handleSetOfficeDecor(BEARER_ADMIN, { edits: [{ index: FREE, item: CHAIR }, { index: FREE + 2 * W, item: { piece: 'desk-wood', rotation: 90 } }] }, deps);
    expect(placed).toEqual({ status: 200, body: { updated: 2 } });
    expect(terrain.decor()).toEqual([{ index: FREE, ...CHAIR }, { index: FREE + 2 * W, piece: 'desk-wood', rotation: 90 }]);
    expect(store.decorActorOf(FREE)).toBe(ADMIN.id);

    expect((await handleSetOfficeDecor(BEARER_ADMIN, { edits: [{ index: FREE, item: null }] }, deps)).status).toBe(200);
    expect(await store.loadDecor()).toEqual([{ index: FREE + 2 * W, piece: 'desk-wood', rotation: 90 }]);
  });

  it('answers 400 to malformed batches and to pieces the catalog does not offer or turn, without writing anything', async () => {
    const { deps, store } = await harness();
    const tiles = W * BASE_LAYOUT.height;

    for (const body of [
      null,
      {},
      { edits: [] },
      { edits: [{ index: tiles, item: CHAIR }] },
      { edits: [{ index: FREE, item: { piece: 'chair-throne', rotation: 0 } }] },
      { edits: [{ index: FREE, item: { piece: 'plant-ficus', rotation: 90 } }] },
      { edits: [{ index: FREE, item: CHAIR }, { index: FREE, item: null }] },
      { edits: Array.from({ length: 501 }, (_, index) => ({ index, item: null })) },
    ]) {
      expect(await handleSetOfficeDecor(BEARER_ADMIN, body, deps)).toEqual({ status: 400, body: { error: 'invalid-request' } });
    }
    expect(await store.loadDecor()).toEqual([]);
  });

  it('answers 409 to an item on water or on another item, and places one on a desk', async () => {
    const { deps, terrain } = await harness();

    expect(await handleSetOfficeDecor(BEARER_ADMIN, { edits: [{ index: at(94, 58), item: CHAIR }] }, deps)).toEqual({ status: 409, body: { error: 'terrain-under-placement' } });
    expect((await handleSetOfficeDecor(BEARER_ADMIN, { edits: [{ index: at(DESK.x + 1, DESK.y + 1), item: CHAIR }] }, deps)).status).toBe(200);
    expect(await handleSetOfficeDecor(BEARER_ADMIN, { edits: [{ index: at(DESK.x + 2, DESK.y + 1), item: { piece: 'desk-wood', rotation: 0 } }] }, deps)).toEqual({ status: 409, body: { error: 'terrain-under-placement' } });
    expect(terrain.decor()).toEqual([{ index: at(DESK.x + 1, DESK.y + 1), ...CHAIR }]);
  });
});

describe('handleSetMyDecor (POST /me/decor)', () => {
  it('needs a signed-in account and answers 403 no-desk to one without a desk', async () => {
    const { deps, terrain } = await harness([desk(EMPLEADO.id)]);

    expect((await handleSetMyDecor(undefined, null, deps)).status).toBe(401);
    expect(await handleSetMyDecor(BEARER_OTRO, { edits: [{ index: at(DESK.x, DESK.y), item: CHAIR }] }, deps)).toEqual({ status: 403, body: { error: 'no-desk' } });
    expect(terrain.decor()).toEqual([]);
  });

  it('lets the occupant place, turn and remove items inside their desk, admins included', async () => {
    const { deps, store, terrain } = await harness([desk(EMPLEADO.id)]);

    const placed = await handleSetMyDecor(BEARER_EMPLEADO, { edits: [{ index: at(DESK.x + 1, DESK.y + 2), item: { piece: 'desk-wood', rotation: 0 } }, { index: at(DESK.x, DESK.y), item: CHAIR }] }, deps);
    expect(placed).toEqual({ status: 200, body: { updated: 2 } });
    expect(store.decorActorOf(at(DESK.x, DESK.y))).toBe(EMPLEADO.id);

    expect((await handleSetMyDecor(BEARER_EMPLEADO, { edits: [{ index: at(DESK.x, DESK.y), item: { piece: 'chair-wood', rotation: 90 } }] }, deps)).status).toBe(200);
    expect((await handleSetMyDecor(BEARER_EMPLEADO, { edits: [{ index: at(DESK.x + 1, DESK.y + 2), item: null }] }, deps)).status).toBe(200);
    expect(terrain.decor()).toEqual([{ index: at(DESK.x, DESK.y), piece: 'chair-wood', rotation: 90 }]);
  });

  it('answers 403 outside-desk to anything reaching outside the desk, removals of outside items included', async () => {
    const outside = at(DESK.x + 5, DESK.y);
    const { deps, terrain } = await harness([desk(EMPLEADO.id)], createMemoryTerrain([], [], [{ index: outside, ...CHAIR }]));
    const OUTSIDE = { status: 403, body: { error: 'outside-desk' } };

    expect(await handleSetMyDecor(BEARER_EMPLEADO, { edits: [{ index: at(DESK.x + 3, DESK.y), item: CHAIR }] }, deps)).toEqual(OUTSIDE);
    // A desk table on a corner sticks out of the 3x3.
    expect(await handleSetMyDecor(BEARER_EMPLEADO, { edits: [{ index: at(DESK.x, DESK.y), item: { piece: 'desk-wood', rotation: 0 } }] }, deps)).toEqual(OUTSIDE);
    expect(await handleSetMyDecor(BEARER_EMPLEADO, { edits: [{ index: outside, item: null }] }, deps)).toEqual(OUTSIDE);
    expect(terrain.decor()).toEqual([{ index: outside, ...CHAIR }]);
  });

  it('answers 400 and 409 like the admin route', async () => {
    const { deps } = await harness([desk(EMPLEADO.id)]);

    expect(await handleSetMyDecor(BEARER_EMPLEADO, { edits: [] }, deps)).toEqual({ status: 400, body: { error: 'invalid-request' } });
    expect((await handleSetMyDecor(BEARER_EMPLEADO, { edits: [{ index: at(DESK.x, DESK.y), item: CHAIR }] }, deps)).status).toBe(200);
    expect(await handleSetMyDecor(BEARER_EMPLEADO, { edits: [{ index: at(DESK.x + 1, DESK.y), item: { piece: 'desk-wood', rotation: 0 } }] }, deps)).toEqual({ status: 409, body: { error: 'terrain-under-placement' } });
  });

  it('answers no-desk without a desks store', async () => {
    const { deps } = await harness();
    const without: OfficeDecorDeps = { ...deps, desks: undefined };

    expect(await handleSetMyDecor(BEARER_EMPLEADO, { edits: [{ index: at(DESK.x, DESK.y), item: CHAIR }] }, without)).toEqual({ status: 403, body: { error: 'no-desk' } });
  });
});
