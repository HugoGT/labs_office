/**
 * El envoltorio de cliente se prueba contra un servidor Colyseus real, en Node.
 * Un doble no serviria: el fallo que este stack sabe producir no esta en la
 * logica sino en el cable (schema 3 contra schema 4), y solo aparece al
 * decodificar de verdad.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOfficeServer, type OfficeServer } from '../../server/src/createOfficeServer.ts';
import { connectOfficeRoom, type OfficeConnection } from './officeRoomClient';
import type { RemotePlayerSnapshot } from './remoteAvatars';

let server: OfficeServer;
let endpoint: string;
const connections: OfficeConnection[] = [];

// Un servidor por test da aislamiento de estado, y cada `Server` de Colyseus
// registra su propio handler de `uncaughtException`; con las pruebas de
// invitaciones de llamada (issue #2) se pasa del limite por defecto de 10.
// Es ruido del arnes, no una fuga del codigo propio -- mismo ajuste que
// `OfficeRoom.test.ts`.
process.setMaxListeners(100);

beforeEach(async () => {
  server = createOfficeServer();
  endpoint = `ws://localhost:${await server.listen(0)}`;
});

afterEach(async () => {
  await Promise.all(
    connections.splice(0).map((c) =>
      Promise.race([c.leave().catch(() => {}), new Promise((r) => setTimeout(r, 500))]),
    ),
  );
  await server.shutdown();
});

function recorder() {
  const added: RemotePlayerSnapshot[] = [];
  const changed: RemotePlayerSnapshot[] = [];
  const removed: string[] = [];
  const callInvites: { from: string; name: string }[] = [];
  const callersLeft: { from: string }[] = [];
  const callsAccepted: { by: string; name: string }[] = [];
  return {
    added,
    changed,
    removed,
    callInvites,
    callersLeft,
    callsAccepted,
    handlers: {
      onAdd: (s: RemotePlayerSnapshot) => added.push(s),
      onChange: (s: RemotePlayerSnapshot) => changed.push(s),
      onRemove: (id: string) => removed.push(id),
      onCallInvite: (payload: { from: string; name: string }) => callInvites.push(payload),
      onCallerLeft: (payload: { from: string }) => callersLeft.push(payload),
      onCallAccepted: (payload: { by: string; name: string }) => callsAccepted.push(payload),
    },
  };
}

async function connect(name: string, handlers: Parameters<typeof connectOfficeRoom>[0]['handlers']) {
  const connection = await connectOfficeRoom({ endpoint, name, handlers });
  connections.push(connection);
  return connection;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return;
    } catch {
      /* el estado aun no llego */
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condicion no cumplida dentro del timeout');
}

describe('connectOfficeRoom', () => {
  it('devuelve la sesion propia y notifica el alta de los demas', async () => {
    const first = recorder();
    const a = await connect('Ana', first.handlers);
    const b = await connect('Beto', recorder().handlers);

    await waitFor(() => first.added.some((s) => s.sessionId === b.sessionId));

    expect(a.sessionId).toBeTruthy();
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(first.added.find((s) => s.sessionId === b.sessionId)?.name).toBe('Beto');
  });

  it('propaga el movimiento del otro cliente como onChange', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const b = await connect('Beto', recorder().handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === b.sessionId));

    b.sendMove(300, 400, 'left');

    await waitFor(() =>
      watcher.changed.some((s) => s.sessionId === b.sessionId && s.x === 300 && s.y === 400),
    );
    const forB = watcher.changed.filter((s) => s.sessionId === b.sessionId);
    expect(forB.at(-1)?.facing).toBe('left');
  });

  it('notifica la baja cuando el otro se va', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const b = await connect('Beto', recorder().handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === b.sessionId));

    await b.leave();

    await waitFor(() => watcher.removed.includes(b.sessionId));
  });

  it('agrupa una rafaga de sendMove: llega el ultimo estado, no todos', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const b = await connect('Beto', recorder().handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === b.sessionId));
    const before = watcher.changed.length;

    for (let i = 1; i <= 60; i++) b.sendMove(100 + i, 200, 'right');

    await waitFor(() => watcher.changed.some((s) => s.x === 160));
    // 60 llamadas seguidas (un segundo de frames) no pueden ser 60 mensajes.
    expect(watcher.changed.length - before).toBeLessThan(10);
  });

  it('falla de forma explicita si no hay servidor, en vez de quedarse colgado', async () => {
    await expect(
      connectOfficeRoom({
        endpoint: 'ws://localhost:1',
        name: 'Ana',
        handlers: recorder().handlers,
      }),
    ).rejects.toBeDefined();
  }, 20000);
});

describe('connectOfficeRoom: estado de presencia (#1)', () => {
  it('sendStatus propaga el estado nuevo al otro cliente', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const b = await connect('Beto', recorder().handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === b.sessionId));

    b.sendStatus('r');

    await waitFor(() =>
      watcher.changed.some((s) => s.sessionId === b.sessionId && s.status === 'r'),
    );
  });

  it('dos cambios seguidos terminan en el ultimo, no en el primero', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const b = await connect('Beto', recorder().handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === b.sessionId));

    // `sendStatus` no agrupa como `sendMove`; lo que si agrupa es el propio
    // sincronizado de Colyseus, asi que el estado intermedio puede no
    // observarse. Lo que no puede pasar es quedarse en el.
    b.sendStatus('r');
    b.sendStatus('y');

    await waitFor(() =>
      watcher.changed.some((s) => s.sessionId === b.sessionId && s.status === 'y'),
    );
    const ultimo = watcher.changed.filter((s) => s.sessionId === b.sessionId).at(-1);
    expect(ultimo?.status).toBe('y');
  });

  it('el estado elegido antes de conectar viaja en el join, no se pierde', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const aislada = await connectOfficeRoom({
      endpoint,
      name: 'Beto',
      status: 'r',
      handlers: recorder().handlers,
    });
    connections.push(aislada);

    // Sin esto, quien pone "No molestar" mientras el servidor aun no responde
    // entraria "En linea" y publicaria audio hasta el siguiente cambio.
    await waitFor(() =>
      watcher.added.some((s) => s.sessionId === aislada.sessionId && s.status === 'r'),
    );
  });
});

/**
 * Invitaciones de llamada (issue #2), a traves del envoltorio de cliente. El
 * cableado del lado servidor ya tiene su propia suite en `OfficeRoom.test.ts`;
 * aqui se prueba que `sendCall`/`sendCallRespond` viajan de verdad y que los
 * tres handlers nuevos disparan con la forma que promete `OfficeRoomHandlers`.
 */
describe('connectOfficeRoom: invitaciones de llamada (issue #2)', () => {
  it('sendCall llega al otro cliente como onCallInvite, con quien llama y su nombre', async () => {
    const watcher = recorder();
    const b = await connect('Beto', watcher.handlers);
    const a = await connect('Ana', recorder().handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === a.sessionId));

    a.sendCall(b.sessionId);

    await waitFor(() => watcher.callInvites.length === 1);
    expect(watcher.callInvites[0]).toEqual({ from: a.sessionId, name: 'Ana' });
  });

  it('sendCallRespond con accept:true llega como onCallAccepted a quien llamo', async () => {
    const watcherA = recorder();
    const a = await connect('Ana', watcherA.handlers);
    const b = await connect('Beto', recorder().handlers);
    await waitFor(() => watcherA.added.some((s) => s.sessionId === b.sessionId));

    a.sendCall(b.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    b.sendCallRespond(a.sessionId, true);

    await waitFor(() => watcherA.callsAccepted.length === 1);
    expect(watcherA.callsAccepted[0]).toEqual({ by: b.sessionId, name: 'Beto' });
  });

  it('sendCallRespond con accept:false no dispara onCallAccepted: pasar es silencioso', async () => {
    const watcherA = recorder();
    const a = await connect('Ana', watcherA.handlers);
    const b = await connect('Beto', recorder().handlers);
    await waitFor(() => watcherA.added.some((s) => s.sessionId === b.sessionId));

    a.sendCall(b.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    b.sendCallRespond(a.sessionId, false);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(watcherA.callsAccepted).toHaveLength(0);
  });

  it('cuando quien llamo se desconecta, el destinatario ve onCallerLeft', async () => {
    const watcherB = recorder();
    const a = await connect('Ana', recorder().handlers);
    const b = await connect('Beto', watcherB.handlers);
    await waitFor(() => watcherB.added.some((s) => s.sessionId === a.sessionId));

    a.sendCall(b.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await a.leave();

    await waitFor(() => watcherB.callersLeft.length === 1);
    expect(watcherB.callersLeft[0]).toEqual({ from: a.sessionId });
  });
});
