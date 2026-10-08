import { Client, type Room } from 'colyseus.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOfficeServer, type OfficeServer } from '../createOfficeServer.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import { createMemorySpaces } from '../spaces/memorySpaces.ts';
import { createMemoryTerrain } from './memoryTerrain.ts';
import { BASE_LAYOUT, blockIndexAt, blockTileRect, encodeTerrainBlocks, isTileWalkable, withBlock } from '../../../src/game/officeLayout.ts';
import { MAP_BLOCK_COLUMNS, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, SPAWN_BLOCK_INDEX, TILE } from '../../../src/game/mapData.ts';
import { physicalBodyRect } from '../../../src/game/avatarGeometry.ts';
import { OFFICE_ROOM_NAME } from '../../../src/game/officeProtocol.ts';
import type { OfficeState } from '../schema.ts';

let server: OfficeServer | undefined;
const rooms: Room<OfficeState>[] = [];
afterEach(async () => {
  for (const room of rooms.splice(0)) await Promise.race([room.leave().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 100))]);
  await server?.shutdown();
});

describe('map editor HTTP to real Colyseus state', () => {
  it.each(['single', 'batch', 'reset', 'reconnecting'] as const)('relocates flooded footprints after %s commits and rejects stale prediction', async (mode) => {
    const spawn = blockIndexAt(BASE_LAYOUT.width, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY);
    const land = spawn - 1;
    const store = createMemoryTerrain([[land, 'grass']]);
    server = createOfficeServer({ directory: null, auth: null, terrain: store, spaces: null, desks: null, decor: null, collisions: null, reconnectionWindowSeconds: 2,
      seats: [{ tx: 63, ty: 49, facing: 'down' }, { tx: 67, ty: 49, facing: 'down' }] });
    const port = await server.listen(0);
    const room = await new Client(`ws://localhost:${port}`).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME);
    rooms.push(room);
    await vi.waitFor(() => expect(room.state?.players.has(room.sessionId)).toBe(true));
    // Center remains on wood, but the right edge of the physical body overlaps the edited block.
    const position = { x: 63 * TILE + 4, y: 49 * TILE + 16 };
    room.send('move', { ...position, facing: 'left' });
    await vi.waitFor(() => expect(server!.sessions.positionOf(room.sessionId)).toEqual(position));
    room.send('sit', { seat: 'map-0' });
    await vi.waitFor(() => expect(room.state.players.get(room.sessionId)?.seat).toBe('map-0'));
    const token = room.reconnectionToken;
    if (mode === 'reconnecting') {
      await room.leave(false);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const none = async () => ({ placements: [], players: [position] });
    if (mode === 'single') await server.terrain.setBlock({ index: land, material: 'water', actorId: null }, none);
    else await server.terrain.setBlocks(mode === 'reset'
      ? BASE_LAYOUT.blocks.map((material, index) => ({ index, material }))
      : [{ index: land, material: 'water' }], null, none, encodeTerrainBlocks(server.terrain.blocks()));
    const fallback = server.sessions.positionOf(room.sessionId)!;
    expect(fallback).not.toEqual(position);
    expect(Math.abs(fallback.x - (PLAYER_SPAWN_TX * TILE + 16))).toBeLessThanOrEqual(TILE);
    expect(Math.abs(fallback.y - (PLAYER_SPAWN_TY * TILE + 16))).toBeLessThanOrEqual(TILE);
    const current = mode === 'reconnecting'
      ? await new Client(`ws://localhost:${port}`).reconnect<OfficeState>(token) : room;
    if (current !== room) rooms.push(current);
    await vi.waitFor(() => expect(current.state?.players.get(room.sessionId)).toMatchObject({ ...fallback, seat: '', positionRevision: 1 }));
    // Even a still-walkable stale position must not undo relocation.
    current.send('move', { ...position, facing: 'left', positionRevision: 0 });
    current.send('move', { ...position, facing: 'left' });
    current.send('sit', { seat: 'map-1', positionRevision: 0 });
    current.send('sit', { seat: 'map-1' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.sessions.positionOf(room.sessionId)).toEqual(fallback);
    expect(current.state.players.get(room.sessionId)?.seat).toBe('');
    current.send('move', { x: fallback.x + 1, y: fallback.y, facing: 'right', positionRevision: 1 });
    await vi.waitFor(() => expect(server!.sessions.positionOf(room.sessionId)?.x).toBe(fallback.x + 1));
  });

  it('failed persistence and stale batches leave terrain and positions unchanged', async () => {
    const land = 76;
    const store = createMemoryTerrain([[land, 'grass']]);
    server = createOfficeServer({ directory: null, auth: null, terrain: store, spaces: null, desks: null, decor: null, collisions: null });
    const port = await server.listen(0);
    const room = await new Client(`ws://localhost:${port}`).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME);
    rooms.push(room);
    await vi.waitFor(() => expect(room.state?.players.has(room.sessionId)).toBe(true));
    const position = { x: 63 * TILE + 4, y: 49 * TILE + 16 };
    room.send('move', { ...position, facing: 'left' });
    await vi.waitFor(() => expect(server!.sessions.positionOf(room.sessionId)).toEqual(position));
    const before = server.terrain.blocks();
    vi.spyOn(store, 'saveBlocks').mockRejectedValue(new Error('store down'));
    const edits = [{ index: land, material: 'water' as const }];
    const none = async () => ({ placements: [], players: [position] });
    await expect(server.terrain.setBlocks(edits, null, none, 'stale')).rejects.toThrow();
    await expect(server.terrain.setBlocks(edits, null, none)).rejects.toThrow('store down');
    expect(server.terrain.blocks()).toEqual(before);
    expect(server.sessions.positionOf(room.sessionId)).toEqual(position);
    expect(room.state.players.get(room.sessionId)).toMatchObject(position);
  });

  it('rechecks current players after delayed persistence, not the pre-write observation', async () => {
    const store = createMemoryTerrain([[76, 'grass']]);
    server = createOfficeServer({ directory: null, auth: null, terrain: store, spaces: null, desks: null, decor: null, collisions: null });
    const port = await server.listen(0);
    const room = await new Client(`ws://localhost:${port}`).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME);
    rooms.push(room);
    await vi.waitFor(() => expect(room.state?.players.has(room.sessionId)).toBe(true));
    const original = store.saveBlocks.bind(store);
    let release!: () => void;
    vi.spyOn(store, 'saveBlocks').mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await original(...args);
    });
    const writing = server.terrain.setBlock({ index: 76, material: 'water', actorId: null }, async () => ({ placements: [], players: [] }));
    await vi.waitFor(() => expect(release).toBeDefined());
    const position = { x: 63 * TILE + 4, y: 49 * TILE + 16 };
    room.send('move', { ...position, facing: 'left' });
    await vi.waitFor(() => expect(server!.sessions.positionOf(room.sessionId)).toEqual(position));
    expect(server.terrain.blocks()[76]).toBe('grass');
    release();
    await writing;
    expect(server.sessions.positionOf(room.sessionId)).not.toEqual(position);
    await vi.waitFor(() => expect(room.state.players.get(room.sessionId)?.positionRevision).toBe(1));
  });

  it('joins on safe wood and replicates it despite a saved central water override, without changing storage', async () => {
    const spawn = blockIndexAt(BASE_LAYOUT.width, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY);
    const terrain = createMemoryTerrain([[spawn, 'water'], [spawn - 1, 'grass']]);
    server = createOfficeServer({ directory: null, auth: null, terrain, spaces: null, desks: null, decor: null, collisions: null, egress: null, storage: null, assetStorage: null });
    const port = await server.listen(0);
    const room = await new Client(`ws://localhost:${port}`).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME);
    rooms.push(room);
    await vi.waitFor(() => expect(room.state?.players.has(room.sessionId)).toBe(true));

    expect(room.state.terrainBlocks.split(',')[spawn]).toBe('wood');
    expect(room.state.terrainBlocks.split(',')[spawn - 1]).toBe('grass');
    const player = room.state.players.get(room.sessionId)!;
    expect({ x: player.x, y: player.y }).toEqual({ x: PLAYER_SPAWN_TX * TILE + TILE / 2, y: PLAYER_SPAWN_TY * TILE + TILE / 2 });
    const body = physicalBodyRect(player);
    for (const x of [body.x, body.x + body.width - 1]) for (const y of [body.y, body.y + body.height - 1]) {
      expect(isTileWalkable(server.terrain.snapshot(), Math.floor(x / TILE), Math.floor(y / TILE))).toBe(true);
    }
    expect(new Map(await terrain.loadBlocks())).toEqual(new Map([[spawn, 'water'], [spawn - 1, 'grass']]));
  });

  it('applies a batch atomically, replicates it to both clients, and refuses a stale or unsafe emptying', async () => {
    let directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'admin@example.com' });
    await directory.resolveOnLogin({ uid: 'admin', email: 'admin@example.com', name: null });
    const admin = (await directory.findByUid('admin'))!;
    directory = createMemoryDirectory({ seed: [admin, { ...admin, id: 'watcher-id', uid: 'watcher', email: 'watcher@example.com', role: 'employee' }] });
    const terrain = createMemoryTerrain();
    const spaces = createMemorySpaces();
    server = createOfficeServer({
      directory, spaces, terrain, auth: { async verify(token) {
        if (token === 'test-admin') return { uid: 'admin', email: 'admin@example.com', name: null };
        if (token === 'test-watcher') return { uid: 'watcher', email: 'watcher@example.com', name: null };
        return null;
      } },
      desks: null, decor: null, collisions: null, egress: null, storage: null, assetStorage: null,
    });
    const port = await server.listen(0);
    const join = async (token: string) => {
      const room = await new Client(`ws://localhost:${port}`).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token });
      rooms.push(room);
      await vi.waitFor(() => expect(room.state.terrainBlocks).toBe(encodeTerrainBlocks(BASE_LAYOUT.blocks)));
      return room;
    };
    const room = await join('test-admin');
    const watcher = await join('test-watcher');
    const post = (edits: { index: number; material: string }[], expected: string, authorization = 'Bearer test-admin') => fetch(`http://localhost:${port}/admin/terrain/blocks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify({ edits, expected }),
    });
    // The four neighbors of the entrance, built as lawn.
    const neighbors = [SPAWN_BLOCK_INDEX - 1, SPAWN_BLOCK_INDEX + 1, SPAWN_BLOCK_INDEX - MAP_BLOCK_COLUMNS, SPAWN_BLOCK_INDEX + MAP_BLOCK_COLUMNS];
    const draft = neighbors.reduce((blocks, index) => withBlock(blocks, index, 'grass'), [...BASE_LAYOUT.blocks]);
    const edits = draft.map((material, index) => ({ index, material }));
    const expected = encodeTerrainBlocks(BASE_LAYOUT.blocks);
    expect((await post(edits, expected, '')).status).toBe(401);
    expect((await post(edits, expected, 'Bearer test-watcher')).status).toBe(403);
    expect((await post(edits, expected)).status).toBe(200);
    await vi.waitFor(() => expect(room.state.terrainBlocks).toBe(encodeTerrainBlocks(draft)));
    await vi.waitFor(() => expect(watcher.state.terrainBlocks).toBe(encodeTerrainBlocks(draft)));
    expect((await terrain.loadBlocks()).size).toBe(neighbors.length);
    expect((await post(edits, expected)).status).toBe(409);
    const { tx: x, ty: y } = blockTileRect(BASE_LAYOUT.width, neighbors[0]!);
    await spaces.createSpace({ name: 'Office block', x, y, w: 9, h: 9, capacity: null });
    const reset = draft.map((_, index) => ({ index, material: index === SPAWN_BLOCK_INDEX ? 'wood' : 'void' }));
    const refusal = await post(reset, encodeTerrainBlocks(draft));
    expect(refusal.status).toBe(409);
    expect(await refusal.json()).toEqual({ error: 'terrain-under-placement' });
    expect(server.terrain.blocks()).toEqual(draft);
    expect(await spaces.listSpaces()).toHaveLength(1);
  });

  it('keeps the batch route present but unavailable without a directory', async () => {
    server = createOfficeServer({ directory: null, auth: null, terrain: null, spaces: null, desks: null, decor: null });
    const port = await server.listen(0);
    const response = await fetch(`http://localhost:${port}/admin/terrain/blocks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'terrain-not-configured' });
  });
});
