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
import { createOfficeServer, type OfficeServer } from './createOfficeServer.ts';
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
import type { OfficeState } from './schema.ts';
import type { IdTokenVerifier, VerifiedIdentity } from './verifyIdToken.ts';

let server: OfficeServer;
let endpoint: string;
const openRooms: { leave: () => Promise<number> }[] = [];

// Un servidor por test da aislamiento de estado, pero cada `Server` de Colyseus
// registra su propio handler de `uncaughtException` y con 10 tests se pasa del
// limite por defecto de 10. Es ruido del arnes, no una fuga del codigo propio.
// Subido a 100 al anadir los tests del directorio (#24), que levantan un
// servidor mas por caso, y a 150 al anadir los de la ventana de reconexion
// (#52), que hacen lo mismo.
process.setMaxListeners(150);

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
function stubVerifier(valid: Record<string, VerifiedIdentity>): IdTokenVerifier {
  return {
    async verify(token: unknown) {
      return typeof token === 'string' ? (valid[token] ?? null) : null;
    },
  };
}

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
    const started = await startAuthenticatedServer(stubVerifier({ 'token-de-ana': ANA }));
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
    await start(createMemoryDirectory());

    const room = await joinWithToken();
    openRooms.push(room);
    await waitFor(() => room.state.players.size === 1);

    expect(room.state.players.get(room.sessionId)?.name).toBe('Ana Gomez');
    expect(directoryServer.sessions.uidOf(room.sessionId)).toBe('uid-ana');
  });

  it('el primer login crea la fila: entrar con un token valido basta', async () => {
    const directory = createMemoryDirectory();
    await start(directory);

    const room = await joinWithToken();
    openRooms.push(room);
    await waitFor(() => room.state.players.size === 1);

    expect((await directory.findByUid('uid-ana'))?.email).toBe('ana@example.com');
  });

  it('un invitado caducado NO entra, aunque su token siga siendo valido', async () => {
    // El nucleo del issue: la firma de Google sigue siendo buena y el token se
    // renueva solo. Lo unico que cierra la puerta es la fecha de esta tabla.
    await start(
      createMemoryDirectory({
        seed: [seededUser({ role: 'guest', expiresAt: new Date('2020-01-01T00:00:00.000Z') })],
      }),
    );

    await expect(joinWithToken()).rejects.toMatchObject({ code: 401 });
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

    await expect(joinWithToken()).rejects.toMatchObject({ code: 401 });
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
    ).rejects.toMatchObject({ code: 401 });

    await withDirectory.shutdown();
  });

  it('el rechazo del directorio es el MISMO 401 mudo que el de un token forjado', async () => {
    // A proposito: si "caducado" y "token invalido" se distinguiesen desde
    // fuera, quien sondea sabria que esa cuenta existe y que existio un acceso
    // legitimo. El motivo va al log del servidor, que no lo lee nadie de fuera.
    await start(createMemoryDirectory({ seed: [seededUser({ status: 'revoked' })] }));

    await expect(joinWithToken()).rejects.toMatchObject({ code: 401 });
    await expect(joinWithToken('token-forjado')).rejects.toMatchObject({ code: 401 });
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
      directory: createMemoryDirectory(),
      logDirectoryDenial: (decision, uid) => logged.push(`${decision}:${uid}`),
    });

    await expect(
      room.onAuth({} as ServerClient, { token: 'token-de-ana' }, {} as never),
    ).resolves.toMatchObject({ uid: 'uid-ana' });
    expect(logged).toEqual([]);
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
