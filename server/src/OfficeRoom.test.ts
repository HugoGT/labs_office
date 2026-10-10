/**
 * Tests de integracion de la sala: servidor y cliente reales sobre WebSocket,
 * no dobles. La razon es concreta: el fallo mas caro de este stack no esta en
 * la logica sino en el protocolo (server 0.17 habla `@colyseus/schema` 4 y el
 * unico cliente publicado habla la 3). Un doble de la sala pasaria ese fallo
 * sin verlo; un round-trip de verdad lo estrella.
 */

import type { Client as ServerClient } from '@colyseus/core';
import { Client } from 'colyseus.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, TILE, WORLD_H, WORLD_W } from '../../src/game/mapData.ts';
import { detectSpace } from '../../src/game/proximity.ts';
import {
  SESSION_REPLACED_CLOSE_CODE,
  SESSION_REVOKED_CLOSE_CODE,
} from '../../src/game/officeProtocol.ts';
import { DESK_SEAT_FACING, chairSeatId, decodeTerrainChairs, decorSeatId, deskSeatId, mapSeatId } from '../../src/game/seating.ts';
import { decodeTerrainBlocks, decodeTerrainWalls } from '../../src/game/officeLayout.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_SEATS as BASE_MAP_SEATS, LEGACY_SPACES as BUILT_IN_SPACES } from '../../src/test/legacyOffice.ts';
import { createOfficeServer as createServer, type OfficeServer, type OfficeServerOverrides } from './createOfficeServer.ts';
const createOfficeServer = (overrides: OfficeServerOverrides = {}) => createServer({ layout: BASE_LAYOUT, seats: BASE_MAP_SEATS, ...overrides });
import { createMemoryDesks } from './desks/memoryDesks.ts';
import {
  DEFAULT_NAME,
  deriveIdentityName,
  MAX_NAME_LENGTH,
  OFFICE_ROOM_NAME,
  OfficeRoom,
  type SpacesVersionMessage,
  type StatusMessage,
} from './OfficeRoom.ts';
import type { DirectoryUser, UserDirectory } from './directory/directoryPort.ts';
import { createMemoryDirectory } from './directory/memoryDirectory.ts';
import { ART_PACK_DEFAULTS } from './decor/artCatalogRules.ts';
import { createMemoryDecor } from './decor/memoryDecor.ts';
import type { OfficeState } from './schema.ts';
import { createMemoryTerrain } from './terrain/memoryTerrain.ts';
import { createMemoryCollisions } from './collisions/memoryCollisions.ts';
import { decodeCollisionTable } from '../../src/game/pieceCollisions.ts';
import {
  SESSION_EXPIRED,
  type IdTokenVerifier,
  type SessionExpired,
  type VerifiedIdentity,
} from './verifyIdToken.ts';

let server: OfficeServer;
let endpoint: string;
const openRooms: { leave: () => Promise<number> }[] = [];

// Un servidor por test da aislamiento de estado, pero cada `Server` de Colyseus
// registra su propio handler de `uncaughtException` y con 10 tests se pasa del
// limite por defecto de 10. Es ruido del arnes, no una fuga del codigo propio.
// Subido a 100 al anadir los tests del directorio (#24), que levantan un
// servidor mas por caso, y a 150 al anadir los de la ventana de reconexion
// (#52), que hacen lo mismo. Raised to 200 for the one-session-per-account
// tests (#78), for the same reason.
process.setMaxListeners(200);

beforeEach(async () => {
  server = createOfficeServer();
  const port = await server.listen(0);
  endpoint = `ws://localhost:${port}`;
});

afterEach(async () => {
  // `leave()` sobre una sala que el test ya cerro nunca resuelve (el cierre que
  // espera ya ocurrio), asi que se corre contra un plazo en vez de esperarla.
  await Promise.all(
    openRooms.splice(0).map((room) =>
      Promise.race([
        room.leave().catch(() => 0),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]),
    ),
  );
  await server.shutdown();
});

async function join(name: string, options: Record<string, unknown> = {}) {
  const room = await new Client(endpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, {
    name,
    ...options,
  });
  openRooms.push(room);
  return room;
}

/**
 * Espera activa corta: el estado llega por red, no de forma sincrona. El
 * predicado puede reventar mientras `room.state` aun no existe, asi que un
 * throw cuenta como "todavia no", no como fallo del test.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`condicion no cumplida dentro del timeout${lastError ? `: ${lastError}` : ''}`);
}

describe('OfficeRoom: presencia', () => {
  it('quien entra aparece en el estado con su nombre y en la tile de spawn', async () => {
    const room = await join('HugoGT');

    await waitFor(() => room.state.players.size === 1);

    const me = room.state.players.get(room.sessionId);
    expect(me?.name).toBe('HugoGT');
    // Reparto en anillo: el primero cae en el centro exacto del spawn.
    expect(me?.x).toBe(PLAYER_SPAWN_TX * TILE + TILE / 2);
    expect(me?.y).toBe(PLAYER_SPAWN_TY * TILE + TILE / 2);
    expect(me?.facing).toBe('down');
  });

  it('dos clientes se ven mutuamente en el mismo estado', async () => {
    const a = await join('Ana');
    const b = await join('Beto');

    await waitFor(() => a.state.players.size === 2 && b.state.players.size === 2);

    expect(a.state.players.get(b.sessionId)?.name).toBe('Beto');
    expect(b.state.players.get(a.sessionId)?.name).toBe('Ana');
  });

  it('no apila a los que entran en el mismo pixel', async () => {
    const a = await join('Ana');
    const b = await join('Beto');

    await waitFor(() => a.state.players.size === 2);

    const first = a.state.players.get(a.sessionId);
    const second = a.state.players.get(b.sessionId);
    expect({ x: first?.x, y: first?.y }).not.toEqual({ x: second?.x, y: second?.y });
  });

  it('al salir un cliente, desaparece del estado del otro', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => a.state.players.size === 2);

    await b.leave();

    await waitFor(() => a.state.players.size === 1);
    expect(a.state.players.get(b.sessionId)).toBeUndefined();
  });
});

describe('OfficeRoom: movimiento', () => {
  it('propaga la posicion de un cliente al otro', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);

    a.send('move', { x: 300, y: 400, facing: 'left' });

    await waitFor(() => b.state.players.get(a.sessionId)?.x === 300);
    const seen = b.state.players.get(a.sessionId);
    expect(seen?.y).toBe(400);
    expect(seen?.facing).toBe('left');
  });
});

/**
 * Walkability (art migration, step 8, #123): the room refuses a move whose
 * body center lands on a tile the shared rule of `officeLayout.ts` blocks,
 * the same tiles the client's physics never lets the avatar into.
 */
describe('OfficeRoom: walkable terrain', () => {
  /** A network position whose feet-aligned body center is the middle of tile (tx, ty). */
  const onTile = (tx: number, ty: number) => ({ x: tx * TILE + 16, y: ty * TILE + 5, facing: 'down' });

  /** A status sent after the moves: once it lands, the moves before it were handled. */
  async function settle(room: Awaited<ReturnType<typeof join>>) {
    room.send('status', { status: 'y' });
    await waitFor(() => room.state.players.get(room.sessionId)?.status === 'y');
  }

  it('drops a move into the river or the lake, and keeps the last position', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const ashore = onTile(20, 23);
    room.send('move', ashore);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === ashore.x);

    room.send('move', onTile(20, 20));
    room.send('move', onTile(94, 62));
    await settle(room);

    expect(room.state.players.get(room.sessionId)?.y).toBe(ashore.y);
    expect(server.sessions.positionOf(room.sessionId)).toEqual({ x: ashore.x, y: ashore.y });
  });

  it('lets a move onto a bridge over the same river through', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const deck = onTile(14, 20);

    room.send('move', deck);

    await waitFor(() => room.state.players.get(room.sessionId)?.y === deck.y);
  });

  it('drops a move into a wall, a table or a tree', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const start = room.state.players.get(room.sessionId)?.x;

    // On the Sala de Juntas' west wall: posts stand on the vertices of x = 51, the wall runs down that line.
    room.send('move', { x: 51 * TILE, y: 4 * TILE + 5, facing: 'down' });
    room.send('move', onTile(55, 8));
    room.send('move', onTile(2, 2));
    await settle(room);

    expect(room.state.players.get(room.sessionId)?.x).toBe(start);
  });

  it('accepts and tracks every spot people stood on before the layout, so membership and voice rooms stay', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    // Tile centers, as the e2e teleport puts them: Cafeteria, its door, the
    // Sala de Juntas, the corridor and the spawn on the open lawn.
    const spots = [
      { tx: 58, ty: 20, space: 'Cafetería' },
      { tx: 59, ty: 21, space: 'Cafetería' },
      { tx: 50, ty: 24, space: 'Cafetería' },
      { tx: 55, ty: 4, space: 'Sala de Juntas' },
      { tx: 48, ty: 30, space: null },
      { tx: PLAYER_SPAWN_TX, ty: PLAYER_SPAWN_TY, space: null },
    ];

    for (const spot of spots) {
      const position = { x: spot.tx * TILE + 16, y: spot.ty * TILE + 16 };
      room.send('move', { ...position, facing: 'down' });
      await waitFor(() => room.state.players.get(room.sessionId)?.x === position.x && room.state.players.get(room.sessionId)?.y === position.y);
      expect(server.sessions.positionOf(room.sessionId)).toEqual(position);
      expect(detectSpace(position, BUILT_IN_SPACES)?.name ?? null).toBe(spot.space);
    }
  });

  it('a sitter snapped onto a chair by its table is kept there, and only while seated', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const index = BASE_MAP_SEATS.findIndex((seat) => seat.facing === 'up' && seat.tx === 53 && seat.ty === 11);
    const beside = onTile(53, 12);
    room.send('move', beside);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === beside.x);
    room.send('sit', { seat: mapSeatId(index) });
    await waitFor(() => room.state.players.get(room.sessionId)?.seat === mapSeatId(index));

    // Feet on the chair ground, as the client puts them.
    const onChair = { x: (53 + 0.5) * TILE, y: (11 + 0.5) * TILE - 18, facing: 'up' };
    room.send('move', onChair);
    await waitFor(() => room.state.players.get(room.sessionId)?.y === onChair.y);

    // Still in seat reach, but the aligned body center now crosses onto the table.
    const overTable = { ...onChair, y: onChair.y - 10 };
    room.send('move', overTable);
    await waitFor(() => room.state.players.get(room.sessionId)?.y === overTable.y);

    room.send('stand', {});
    await waitFor(() => room.state.players.get(room.sessionId)?.seat === '');
    room.send('move', { ...overTable, y: overTable.y - 1 });
    await settle(room);
    expect(room.state.players.get(room.sessionId)?.y).toBe(overTable.y);
  });
});

/**
 * Persisted terrain blocks (#123 phase 2): the room replicates the live blocks
 * and checks moves against the snapshot the server rebuilt on the last edit,
 * never against the database.
 */
describe('OfficeRoom: edited terrain', () => {
  const LAWN = 35;
  const LAKE = 94;
  const onTile = (tx: number, ty: number) => ({ x: tx * TILE + 16, y: ty * TILE + 5, facing: 'down' });
  const nobody = async () => ({ placements: [], players: [] });
  const blocksOf = (room: Awaited<ReturnType<typeof join>>) =>
    decodeTerrainBlocks(room.state.terrainBlocks, BASE_LAYOUT.blocks.length);

  async function settle(room: Awaited<ReturnType<typeof join>>) {
    room.send('status', { status: 'y' });
    await waitFor(() => room.state.players.get(room.sessionId)?.status === 'y');
  }

  beforeEach(async () => {
    await server.shutdown();
    server = createOfficeServer({ terrain: createMemoryTerrain([[LAWN, 'water']]) });
    endpoint = `ws://localhost:${await server.listen(0)}`;
  });

  it('replicates the persisted blocks to whoever joins', async () => {
    const room = await join('Ana');

    await waitFor(() => blocksOf(room)?.[LAWN] === 'water');
    expect(blocksOf(room)?.[LAKE]).toBe('water');
  });

  it('shows an edit to a client already inside, and to one joining after it', async () => {
    const ana = await join('Ana');
    const beto = await join('Beto');
    await waitFor(() => blocksOf(beto) !== null);

    await server.terrain.setBlock({ index: LAKE, material: 'grass', actorId: null }, nobody);

    await waitFor(() => blocksOf(beto)?.[LAKE] === 'grass');
    await waitFor(() => blocksOf(ana)?.[LAKE] === 'grass');
    const late = await join('Carla');
    await waitFor(() => blocksOf(late)?.[LAKE] === 'grass');
  });

  it('drops a move onto newly watered tiles and accepts one onto newly dried tiles', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    await server.terrain.setBlock({ index: LAWN, material: 'grass', actorId: null }, nobody);
    const lawn = onTile(67, 22);
    room.send('move', lawn);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === lawn.x);
    const ashore = onTile(20, 23);
    room.send('move', ashore);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === ashore.x);

    await server.terrain.setBlock({ index: LAWN, material: 'water', actorId: null }, nobody);
    room.send('move', lawn);
    await settle(room);
    expect(room.state.players.get(room.sessionId)?.x).toBe(ashore.x);

    await server.terrain.setBlock({ index: LAKE, material: 'grass', actorId: null }, nobody);
    const dried = onTile(94, 58);
    room.send('move', dried);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === dried.x);
    expect(server.sessions.positionOf(room.sessionId)).toEqual({ x: dried.x, y: dried.y });
  });

  const wallsOf = (room: Awaited<ReturnType<typeof join>>) =>
    decodeTerrainWalls(room.state.terrainWalls, BASE_LAYOUT.width * BASE_LAYOUT.height);
  const tile = (tx: number, ty: number) => ty * BASE_LAYOUT.width + tx;

  it('replicates painted walls to whoever is inside and whoever joins after', async () => {
    const ana = await join('Ana');
    await waitFor(() => wallsOf(ana) !== null);

    await server.terrain.setWalls([{ index: tile(20, 30), piece: 'wall-brick' }, { index: tile(21, 30), piece: 'wall-glass' }], null, nobody);

    await waitFor(() => wallsOf(ana)?.[tile(21, 30)] === 'wall-glass');
    expect(wallsOf(ana)?.[tile(20, 30)]).toBe('wall-brick');
    const late = await join('Beto');
    await waitFor(() => wallsOf(late)?.[tile(20, 30)] === 'wall-brick');
    expect(blocksOf(late)?.[LAWN]).toBe('water');
  });

  it('drops a move into a wall, and returns someone a wall lands on to the spawn', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const ashore = onTile(22, 23);
    room.send('move', ashore);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === ashore.x);

    // A lone post on the top-left corner of tile (23, 23) clears the body: nobody moves.
    await server.terrain.setWalls([{ index: tile(23, 23), piece: 'wall-stone' }], null, nobody);
    // A move whose body center lands on the post's vertex is refused.
    room.send('move', { x: 23 * TILE, y: 23 * TILE - 11, facing: 'down' });
    await settle(room);
    expect(room.state.players.get(room.sessionId)).toMatchObject({ x: ashore.x, y: ashore.y, positionRevision: 0 });

    // Joined to a post below it, the wall runs down x = 23 * TILE and clips the 18 px body standing west of it.
    await server.terrain.setWalls([{ index: tile(23, 24), piece: 'wall-stone' }], null, nobody);
    await waitFor(() => room.state.players.get(room.sessionId)?.positionRevision === 1);
    const moved = room.state.players.get(room.sessionId)!;
    expect(moved.x).not.toBe(ashore.x);
    expect(server.sessions.positionOf(room.sessionId)).toEqual({ x: moved.x, y: moved.y });
  });

});

/**
 * Collision areas per piece: the room replicates the saved table and checks
 * moves against the rectangles the server rebuilt on the last edit or desk
 * change, never against the database.
 */
describe('OfficeRoom: piece collisions', () => {
  const onTile = (tx: number, ty: number) => ({ x: tx * TILE + 16, y: ty * TILE + 5, facing: 'down' });
  const tableOf = (room: Awaited<ReturnType<typeof join>>) => decodeCollisionTable(room.state.pieceCollisions);
  const DESK = ART_PACK_DEFAULTS.desk;

  async function settle(room: Awaited<ReturnType<typeof join>>) {
    room.send('status', { status: 'y' });
    await waitFor(() => room.state.players.get(room.sessionId)?.status === 'y');
  }

  beforeEach(async () => {
    await server.shutdown();
    const at = new Date('2026-01-01T00:00:00.000Z');
    const desks = createMemoryDesks({ seed: [{ id: 'desk-a', label: 'Mesa A', x: 21, y: 50, occupantId: null, createdAt: at, updatedAt: at }] });
    server = createOfficeServer({ desks, collisions: createMemoryCollisions([['tree-oak', []]]) });
    endpoint = `ws://localhost:${await server.listen(0)}`;
  });

  it('checks the feet-aligned center while still allowing full-body edge overlap', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    // The desk pivot is (720, 1648); the saved small rectangle is deliberately asymmetric.
    await server.collisions.setRects({ pieceId: DESK, rects: [{ x: 1, y: -12, w: 9, h: 11 }], actorId: null }, () => []);
    const edgeOverlap = { x: 720, y: 1628, facing: 'down' };
    room.send('move', edgeOverlap);
    await waitFor(() => room.state.players.get(room.sessionId)?.y === edgeOverlap.y);
    expect(server.sessions.positionOf(room.sessionId)).toEqual({ x: 720, y: 1628 });

    // Center (724, 1639) is inside; the old offset center (708, 1619) was not.
    room.send('move', { x: 724, y: 1628, facing: 'left' });
    await settle(room);
    expect(room.state.players.get(room.sessionId)).toMatchObject(edgeOverlap);
    expect(server.sessions.positionOf(room.sessionId)).toEqual({ x: 720, y: 1628 });
  });

  it('replicates the saved table to whoever joins, and an edit to whoever is inside', async () => {
    const room = await join('Ana');
    await waitFor(() => tableOf(room)?.get('tree-oak')?.length === 0);

    await server.collisions.setRects({ pieceId: DESK, rects: [{ x: -20, y: -12, w: 40, h: 16 }], actorId: null }, () => []);

    await waitFor(() => tableOf(room)?.get(DESK)?.[0]?.w === 40);
    const late = await join('Beto');
    await waitFor(() => tableOf(late)?.get(DESK)?.[0]?.w === 40);
  });

  it('drops a move into a served desk once its piece has rectangles', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const middle = onTile(22, 51);
    room.send('move', middle);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === middle.x);
    const aside = onTile(22, 49);
    room.send('move', aside);
    await waitFor(() => room.state.players.get(room.sessionId)?.y === aside.y);

    await server.collisions.setRects({ pieceId: DESK, rects: [{ x: -20, y: -12, w: 40, h: 16 }], actorId: null }, () => []);
    room.send('move', middle);
    await settle(room);

    expect(room.state.players.get(room.sessionId)?.y).toBe(aside.y);
    expect(server.sessions.positionOf(room.sessionId)).toEqual({ x: aside.x, y: aside.y });
  });
});

describe('OfficeRoom: posicion trackeada en el registro de sesiones (#10, #12)', () => {
  it('onJoin registra la posicion de spawn en el registro, no solo en el estado', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);

    const me = room.state.players.get(room.sessionId);
    expect(server.sessions.positionOf(room.sessionId)).toEqual({ x: me?.x, y: me?.y });
  });

  it('un move valido actualiza la posicion trackeada en el registro', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);

    room.send('move', { x: 300, y: 400, facing: 'left' });

    await waitFor(() => room.state.players.get(room.sessionId)?.x === 300);
    expect(server.sessions.positionOf(room.sessionId)).toEqual({ x: 300, y: 400 });
  });

  it('un move fuera de los limites del mundo no toca la posicion trackeada: recortado, cae en el seto del borde', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const before = server.sessions.positionOf(room.sessionId);

    room.send('move', { x: 999999, y: -999999, facing: 'down' });
    room.send('status', { status: 'y' });

    await waitFor(() => room.state.players.get(room.sessionId)?.status === 'y');
    expect(server.sessions.positionOf(room.sessionId)).toEqual(before);
  });

  it('un move invalido (ignorado por el estado) tampoco toca la posicion trackeada', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const before = server.sessions.positionOf(room.sessionId);

    room.send('move', { x: 'aqui', y: null, facing: 'down' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(server.sessions.positionOf(room.sessionId)).toEqual(before);
  });
});

describe('OfficeRoom: el cliente no es de fiar', () => {
  it('nunca acepta una posicion fuera de los limites del mundo', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const start = { x: room.state.players.get(room.sessionId)?.x, y: room.state.players.get(room.sessionId)?.y };

    room.send('move', { x: 999999, y: -999999, facing: 'down' });
    room.send('move', { x: -5, y: WORLD_H + 40, facing: 'down' });
    room.send('status', { status: 'y' });

    await waitFor(() => room.state.players.get(room.sessionId)?.status === 'y');
    expect({ x: room.state.players.get(room.sessionId)?.x, y: room.state.players.get(room.sessionId)?.y }).toEqual(start);
    expect(WORLD_W).toBeLessThan(999999);
  });

  it('ignora un move con coordenadas no numericas en vez de escribir NaN', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const startX = room.state.players.get(room.sessionId)?.x;

    room.send('move', { x: 'aqui', y: null, facing: 'down' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Un NaN en el estado se propaga a todos los clientes y rompe el render.
    expect(room.state.players.get(room.sessionId)?.x).toBe(startX);
  });

  it('descarta un move parcialmente valido entero, sin aplicar solo un eje', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const startY = room.state.players.get(room.sessionId)?.y;

    room.send('move', { x: 500, y: Number.NaN, facing: 'down' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(room.state.players.get(room.sessionId)?.x).not.toBe(500);
    expect(room.state.players.get(room.sessionId)?.y).toBe(startY);
  });

  it('cae a "down" ante un facing inventado', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);

    room.send('move', { x: 320, y: 400, facing: 'diagonal-inventada' });

    await waitFor(() => room.state.players.get(room.sessionId)?.x === 320);
    expect(room.state.players.get(room.sessionId)?.facing).toBe('down');
  });

  it('recorta un nombre desmesurado y sustituye uno vacio', async () => {
    const long = await join('N'.repeat(200));
    const blank = await join('   ');
    await waitFor(() => long.state.players.size === 2);

    expect(long.state.players.get(long.sessionId)?.name).toHaveLength(MAX_NAME_LENGTH);
    expect(long.state.players.get(blank.sessionId)?.name).toBe(DEFAULT_NAME);
  });
});

describe('OfficeRoom: registro de sesiones vivas para LiveKit (D4)', () => {
  it('quien entra queda registrado de inmediato, via join real', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);

    expect(server.sessions.has(room.sessionId)).toBe(true);
  });

  it('quien sale se quita del registro, via leave real', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    const sessionId = room.sessionId;

    await room.leave();
    await waitFor(() => !server.sessions.has(sessionId));
  });
});

describe('OfficeRoom: estado de presencia (#1)', () => {
  it('el cambio de estado de un cliente llega al estado que ve el otro', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);

    a.send('status', { status: 'y' });

    await waitFor(() => b.state.players.get(a.sessionId)?.status === 'y');
  });

  it('quien entra sin pedir estado arranca "En linea"', async () => {
    const room = await join('Ana');

    await waitFor(() => room.state.players.size === 1);
    expect(room.state.players.get(room.sessionId)?.status).toBe('g');
  });

  it('al entrar, un estado invalido si cae al valor por defecto', async () => {
    // En `onJoin` no hay estado previo que proteger: rechazar el join entero
    // por una opcion mal escrita dejaria a alguien fuera de la oficina.
    const room = await join('Ana', { status: 'moradito' });

    await waitFor(() => room.state.players.size === 1);
    expect(room.state.players.get(room.sessionId)?.status).toBe('g');
  });

  it('un "status" inventado deja intacto el anterior, no lo degrada al de defecto', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    room.send('status', { status: 'r' });
    await waitFor(() => room.state.players.get(room.sessionId)?.status === 'r');

    room.send('status', { status: 'invisible' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Degradar en silencio un "No molestar" a "En linea" seria una fuga de
    // privacidad disfrazada de saneamiento: quien pidio aislarse dejaria de
    // estarlo sin enterarse, y el saneamiento se veria como correcto.
    expect(room.state.players.get(room.sessionId)?.status).toBe('r');
  });

  it('un "status" sin el campo tampoco toca el estado anterior', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    room.send('status', { status: 'r' });
    await waitFor(() => room.state.players.get(room.sessionId)?.status === 'r');

    room.send('status', {});
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(room.state.players.get(room.sessionId)?.status).toBe('r');
  });

  it('un "status" de una sesion que no esta en el estado no crea un jugador fantasma', () => {
    // No es alcanzable por WebSocket (todo cliente conectado tiene su entrada),
    // asi que se invoca el manejador directamente: la guarda existe para el
    // mensaje que llega justo despues de la baja.
    const handlers = new Map<string, (client: ServerClient, message: unknown) => void>();
    const room = new OfficeRoom();
    (room as unknown as { onMessage: unknown }).onMessage = (
      type: string,
      handler: (client: ServerClient, message: unknown) => void,
    ) => {
      handlers.set(type, handler);
      return () => {};
    };
    room.onCreate();

    const message: StatusMessage = { status: 'r' };
    expect(() =>
      handlers.get('status')!({ sessionId: 'fantasma' } as ServerClient, message),
    ).not.toThrow();
    expect(room.state.players.size).toBe(0);
  });
});

/**
 * Version de config de espacios (#7, D4). Mismo criterio de prueba que
 * "estado de presencia": el mensaje `spacesversion` espeja `status` linea a
 * linea (`OfficeRoom.ts`), asi que su suite tambien lo hace.
 */
describe('OfficeRoom: version de config de espacios (#7, D4)', () => {
  it('el cambio de version de un cliente llega al estado que ve el otro', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);

    a.send('spacesversion', { version: 'v2edited' });

    await waitFor(() => b.state.players.get(a.sessionId)?.spacesVersion === 'v2edited');
  });

  it('quien entra sin pedir version arranca con la version por defecto del servidor (#7, D4)', async () => {
    const room = await join('Ana');

    await waitFor(() => room.state.players.size === 1);
    // Nunca vacia: un peer jamas queda "sin version" ni un instante, o
    // audiblePeers() lo silenciaria contra todo el mundo por una version
    // vacia que no coincide con nada.
    expect(room.state.players.get(room.sessionId)?.spacesVersion).toBeTruthy();
  });

  it('el valor elegido antes de conectar viaja en el join, no se pierde (nunca "brevemente sin version")', async () => {
    const room = await join('Ana', { spacesVersion: 'inicial123' });

    await waitFor(() => room.state.players.size === 1);
    expect(room.state.players.get(room.sessionId)?.spacesVersion).toBe('inicial123');
  });

  it('una "spacesversion" con un valor no-string cae al valor por defecto del servidor', async () => {
    const room = await join('Ana', { spacesVersion: 12345 });

    await waitFor(() => room.state.players.size === 1);
    expect(room.state.players.get(room.sessionId)?.spacesVersion).not.toBe('12345');
  });

  it('una "spacesversion" de una sesion que no esta en el estado no crea un jugador fantasma', () => {
    const handlers = new Map<string, (client: ServerClient, message: unknown) => void>();
    const room = new OfficeRoom();
    (room as unknown as { onMessage: unknown }).onMessage = (
      type: string,
      handler: (client: ServerClient, message: unknown) => void,
    ) => {
      handlers.set(type, handler);
      return () => {};
    };
    room.onCreate();

    const message: SpacesVersionMessage = { version: 'v9' };
    expect(() =>
      handlers.get('spacesversion')!({ sessionId: 'fantasma' } as ServerClient, message),
    ).not.toThrow();
    expect(room.state.players.size).toBe(0);
  });
});

/**
 * Invitaciones de llamada entre pares (issue #2). Mismo criterio que el resto
 * del fichero: servidor y clientes reales sobre WebSocket, `callInvitations.ts`
 * ya tiene su propia suite pura -- aqui se prueba el CABLEADO, no la logica de
 * apilado en si (D5/D6/D7/D8).
 */
describe('OfficeRoom: invitaciones de llamada (issue #2)', () => {
  function listenFor<T>(room: { onMessage(type: string, cb: (msg: T) => void): unknown }, type: string) {
    const received: T[] = [];
    room.onMessage(type, (msg: T) => received.push(msg));
    return received;
  }

  it('dos llamantes distintos se apilan: ambas tarjetas llegan, en orden de llegada', async () => {
    const a = await join('Ana');
    const c = await join('Carla');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 3);
    const invites = listenFor<{ from: string; name: string }>(b, 'callinvite');

    a.send('call', { to: b.sessionId });
    await waitFor(() => invites.length === 1);
    c.send('call', { to: b.sessionId });
    await waitFor(() => invites.length === 2);

    expect(invites.map((i) => i.from)).toEqual([a.sessionId, c.sessionId]);
    expect(invites.map((i) => i.name)).toEqual(['Ana', 'Carla']);
  });

  it('D5: la misma persona llamando dos veces produce una unica tarjeta', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    const invites = listenFor<{ from: string }>(b, 'callinvite');

    a.send('call', { to: b.sessionId });
    await waitFor(() => invites.length === 1);
    a.send('call', { to: b.sessionId });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(invites).toHaveLength(1);
  });

  it('D8: el servidor no entrega una llamada dirigida a alguien en DND, aunque el cliente este trucado', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    b.send('status', { status: 'r' });
    await waitFor(() => a.state.players.get(b.sessionId)?.status === 'r');
    const invites = listenFor<unknown>(b, 'callinvite');

    a.send('call', { to: b.sessionId });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(invites).toHaveLength(0);
  });

  it('una llamada a uno mismo se ignora', async () => {
    const a = await join('Ana');
    await waitFor(() => a.state.players.size === 1);
    const invites = listenFor<unknown>(a, 'callinvite');

    a.send('call', { to: a.sessionId });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(invites).toHaveLength(0);
  });

  it('una llamada a un sessionId inexistente se descarta en silencio', async () => {
    const a = await join('Ana');
    await waitFor(() => a.state.players.size === 1);
    const invites = listenFor<unknown>(a, 'callinvite');

    expect(() => a.send('call', { to: 'jamas-existio' })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(invites).toHaveLength(0);
  });

  it('aceptar produce callaccepted en el emisor, con el nombre de quien acepto', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    const accepted = listenFor<{ by: string; name: string }>(a, 'callaccepted');

    a.send('call', { to: b.sessionId });
    await waitFor(() => b.state.players.size === 2);
    b.send('callrespond', { from: a.sessionId, accept: true });

    await waitFor(() => accepted.length === 1);
    expect(accepted[0]).toEqual({ by: b.sessionId, name: 'Beto' });
  });

  it('D3: pasar es silencioso, el emisor no recibe nada', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    const accepted = listenFor<unknown>(a, 'callaccepted');

    a.send('call', { to: b.sessionId });
    await new Promise((resolve) => setTimeout(resolve, 100));
    b.send('callrespond', { from: a.sessionId, accept: false });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(accepted).toHaveLength(0);
  });

  it('una respuesta forjada, de alguien que nunca llamo, se descarta en silencio', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    const accepted = listenFor<unknown>(a, 'callaccepted');

    expect(() => b.send('callrespond', { from: a.sessionId, accept: true })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(accepted).toHaveLength(0);
  });

  it('una respuesta repetida sobre una llamada ya resuelta es un no-op, no un segundo callaccepted', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    const accepted = listenFor<unknown>(a, 'callaccepted');

    a.send('call', { to: b.sessionId });
    await waitFor(() => b.state.players.size === 2);
    b.send('callrespond', { from: a.sessionId, accept: true });
    await waitFor(() => accepted.length === 1);
    expect(() => b.send('callrespond', { from: a.sessionId, accept: true })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(accepted).toHaveLength(1);
  });

  it('D7: si el emisor se desconecta, el destinatario recibe callerleft', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    const left = listenFor<{ from: string }>(b, 'callerleft');

    a.send('call', { to: b.sessionId });
    await waitFor(() => b.state.players.size === 2);
    await a.leave();

    await waitFor(() => left.length === 1);
    expect(left[0]).toEqual({ from: a.sessionId });
  });

  it('una invitacion sobrevive al reload de nadie: si el DESTINATARIO se va y vuelve, no le llega de nuevo', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    const firstInvites = listenFor<unknown>(b, 'callinvite');

    a.send('call', { to: b.sessionId });
    await waitFor(() => firstInvites.length === 1);
    await b.leave();
    await waitFor(() => a.state.players.size === 1);

    // Lo que se prueba aqui es lo observable por cable: nada replica las
    // invitaciones a quien entra, asi que recargar la pagina las pierde. Que
    // el registro ademas se limpie por dentro al irse el destinatario lo
    // prueba la suite pura de `callInvitations.ts` (`removeAllFor` en ambos
    // roles); desde fuera esa limpieza no se ve, solo evita que crezca.
    const reconnected = await join('Beto');
    await waitFor(() => reconnected.state.players.size === 2);
    const afterReconnect = listenFor<unknown>(reconnected, 'callinvite');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(reconnected.sessionId).not.toBe(b.sessionId);
    expect(afterReconnect).toHaveLength(0);
  });

  it('D7: si el destinatario se desconecta, el emisor NO recibe callerleft (solo se avisa al reves)', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    const left = listenFor<unknown>(a, 'callerleft');

    a.send('call', { to: b.sessionId });
    await waitFor(() => b.state.players.size === 2);
    await b.leave();
    await waitFor(() => a.state.players.size === 1);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(left).toHaveLength(0);
  });

  /**
   * Sala sin transporte: se capturan sus manejadores y se le pone un `clients`
   * de mentira que apunta cada envio. No es un atajo para ahorrarse el
   * WebSocket -- es la unica forma de probar sin carreras las dos cosas de
   * abajo: el paso del tiempo (temporizadores falsos y un socket vivo no se
   * llevan bien) y un mensaje que llega DESPUES de que el objetivo cambiase
   * de estado. Mismo criterio que la guarda del jugador fantasma de `status`.
   */
  function headlessRoom() {
    const handlers = new Map<string, (client: ServerClient, message: unknown) => void>();
    const sent: { to: string; type: string }[] = [];
    const room = new OfficeRoom();
    (room as unknown as { onMessage: unknown }).onMessage = (
      type: string,
      handler: (client: ServerClient, message: unknown) => void,
    ) => {
      handlers.set(type, handler);
      return () => {};
    };
    (room as unknown as { clients: unknown }).clients = {
      getById: (sessionId: string) => ({
        send: (type: string) => sent.push({ to: sessionId, type }),
      }),
    };
    room.onCreate();
    return { room, handlers, sent };
  }

  function seat(room: OfficeRoom, sessionId: string, name: string): void {
    room.onJoin({ sessionId, auth: true } as unknown as ServerClient, { name });
  }

  it('D6: sin caducidad, una invitacion sigue viva y aceptable pasado un minuto', () => {
    vi.useFakeTimers();
    try {
      const { room, handlers, sent } = headlessRoom();
      seat(room, 'ana', 'Ana');
      seat(room, 'beto', 'Beto');

      handlers.get('call')!({ sessionId: 'ana' } as ServerClient, { to: 'beto' });
      expect(sent.filter((message) => message.type === 'callinvite')).toHaveLength(1);

      // Con temporizadores falsos, CUALQUIER caducidad futura se dispararia
      // aqui: `setTimeout`, `setInterval`, o el `clock` de Colyseus, que corre
      // sobre ellos. Si alguien reintroduce un TTL, este test se cae, que es
      // justo lo que se quiere -- la decision de producto es que la tarjeta
      // vive hasta que se responde.
      vi.advanceTimersByTime(60_000);

      handlers.get('callrespond')!({ sessionId: 'beto' } as ServerClient, {
        from: 'ana',
        accept: true,
      });

      expect(sent.filter((message) => message.type === 'callaccepted')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('D8: el estado se lee cuando llega el mensaje, no cuando se abrio el menu', () => {
    const { room, handlers, sent } = headlessRoom();
    seat(room, 'ana', 'Ana');
    seat(room, 'beto', 'Beto');

    // El menu de Ana se abrio con Beto en verde y Beto se pone en rojo justo
    // despues. La llamada que sale de esa vista vieja tiene que morir igual:
    // el boton deshabilitado del cliente no puede ser la unica defensa, porque
    // llega tarde por definicion.
    handlers.get('status')!({ sessionId: 'beto' } as ServerClient, { status: 'r' });
    handlers.get('call')!({ sessionId: 'ana' } as ServerClient, { to: 'beto' });

    expect(sent).toHaveLength(0);
  });
});

/**
 * Verificador de mentira indexado por token. Aqui es lo correcto: que un token
 * de Firebase sea valido o no ya lo prueba a fondo `verifyIdToken.test.ts` con
 * firmas reales. Lo que estos tests tienen que demostrar es el cableado de la
 * sala -- que un `null` cierra la puerta, que la identidad llega a `client.auth`
 * y que el uid acaba en el registro -- y para eso un doble es mas honesto que
 * montar un JWKS.
 */
function stubVerifier(valid: Record<string, VerifiedIdentity | SessionExpired>): IdTokenVerifier {
  return {
    async verify(token: unknown) {
      return typeof token === 'string' ? (valid[token] ?? null) : null;
    },
  };
}

describe('OfficeRoom: shared desk invalidation lifecycle', () => {
  it('broadcasts committed invalidations and unsubscribes on disposal', () => {
    const room = new OfficeRoom();
    (room as unknown as { onMessage: unknown }).onMessage = () => () => {};
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => {});
    const listeners = new Set<() => void>();
    room.onCreate({ subscribeDesksChanges(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    } });
    for (const listener of listeners) listener();
    expect(broadcast).toHaveBeenCalledWith('deskschanged');
    room.onDispose();
    expect(listeners.size).toBe(0);
  });
});

const ANA: VerifiedIdentity = { uid: 'uid-ana', email: 'ana@example.com', name: 'Ana Gomez' };

/** Levanta un segundo servidor con auth activa, en su propio puerto efimero. */
async function startAuthenticatedServer(verifier: IdTokenVerifier) {
  const authServer = createOfficeServer({ auth: verifier });
  const port = await authServer.listen(0);
  return { authServer, endpoint: `ws://localhost:${port}` };
}

describe('deriveIdentityName (#8)', () => {
  it('prefiere el name del token verificado', () => {
    expect(deriveIdentityName(ANA, DEFAULT_NAME)).toBe('Ana Gomez');
  });

  it('cae a la parte local del email cuando no hay name', () => {
    // Mejor "ana" que "Invitado": es lo que la persona reconoce de si misma, y
    // el dominio no pinta nada en una etiqueta sobre un avatar.
    expect(
      deriveIdentityName({ uid: 'uid-ana', email: 'ana@example.com', name: null }, DEFAULT_NAME),
    ).toBe('ana');
  });

  it('cae al valor por defecto cuando el token no trae ni name ni email', () => {
    expect(deriveIdentityName({ uid: 'uid-ana', email: null, name: null }, DEFAULT_NAME)).toBe(
      DEFAULT_NAME,
    );
  });

  it('trata un name en blanco como ausente en vez de mostrar una etiqueta vacia', () => {
    expect(
      deriveIdentityName({ uid: 'uid-ana', email: 'ana@example.com', name: '   ' }, DEFAULT_NAME),
    ).toBe('ana');
  });

  it('cae al valor por defecto si la parte local del email queda vacia', () => {
    expect(
      deriveIdentityName({ uid: 'uid-ana', email: '@example.com', name: null }, DEFAULT_NAME),
    ).toBe(DEFAULT_NAME);
  });

  it('recorta los espacios de alrededor del name', () => {
    expect(
      deriveIdentityName({ uid: 'uid-ana', email: null, name: '  Ana Gomez  ' }, DEFAULT_NAME),
    ).toBe('Ana Gomez');
  });

  it('no recorta la longitud: de eso se encarga sanitizeName despues', () => {
    // Separar las dos reglas evita que un cambio en MAX_NAME_LENGTH haya que
    // perseguirlo por dos sitios.
    const largo = 'N'.repeat(200);
    expect(
      deriveIdentityName({ uid: 'uid-ana', email: null, name: largo }, DEFAULT_NAME),
    ).toHaveLength(200);
  });
});

describe('OfficeRoom: onAuth sin verificador (comportamiento de hoy)', () => {
  it('deja entrar sin token y la sesion queda sin dueno', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);

    expect(server.sessions.has(room.sessionId)).toBe(true);
    expect(server.sessions.uidOf(room.sessionId)).toBeUndefined();
  });

  it('REGRESION: sin verificador el nombre sigue saliendo de options.name', async () => {
    // Colyseus rechaza el join si `onAuth` devuelve algo falsy, asi que el modo
    // abierto devuelve `true` -- y ese `true` aterriza en `client.auth`. La
    // primera version de `onJoin` lo tomo por una identidad y le puso "Invitado"
    // a todo el mundo con la auth desactivada. Este test es el que lo caza.
    const room = await join('Ana', { token: 'da-igual-lo-que-ponga-aqui' });
    await waitFor(() => room.state.players.size === 1);

    expect(room.state.players.get(room.sessionId)?.name).toBe('Ana');
  });
});

describe('OfficeRoom: onAuth con verificador (#8)', () => {
  let authServer: OfficeServer;
  let authEndpoint: string;

  beforeEach(async () => {
    const started = await startAuthenticatedServer(
      stubVerifier({ 'token-de-ana': ANA, 'token-de-hace-meses': SESSION_EXPIRED }),
    );
    authServer = started.authServer;
    authEndpoint = started.endpoint;
  });

  afterEach(async () => {
    await authServer.shutdown();
  });

  function joinAuth(options: Record<string, unknown>) {
    return new Client(authEndpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, options);
  }

  it('un token valido entra y su uid queda ligado al sessionId', async () => {
    const room = await joinAuth({ token: 'token-de-ana' });
    openRooms.push(room);
    await waitFor(() => room.state.players.size === 1);

    expect(authServer.sessions.has(room.sessionId)).toBe(true);
    expect(authServer.sessions.uidOf(room.sessionId)).toBe('uid-ana');
  });

  it('el nombre sale del token, no del `name` que mande el cliente', async () => {
    // Este es el punto: con auth activa `options.name` deja de ser una fuente
    // legitima. Si se respetase, cualquiera podria entrar autenticado como si
    // mismo y rotularse con el nombre de otra persona de la oficina.
    const room = await joinAuth({ token: 'token-de-ana', name: 'Director General' });
    openRooms.push(room);
    await waitFor(() => room.state.players.size === 1);

    expect(room.state.players.get(room.sessionId)?.name).toBe('Ana Gomez');
  });

  it('un token invalido no entra: 401 unauthorized', async () => {
    await expect(joinAuth({ token: 'token-forjado' })).rejects.toMatchObject({ code: 401 });
  });

  it('a session older than its maximum age does not enter: 401 session-expired (#128)', async () => {
    await expect(joinAuth({ token: 'token-de-hace-meses' })).rejects.toMatchObject({
      code: 401,
      message: 'session-expired',
    });
    expect(authServer.sessions.size()).toBe(0);
  });

  it('entrar sin token tampoco cuela cuando la auth esta activa', async () => {
    await expect(joinAuth({ name: 'Ana' })).rejects.toMatchObject({ code: 401 });
  });

  it('un token invalido no deja rastro en el registro de sesiones', async () => {
    await expect(joinAuth({ token: 'token-forjado' })).rejects.toThrow();

    expect(authServer.sessions.size()).toBe(0);
  });
});

describe('OfficeRoom: nombre derivado de la identidad (#8)', () => {
  async function joinWithIdentity(identity: VerifiedIdentity, options: Record<string, unknown>) {
    const { authServer, endpoint: authEndpoint } = await startAuthenticatedServer(
      stubVerifier({ 'un-token': identity }),
    );
    const room = await new Client(authEndpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, {
      token: 'un-token',
      ...options,
    });
    await waitFor(() => room.state.players.size === 1);
    const name = room.state.players.get(room.sessionId)?.name;
    await authServer.shutdown();
    return name;
  }

  it('usa la parte local del email cuando el token no trae name', async () => {
    const name = await joinWithIdentity(
      { uid: 'uid-beto', email: 'beto@example.com', name: null },
      { name: 'ignorame' },
    );

    expect(name).toBe('beto');
  });

  it('usa el nombre por defecto cuando el token no trae ni name ni email', async () => {
    const name = await joinWithIdentity({ uid: 'uid-anon', email: null, name: null }, {});

    expect(name).toBe(DEFAULT_NAME);
  });

  it('recorta a MAX_NAME_LENGTH un name desmesurado que venga en el token', async () => {
    // El token viene firmado por Google, no saneado: un `name` de 200 caracteres
    // es perfectamente emitible y romperia el render igual que uno del cliente.
    const name = await joinWithIdentity(
      { uid: 'uid-largo', email: null, name: 'N'.repeat(200) },
      {},
    );

    expect(name).toHaveLength(MAX_NAME_LENGTH);
  });
});

/**
 * Directorio en `onAuth` (#24). El verificador y el directorio responden dos
 * preguntas distintas y ambas tienen que decir que si: la firma prueba QUIEN
 * es, y el directorio dice si esa persona puede entrar HOY. Sin la segunda, un
 * invitado de un dia entra para siempre, porque Identity Platform renueva su
 * token indefinidamente mientras la cuenta exista.
 *
 * Se usa el directorio en memoria y no Postgres por lo mismo que el resto de la
 * suite: una prueba que exige infraestructura levantada acaba sin correrse.
 */
function seededUser(overrides: Partial<DirectoryUser>): DirectoryUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    uid: 'uid-ana',
    email: 'ana@example.com',
    displayName: 'Ana',
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

async function startServerWithDirectory(directory: UserDirectory) {
  const withDirectory = createOfficeServer({
    auth: stubVerifier({ 'token-de-ana': ANA }),
    directory,
  });
  const port = await withDirectory.listen(0);
  return { server: withDirectory, endpoint: `ws://localhost:${port}` };
}

describe('OfficeRoom: onAuth con directorio (#24)', () => {
  let directoryServer: OfficeServer;
  let directoryEndpoint: string;

  async function start(directory: UserDirectory) {
    const started = await startServerWithDirectory(directory);
    directoryServer = started.server;
    directoryEndpoint = started.endpoint;
  }

  function joinWithToken(token = 'token-de-ana') {
    return new Client(directoryEndpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token });
  }

  afterEach(async () => {
    await directoryServer?.shutdown();
  });

  it('un usuario activo del directorio entra igual que antes', async () => {
    await start(createMemoryDirectory({ seed: [seededUser({})] }));

    const room = await joinWithToken();
    openRooms.push(room);
    await waitFor(() => room.state.players.size === 1);

    expect(directoryServer.sessions.uidOf(room.sessionId)).toBe('uid-ana');
  });

  it('#100, D5: el nombre visible sale del directorio, no del token, cuando ya lo eligio', async () => {
    // `seededUser` guarda `displayName: 'Ana'`, distinto del `name: 'Ana Gomez'`
    // del token. El directorio manda: es lo que peers y self ven, y es lo mismo
    // que ya devuelve `/me/display-name`.
    await start(createMemoryDirectory({ seed: [seededUser({})] }));

    const room = await joinWithToken();
    openRooms.push(room);
    await waitFor(() => room.state.players.size === 1);

    expect(room.state.players.get(room.sessionId)?.name).toBe('Ana');
  });

  it('#100, D5: sin nombre elegido todavia, cae al nombre derivado del token', async () => {
    await start(createMemoryDirectory({ seed: [seededUser({ displayName: null })] }));

    const room = await joinWithToken();
    openRooms.push(room);
    await waitFor(() => room.state.players.size === 1);

    expect(room.state.players.get(room.sessionId)?.name).toBe('Ana Gomez');
  });

  it('#100, D5: options.name sigue ignorado con directorio activo, incluso sin nombre elegido', async () => {
    await start(createMemoryDirectory({ seed: [seededUser({ displayName: null })] }));

    const room = await new Client(directoryEndpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, {
      token: 'token-de-ana',
      name: 'Director General',
    });
    openRooms.push(room);
    await waitFor(() => room.state.players.size === 1);

    expect(room.state.players.get(room.sessionId)?.name).toBe('Ana Gomez');
  });

  it('una cuenta de Identity Platform sin fila en el directorio NO entra (#72)', async () => {
    // El token es valido y trae email: antes eso bastaba para que el login
    // creara a la persona como empleado permanente. Tras perder la base de
    // datos, asi se recreo un invitado sin caducidad e irrevocable. Ahora un
    // token valido solo prueba quien es; entrar exige una fila dada de alta.
    const directory = createMemoryDirectory();
    await start(directory);

    await expect(joinWithToken()).rejects.toMatchObject({ code: 401, message: 'not-provisioned' });
    expect(await directory.findByUid('uid-ana')).toBeNull();
    expect(directoryServer.sessions.size()).toBe(0);
  });

  it('el superadmin de bootstrap si entra la primera vez, y se crea su fila', async () => {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'ana@example.com' });
    await start(directory);

    const room = await joinWithToken();
    openRooms.push(room);
    await waitFor(() => room.state.players.size === 1);

    expect((await directory.findByUid('uid-ana'))?.role).toBe('superadmin');
  });

  it('un invitado caducado NO entra, aunque su token siga siendo valido', async () => {
    // El nucleo del issue: la firma de Google sigue siendo buena y el token se
    // renueva solo. Lo unico que cierra la puerta es la fecha de esta tabla.
    await start(
      createMemoryDirectory({
        seed: [seededUser({ role: 'guest', expiresAt: new Date('2020-01-01T00:00:00.000Z') })],
      }),
    );

    await expect(joinWithToken()).rejects.toMatchObject({ code: 401, message: 'expired' });
  });

  it('un invitado con la caducidad en el futuro si entra', async () => {
    await start(
      createMemoryDirectory({
        seed: [seededUser({ role: 'guest', expiresAt: new Date('2099-01-01T00:00:00.000Z') })],
      }),
    );

    const room = await joinWithToken();
    openRooms.push(room);
    await waitFor(() => room.state.players.size === 1);

    expect(directoryServer.sessions.has(room.sessionId)).toBe(true);
  });

  it('una cuenta revocada NO entra', async () => {
    await start(createMemoryDirectory({ seed: [seededUser({ status: 'revoked' })] }));

    await expect(joinWithToken()).rejects.toMatchObject({ code: 401, message: 'revoked' });
  });

  it('quien no esta en el directorio NO entra', async () => {
    // El directorio en memoria devuelve `null` cuando el token no trae email,
    // que es el caso real de una cuenta anonima o por telefono: no hay clave
    // humana con la que casar una invitacion.
    const withDirectory = createOfficeServer({
      auth: stubVerifier({
        'token-sin-email': { uid: 'uid-anon', email: null, name: null },
      }),
      directory: createMemoryDirectory(),
    });
    const port = await withDirectory.listen(0);

    await expect(
      new Client(`ws://localhost:${port}`).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, {
        token: 'token-sin-email',
      }),
    ).rejects.toMatchObject({ code: 401, message: 'not-provisioned' });

    await withDirectory.shutdown();
  });

  it('the directory refusal says why, while a forged token stays mute (#129)', async () => {
    // Only a validly signed token learns the reason: whoever holds one already
    // proved who they are, and without it the office could only say "Sin
    // servidor". A forged token proves nothing, so it learns nothing.
    await start(createMemoryDirectory({ seed: [seededUser({ status: 'revoked' })] }));

    await expect(joinWithToken()).rejects.toMatchObject({ code: 401, message: 'revoked' });
    await expect(joinWithToken('token-forjado')).rejects.toMatchObject({ code: 401, message: 'unauthorized' });
  });

  it('un rechazo del directorio no deja rastro en el registro de sesiones', async () => {
    await start(createMemoryDirectory({ seed: [seededUser({ status: 'revoked' })] }));

    await expect(joinWithToken()).rejects.toThrow();

    expect(directoryServer.sessions.size()).toBe(0);
  });
});

describe('OfficeRoom: el motivo del rechazo se registra en el servidor (#24)', () => {
  /**
   * Se invoca `onAuth` directamente en vez de por WebSocket: lo que se prueba
   * es lo que el operador vera en el log, y eso no viaja por la red. El mismo
   * recurso que usa el test del "status fantasma" de mas arriba.
   */
  async function denyAndCaptureLog(directory: UserDirectory) {
    const logged: string[] = [];
    const room = new OfficeRoom();
    (room as unknown as { onMessage: unknown }).onMessage = () => () => {};
    room.onCreate({
      auth: stubVerifier({ 'token-de-ana': ANA }),
      directory,
      logDirectoryDenial: (decision, uid) => logged.push(`${decision}:${uid}`),
    });

    await expect(
      room.onAuth({} as ServerClient, { token: 'token-de-ana' }, {} as never),
    ).rejects.toThrow();

    return logged;
  }

  it('registra "expired" con el uid cuando caduca la invitacion', async () => {
    // El log SI distingue, y esa es la unica razon por la que existe: "todo el
    // mundo cae en not-provisioned" (las migraciones no corrieron) y "un
    // invitado caduco" son la misma respuesta HTTP y dos incidencias distintas.
    const logged = await denyAndCaptureLog(
      createMemoryDirectory({
        seed: [seededUser({ role: 'guest', expiresAt: new Date('2020-01-01T00:00:00.000Z') })],
      }),
    );

    expect(logged).toEqual(['expired:uid-ana']);
  });

  it('registra "not-provisioned" cuando la cuenta no tiene fila (#72)', async () => {
    const logged = await denyAndCaptureLog(createMemoryDirectory());

    expect(logged).toEqual(['not-provisioned:uid-ana']);
  });

  it('registra "revoked" cuando la cuenta esta revocada', async () => {
    const logged = await denyAndCaptureLog(
      createMemoryDirectory({ seed: [seededUser({ status: 'revoked' })] }),
    );

    expect(logged).toEqual(['revoked:uid-ana']);
  });

  it('no registra nada cuando la persona entra', async () => {
    const logged: string[] = [];
    const room = new OfficeRoom();
    (room as unknown as { onMessage: unknown }).onMessage = () => () => {};
    room.onCreate({
      auth: stubVerifier({ 'token-de-ana': ANA }),
      directory: createMemoryDirectory({ seed: [seededUser({})] }),
      logDirectoryDenial: (decision, uid) => logged.push(`${decision}:${uid}`),
    });

    await expect(
      room.onAuth({} as ServerClient, { token: 'token-de-ana' }, {} as never),
    ).resolves.toMatchObject({ uid: 'uid-ana' });
    expect(logged).toEqual([]);
  });

  it('#100, D5: onAuth trae el nombre ya elegido en el directorio, junto a la identidad', async () => {
    const room = new OfficeRoom();
    (room as unknown as { onMessage: unknown }).onMessage = () => () => {};
    room.onCreate({
      auth: stubVerifier({ 'token-de-ana': ANA }),
      directory: createMemoryDirectory({ seed: [seededUser({ displayName: 'Ana Lopez' })] }),
    });

    await expect(
      room.onAuth({} as ServerClient, { token: 'token-de-ana' }, {} as never),
    ).resolves.toMatchObject({ uid: 'uid-ana', directoryName: 'Ana Lopez' });
  });

  it('#100, D5: sin nombre elegido, onAuth trae directoryName null', async () => {
    const room = new OfficeRoom();
    (room as unknown as { onMessage: unknown }).onMessage = () => () => {};
    room.onCreate({
      auth: stubVerifier({ 'token-de-ana': ANA }),
      directory: createMemoryDirectory({ seed: [seededUser({ displayName: null })] }),
    });

    await expect(
      room.onAuth({} as ServerClient, { token: 'token-de-ana' }, {} as never),
    ).resolves.toMatchObject({ uid: 'uid-ana', directoryName: null });
  });
});

/**
 * The chosen character travels in the room state (art migration, step 5). The
 * id replicated is always the persisted one: `onAuth` reads it from the
 * directory row it already resolves, and anything the client sends is
 * ignored, or anyone could dress up as someone else's character.
 */
describe('OfficeRoom: persisted character in the room state (art migration, step 5)', () => {
  const BETO: VerifiedIdentity = { uid: 'uid-beto', email: 'beto@example.com', name: 'Beto Ruiz' };
  let characterServer: OfficeServer | undefined;

  async function start(options: { auth?: boolean; directory?: UserDirectory }) {
    characterServer = createOfficeServer({
      ...(options.auth === false ? {} : { auth: stubVerifier({ 'token-de-ana': ANA, 'token-de-beto': BETO }) }),
      ...(options.directory ? { directory: options.directory } : { directory: null }),
    });
    return `ws://localhost:${await characterServer.listen(0)}`;
  }

  async function joinAt(endpoint: string, options: Record<string, unknown>) {
    const room = await new Client(endpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, options);
    openRooms.push(room);
    return room;
  }

  afterEach(async () => {
    await characterServer?.shutdown();
    characterServer = undefined;
  });

  it('onAuth carries the persisted character next to the identity', async () => {
    const room = new OfficeRoom();
    (room as unknown as { onMessage: unknown }).onMessage = () => () => {};
    room.onCreate({
      auth: stubVerifier({ 'token-de-ana': ANA }),
      directory: createMemoryDirectory({ seed: [seededUser({ avatarId: 'character-p07-green-suit' })] }),
    });

    await expect(
      room.onAuth({} as ServerClient, { token: 'token-de-ana' }, {} as never),
    ).resolves.toMatchObject({ uid: 'uid-ana', avatarId: 'character-p07-green-suit' });
  });

  it('a second client sees the first client persisted character, not what it sent', async () => {
    const directory = createMemoryDirectory({
      seed: [
        seededUser({ avatarId: 'character-p07-green-suit' }),
        seededUser({
          id: '22222222-2222-4222-8222-222222222222',
          uid: 'uid-beto',
          email: 'beto@example.com',
          displayName: 'Beto',
          avatarId: 'character-p12-mint-blazer',
        }),
      ],
    });
    const endpoint = await start({ directory });

    const ana = await joinAt(endpoint, { token: 'token-de-ana', avatarId: 'character-p01-burgundy-suit' });
    const beto = await joinAt(endpoint, { token: 'token-de-beto' });
    await waitFor(() => beto.state.players.size === 2 && ana.state.players.size === 2);

    expect(beto.state.players.get(ana.sessionId)?.avatarId).toBe('character-p07-green-suit');
    expect(ana.state.players.get(beto.sessionId)?.avatarId).toBe('character-p12-mint-blazer');
    expect(ana.state.players.get(ana.sessionId)?.avatarId).toBe('character-p07-green-suit');
  });

  it('a character saved after a session ends is the one the next join replicates', async () => {
    const directory = createMemoryDirectory({ seed: [seededUser({})] });
    const endpoint = await start({ directory });

    await directory.setAvatar('11111111-1111-4111-8111-111111111111', 'character-p09-mint-shirt');
    const room = await joinAt(endpoint, { token: 'token-de-ana' });
    await waitFor(() => room.state.players.size === 1);

    expect(room.state.players.get(room.sessionId)?.avatarId).toBe('character-p09-mint-shirt');
  });

  it('retiring a character puts its live wearers on the fallback without closing their session (#122)', async () => {
    const directory = createMemoryDirectory({
      seed: [
        seededUser({ avatarId: 'character-upload-0123456789abcdef' }),
        seededUser({
          id: '22222222-2222-4222-8222-222222222222',
          uid: 'uid-beto',
          email: 'beto@example.com',
          displayName: 'Beto',
          avatarId: 'character-p12-mint-blazer',
        }),
      ],
    });
    const endpoint = await start({ directory });
    const ana = await joinAt(endpoint, { token: 'token-de-ana' });
    const beto = await joinAt(endpoint, { token: 'token-de-beto' });
    await waitFor(() => beto.state.players.size === 2 && ana.state.players.size === 2);
    let anaLeft = false;
    ana.onLeave(() => {
      anaLeft = true;
    });

    characterServer!.characters.retireCharacter('character-upload-0123456789abcdef', ART_PACK_DEFAULTS.character);

    await waitFor(() => beto.state.players.get(ana.sessionId)?.avatarId === ART_PACK_DEFAULTS.character, 1000);
    await waitFor(() => ana.state.players.get(ana.sessionId)?.avatarId === ART_PACK_DEFAULTS.character, 1000);
    expect(ana.state.players.get(beto.sessionId)?.avatarId).toBe('character-p12-mint-blazer');
    expect(anaLeft).toBe(false);
    expect(characterServer!.sessions.has(ana.sessionId)).toBe(true);
  });

  it('without a directory every player is the pack default character', async () => {
    const endpoint = await start({});

    const room = await joinAt(endpoint, { token: 'token-de-ana', avatarId: 'character-p07-green-suit' });
    await waitFor(() => room.state.players.size === 1);

    expect(room.state.players.get(room.sessionId)?.avatarId).toBe(ART_PACK_DEFAULTS.character);
  });

  it('without auth the client-sent character is ignored too', async () => {
    const endpoint = await start({ auth: false });

    const room = await joinAt(endpoint, { name: 'Ana', avatarId: 'character-p07-green-suit' });
    await waitFor(() => room.state.players.size === 1);

    expect(room.state.players.get(room.sessionId)?.avatarId).toBe(ART_PACK_DEFAULTS.character);
  });
});

/**
 * Reconexion tras una caida (issue #52). El fallo que estos tests fijan es el
 * que se veia en produccion: a un cliente le desaparecia el avatar del otro y
 * solo recargando LAS DOS pestanas volvia. Nada del lado del cliente puede
 * arreglarlo si el servidor borra el jugador del estado en el primer instante
 * de silencio, porque ese borrado ya viajo a todo el mundo como `onRemove`.
 *
 * La ventana se inyecta corta (1 s) en vez de falsear el reloj: el camino que
 * importa es el de Colyseus de verdad -- `allowReconnection` reservando el
 * asiento y su temporizador rechazando el `Deferred` -- y un reloj falso no
 * prueba ese camino, prueba un doble de el.
 */
describe('OfficeRoom: ventana de reconexion (issue #52)', () => {
  let dropServer: OfficeServer;
  let dropEndpoint: string;

  beforeEach(async () => {
    dropServer = createOfficeServer({ reconnectionWindowSeconds: 1 });
    dropEndpoint = `ws://localhost:${await dropServer.listen(0)}`;
  });

  afterEach(async () => {
    await dropServer.shutdown();
  });

  function joinDropServer(name: string) {
    return new Client(dropEndpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { name });
  }

  /**
   * Corta el socket sin mandar el `LEAVE_ROOM` consentido, que es literalmente
   * lo que hace `room.leave(false)` en `colyseus.js` (`Room.js:70-86`:
   * `consented` manda el frame, `!consented` llama a `connection.close()`).
   * Eso es una caida simulada, no una salida: el servidor recibe un codigo de
   * cierre que NO es 4000 y por tanto `onLeave(client, consented=false)`.
   */
  function dropSocket(room: { leave(consented?: boolean): Promise<number> }): Promise<number> {
    return room.leave(false);
  }

  it('una caida no consentida deja el avatar en pie para los demas', async () => {
    const a = await joinDropServer('Ana');
    const b = await joinDropServer('Beto');
    openRooms.push(a);
    await waitFor(() => a.state.players.size === 2);
    const droppedId = b.sessionId;

    const closeCode = await dropSocket(b);

    // La premisa del test: si esto fuese 4000 estariamos probando una salida
    // voluntaria y no una caida, y el resto de la asercion no valdria nada.
    expect(closeCode).not.toBe(4000);
    // Margen suficiente para que un borrado inmediato hubiese llegado ya: la
    // sincronizacion de Colyseus es de milisegundos, no de cientos.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(a.state.players.has(droppedId)).toBe(true);
  });

  it('agotada la ventana, el avatar del que se cayo si desaparece', async () => {
    const a = await joinDropServer('Ana');
    const b = await joinDropServer('Beto');
    openRooms.push(a);
    await waitFor(() => a.state.players.size === 2);
    const droppedId = b.sessionId;

    await dropSocket(b);

    // Un fantasma de pie para siempre seria tan malo como el parpadeo: la
    // ventana tiene que cerrarse sola.
    await waitFor(() => !a.state.players.has(droppedId), 4000);
  });

  it('una salida voluntaria no espera la ventana: se va en el acto', async () => {
    const a = await joinDropServer('Ana');
    const b = await joinDropServer('Beto');
    openRooms.push(a);
    await waitFor(() => a.state.players.size === 2);
    const leftId = b.sessionId;

    await b.leave();

    // La ventana es de 1 s; esto tiene que resolverse muy por debajo de eso, o
    // cerrar la pestana dejaria un avatar plantado un segundo entero.
    await waitFor(() => !a.state.players.has(leftId), 500);
  });

  it('la sesion de LiveKit sobrevive la ventana y solo muere al expirar', async () => {
    const a = await joinDropServer('Ana');
    const b = await joinDropServer('Beto');
    openRooms.push(a);
    await waitFor(() => a.state.players.size === 2);
    const droppedId = b.sessionId;

    await dropSocket(b);

    // Sin esto, el que vuelve tendria avatar pero no podria pedir token de
    // LiveKit: se le veria y no se le oiria, que es un modo degradado peor de
    // diagnosticar que la desaparicion entera.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(dropServer.sessions.has(droppedId)).toBe(true);

    await waitFor(() => !dropServer.sessions.has(droppedId), 4000);
  });
});

/**
 * One live session per account (#78): the last join wins. Real server and real
 * sockets, like the reconnection window tests above, because what has to hold
 * is Colyseus' own close and reconnection path, not a double of it.
 */
describe('OfficeRoom: one session per account (#78)', () => {
  const BETO: VerifiedIdentity = { uid: 'uid-beto', email: 'beto@example.com', name: 'Beto Ruiz' };
  let singleServer: OfficeServer;
  let singleEndpoint: string;

  beforeEach(async () => {
    singleServer = createOfficeServer({
      auth: stubVerifier({ 'token-de-ana': ANA, 'token-de-beto': BETO }),
      // Short, so a test that forgets to evict does not hide behind a window
      // that outlives it.
      reconnectionWindowSeconds: 2,
    });
    singleEndpoint = `ws://localhost:${await singleServer.listen(0)}`;
  });

  afterEach(async () => {
    await singleServer.shutdown();
  });

  async function joinAs(token: string) {
    const room = await new Client(singleEndpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token });
    openRooms.push(room);
    return room;
  }

  function closeCodeOf(room: { onLeave(handler: (code: number) => void): void }): Promise<number> {
    return new Promise((resolve) => room.onLeave(resolve));
  }

  it('a second join of the same account closes the first with the replaced code', async () => {
    const first = await joinAs('token-de-ana');
    await waitFor(() => first.state.players.size === 1);
    const firstClosed = closeCodeOf(first);

    const second = await joinAs('token-de-ana');

    expect(await firstClosed).toBe(SESSION_REPLACED_CLOSE_CODE);
    await waitFor(() => second.state.players.size === 1);
    expect([...second.state.players.keys()]).toEqual([second.sessionId]);
  });

  it('the new tab never sees the old avatar: it is released before the join state is sent', async () => {
    const first = await joinAs('token-de-ana');
    await waitFor(() => first.state.players.size === 1);

    const second = await joinAs('token-de-ana');
    const firstSync = new Promise<number>((resolve) =>
      second.onStateChange.once((state) => resolve(state.players.size)),
    );

    expect(await firstSync).toBe(1);
    expect(singleServer.sessions.has(first.sessionId)).toBe(false);
    expect(singleServer.sessions.uidOf(second.sessionId)).toBe('uid-ana');
  });

  it('a replaced session gets no reconnection window: its token is dead at once', async () => {
    const first = await joinAs('token-de-ana');
    await waitFor(() => first.state.players.size === 1);
    const token = first.reconnectionToken;
    const firstClosed = closeCodeOf(first);

    await joinAs('token-de-ana');
    await firstClosed;

    await expect(new Client(singleEndpoint).reconnect(token)).rejects.toThrow();
  });

  it('a session waiting in its reconnection window is evicted too, and its token stops working', async () => {
    const beto = await joinAs('token-de-beto');
    const first = await joinAs('token-de-ana');
    await waitFor(() => beto.state.players.size === 2);
    const oldId = first.sessionId;
    const token = first.reconnectionToken;

    // Non-consented drop: the seat is held for the window (#52).
    await first.leave(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(beto.state.players.has(oldId)).toBe(true);

    const second = await joinAs('token-de-ana');

    // Well below the 2 s window: the eviction, not the timeout, removed it.
    await waitFor(() => !beto.state.players.has(oldId) && beto.state.players.has(second.sessionId), 1000);
    expect(beto.state.players.size).toBe(2);
    expect(singleServer.sessions.has(oldId)).toBe(false);
    await expect(new Client(singleEndpoint).reconnect(token)).rejects.toThrow();
  });

  it('a pending call of the replaced session is withdrawn exactly once', async () => {
    const beto = await joinAs('token-de-beto');
    const first = await joinAs('token-de-ana');
    await waitFor(() => beto.state.players.size === 2);
    const callerLeft: unknown[] = [];
    beto.onMessage('callerleft', (payload) => callerLeft.push(payload));
    const invited = new Promise((resolve) => beto.onMessage('callinvite', resolve));
    first.send('call', { to: beto.sessionId });
    await invited;
    const firstClosed = closeCodeOf(first);

    await joinAs('token-de-ana');
    await firstClosed;
    // Room for a second release (from `onLeave`) to show up if it happened.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(callerLeft).toEqual([{ from: first.sessionId }]);
  });

  it('different accounts both stay', async () => {
    const ana = await joinAs('token-de-ana');
    const beto = await joinAs('token-de-beto');
    let anaLeft = false;
    ana.onLeave(() => {
      anaLeft = true;
    });

    await waitFor(() => ana.state.players.size === 2 && beto.state.players.size === 2);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(anaLeft).toBe(false);
    expect(ana.state.players.size).toBe(2);
  });
});

/**
 * Live eviction of a revoked account (#93): the admin route calls
 * `server.eviction.evictAccount(uid)`, and the room closes that account's
 * sessions right away with the revoked code. Real server and real sockets for
 * the same reason as the #78 tests above.
 */
describe('OfficeRoom: evicting a revoked account (#93)', () => {
  const BETO: VerifiedIdentity = { uid: 'uid-beto', email: 'beto@example.com', name: 'Beto Ruiz' };
  let evictServer: OfficeServer;
  let evictEndpoint: string;

  beforeEach(async () => {
    evictServer = createOfficeServer({
      auth: stubVerifier({ 'token-de-ana': ANA, 'token-de-beto': BETO }),
      reconnectionWindowSeconds: 2,
    });
    evictEndpoint = `ws://localhost:${await evictServer.listen(0)}`;
  });

  afterEach(async () => {
    await evictServer.shutdown();
  });

  async function joinAs(token: string) {
    const room = await new Client(evictEndpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token });
    openRooms.push(room);
    return room;
  }

  function closeCodeOf(room: { onLeave(handler: (code: number) => void): void }): Promise<number> {
    return new Promise((resolve) => room.onLeave(resolve));
  }

  it('closes the live session with the revoked code and removes its avatar for everyone', async () => {
    const beto = await joinAs('token-de-beto');
    const ana = await joinAs('token-de-ana');
    await waitFor(() => beto.state.players.size === 2);
    const anaId = ana.sessionId;
    const anaClosed = closeCodeOf(ana);

    evictServer.eviction.evictAccount('uid-ana');

    expect(await anaClosed).toBe(SESSION_REVOKED_CLOSE_CODE);
    await waitFor(() => !beto.state.players.has(anaId), 1000);
    expect(evictServer.sessions.has(anaId)).toBe(false);
    expect(evictServer.sessions.has(beto.sessionId)).toBe(true);
  });

  it('an evicted session gets no reconnection window: its token is dead at once', async () => {
    const ana = await joinAs('token-de-ana');
    await waitFor(() => ana.state.players.size === 1);
    const token = ana.reconnectionToken;
    const anaClosed = closeCodeOf(ana);

    evictServer.eviction.evictAccount('uid-ana');
    await anaClosed;

    await expect(new Client(evictEndpoint).reconnect(token)).rejects.toThrow();
  });

  it('a session waiting in its reconnection window is evicted too', async () => {
    const beto = await joinAs('token-de-beto');
    const ana = await joinAs('token-de-ana');
    await waitFor(() => beto.state.players.size === 2);
    const anaId = ana.sessionId;
    const token = ana.reconnectionToken;
    await ana.leave(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(beto.state.players.has(anaId)).toBe(true);

    evictServer.eviction.evictAccount('uid-ana');

    // Well below the 2 s window: the eviction, not the timeout, removed it.
    await waitFor(() => !beto.state.players.has(anaId), 1000);
    expect(evictServer.sessions.has(anaId)).toBe(false);
    await expect(new Client(evictEndpoint).reconnect(token)).rejects.toThrow();
  });

  it('other accounts stay, and an account with no session is a no-op', async () => {
    const beto = await joinAs('token-de-beto');
    let betoLeft = false;
    beto.onLeave(() => {
      betoLeft = true;
    });
    await waitFor(() => beto.state.players.size === 1);

    evictServer.eviction.evictAccount('uid-ana');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(betoLeft).toBe(false);
    expect(beto.state.players.size).toBe(1);
  });
});

/**
 * Kept outside the block above on purpose: Colyseus' matchmaker is per process,
 * so the `define` of the second server there would replace the open one.
 */
describe('OfficeRoom: one session per account without auth (#78)', () => {
  it('without auth there is no account to deduplicate: two joins both stay', async () => {
    // The open office (local dev, e2e) has no identity, so "same person" is
    // not something the server can know.
    const first = await join('Ana');
    const second = await join('Ana');
    let firstLeft = false;
    first.onLeave(() => {
      firstLeft = true;
    });

    await waitFor(() => first.state.players.size === 2 && second.state.players.size === 2);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(firstLeft).toBe(false);
    expect(server.sessions.size()).toBe(2);
  });
});

/**
 * Sitting (art migration, step 6). Having a desk and sitting are different
 * things: a seat is something a client asks for, the room checks it (the seat
 * exists, the player is next to it, nobody else is on it, and for a claimed
 * desk only its owner) and replicates it; moving away stands the player up.
 */
describe('OfficeRoom: seats', () => {
  const CHAIR = BASE_MAP_SEATS[0];
  const besideChair = { x: CHAIR.tx * TILE + 16, y: (CHAIR.ty - 1) * TILE + 16, facing: 'down' };

  async function moveNextToChair(room: Awaited<ReturnType<typeof join>>) {
    room.send('move', besideChair);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === besideChair.x);
  }

  it('a player next to a chair sits on it, and the others see the seat and its facing', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    await moveNextToChair(a);

    a.send('sit', { seat: mapSeatId(0) });

    await waitFor(() => b.state.players.get(a.sessionId)?.seat === mapSeatId(0));
    expect(b.state.players.get(a.sessionId)?.facing).toBe(CHAIR.facing);
  });

  it('everyone joins standing', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    expect(room.state.players.get(room.sessionId)?.seat).toBe('');
  });

  it('ignores a seat out of reach, a malformed one and a chair that does not exist', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);

    // From the spawn, far from every chair.
    room.send('sit', { seat: mapSeatId(0) });
    await moveNextToChair(room);
    room.send('sit', { seat: 'map-999' });
    room.send('sit', { seat: 42 });
    room.send('sit', null);
    room.send('status', { status: 'y' });

    // The status sent last proves the sits before it were already handled.
    await waitFor(() => room.state.players.get(room.sessionId)?.status === 'y');
    expect(room.state.players.get(room.sessionId)?.seat).toBe('');
  });

  it('a seat holds one person: a second one asking for it stays standing', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    await moveNextToChair(a);
    await moveNextToChair(b);

    a.send('sit', { seat: mapSeatId(0) });
    await waitFor(() => b.state.players.get(a.sessionId)?.seat === mapSeatId(0));
    b.send('sit', { seat: mapSeatId(0) });
    b.send('status', { status: 'y' });

    await waitFor(() => a.state.players.get(b.sessionId)?.status === 'y');
    expect(a.state.players.get(b.sessionId)?.seat).toBe('');
  });

  it('stand clears the seat', async () => {
    const room = await join('Ana');
    await moveNextToChair(room);
    room.send('sit', { seat: mapSeatId(0) });
    await waitFor(() => room.state.players.get(room.sessionId)?.seat === mapSeatId(0));

    room.send('stand', {});

    await waitFor(() => room.state.players.get(room.sessionId)?.seat === '');
  });

  it('moving within reach keeps the seat and its facing; moving away stands up', async () => {
    const room = await join('Ana');
    await moveNextToChair(room);
    room.send('sit', { seat: mapSeatId(0) });
    await waitFor(() => room.state.players.get(room.sessionId)?.seat === mapSeatId(0));

    // The client snaps onto the chair after the server confirms: a move that
    // stays next to the seat must not throw the sitter out of it.
    room.send('move', { x: CHAIR.tx * TILE + 16, y: CHAIR.ty * TILE - 2, facing: 'left' });
    await waitFor(() => room.state.players.get(room.sessionId)?.y === CHAIR.ty * TILE - 2);
    expect(room.state.players.get(room.sessionId)?.seat).toBe(mapSeatId(0));
    expect(room.state.players.get(room.sessionId)?.facing).toBe(CHAIR.facing);

    room.send('move', { x: PLAYER_SPAWN_TX * TILE, y: PLAYER_SPAWN_TY * TILE, facing: 'left' });
    await waitFor(() => room.state.players.get(room.sessionId)?.seat === '');
    expect(room.state.players.get(room.sessionId)?.facing).toBe('left');
  });

  it('a seat is free again once its sitter leaves', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    await moveNextToChair(a);
    await moveNextToChair(b);
    a.send('sit', { seat: mapSeatId(0) });
    await waitFor(() => b.state.players.get(a.sessionId)?.seat === mapSeatId(0));

    await a.leave();
    await waitFor(() => b.state.players.size === 1);
    b.send('sit', { seat: mapSeatId(0) });

    await waitFor(() => b.state.players.get(b.sessionId)?.seat === mapSeatId(0));
  });

  it('sitting does not move the position the room tracks for LiveKit', async () => {
    const room = await join('Ana');
    await moveNextToChair(room);
    room.send('sit', { seat: mapSeatId(0) });
    await waitFor(() => room.state.players.get(room.sessionId)?.seat === mapSeatId(0));

    expect(server.sessions.positionOf(room.sessionId)).toEqual({ x: besideChair.x, y: besideChair.y });
  });

  it('without a desk store a desk seat is never granted', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);
    room.send('sit', { seat: deskSeatId('id-mesa') });
    room.send('status', { status: 'y' });

    await waitFor(() => room.state.players.get(room.sessionId)?.status === 'y');
    expect(room.state.players.get(room.sessionId)?.seat).toBe('');
  });
});

/**
 * Chairs placed from the terrain editor: replicated like the walls, and a
 * seat anyone may take, checked against the live chairs the terrain runtime
 * holds.
 */
describe('OfficeRoom: placed chairs', () => {
  const tile = (tx: number, ty: number) => ty * BASE_LAYOUT.width + tx;
  const CHAIR = tile(22, 23);
  const besideChair = { x: 21 * TILE + 16, y: 23 * TILE + 5, facing: 'down' };
  const nobody = async () => ({ placements: [], players: [] });
  const chairsOf = (room: Awaited<ReturnType<typeof join>>) => decodeTerrainChairs(room.state.terrainChairs, BASE_LAYOUT.width * BASE_LAYOUT.height);

  beforeEach(async () => {
    await server.shutdown();
    server = createOfficeServer({ terrain: createMemoryTerrain([], [], [{ index: CHAIR, piece: 'chair-gamer', facing: 'left' }]) });
    endpoint = `ws://localhost:${await server.listen(0)}`;
  });

  async function moveNextToChair(room: Awaited<ReturnType<typeof join>>) {
    room.send('move', besideChair);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === besideChair.x);
  }

  it('replicates the placed chairs to whoever is inside and whoever joins after', async () => {
    const ana = await join('Ana');
    await waitFor(() => chairsOf(ana)?.length === 1);
    expect(chairsOf(ana)).toEqual([{ index: CHAIR, piece: 'chair-gamer', facing: 'left' }]);

    await server.terrain.setChairs([{ index: tile(30, 23), chair: { piece: 'chair-wood', facing: 'up' } }], null, nobody);

    await waitFor(() => chairsOf(ana)?.length === 2);
    const late = await join('Beto');
    await waitFor(() => chairsOf(late)?.length === 2);
  });

  it('seats anyone next to a placed chair, facing the way the chair does', async () => {
    const a = await join('Ana');
    const b = await join('Beto');
    await waitFor(() => b.state.players.size === 2);
    await moveNextToChair(a);

    a.send('sit', { seat: chairSeatId(CHAIR) });

    await waitFor(() => b.state.players.get(a.sessionId)?.seat === chairSeatId(CHAIR));
    expect(b.state.players.get(a.sessionId)?.facing).toBe('left');
  });

  it('ignores a placed chair that does not stand there, or one out of reach', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);

    room.send('sit', { seat: chairSeatId(CHAIR) });
    await moveNextToChair(room);
    room.send('sit', { seat: chairSeatId(tile(21, 22)) });
    room.send('status', { status: 'y' });

    await waitFor(() => room.state.players.get(room.sessionId)?.status === 'y');
    expect(room.state.players.get(room.sessionId)?.seat).toBe('');
  });

  it('turns the sitter with a turned chair, and stands them up when the chair is removed', async () => {
    const room = await join('Ana');
    await moveNextToChair(room);
    room.send('sit', { seat: chairSeatId(CHAIR) });
    await waitFor(() => room.state.players.get(room.sessionId)?.seat === chairSeatId(CHAIR));

    await server.terrain.setChairs([{ index: CHAIR, chair: { piece: 'chair-gamer', facing: 'up' } }], null, nobody);
    await waitFor(() => room.state.players.get(room.sessionId)?.facing === 'up');
    expect(room.state.players.get(room.sessionId)?.seat).toBe(chairSeatId(CHAIR));

    await server.terrain.setChairs([{ index: CHAIR, chair: null }], null, nobody);
    await waitFor(() => room.state.players.get(room.sessionId)?.seat === '');
  });
});

describe('OfficeRoom: desk seats', () => {
  const BETO: VerifiedIdentity = { uid: 'uid-beto', email: 'beto@example.com', name: 'Beto Ruiz' };
  const ANA_ID = '11111111-1111-4111-8111-111111111111';
  const BETO_ID = '22222222-2222-4222-8222-222222222222';
  // On the open lawn: the river (rows 19-21) refuses the moves that reach a desk there.
  const DESK = { x: 10, y: 25 };
  let deskServer: OfficeServer | undefined;
  let deskPort = 0;

  async function start(occupantId: string | null) {
    const directory = createMemoryDirectory({
      seed: [
        seededUser({}),
        seededUser({ id: BETO_ID, uid: 'uid-beto', email: 'beto@example.com', displayName: 'Beto' }),
      ],
    });
    const now = new Date('2026-01-01T00:00:00.000Z');
    const desks = createMemoryDesks({
      seed: [
        { id: 'mesa-ana', label: 'Mesa 1', ...DESK, occupantId, createdAt: now, updatedAt: now },
        { id: 'mesa-lejos', label: 'Mesa 2', x: 30, y: 20, occupantId: null, createdAt: now, updatedAt: now },
      ],
    });
    deskServer = createOfficeServer({
      auth: stubVerifier({ 'token-de-ana': ANA, 'token-de-beto': BETO }),
      directory,
      desks,
    });
    deskPort = await deskServer.listen(0);
    return `ws://localhost:${deskPort}`;
  }

  async function joinNearDesk(endpoint: string, token: string) {
    const room = await new Client(endpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token });
    openRooms.push(room);
    const x = (DESK.x + 1) * TILE + 16;
    const y = (DESK.y + 1) * TILE;
    room.send('move', { x, y, facing: 'down' });
    await waitFor(() => room.state.players.get(room.sessionId)?.x === x);
    return room;
  }

  afterEach(async () => {
    await deskServer?.shutdown();
    deskServer = undefined;
  });

  it('only its owner sits at a claimed desk', async () => {
    const endpoint = await start(ANA_ID);
    const ana = await joinNearDesk(endpoint, 'token-de-ana');
    const beto = await joinNearDesk(endpoint, 'token-de-beto');

    beto.send('sit', { seat: deskSeatId('mesa-ana') });
    beto.send('status', { status: 'y' });
    await waitFor(() => beto.state.players.get(beto.sessionId)?.status === 'y');
    expect(beto.state.players.get(beto.sessionId)?.seat).toBe('');

    ana.send('sit', { seat: deskSeatId('mesa-ana') });
    await waitFor(() => beto.state.players.get(ana.sessionId)?.seat === deskSeatId('mesa-ana'));
    expect(beto.state.players.get(ana.sessionId)?.facing).toBe(DESK_SEAT_FACING);
  });

  it('anyone sits at a free desk, and sitting does not claim it', async () => {
    const endpoint = await start(null);
    const beto = await joinNearDesk(endpoint, 'token-de-beto');

    beto.send('sit', { seat: deskSeatId('mesa-ana') });

    await waitFor(() => beto.state.players.get(beto.sessionId)?.seat === deskSeatId('mesa-ana'));
    const listed = await fetch(`http://localhost:${deskPort}/desks`, { headers: { Authorization: 'Bearer token-de-beto' } });
    const body = (await listed.json()) as { desks: { id: string; occupant: unknown }[] };
    expect(body.desks.find((desk) => desk.id === 'mesa-ana')?.occupant).toBeNull();
  });

  it('ignores a desk out of reach and a desk that does not exist', async () => {
    const endpoint = await start(null);
    const beto = await joinNearDesk(endpoint, 'token-de-beto');

    beto.send('sit', { seat: deskSeatId('mesa-lejos') });
    beto.send('sit', { seat: deskSeatId('no-existe') });
    beto.send('status', { status: 'y' });

    await waitFor(() => beto.state.players.get(beto.sessionId)?.status === 'y');
    // Desk seats are checked against the store asynchronously; give them time.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(beto.state.players.get(beto.sessionId)?.seat).toBe('');
  });

  it('when someone else claims the desk, its non-owner sitter stands up', async () => {
    const endpoint = await start(null);
    const beto = await joinNearDesk(endpoint, 'token-de-beto');
    beto.send('sit', { seat: deskSeatId('mesa-ana') });
    await waitFor(() => beto.state.players.get(beto.sessionId)?.seat === deskSeatId('mesa-ana'));

    const claimed = await fetch(`http://localhost:${deskPort}/desks/mesa-ana/claim`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-de-ana' },
    });
    expect(claimed.status).toBe(200);

    await waitFor(() => beto.state.players.get(beto.sessionId)?.seat === '');
  });

  it('the owner keeps sitting when they claim the desk they sit at', async () => {
    const endpoint = await start(null);
    const ana = await joinNearDesk(endpoint, 'token-de-ana');
    ana.send('sit', { seat: deskSeatId('mesa-ana') });
    await waitFor(() => ana.state.players.get(ana.sessionId)?.seat === deskSeatId('mesa-ana'));

    await fetch(`http://localhost:${deskPort}/desks/mesa-ana/claim`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-de-ana' },
    });
    ana.send('status', { status: 'y' });
    await waitFor(() => ana.state.players.get(ana.sessionId)?.status === 'y');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(ana.state.players.get(ana.sessionId)?.seat).toBe(deskSeatId('mesa-ana'));
  });
});

/**
 * Chairs in a desk's decor: guest seats anyone may take, whoever owns the
 * desk, checked against the occupant's decor the desks store resolves.
 */
describe('OfficeRoom: decor chairs', () => {
  const BETO: VerifiedIdentity = { uid: 'uid-beto', email: 'beto@example.com', name: 'Beto Ruiz' };
  const ANA_ID = '11111111-1111-4111-8111-111111111111';
  const BETO_ID = '22222222-2222-4222-8222-222222222222';
  const DESK = { x: 10, y: 25 };
  const at = new Date('2026-01-01T00:00:00.000Z');
  const decorAsset = (id: string, textureKey: string) => ({
    id, slug: id, name: id, kind: 'furniture' as const, textureKey, w: 1, h: 1, placeableOnDesk: true, aboveAvatars: false, archivedAt: null, createdAt: at,
  });
  const CHAIR = decorAsset('silla', 'art:chair-wood:sheet');
  const PLANT = decorAsset('planta', 'art:plant-ficus:sheet');
  const GUEST_SEAT = decorSeatId('mesa-ana', 8);
  let decorServer: OfficeServer | undefined;
  let decorPort = 0;

  async function start() {
    const directory = createMemoryDirectory({
      seed: [
        seededUser({}),
        seededUser({ id: BETO_ID, uid: 'uid-beto', email: 'beto@example.com', displayName: 'Beto' }),
      ],
    });
    const decor = createMemoryDecor({ seed: [CHAIR, PLANT], now: () => at });
    await decor.replaceDeskConfig(ANA_ID, [
      { assetId: CHAIR.id, slot: 8, rotation: 270 },
      { assetId: PLANT.id, slot: 0, rotation: 0 },
    ]);
    const desks = createMemoryDesks({
      decor,
      seed: [{ id: 'mesa-ana', label: 'Mesa 1', ...DESK, occupantId: ANA_ID, createdAt: at, updatedAt: at }],
    });
    decorServer = createOfficeServer({ auth: stubVerifier({ 'token-de-ana': ANA, 'token-de-beto': BETO }), directory, desks, decor });
    decorPort = await decorServer.listen(0);
    return `ws://localhost:${decorPort}`;
  }

  async function joinNearDesk(endpoint: string, token: string) {
    const room = await new Client(endpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token });
    openRooms.push(room);
    const x = (DESK.x + 1) * TILE + 16;
    const y = (DESK.y + 1) * TILE;
    room.send('move', { x, y, facing: 'down' });
    await waitFor(() => room.state.players.get(room.sessionId)?.x === x);
    return room;
  }

  function saveDecor(items: unknown[]) {
    return fetch(`http://localhost:${decorPort}/me/desk`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-de-ana', 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  }

  afterEach(async () => {
    await decorServer?.shutdown();
    decorServer = undefined;
  });

  it('seats a guest at a decor chair of a claimed desk, facing as the chair is turned', async () => {
    const endpoint = await start();
    const ana = await joinNearDesk(endpoint, 'token-de-ana');
    const beto = await joinNearDesk(endpoint, 'token-de-beto');

    beto.send('sit', { seat: GUEST_SEAT });

    await waitFor(() => ana.state.players.get(beto.sessionId)?.seat === GUEST_SEAT);
    expect(ana.state.players.get(beto.sessionId)?.facing).toBe('left');

    // One sitter per decor chair, the desk's owner included.
    ana.send('sit', { seat: GUEST_SEAT });
    ana.send('status', { status: 'y' });
    await waitFor(() => ana.state.players.get(ana.sessionId)?.status === 'y');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ana.state.players.get(ana.sessionId)?.seat).toBe('');
  });

  it('ignores a slot without a chair, an empty slot and a desk that does not exist', async () => {
    const endpoint = await start();
    const beto = await joinNearDesk(endpoint, 'token-de-beto');

    beto.send('sit', { seat: decorSeatId('mesa-ana', 0) });
    beto.send('sit', { seat: decorSeatId('mesa-ana', 4) });
    beto.send('sit', { seat: decorSeatId('no-existe', 8) });
    beto.send('status', { status: 'y' });

    await waitFor(() => beto.state.players.get(beto.sessionId)?.status === 'y');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(beto.state.players.get(beto.sessionId)?.seat).toBe('');
  });

  it('turns the guest with a turned chair, and stands them up when the chair is taken away', async () => {
    const endpoint = await start();
    const beto = await joinNearDesk(endpoint, 'token-de-beto');
    beto.send('sit', { seat: GUEST_SEAT });
    await waitFor(() => beto.state.players.get(beto.sessionId)?.seat === GUEST_SEAT);

    expect((await saveDecor([{ assetId: CHAIR.id, slot: 8, rotation: 180 }])).status).toBe(200);
    await waitFor(() => beto.state.players.get(beto.sessionId)?.facing === 'up');
    expect(beto.state.players.get(beto.sessionId)?.seat).toBe(GUEST_SEAT);

    expect((await saveDecor([{ assetId: PLANT.id, slot: 8, rotation: 0 }])).status).toBe(200);
    await waitFor(() => beto.state.players.get(beto.sessionId)?.seat === '');
  });

  it('stands the guest up when the owner releases the desk, taking the decor along', async () => {
    const endpoint = await start();
    const beto = await joinNearDesk(endpoint, 'token-de-beto');
    beto.send('sit', { seat: GUEST_SEAT });
    await waitFor(() => beto.state.players.get(beto.sessionId)?.seat === GUEST_SEAT);

    const released = await fetch(`http://localhost:${decorPort}/me/desk/release`, { method: 'POST', headers: { Authorization: 'Bearer token-de-ana' } });
    expect(released.status).toBe(200);

    await waitFor(() => beto.state.players.get(beto.sessionId)?.seat === '');
  });
});
