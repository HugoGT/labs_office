import { Client, type Room } from 'colyseus.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, TILE, WORLD_H, WORLD_W } from '../../src/game/mapData.ts';
import { OFFICE_ROOM_NAME } from '../../src/game/officeProtocol.ts';
import { mapSeatId } from '../../src/game/seating.ts';
import { isPositionWalkable } from '../../src/game/officeLayout.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_SEATS as BASE_MAP_SEATS } from '../../src/test/legacyOffice.ts';
import { isPositionBlocked } from '../../src/game/pieceCollisions.ts';
import { createOfficeServer, type OfficeServer } from './createOfficeServer.ts';
import { createMemoryDirectory } from './directory/memoryDirectory.ts';
import type { UserDirectory } from './directory/directoryPort.ts';
import type { OfficeState } from './schema.ts';
import { createMemoryTerrain } from './terrain/memoryTerrain.ts';
import { createMemoryCollisions } from './collisions/memoryCollisions.ts';
import { createMemorySpaces } from './spaces/memorySpaces.ts';

process.setMaxListeners(200);

const UID = 'uid-ana';
const POSITION = { x: 300.5, y: 400.25 };
let server: OfficeServer;
const rooms: Room<OfficeState>[] = [];

async function waitFor(predicate: () => boolean) {
  await vi.waitFor(predicateAssert, { timeout: 4000, interval: 20 });
  function predicateAssert() { expect(predicate()).toBe(true); }
}

async function directory() {
  const store = createMemoryDirectory({ bootstrapSuperadminEmail: 'ana@example.com' });
  await store.resolveOnLogin({ uid: UID, email: 'ana@example.com', name: null });
  return store;
}

async function start(store?: UserDirectory, auth = true, overrides: NonNullable<Parameters<typeof createOfficeServer>[0]> = {}) {
  server = createOfficeServer({
    directory: store ?? null,
    auth: auth ? { async verify() { return { uid: UID, email: 'ana@example.com', name: null }; } } : null,
    spaces: null, decor: null, desks: null, terrain: null, collisions: null,
    egress: null, storage: null, assetStorage: null,
    reconnectionWindowSeconds: 0.3,
    layout: BASE_LAYOUT, seats: BASE_MAP_SEATS,
    ...overrides,
  });
  await server.listen(0);
}

async function join() {
  const room = await new Client(`ws://localhost:${server.port()}`).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token: 'verified', uid: UID, x: 999, y: 999 });
  rooms.push(room);
  await waitFor(() => room.state?.players.has(room.sessionId));
  return room;
}

async function move(room: Room<OfficeState>, position = POSITION) {
  room.send('move', { ...position, facing: 'left' });
  await waitFor(() => room.state.players.get(room.sessionId)?.x === position.x);
}

function own(room: Room<OfficeState>) { return room.state.players.get(room.sessionId)!; }
function expectSpawn(room: Room<OfficeState>) {
  expect(Math.abs(own(room).x - (PLAYER_SPAWN_TX * TILE + TILE / 2))).toBeLessThanOrEqual(TILE);
  expect(Math.abs(own(room).y - (PLAYER_SPAWN_TY * TILE + TILE / 2))).toBeLessThanOrEqual(TILE);
}

afterEach(async () => {
  await Promise.all(rooms.splice(0).map((room) => Promise.race([room.leave().catch(() => 0), new Promise((resolve) => setTimeout(resolve, 50))])));
  await server?.shutdown();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('OfficeRoom: restore last position (#148)', () => {
  it('rejects a saved footprint that straddles water even when its center is walkable', async () => {
    const store = await directory();
    const position = { x: 63 * TILE + 4, y: 49 * TILE + 16 };
    await store.saveLastPosition(UID, position);
    const { BASE_LAYOUT: layout } = await import('../../src/game/officeLayout.ts');
    await start(store, true, { layout, seats: [] });
    expect(isPositionWalkable(server.terrain.snapshot(), position.x, position.y)).toBe(true);
    const room = await join();
    expectSpawn(room);
    expect({ x: own(room).x, y: own(room).y }).not.toEqual(position);
  });

  it('an unoccupable spawn ring cell falls back to primary instead of intersecting a piece', async () => {
    await start(undefined, false, { collisions: createMemoryCollisions() });
    const first = await join();
    const primary = { x: own(first).x, y: own(first).y };
    // Inject a small authoritative piece rectangle at the second join's return cell.
    const rects = vi.spyOn(server.collisions, 'rects').mockReturnValue([{ piece: 'desk-wood', x: primary.x + TILE - 4, y: primary.y + 5, w: 8, h: 12 }]);
    expectSpawn(await join());
    const next = rooms.at(-1)!;
    expect({ x: own(next).x, y: own(next).y }).toEqual(primary);
    rects.mockRestore();
  });

  it('definitive leave then a new room restores position standing and tracks it for LiveKit', async () => {
    const store = await directory();
    await start(store);
    const first = await join();
    await move(first);
    await first.leave();
    await waitFor(() => !server.sessions.has(first.sessionId));
    expect(await store.getLastPosition(UID)).toEqual(POSITION);
    const next = await join();
    expect(own(next)).toMatchObject({ ...POSITION, seat: '', facing: 'down' });
    expect(server.sessions.positionOf(next.sessionId)).toEqual(POSITION);
    expect(server.sessions.uidOf(next.sessionId)).toBe(UID);
  });

  it('refresh joins before the old reconnection window ends and never regresses to stale storage', async () => {
    const store = await directory();
    await store.saveLastPosition(UID, { x: 350, y: 450 });
    await start(store);
    const first = await join();
    await move(first);
    const token = first.reconnectionToken;
    await first.leave(false);
    expect(server.sessions.has(first.sessionId)).toBe(true);
    expect(await store.getLastPosition(UID)).toEqual({ x: 350, y: 450 });
    const next = await join();
    expect(own(next)).toMatchObject(POSITION);
    expect(next.state.players.size).toBe(1);
    await expect(new Client(`ws://localhost:${server.port()}`).reconnect(token)).rejects.toThrow();
    await move(next, { x: 310, y: 410 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(own(next)).toMatchObject({ x: 310, y: 410 });
    await next.leave();
    await waitFor(() => !server.sessions.has(next.sessionId));
    expect(await store.getLastPosition(UID)).toEqual({ x: 310, y: 410 });
  });

  it('expired reconnection persists, but reconnecting inside the window does not save or reset', async () => {
    const store = await directory();
    const save = vi.spyOn(store, 'saveLastPosition');
    await start(store);
    const first = await join();
    await move(first);
    const token = first.reconnectionToken;
    await first.leave(false);
    expect(save).not.toHaveBeenCalled();
    // The client close fires before the server has reserved its reconnection seat.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const recovered = await new Client(`ws://localhost:${server.port()}`).reconnect<OfficeState>(token);
    rooms.push(recovered);
    await waitFor(() => recovered.state?.players.has(recovered.sessionId));
    expect(own(recovered)).toMatchObject(POSITION);
    expect(save).not.toHaveBeenCalled();
    await recovered.leave(false);
    await waitFor(() => !server.sessions.has(first.sessionId));
    expect(await store.getLastPosition(UID)).toEqual(POSITION);
    expect(own(await join())).toMatchObject(POSITION);
  });

  it.each([{ x: NaN, y: 400 }, { x: 300, y: Infinity }, { x: -1, y: 400 }, { x: WORLD_W, y: 400 }, { x: 300, y: WORLD_H }, { x: 0, y: 0 }, { x: 20 * TILE + 32, y: 20 * TILE + 25 }])('invalid or unwalkable stored coordinate %j falls back', async (position) => {
    const store = await directory();
    vi.spyOn(store, 'getLastPosition').mockResolvedValue(position);
    await start(store);
    expectSpawn(await join());
  });

  it('a live replacement never waits on an unavailable position read', async () => {
    const store = await directory();
    await start(store);
    const first = await join();
    await move(first);
    const read = vi.spyOn(store, 'getLastPosition').mockImplementation(() => new Promise(() => {}));
    expect(own(await join())).toMatchObject(POSITION);
    expect(read).not.toHaveBeenCalled();
  });

  it('a replaced in-flight join cannot resurrect itself after its delayed read completes', async () => {
    const store = await directory();
    await start(store);
    let finishRead!: (value: null) => void;
    const read = vi.spyOn(store, 'getLastPosition').mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const joining = join().then(() => null, (error: unknown) => error);
    await waitFor(() => read.mock.calls.length === 1);
    const concurrent = await join();
    await move(concurrent);
    finishRead(null);
    expect(await joining).toMatchObject({ code: 4100 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(own(concurrent)).toMatchObject(POSITION);
    expect(concurrent.state.players.size).toBe(1);
    expect(server.sessions.size()).toBe(1);
  });

  it('delayed saves bridge clean reloads and serialize newer leaves after older writes', async () => {
    const store = await directory();
    const originalSave = store.saveLastPosition.bind(store);
    let finishSave!: () => void;
    const save = vi.spyOn(store, 'saveLastPosition').mockImplementationOnce(async (uid, position) => {
      await new Promise<void>((resolve) => { finishSave = resolve; });
      await originalSave(uid, position);
    });
    await start(store);
    const first = await join();
    await move(first);
    const firstLeft = first.leave();
    await waitFor(() => save.mock.calls.length === 1);
    const next = await join();
    expect(own(next)).toMatchObject(POSITION);
    await move(next, { x: 310, y: 410 });
    const nextLeft = next.leave();
    await waitFor(() => !server.sessions.has(next.sessionId));
    expect(save).toHaveBeenCalledTimes(1);
    const third = await join();
    expect(own(third)).toMatchObject({ x: 310, y: 410 });
    finishSave();
    await Promise.all([firstLeft, nextLeft]);
    await waitFor(() => save.mock.calls.length === 2);
    expect(await store.getLastPosition(UID)).toEqual({ x: 310, y: 410 });
  });

  it('last join wins for a connected tab too, carrying its current accepted position', async () => {
    await start(await directory());
    const first = await join();
    await move(first);
    const next = await join();
    expect(own(next)).toMatchObject(POSITION);
    expect(next.state.players.size).toBe(1);
    expect(server.sessions.has(first.sessionId)).toBe(false);
  });

  it('terrain changed after saving invalidates the restored coordinate', async () => {
    const store = await directory();
    await start(store, true, { terrain: createMemoryTerrain() });
    const position = { x: 120 * TILE + 16, y: 85 * TILE + 5 };
    const first = await join();
    await move(first, position);
    await first.leave();
    await waitFor(() => !server.sessions.has(first.sessionId));
    const index = Math.floor(85 / 9) * 14 + Math.floor(120 / 9);
    await server.terrain.setBlock({ index, material: 'water', actorId: null }, async () => ({ placements: [], players: [] }));
    expect(isPositionWalkable(server.terrain.snapshot(), position.x, position.y)).toBe(false);
    expectSpawn(await join());
  });

  it('changed piece rectangles invalidate a previously valid saved position', async () => {
    const store = await directory();
    const table = BASE_LAYOUT.props.find((prop) => prop.piece.startsWith('table-'))!;
    const piece = table.piece;
    await start(store, true, { collisions: createMemoryCollisions([[piece, []]]) });
    const target = { x: table.tx * TILE + 16, y: table.ty * TILE + 5 };
    await server.collisions.setRects({ pieceId: piece, rects: [], actorId: null }, () => []);
    const first = await join();
    await move(first, target);
    await first.leave();
    await waitFor(() => !server.sessions.has(first.sessionId));
    await server.collisions.reset({ pieceId: piece, actorId: null }, () => []);
    expect(isPositionBlocked(server.collisions.rects(), target.x, target.y)).toBe(true);
    expectSpawn(await join());
  });

  it('a formerly seated avatar re-enters standing without retaining its seat claim', async () => {
    await start(await directory());
    const first = await join();
    const index = BASE_MAP_SEATS.findIndex((seat) => seat.tx === 53 && seat.ty === 11);
    const beside = { x: 53 * TILE + 16, y: 12 * TILE + 5 };
    await move(first, beside);
    first.send('sit', { seat: mapSeatId(index) });
    await waitFor(() => own(first).seat === mapSeatId(index));
    await first.leave();
    await waitFor(() => !server.sessions.has(first.sessionId));
    expect(own(await join())).toMatchObject({ ...beside, seat: '' });
  });

  it('a restored position authorizes the actual LiveKit space before any new move', async () => {
    const store = await directory();
    await store.saveLastPosition(UID, POSITION);
    const spaces = createMemorySpaces({ seed: [{ id: 'restored-space', slug: 'restored-space', name: 'Restored space', x: 9, y: 12, w: 2, h: 2, capacity: null }] });
    vi.stubEnv('LIVEKIT_API_KEY', 'local-test-key');
    vi.stubEnv('LIVEKIT_API_SECRET', 'local-test-secret-with-at-least-32-characters');
    await start(store, true, { spaces });
    const room = await join();
    const response = await fetch(`http://localhost:${server.port()}/livekit/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'verified', sessionId: room.sessionId, spaceId: 'restored-space' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ room: 'office-livekit-space-restored-space', identity: room.sessionId });
  });

  it.each(['revoked', 'expired'] as const)('a %s directory account is still refused before position retrieval', async (mode) => {
    const store = await directory();
    const user = (await store.findByUid(UID))!;
    const guarded = createMemoryDirectory({ seed: [{ ...user, status: mode === 'revoked' ? 'revoked' : 'active', expiresAt: mode === 'expired' ? new Date(0) : null }] });
    const read = vi.spyOn(guarded, 'getLastPosition');
    await start(guarded);
    await expect(join()).rejects.toThrow(mode);
    expect(read).not.toHaveBeenCalled();
    expect(server.sessions.size()).toBe(0);
  });

  it.each([true, false])('position read/write errors degrade without preventing cleanup (consented=%s)', async (consented) => {
    const store = await directory();
    vi.spyOn(store, 'getLastPosition').mockRejectedValue(new Error('read unavailable'));
    vi.spyOn(store, 'saveLastPosition').mockRejectedValue(new Error('write unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await start(store);
    const first = await join();
    expectSpawn(first);
    await move(first);
    await first.leave(consented);
    await waitFor(() => !server.sessions.has(first.sessionId));
    expectSpawn(await join());
    expect(warn).toHaveBeenCalledWith('[office] last position read failed', expect.any(Error));
    expect(warn).toHaveBeenCalledWith('[office] last position save failed', expect.any(Error));
  });

  it.each(['no auth', 'no directory'])('%s retains spawn fallback without trusting join uid/coordinates', async (mode) => {
    const store = await directory();
    await start(mode === 'no auth' ? store : undefined, mode !== 'no auth');
    const first = await join();
    await move(first);
    await first.leave();
    await waitFor(() => !server.sessions.has(first.sessionId));
    expectSpawn(await join());
    expect(await store.getLastPosition(UID)).toBeNull();
  });
});
