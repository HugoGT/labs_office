/**
 * Tests de integracion de la sala: servidor y cliente reales sobre WebSocket,
 * no dobles. La razon es concreta: el fallo mas caro de este stack no esta en
 * la logica sino en el protocolo (server 0.17 habla `@colyseus/schema` 4 y el
 * unico cliente publicado habla la 3). Un doble de la sala pasaria ese fallo
 * sin verlo; un round-trip de verdad lo estrella.
 */

import { Client } from 'colyseus.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, TILE, WORLD_H, WORLD_W } from '../../src/game/mapData.ts';
import { createOfficeServer, type OfficeServer } from './createOfficeServer.ts';
import { DEFAULT_NAME, MAX_NAME_LENGTH, OFFICE_ROOM_NAME } from './OfficeRoom.ts';
import type { OfficeState } from './schema.ts';

let server: OfficeServer;
let endpoint: string;
const openRooms: { leave: () => Promise<number> }[] = [];

// Un servidor por test da aislamiento de estado, pero cada `Server` de Colyseus
// registra su propio handler de `uncaughtException` y con 10 tests se pasa del
// limite por defecto de 10. Es ruido del arnes, no una fuga del codigo propio.
process.setMaxListeners(50);

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

async function join(name: string) {
  const room = await new Client(endpoint).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { name });
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

describe('OfficeRoom: el cliente no es de fiar', () => {
  it('recorta una posicion fuera de los limites del mundo en vez de aceptarla', async () => {
    const room = await join('Ana');
    await waitFor(() => room.state.players.size === 1);

    room.send('move', { x: 999999, y: -999999, facing: 'down' });

    await waitFor(() => room.state.players.get(room.sessionId)?.x === WORLD_W);
    expect(room.state.players.get(room.sessionId)?.y).toBe(0);
    expect(WORLD_W).toBeLessThan(999999);
    expect(WORLD_H).toBeGreaterThan(0);
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

    room.send('move', { x: 100, y: 100, facing: 'diagonal-inventada' });

    await waitFor(() => room.state.players.get(room.sessionId)?.x === 100);
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
