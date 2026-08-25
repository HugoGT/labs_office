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
  return {
    added,
    changed,
    removed,
    handlers: {
      onAdd: (s: RemotePlayerSnapshot) => added.push(s),
      onChange: (s: RemotePlayerSnapshot) => changed.push(s),
      onRemove: (id: string) => removed.push(id),
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
