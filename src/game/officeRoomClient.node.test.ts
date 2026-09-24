/**
 * El envoltorio de cliente se prueba contra un servidor Colyseus real, en Node.
 * Un doble no serviria: el fallo que este stack sabe producir no esta en la
 * logica sino en el cable (schema 3 contra schema 4), y solo aparece al
 * decodificar de verdad.
 */

import { matchMaker } from '@colyseus/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOfficeServer, type OfficeServer } from '../../server/src/createOfficeServer.ts';
import { OFFICE_ROOM_NAME } from './officeProtocol';
import {
  connectOfficeRoom,
  type OfficeConnection,
  type OfficeConnectionState,
} from './officeRoomClient';
import type { RemotePlayerSnapshot } from './remoteAvatars';

let server: OfficeServer;
let endpoint: string;
const connections: OfficeConnection[] = [];

// Un servidor por test da aislamiento de estado, y cada `Server` de Colyseus
// registra su propio handler de `uncaughtException`; con las pruebas de
// invitaciones de llamada (issue #2) se pasa del limite por defecto de 10.
// Es ruido del arnes, no una fuga del codigo propio -- mismo ajuste que
// `OfficeRoom.test.ts`. Subido a 150 al anadir los de reconexion (#52), que
// levantan un servidor mas por caso.
process.setMaxListeners(150);

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
  // Issue #52: la secuencia importa tanto como los valores -- "reconectando"
  // DESPUES de "conectado" seria un HUD que miente al reves.
  const states: OfficeConnectionState[] = [];
  const resyncs: string[] = [];
  // Orden real de lo que llega, en una sola linea del tiempo. Hace falta
  // porque parte del contrato de #52 no es QUE pasa sino CUANDO: el resync
  // tiene que caer antes del replay, o quien lo escuche vaciaria su registro
  // justo despues de haberlo repoblado.
  const timeline: string[] = [];
  return {
    added,
    changed,
    removed,
    callInvites,
    callersLeft,
    callsAccepted,
    states,
    resyncs,
    timeline,
    handlers: {
      onAdd: (s: RemotePlayerSnapshot) => {
        added.push(s);
        timeline.push(`add:${s.sessionId}`);
      },
      onChange: (s: RemotePlayerSnapshot) => changed.push(s),
      onRemove: (id: string) => removed.push(id),
      onCallInvite: (payload: { from: string; name: string }) => callInvites.push(payload),
      onCallerLeft: (payload: { from: string }) => callersLeft.push(payload),
      onCallAccepted: (payload: { by: string; name: string }) => callsAccepted.push(payload),
      onConnectionState: (state: OfficeConnectionState) => states.push(state),
      // Se guarda el estado en el momento del resync para poder afirmar el
      // orden contra `states` sin un reloj.
      onResync: () => {
        resyncs.push(states.at(-1) ?? '');
        timeline.push('resync');
      },
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
 * Version de config de espacios (#7, D4), a traves del envoltorio de
 * cliente. Mismo criterio que la suite de presencia de mas arriba: el join
 * lleva el valor inicial, y `sendSpacesVersion` es un metodo sin agrupar,
 * igual que `sendStatus`.
 */
describe('connectOfficeRoom: version de config de espacios (#7, D4)', () => {
  it('sendSpacesVersion propaga la version nueva al otro cliente', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const b = await connect('Beto', recorder().handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === b.sessionId));

    b.sendSpacesVersion('v2edited');

    await waitFor(() =>
      watcher.changed.some((s) => s.sessionId === b.sessionId && s.spacesVersion === 'v2edited'),
    );
  });

  it('dos cambios seguidos terminan en el ultimo, no en el primero (sin agrupar, como sendStatus)', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const b = await connect('Beto', recorder().handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === b.sessionId));

    b.sendSpacesVersion('v2');
    b.sendSpacesVersion('v3');

    await waitFor(() =>
      watcher.changed.some((s) => s.sessionId === b.sessionId && s.spacesVersion === 'v3'),
    );
    const ultimo = watcher.changed.filter((s) => s.sessionId === b.sessionId).at(-1);
    expect(ultimo?.spacesVersion).toBe('v3');
  });

  it('la version elegida antes de conectar viaja en el join, no se pierde (nunca "brevemente sin version")', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const conVersion = await connectOfficeRoom({
      endpoint,
      name: 'Beto',
      spacesVersion: 'inicial123',
      handlers: recorder().handlers,
    });
    connections.push(conVersion);

    await waitFor(() =>
      watcher.added.some(
        (s) => s.sessionId === conVersion.sessionId && s.spacesVersion === 'inicial123',
      ),
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

/**
 * Reconexion tras una caida (issue #52), de punta a punta: servidor real,
 * socket cortado de verdad, y el envoltorio recuperandose solo.
 *
 * La mitad servidor (el avatar que sobrevive la ventana) ya tiene su suite en
 * `server/src/OfficeRoom.test.ts`. Lo que se prueba aqui es la otra mitad: que
 * el cliente se entera de la caida -- antes de este cambio no registraba
 * `onLeave` ni `onError` y simplemente se quedaba mudo -- y que la sesion que
 * vuelve sirve para algo, no solo esta viva.
 */
describe('connectOfficeRoom: reconexion tras una caida (issue #52)', () => {
  /**
   * Mata el socket desde el servidor con `terminate()`, que es EXACTAMENTE lo
   * que hace el transporte en produccion con un cliente que deja de responder
   * a los pings (`autoTerminateUnresponsiveClients` en
   * `@colyseus/ws-transport`). Un `close(code)` ordenado seria un cierre
   * educado y este bug nace de los que no lo son: `terminate()` deja el codigo
   * en 1006, que es el que llega cuando un socket muere sin despedirse.
   *
   * `ref` esta tipado como `EventEmitter` en el contrato publico de Colyseus,
   * pero el objeto real es el WebSocket de `ws`; el casteo vive aqui, en el
   * arnes, y no en codigo de produccion.
   */
  async function terminateSocketOf(sessionId: string): Promise<void> {
    const [cache] = await matchMaker.query({ name: OFFICE_ROOM_NAME });
    const room = matchMaker.getLocalRoomById(cache.roomId);
    const ref = room.clients.getById(sessionId)?.ref as unknown as
      | { terminate(): void }
      | undefined;
    if (!ref) throw new Error(`no hay cliente ${sessionId} en la sala`);
    ref.terminate();
  }

  it('el que sobrevive nunca ve la baja del que se cayo', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const b = await connect('Beto', recorder().handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === b.sessionId));

    await terminateSocketOf(b.sessionId);

    // El corazon de la issue: si esto falla, al otro le desaparece el avatar y
    // ya no vuelve -- `onRemove` es definitivo para `RemoteAvatarRegistry`.
    // Se espera bastante mas que el primer escalon del backoff (500 ms) para
    // que una baja prematura haya tenido tiempo de sobra de llegar.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(watcher.removed).not.toContain(b.sessionId);
  }, 20000);

  it('el que se cayo pasa por "reconectando" y termina en "conectado", con un resync por medio', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const dropped = recorder();
    const b = await connect('Beto', dropped.handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === b.sessionId));

    await terminateSocketOf(b.sessionId);

    await waitFor(() => dropped.states.includes('connected'), 15000);
    // El orden es la mitad del contrato: el HUD tiene que poder pintar el
    // amarillo ANTES del verde, no descubrirlo despues.
    expect(dropped.states.indexOf('reconnecting')).toBeGreaterThanOrEqual(0);
    expect(dropped.states.indexOf('reconnecting')).toBeLessThan(
      dropped.states.indexOf('connected'),
    );
    // El resync avisa de que llega un replay completo, y llega ANTES de
    // declarar "conectado": quien lo escuche tiene que poder tirar lo que sabia
    // de los pares mientras el estado nuevo aun se esta repartiendo.
    expect(dropped.resyncs).toEqual(['reconnecting']);
  }, 20000);

  it('la sesion recuperada sigue publicando: un sendMove posterior llega al otro', async () => {
    const watcher = recorder();
    await connect('Ana', watcher.handlers);
    const dropped = recorder();
    const b = await connect('Beto', dropped.handlers);
    await waitFor(() => watcher.added.some((s) => s.sessionId === b.sessionId));

    await terminateSocketOf(b.sessionId);
    await waitFor(() => dropped.states.includes('connected'), 15000);

    // Sin volver a cablear el envoltorio contra la sala NUEVA, esto se enviaria
    // por un socket muerto y nadie se enteraria de nada.
    b.sendMove(300, 400, 'left');

    await waitFor(() =>
      watcher.changed.some((s) => s.sessionId === b.sessionId && s.x === 300 && s.y === 400),
    );
  }, 20000);

  it('tras reconectar, el replay completo vuelve a dar de alta a los presentes', async () => {
    const watcher = recorder();
    const a = await connect('Ana', watcher.handlers);
    const dropped = recorder();
    const b = await connect('Beto', dropped.handlers);
    await waitFor(() => dropped.added.some((s) => s.sessionId === a.sessionId));
    const altasAntes = dropped.added.filter((s) => s.sessionId === a.sessionId).length;

    await terminateSocketOf(b.sessionId);
    await waitFor(() => dropped.states.includes('connected'), 15000);

    // Es lo que hace seguro el `remotes.clear()` del resync: la sala nueva
    // reparte el estado entero, asi que vaciar el registro no puede dejar a
    // nadie fuera.
    await waitFor(
      () => dropped.added.filter((s) => s.sessionId === a.sessionId).length > altasAntes,
    );

    // Y el orden es parte del contrato, no una casualidad: el replay tiene que
    // caer DESPUES del resync. Al reves, la escena vaciaria su registro justo
    // despues de haberlo repoblado y el avatar del otro no volveria a
    // aparecer -- exactamente el sintoma de la issue, movido de sitio.
    const resyncAt = dropped.timeline.lastIndexOf('resync');
    expect(resyncAt).toBeGreaterThanOrEqual(0);
    expect(dropped.timeline.slice(resyncAt)).toContain(`add:${a.sessionId}`);
  }, 20000);
});

/**
 * Active recordings (#5) travel as synced state, so every occupant, late
 * joiners included, learns about them without asking. The client hands out
 * the whole map each time: the UI compares it to its own space.
 */
describe('connectOfficeRoom: recordings', () => {
  function recordingsRecorder() {
    const snapshots: Record<string, { startedBy: string; startedAt: number }>[] = [];
    const base = recorder();
    const handlers = {
      ...base.handlers,
      onRecordings: (active: Record<string, { startedBy: string; startedAt: number }>) =>
        snapshots.push(active),
    };
    return { snapshots, handlers, states: base.states, last: () => snapshots.at(-1) };
  }

  it('reports a recording that starts and stops while connected', async () => {
    const watcher = recordingsRecorder();
    await connect('Ana', watcher.handlers);

    server.recordings.set({ spaceId: 'sala', egressId: 'EG_1', startedBy: 'ses-x', startedAt: 42, key: 'k.mp4', participants: [] });
    await waitFor(() => watcher.last()?.sala?.startedBy === 'ses-x');
    expect(watcher.last()).toEqual({ sala: { startedBy: 'ses-x', startedAt: 42 } });

    server.recordings.delete('sala');
    await waitFor(() => watcher.last() !== undefined && !('sala' in watcher.last()!));
  });

  it('a late joiner gets the recordings already running on its first sync', async () => {
    await connect('Ana', recorder().handlers);
    server.recordings.set({ spaceId: 'sala', egressId: 'EG_1', startedBy: 'ses-x', startedAt: 42, key: 'k.mp4', participants: [] });

    const late = recordingsRecorder();
    await connect('Tarde', late.handlers);

    await waitFor(() => late.last()?.sala?.startedBy === 'ses-x');
  });

  it('after a reconnect, a recording stopped during the outage is gone', async () => {
    const dropped = recordingsRecorder();
    const b = await connect('Beto', dropped.handlers);
    await connect('Ana', recorder().handlers);
    server.recordings.set({ spaceId: 'sala', egressId: 'EG_1', startedBy: 'ses-x', startedAt: 42, key: 'k.mp4', participants: [] });
    await waitFor(() => dropped.last()?.sala !== undefined);

    // Same abrupt drop as `terminateSocketOf` in the reconnection block.
    const [cache] = await matchMaker.query({ name: OFFICE_ROOM_NAME });
    const ref = matchMaker.getLocalRoomById(cache.roomId).clients.getById(b.sessionId)?.ref as unknown as {
      terminate(): void;
    };
    ref.terminate();
    server.recordings.delete('sala');

    await waitFor(() => dropped.states.includes('connected') && !('sala' in (dropped.last() ?? {})), 15000);
  }, 20000);
});
