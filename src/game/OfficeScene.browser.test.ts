import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterContainer } from './characters';
import {
  BUILT_IN_SPACES,
  BUILT_IN_SPACES_VERSION,
  DESK_ROWS,
  MAP_H,
  MAP_W,
  PLAYER_SPAWN_TX,
  PLAYER_SPAWN_TY,
  TILE,
  TREES,
  ZONE_LABELS,
} from './mapData';
import { TERRAIN_SHEET } from './assets';
import { deskZoneName } from './deskLayout';
import type { DeskDecorItem, DeskOccupant, OfficeDesk } from './desksPort';
import { createOfficeBridge, type OfficeEventMap } from './officeBridge';
import { DEFAULT_NAME, DEFAULT_STATUS, type PresenceStatus } from './officeProtocol';
import { STATUS_COLOR } from './presence';
import { AVATAR_KEYS, PLAYER_TEXTURE } from './textures';
import type {
  ConnectOfficeRoomOptions,
  OfficeConnection,
  OfficeRoomHandlers,
} from './officeRoomClient';
import { OFFICE_SCENE_KEY, OfficeScene, type OfficeSceneOptions } from './OfficeScene';

/**
 * `OfficeScene` orquesta fisica, camaras, tweens y timers desde el slice 7 en
 * adelante: no se prueba con una superficie falsa (ver D5) sino siempre
 * dentro de un `Phaser.Game` real, igual que `createGame`/`mapBuilder`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

/**
 * Margen unico para toda espera que dependa del bucle de Phaser. En el runner
 * de CI el hilo principal se atasca segundos enteros: una prueba con 2000ms de
 * margen tardo 8263ms de reloj de pared alli y fallo sin que la escena hubiese
 * hecho nada mal. El margen se fija holgado a proposito -- lo que decide la
 * prueba es la condicion, no el cronometro.
 */
const LOOP_WAIT = { timeout: 20000, interval: 50 } as const;

/**
 * Espera avanzando el RELOJ DEL JUEGO, que solo corre cuando corren los frames.
 * Un `setTimeout` real puede vencer sin que la escena haya dado un solo tick de
 * proximidad (250ms de reloj de juego), y entonces la prueba mide la velocidad
 * del runner en vez de la regla que dice medir.
 */
async function advanceGameClock(scene: Phaser.Scene, ms: number): Promise<void> {
  const target = scene.time.now + ms;
  await vi.waitFor(() => {
    expect(scene.time.now).toBeGreaterThanOrEqual(target);
  }, LOOP_WAIT);
}

async function bootOfficeScene(
  bridge = createOfficeBridge(),
  options: OfficeSceneOptions = {},
): Promise<{
  scene: Phaser.Scene;
  bridge: ReturnType<typeof createOfficeBridge>;
}> {
  const host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '240px';
  document.body.append(host);
  hosts.push(host);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 240,
    physics: { default: 'arcade' },
    scene: [new OfficeScene(bridge, options)],
  });
  games.push(game);

  await vi.waitFor(() => {
    expect(game.scene.getScene(OFFICE_SCENE_KEY)?.scene.settings.status).toBe(
      Phaser.Scenes.RUNNING,
    );
  }, LOOP_WAIT);

  return { scene: game.scene.getScene(OFFICE_SCENE_KEY) as Phaser.Scene, bridge };
}

/**
 * El jugador local es el unico contenedor con cuerpo fisico: los avatares
 * remotos no lo tienen. Se busca asi y no por su nombre porque el nombre es
 * justo lo que varias pruebas miden (#6): atarlo aqui haria que el helper
 * dejase de encontrarlo en cuanto la sesion traiga otro.
 */
function findPlayer(scene: Phaser.Scene): CharacterContainer {
  const player = scene.children.list.find(
    (c): c is CharacterContainer => c.type === 'Container' && c.body !== null,
  );
  if (!player) throw new Error('player container not found in scene');
  return player;
}

/** Codigos de tecla legacy (`keyCode`), que es lo que Phaser's Key matching usa internamente. */
const KEY = { RIGHT: 39, LEFT: 37, DOWN: 40, D: 68 } as const;

function dispatchKey(type: 'keydown' | 'keyup', keyCode: number): void {
  const event = new KeyboardEvent(type, { bubbles: true } as KeyboardEventInit);
  Object.defineProperty(event, 'keyCode', { get: () => keyCode });
  Object.defineProperty(event, 'which', { get: () => keyCode });
  window.dispatchEvent(event);
}

describe('OfficeScene: identidad y construccion (D2/D5)', () => {
  it('se registra con la clave "office", no "boot"', () => {
    expect(OFFICE_SCENE_KEY).toBe('office');
    expect(new OfficeScene(createOfficeBridge()).sys.settings.key).toBe(OFFICE_SCENE_KEY);
  });

  it('el constructor acepta una instancia de OfficeBridge sin lanzar', () => {
    const bridge = createOfficeBridge();

    expect(() => new OfficeScene(bridge)).not.toThrow();
  });
});

describe('OfficeScene dentro de un Phaser.Game real: mapa y jugador', () => {
  it('pinta el suelo completo, mobiliario, arboles y etiquetas de zona en create()', async () => {
    const { scene } = await bootOfficeScene();

    const images = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Image => c.type === 'Image',
    );
    const texts = scene.children.list.filter(
      (c): c is Phaser.GameObjects.Text => c.type === 'Text',
    );

    const tiled = scene.children.list.filter((c) => c.type === 'TileSprite');
    const terrainImages = images.filter((img) => img.texture.key === TERRAIN_SHEET);
    const deskCount = DESK_ROWS.reduce((sum, [, , n]) => sum + n, 0);

    // Suelo (una imagen por tile) + arboles, todos de la hoja de terreno.
    expect(terrainImages.length).toBeGreaterThanOrEqual(MAP_W * MAP_H + TREES.length);
    // Escritorios y las dos mesas de sala se dibujan con tileSprite, que repite
    // el tile de 16px en vez de estirar uno solo.
    expect(tiled).toHaveLength(deskCount + 2);
    expect(texts).toHaveLength(ZONE_LABELS.length);
  });

  it('crea al jugador local y a nadie mas: la oficina arranca vacia de companeros', async () => {
    const { scene } = await bootOfficeScene();

    const containers = scene.children.list.filter((c) => c.type === 'Container');
    expect(containers).toHaveLength(1);
    expect(findPlayer(scene).nameText).toBe(DEFAULT_NAME);
  });
});

describe('OfficeScene: input y movimiento del jugador (app.js:488-497)', () => {
  it('la flecha derecha mueve al jugador inactivo hacia la derecha', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    const startX = player.x;

    dispatchKey('keydown', KEY.RIGHT);
    try {
      await vi.waitFor(() => {
        expect(player.x).toBeGreaterThan(startX);
      });
    } finally {
      dispatchKey('keyup', KEY.RIGHT);
    }
  });

  it('la tecla D (WASD) mueve al jugador hacia la derecha, igual que la flecha', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    const startX = player.x;

    dispatchKey('keydown', KEY.D);
    try {
      await vi.waitFor(() => {
        expect(player.x).toBeGreaterThan(startX);
      });
    } finally {
      dispatchKey('keyup', KEY.D);
    }
  });
});

describe('OfficeScene: colisiones (app.js: colisionador fusionado, D6)', () => {
  it('el jugador no atraviesa el seto solido del borde del mapa', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    // A una tile del seto izquierdo (x=0, solido): intenta seguir hacia la izquierda.
    player.setPosition(1 * TILE + 16, 5 * TILE + 16);
    const startX = player.x;

    dispatchKey('keydown', KEY.LEFT);
    await new Promise((resolve) => setTimeout(resolve, 250));
    dispatchKey('keyup', KEY.LEFT);

    // El colisionador detiene al jugador antes de entrar a la tile solida (x=0).
    expect(player.x).toBeGreaterThanOrEqual(0 * TILE + TILE / 2);
    expect(player.x).toBeLessThanOrEqual(startX);
  });

  it('el jugador cruza un tile de puente sobre el rio', async () => {
    const { scene } = await bootOfficeScene();
    const player = findPlayer(scene);
    // Al norte de uno de los dos puentes (x=13..15, y=19..21): cruza hacia el sur.
    player.setPosition(14 * TILE + 16, 18 * TILE + 16);
    const startY = player.y;

    dispatchKey('keydown', KEY.DOWN);
    try {
      await vi.waitFor(
        () => {
          expect(player.y).toBeGreaterThan(startY);
        },
        { timeout: 2000 },
      );
    } finally {
      dispatchKey('keyup', KEY.DOWN);
    }
  });
});

describe('OfficeScene: depth-sorting por y (app.js:497-499)', () => {
  it('el contenedor con mayor y queda por delante del de menor y tras update()', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));
    const remote = findRemoteAvatars(scene)[0];

    // Se mueve al jugador SIN tocar su `depth`: quien reordena es `update()`,
    // y no la profundidad que cada contenedor recibio al crearse.
    player.setPosition(player.x, remote.y - 4 * TILE);
    await vi.waitFor(() => {
      expect(player.depth).toBeLessThan(remote.depth);
    }, LOOP_WAIT);

    player.setPosition(player.x, remote.y + 4 * TILE);
    await vi.waitFor(() => {
      expect(player.depth).toBeGreaterThan(remote.depth);
    }, LOOP_WAIT);
  });
});

describe('OfficeScene: proximidad y salas (app.js:444-471, cada 250ms)', () => {
  it('emite "room" al entrar a una sala', async () => {
    const bridge = createOfficeBridge();
    const rooms: (string | null)[] = [];
    bridge.on('room', (payload) => rooms.push(payload.name));

    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    // Sala de Juntas: tile (50,2) tamano 13x14 -> dentro en (52,4).
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(() => {
      expect(rooms).toContain('Sala de Juntas');
    }, LOOP_WAIT);
  });

  it('el "room" emitido trae el id estable del espacio, no solo el nombre (#7, D2)', async () => {
    const bridge = createOfficeBridge();
    const rooms: { spaceId: string | null; name: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(() => {
      expect(rooms.some((r) => r.name === 'Sala de Juntas')).toBe(true);
    }, LOOP_WAIT);
    const match = rooms.find((r) => r.name === 'Sala de Juntas');
    expect(match?.spaceId).toBe(BUILT_IN_SPACES[0].id);
  });
});

describe('OfficeScene: audio/video por proximidad (D3, issue #17)', () => {
  it('emite "voice" con los peers reales audibles (sessionId + nombre), sin repetir en tics identicos', async () => {
    const bridge = createOfficeBridge();
    const voices: {
      selfSessionId: string | null;
      peers: readonly { sessionId: string; name: string }[];
      spaceId: string | null;
    }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));

    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);

    const countAfterFirstNotification = voices.length;
    // Sin mover a nadie, los proximos tics (250ms cada uno) no deben repetir la
    // notificacion; la ventana se cuenta en reloj de juego, no de pared.
    await advanceGameClock(scene, 600);
    expect(voices.length).toBe(countAfterFirstNotification);
  });

  it('un cruce de sala reemite "voice" aunque el conjunto de pares audibles no cambie', async () => {
    const bridge = createOfficeBridge();
    const voices: {
      selfSessionId: string | null;
      peers: readonly { sessionId: string; name: string }[];
      spaceId: string | null;
    }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    // Un par lejano que nunca entra por radio ni por sala en ningun lado del cruce.
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'lejano', x: 5000, y: 5000 }));

    await vi.waitFor(() => expect(voices.length).toBeGreaterThan(0), LOOP_WAIT);
    const countBeforeCrossing = voices.length;

    // Sala de Juntas: tile (50,2) tamano 13x14 -> dentro en (52,4).
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(() => {
      expect(voices.at(-1)?.spaceId).toBe(BUILT_IN_SPACES[0].id);
    }, LOOP_WAIT);
    expect(voices.length).toBeGreaterThan(countBeforeCrossing);
    // El conjunto audible sigue vacio: la clave de dedupe cambio solo por la sala.
    expect(voices.at(-1)?.peers).toEqual([]);
  });

  it(
    'D7 asimetria: un par fuera de la sala del jugador queda fuera de "voice" mientras un par ' +
      'DENTRO de la sala si aparece, con su nombre',
    async () => {
      const bridge = createOfficeBridge();
      const voices: { peers: readonly { sessionId: string; name: string }[] }[] = [];
      bridge.on('voice', (payload) => voices.push(payload));
      const connector = fakeConnector('mi-sesion');

      const { scene } = await bootOfficeScene(bridge, {
        endpoint: 'ws://fake',
        connect: connector.connect,
      });
      await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
      const player = findPlayer(scene);
      // Jugador dentro de "Sala de Juntas" (tile (50,2) tamano 13x14 -> dentro en (52,4)).
      player.setPosition(52 * TILE, 4 * TILE);
      // Par legitimo: comparte la misma sala que el jugador -> audible.
      connector.handlers()!.onAdd(
        remoteSnapshot({
          sessionId: 'companera-en-sala',
          name: 'Compañera De Sala',
          x: 52 * TILE,
          y: 4 * TILE,
        }),
      );
      // Par excluido: un pixel al oeste del limite de la sala, dentro del radio pero fuera de ella.
      connector.handlers()!.onAdd(
        remoteSnapshot({
          sessionId: 'vecina-de-puerta',
          name: 'Vecina De Puerta',
          x: 50 * TILE - 1,
          y: 4 * TILE,
        }),
      );

      await vi.waitFor(() => {
        expect(
          voices.some((v) =>
            v.peers.some((peer) => peer.sessionId === 'companera-en-sala' && peer.name === 'Compañera De Sala'),
          ),
        ).toBe(true);
      }, LOOP_WAIT);

      expect(
        voices.some((v) => v.peers.some((peer) => peer.sessionId === 'vecina-de-puerta')),
      ).toBe(false);
    },
  );
});

/**
 * Doble de conexion: captura los handlers que la escena registra para poder
 * simular altas, cambios y bajas remotas sin levantar un Colyseus. El
 * protocolo real ya se prueba contra un servidor de verdad en la capa node
 * (`officeRoomClient.node.test.ts`); lo que se prueba aqui es el cableado.
 */
function fakeConnector(sessionId = 'yo') {
  const sent: { x: number; y: number; facing: string }[] = [];
  const statuses: PresenceStatus[] = [];
  // Issue #2, unit 12: ahora si se registran -- antes eran no-ops porque
  // ninguna unit emitia comandos de llamada todavia.
  const calls: string[] = [];
  const respondedCalls: { from: string; accept: boolean }[] = [];
  const sentSpacesVersions: string[] = [];
  let captured: OfficeRoomHandlers | undefined;
  let joinedWith: PresenceStatus | undefined;
  let joinedName: string | undefined;
  let joinedSpacesVersion: string | undefined;
  let left = false;
  // Issue #52: el comando `reconnect` se prueba contando entradas, no
  // inspeccionando la conexion -- lo que tiene que pasar es que la escena
  // vuelva a entrar, no como quede por dentro el doble.
  let connectCount = 0;

  const connection: OfficeConnection = {
    sessionId,
    sendMove: (x, y, facing) => sent.push({ x, y, facing }),
    sendStatus: (status) => statuses.push(status),
    sendSpacesVersion: (version) => sentSpacesVersions.push(version),
    sendCall: (to) => calls.push(to),
    sendCallRespond: (from, accept) => respondedCalls.push({ from, accept }),
    leave: async () => {
      left = true;
    },
  };

  return {
    sent,
    statuses,
    calls,
    respondedCalls,
    sentSpacesVersions,
    handlers: () => captured,
    joinedWith: () => joinedWith,
    joinedName: () => joinedName,
    joinedSpacesVersion: () => joinedSpacesVersion,
    hasLeft: () => left,
    connectCount: () => connectCount,
    connect: async (options: ConnectOfficeRoomOptions) => {
      connectCount++;
      captured = options.handlers;
      joinedWith = options.status;
      joinedName = options.name;
      joinedSpacesVersion = options.spacesVersion;
      return connection;
    },
  };
}

function remoteSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'remota-1',
    name: 'Ana Remota',
    x: 500,
    y: 600,
    status: 'g',
    facing: 'down',
    spacesVersion: BUILT_IN_SPACES_VERSION,
    ...overrides,
  } as Parameters<OfficeRoomHandlers['onAdd']>[0];
}

function findRemoteAvatars(scene: Phaser.Scene): CharacterContainer[] {
  // Complemento exacto de `findPlayer`, y por el mismo motivo: sin cuerpo
  // fisico solo quedan los avatares que llegan por Colyseus.
  return scene.children.list.filter(
    (c): c is CharacterContainer => c.type === 'Container' && c.body === null,
  );
}

describe('OfficeScene: avatares reales por Colyseus (PRD 6.2)', () => {
  it('sin endpoint corre en solitario y lo anuncia por el puente', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));

    const { scene } = await bootOfficeScene(bridge, { endpoint: null });

    // Sin endpoint no hay nada que reintentar, y por eso `canRetry` es falso:
    // ofrecer un boton de reintento en modo solitario seria ofrecer un boton que
    // no puede hacer nada.
    await vi.waitFor(() =>
      expect(presence).toContainEqual({
        online: false,
        peers: 0,
        state: 'offline',
        canRetry: false,
      }),
    );
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('un alta remota dibuja un avatar nuevo en las coordenadas del servidor', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());
    connector.handlers()!.onAdd(remoteSnapshot({ x: 500, y: 600 }));

    const avatars = findRemoteAvatars(scene);
    expect(avatars).toHaveLength(1);
    expect({ x: avatars[0].x, y: avatars[0].y }).toEqual({ x: 500, y: 600 });
    expect(avatars[0].nameText).toBe('Ana Remota');
  });

  it('no dibuja un clon del jugador local aunque el servidor lo incluya', async () => {
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'mi-sesion', name: DEFAULT_NAME }));

    // El jugador local ya responde al teclado al instante; su copia remota
    // llegaria con el retardo de la red y se veria como un doble pisandole.
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('una baja remota retira el avatar de la escena', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'se-va' }));
    expect(findRemoteAvatars(scene)).toHaveLength(1);

    connector.handlers()!.onRemove('se-va');

    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('emite presence con el numero de companeros conectados', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'a' }));
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'b' }));

    expect(presence.at(-1)).toEqual({
      online: true,
      peers: 2,
      state: 'connected',
      canRetry: true,
    });
  });

  it('si el servidor no responde, la oficina sigue jugable en solitario', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    // Lo que se prueba es que un servidor caido no deja la pantalla en negro:
    // en desarrollo eso seria la mitad del tiempo.
    // Con endpoint configurado SI hay algo que reintentar, aunque el primer
    // intento fallase: el servidor puede estar solo arrancando.
    await vi.waitFor(() =>
      expect(presence).toContainEqual({
        online: false,
        peers: 0,
        state: 'offline',
        canRetry: true,
      }),
    );
    expect(findPlayer(scene).nameText).toBe(DEFAULT_NAME);
  });

  it('publica la posicion del jugador local en cada frame', async () => {
    const connector = fakeConnector();
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    // El agrupado decide que sale por el cable; la escena publica siempre.
    await vi.waitFor(() => expect(connector.sent.length).toBeGreaterThan(0));
    expect(connector.sent[0]).toMatchObject({ facing: 'down' });
  });

  it('cierra la conexion al apagar la escena', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);

    // Sin esto, cada remonte de StrictMode dejaria un socket vivo publicando la
    // posicion de un jugador ya destruido.
    await vi.waitFor(() => expect(connector.hasLeft()).toBe(true));
  });
});

describe('OfficeScene: comando setStatus via el puente (#1)', () => {
  it('repinta el punto de estado del jugador local', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    expect(player.statusDot.fillColor).toBe(STATUS_COLOR[DEFAULT_STATUS]);

    bridge.emitCommand('setStatus', { status: 'r' });

    expect(player.status).toBe('r');
    expect(player.statusDot.fillColor).toBe(STATUS_COLOR.r);
  });

  it('publica el estado nuevo al servidor', async () => {
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('setStatus', { status: 'y' });

    expect(connector.statuses).toEqual(['y']);
  });

  it('corta el audio al instante, sin esperar al siguiente tic de proximidad', async () => {
    const bridge = createOfficeBridge();
    const voices: { peers: readonly { sessionId: string; name: string }[] }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));
    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);

    bridge.emitCommand('setStatus', { status: 'r' });

    // Sin esperar nada: un "No molestar" que tarda un cuarto de segundo en
    // cortar el audio no es un corte, es un retraso.
    expect(voices.at(-1)?.peers).toEqual([]);
  });

  it('un par que pasa a "No molestar" deja de ser audible en el siguiente tic', async () => {
    const bridge = createOfficeBridge();
    const voices: { peers: readonly { sessionId: string; name: string }[] }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y }));
    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);

    connector
      .handlers()!
      .onChange(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y, status: 'r' }));

    await vi.waitFor(() => {
      expect(voices.at(-1)?.peers).toEqual([]);
    }, LOOP_WAIT);
  });

  it('el mismo estado dos veces no vuelve a publicarlo', async () => {
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('setStatus', { status: 'r' });
    bridge.emitCommand('setStatus', { status: 'r' });

    expect(connector.statuses).toEqual(['r']);
  });

  it('el join lleva el estado actual del jugador, no un valor fijo', async () => {
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    await vi.waitFor(() => expect(connector.joinedWith()).toBe(DEFAULT_STATUS), LOOP_WAIT);
  });

  it('el join lleva la version de config de espacios fallback (#7, D4)', async () => {
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    // Sin `spacesVersion` en las opciones la escena publica la constante
    // fallback, que es el camino de la oficina en solitario y el de un
    // despliegue sin `DATABASE_URL`: todos sus clientes caen en el mismo valor
    // y por tanto siguen de acuerdo.
    await vi.waitFor(
      () => expect(connector.joinedSpacesVersion()).toBe(BUILT_IN_SPACES_VERSION),
      LOOP_WAIT,
    );
  });

  it('un cambio de estado mientras la conexion esta en vuelo no se pierde', async () => {
    const bridge = createOfficeBridge();
    const statuses: PresenceStatus[] = [];
    let joinedWith: PresenceStatus | undefined;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const connection: OfficeConnection = {
      sessionId: 'mi-sesion',
      sendMove: () => {},
      sendStatus: (status) => statuses.push(status),
      sendSpacesVersion: () => {},
      sendCall: () => {},
      sendCallRespond: () => {},
      leave: async () => {},
    };

    await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: async (options: ConnectOfficeRoomOptions) => {
        joinedWith = options.status;
        await gate;
        return connection;
      },
    });

    bridge.emitCommand('setStatus', { status: 'r' });
    openGate();

    // El join ya habia salido con el estado viejo: si nadie reconcilia al
    // aterrizar, el servidor nos publica "En linea" habiendo pedido "No
    // molestar", y el aislamiento local no se nota desde fuera.
    await vi.waitFor(() => expect(statuses).toEqual(['r']), LOOP_WAIT);
    expect(joinedWith).toBe(DEFAULT_STATUS);
  });

  it('desuscribe el handler de setStatus al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('setStatus', { status: 'r' });

    expect(player.status).toBe(DEFAULT_STATUS);
  });
});

describe('OfficeScene: comando speakers via el puente (issue #17, D7 -- habla real enciende el anillo)', () => {
  it('enciende el anillo de un avatar remoto real cuando su sessionId reporta estar hablando', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];
    expect(avatar.ring.visible).toBe(false);

    bridge.emitCommand('speakers', { sessionIds: ['par-1'] });

    expect(avatar.ring.visible).toBe(true);
  });

  it('apaga el anillo cuando su sessionId deja de aparecer en el conjunto reportado', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];
    bridge.emitCommand('speakers', { sessionIds: ['par-1'] });
    expect(avatar.ring.visible).toBe(true);

    bridge.emitCommand('speakers', { sessionIds: [] });

    expect(avatar.ring.visible).toBe(false);
  });

  it('un sessionId ajeno en el comando no enciende avatares que no coinciden', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];

    bridge.emitCommand('speakers', { sessionIds: ['alguien-mas'] });

    expect(avatar.ring.visible).toBe(false);
  });

  it('desuscribe el handler de speakers al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'par-1' }));
    const avatar = findRemoteAvatars(scene)[0];

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('speakers', { sessionIds: ['par-1'] });

    expect(avatar.ring.visible).toBe(false);
  });
});

describe('OfficeScene: retratos fieles exportados una vez desde create() (issue #17, D1)', () => {
  it('emite "portraits" una sola vez con una URL de datos PNG decodificable por cada clave base', async () => {
    const bridge = createOfficeBridge();
    const events: { byKey: Record<string, string> }[] = [];
    bridge.on('portraits', (payload) => events.push(payload));

    await bootOfficeScene(bridge);

    expect(events).toHaveLength(1);
    const { byKey } = events[0];
    const expectedKeys = [...AVATAR_KEYS, PLAYER_TEXTURE].sort();
    expect(Object.keys(byKey).sort()).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      const dataUrl = byKey[key];
      expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
      expect(atob(dataUrl.split(',')[1]).length).toBeGreaterThan(0);
    }
  });
});

/**
 * Issue #2, unit 12 (kill switch final de la cadena, D3/D9/D10). Como el
 * resto de este archivo, **no puede ejecutarse en este entorno**
 * (`chrome-headless-shell` sin `libglib-2.0.so.0`, mismo fallo que arrastra
 * toda la cadena desde PR3). Escrito y verificado a mano contra la
 * implementacion, no contra una corrida verde -- mismo precedente que la
 * unit 8 en PR3.
 */
describe('OfficeScene: comandos de llamada via el puente (issue #2, D3)', () => {
  it('el comando callPeer reenvia el sessionId al transporte (connection.sendCall)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('callPeer', { sessionId: 'peer-1' });

    expect(connector.calls).toEqual(['peer-1']);
  });

  it('el comando respondCall reenvia {from,accept} al transporte (connection.sendCallRespond)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('respondCall', { from: 'caller-1', accept: false });

    expect(connector.respondedCalls).toEqual([{ from: 'caller-1', accept: false }]);
  });

  it('sin conexion activa, los comandos de llamada no lanzan (oficina en solitario)', async () => {
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: null });

    expect(() => bridge.emitCommand('callPeer', { sessionId: 'peer-1' })).not.toThrow();
    expect(() => bridge.emitCommand('respondCall', { from: 'x', accept: true })).not.toThrow();
    expect(() => bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' })).not.toThrow();
  });

  it('desuscribe los tres handlers de llamada al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('callPeer', { sessionId: 'peer-1' });
    bridge.emitCommand('respondCall', { from: 'caller-1', accept: true });
    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });

    expect(connector.calls).toEqual([]);
    expect(connector.respondedCalls).toEqual([]);
  });
});

describe('OfficeScene: mensajes de llamada del servidor se relanzan al puente (issue #2, D4)', () => {
  it('onCallInvite del transporte se relanza como "callinvite"', async () => {
    const bridge = createOfficeBridge();
    const events: { from: string; name: string }[] = [];
    bridge.on('callinvite', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onCallInvite?.({ from: 'caller-1', name: 'Diego Soto' });

    expect(events).toEqual([{ from: 'caller-1', name: 'Diego Soto' }]);
  });

  it('onCallerLeft del transporte se relanza como "callerleft"', async () => {
    const bridge = createOfficeBridge();
    const events: { from: string }[] = [];
    bridge.on('callerleft', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onCallerLeft?.({ from: 'caller-1' });

    expect(events).toEqual([{ from: 'caller-1' }]);
  });

  it('onCallAccepted del transporte se relanza como "callaccepted"', async () => {
    const bridge = createOfficeBridge();
    const events: { by: string; name: string }[] = [];
    bridge.on('callaccepted', (payload) => events.push(payload));
    const connector = fakeConnector('mi-sesion');
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onCallAccepted?.({ by: 'peer-1', name: 'Marta Ríos' });

    expect(events).toEqual([{ by: 'peer-1', name: 'Marta Ríos' }]);
  });
});

describe('OfficeScene: auto-caminata al aceptar una llamada (issue #2, D9/D10)', () => {
  it(
    'walkToPeer mueve al jugador junto al peer y LO DEJA QUIETO ahi -- regresion ' +
      'directa de la trampa de renormalizar la velocidad del reductor (ver discovery ' +
      '"update() renormaliza la velocidad del reductor"): normalize().scale() la ' +
      'reescala a una magnitud constante y el jugador oscilaria alrededor del ' +
      'destino sin llegar nunca. Si alguien reintroduce esa renormalizacion en el ' +
      'camino de autoWalk, la velocidad jamas se asienta en (0,0) y esta prueba no ' +
      'converge (timeout en el primer `vi.waitFor`, o la posicion sigue derivando en ' +
      'el segundo chequeo).',
    async () => {
      const bridge = createOfficeBridge();
      const connector = fakeConnector('mi-sesion');
      const { scene } = await bootOfficeScene(bridge, {
        endpoint: 'ws://fake',
        connect: connector.connect,
      });
      await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
      const player = findPlayer(scene);
      // Zona abierta del cesped, lejos del jugador y de cualquier colisionador.
      const peerX = 30 * TILE;
      const peerY = 30 * TILE;
      connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: peerX, y: peerY }));

      bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });

      await vi.waitFor(() => {
        const d = Phaser.Math.Distance.Between(player.x, player.y, peerX, peerY);
        expect(d).toBeLessThanOrEqual(TILE * 1.5);
      }, LOOP_WAIT);

      const body = player.body as Phaser.Physics.Arcade.Body;
      await vi.waitFor(() => {
        expect(body.velocity.x).toBe(0);
        expect(body.velocity.y).toBe(0);
      }, LOOP_WAIT);

      // Asentado de verdad, no solo un cruce momentaneo de la ventana de
      // ARRIVE_EPSILON_PX: la posicion no debe seguir derivando cuadros despues.
      const settledX = player.x;
      const settledY = player.y;
      await advanceGameClock(scene, 300);
      expect(player.x).toBe(settledX);
      expect(player.y).toBe(settledY);
    },
    20000,
  );

  it('un toque de WASD durante la auto-caminata cancela y devuelve el control al instante', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: 30 * TILE, y: 30 * TILE }));
    bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });
    // Deja que la auto-caminata arranque de verdad antes de interrumpirla.
    await vi.waitFor(() => {
      const body = player.body as Phaser.Physics.Arcade.Body;
      expect(body.velocity.x !== 0 || body.velocity.y !== 0).toBe(true);
    }, LOOP_WAIT);

    dispatchKey('keydown', KEY.RIGHT);
    try {
      // D10: el mismo cuadro que lee la tecla ya se mueve bajo velocidad de
      // teclado -- esa lectura ES la cancelacion, sin listener aparte.
      await vi.waitFor(() => {
        const body = player.body as Phaser.Physics.Arcade.Body;
        expect(body.velocity.x).toBeGreaterThan(0);
        expect(body.velocity.y).toBe(0);
      }, LOOP_WAIT);
    } finally {
      dispatchKey('keyup', KEY.RIGHT);
    }
  });

  it('aceptar una llamada (respondCall accept:true) dispara la misma auto-caminata que walkToPeer', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const peerX = 30 * TILE;
    const peerY = 30 * TILE;
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'caller-1', x: peerX, y: peerY }));
    const startDistance = Phaser.Math.Distance.Between(player.x, player.y, peerX, peerY);

    bridge.emitCommand('respondCall', { from: 'caller-1', accept: true });

    await vi.waitFor(() => {
      const d = Phaser.Math.Distance.Between(player.x, player.y, peerX, peerY);
      expect(d).toBeLessThan(startDistance);
    }, LOOP_WAIT);
    expect(connector.respondedCalls).toEqual([{ from: 'caller-1', accept: true }]);
  });

  it('pasar una llamada (respondCall accept:false) NO mueve al jugador', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'caller-1', x: 30 * TILE, y: 30 * TILE }));
    const startX = player.x;
    const startY = player.y;

    bridge.emitCommand('respondCall', { from: 'caller-1', accept: false });
    await advanceGameClock(scene, 300);

    expect(player.x).toBe(startX);
    expect(player.y).toBe(startY);
  });

  it('walkToPeer sobre un sessionId desconocido no hace nada (peer ya desconectado)', async () => {
    const bridge = createOfficeBridge();
    const connector = fakeConnector('mi-sesion');
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const startX = player.x;
    const startY = player.y;

    expect(() => bridge.emitCommand('walkToPeer', { sessionId: 'fantasma' })).not.toThrow();
    await advanceGameClock(scene, 300);

    expect(player.x).toBe(startX);
    expect(player.y).toBe(startY);
  });

  it(
    'el destino respeta el espacio de quien llama (issue #10, S2 3.2): el jugador aterriza ' +
      'DENTRO del rectangulo servido, no solo cerca del peer -- regresion directa de usar ' +
      'findFreeAdjacentTile sin el rectangulo, que aterrizaria fuera de un espacio cuando el ' +
      'primer offset del peer cae al otro lado del borde',
    async () => {
      const bridge = createOfficeBridge();
      const connector = fakeConnector('mi-sesion');
      const { scene } = await bootOfficeScene(bridge, {
        endpoint: 'ws://fake',
        connect: connector.connect,
      });
      await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
      const player = findPlayer(scene);

      // Cubiculo 3x3 en cesped abierto, lejos de cualquier colisionador del
      // mapa base (mismas tiles que `terrainGrid.test.ts`).
      const rect = { x0: 30, y0: 30, x1: 32, y1: 32 };
      const cubiculo = {
        id: 'desk-borde',
        name: 'Escritorio de Borde',
        x: rect.x0 * TILE,
        y: rect.y0 * TILE,
        w: (rect.x1 - rect.x0 + 1) * TILE,
        h: (rect.y1 - rect.y0 + 1) * TILE,
      };
      bridge.emitCommand('spacesconfig', { spaces: [cubiculo], version: 'version-cubiculo' });

      // El peer esta en el borde DERECHO del cubiculo: su primer
      // ADJACENT_OFFSETS ([1,0]) cae en (33,31), fuera del rectangulo. Sin la
      // restriccion de espacio, `findFreeAdjacentTile` aterrizaria ahi mismo.
      const peerX = rect.x1 * TILE + 16;
      const peerY = 31 * TILE + 16;
      connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'peer-1', x: peerX, y: peerY }));

      bridge.emitCommand('walkToPeer', { sessionId: 'peer-1' });

      // Primero confirma que la auto-caminata REALMENTE arranco (velocidad
      // distinta de cero en algun momento) antes de esperar a que se asiente:
      // sin este chequeo intermedio, un `walkToPeer` que aborta temprano
      // (peer no encontrado, destino null) pasaria el chequeo de asentado de
      // forma trivial -- la velocidad ya es (0,0) en reposo desde el inicio.
      await vi.waitFor(() => {
        const body = player.body as Phaser.Physics.Arcade.Body;
        expect(body.velocity.x !== 0 || body.velocity.y !== 0).toBe(true);
      }, LOOP_WAIT);

      await vi.waitFor(() => {
        const body = player.body as Phaser.Physics.Arcade.Body;
        expect(body.velocity.x).toBe(0);
        expect(body.velocity.y).toBe(0);
      }, LOOP_WAIT);

      const landedTx = Math.floor(player.x / TILE);
      const landedTy = Math.floor(player.y / TILE);
      expect(landedTx).toBeGreaterThanOrEqual(rect.x0);
      expect(landedTx).toBeLessThanOrEqual(rect.x1);
      expect(landedTy).toBeGreaterThanOrEqual(rect.y0);
      expect(landedTy).toBeLessThanOrEqual(rect.y1);
    },
    20000,
  );
});

describe('OfficeScene: nombre real del usuario local (#6)', () => {
  it('la pildora del jugador local lleva el nombre de la sesion', async () => {
    const { scene } = await bootOfficeScene(createOfficeBridge(), { playerName: 'Ana Torres' });

    expect(findPlayer(scene).nameText).toBe('Ana Torres');
  });

  it('sin nombre de sesion el jugador local cae en DEFAULT_NAME, no en el de una persona', async () => {
    const { scene } = await bootOfficeScene();

    // Desarrollo local, e2e y la oficina sin autenticacion comparten este
    // camino: la escena llama al usuario como lo llama el servidor.
    expect(findPlayer(scene).nameText).toBe(DEFAULT_NAME);
  });

  it('entra a la sala de Colyseus con ese mismo nombre', async () => {
    const connector = fakeConnector();
    await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
      playerName: 'Ana Torres',
    });

    await vi.waitFor(() => expect(connector.joinedName()).toBe('Ana Torres'), LOOP_WAIT);
  });

  it('sin nombre de sesion entra a la sala con el de la pildora, no con undefined', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });

    await vi.waitFor(() => expect(connector.joinedName()).toBeDefined(), LOOP_WAIT);
    expect(connector.joinedName()).toBe(findPlayer(scene).nameText);
  });

  it('el tile de video propio se etiqueta con el mismo nombre que la pildora', async () => {
    const bridge = createOfficeBridge();
    const voices: { selfName: string }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));

    const { scene } = await bootOfficeScene(bridge, { endpoint: null, playerName: 'Ana Torres' });

    // `emitVoice` lee la pildora: si la pildora deja de ser la sesion, el tile
    // propio se va con ella. Se comprueban juntas para que no se separen.
    await vi.waitFor(() => expect(voices.length).toBeGreaterThan(0), LOOP_WAIT);
    expect(voices.at(-1)?.selfName).toBe('Ana Torres');
    expect(voices.at(-1)?.selfName).toBe(findPlayer(scene).nameText);
  });
});

/**
 * La config servida llegando a la escena (#7, slice 3). Quien la LEE es
 * `spacesConfig.ts` y quien la resuelve es `useSpacesConfig`, ambos probados
 * sin Phaser. Lo que falta cubrir aqui es que, una vez dentro, gobierne de
 * verdad la pertenencia y se anuncie a los pares.
 *
 * Entra por COMANDO y no por opcion de construccion: llega despues de que
 * Phaser arranque, porque la escena no puede esperar a un viaje de red para
 * existir.
 */
describe('OfficeScene: config de espacios servida (#7, slice 3)', () => {
  /** Un espacio que NO existe en `BUILT_IN_SPACES`, en pixeles y sobre el spawn. */
  const SERVIDO = {
    id: 'id-espacio-servido',
    name: 'Espacio Servido',
    x: (PLAYER_SPAWN_TX - 2) * TILE,
    y: (PLAYER_SPAWN_TY - 2) * TILE,
    w: 6 * TILE,
    h: 6 * TILE,
  };

  it('tras el comando deriva la pertenencia de los espacios servidos', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const rooms: { spaceId: string | null; name: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    bridge.emitCommand('spacesconfig', { spaces: [SERVIDO], version: 'version-servida' });

    // El jugador nace dentro de `SERVIDO`, que no es ninguna de las dos salas
    // incorporadas: sin adoptar la config, el spawn caeria en piso abierto y
    // este evento no llegaria nunca.
    await advanceGameClock(scene, 600);
    await vi.waitFor(() => expect(rooms.at(-1)?.spaceId).toBe(SERVIDO.id), LOOP_WAIT);
  });

  it('anuncia la version nueva a los pares con sendSpacesVersion', async () => {
    // Es la mitad que hace util al predicado mutuo: un cliente que cambia de
    // config tiene que DECIRLO, o el resto seguira creyendo que coinciden.
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.joinedSpacesVersion()).toBe(BUILT_IN_SPACES_VERSION), LOOP_WAIT);

    bridge.emitCommand('spacesconfig', { spaces: [SERVIDO], version: 'version-servida' });

    await vi.waitFor(() => expect(connector.sentSpacesVersions).toContain('version-servida'), LOOP_WAIT);
  });

  it('una config cuya version ya es la vigente no se reenvia', async () => {
    // El caso normal de un despliegue sin editar: lo servido coincide con lo
    // incorporado. Un mensaje por sesion que no dice nada nuevo es ruido.
    const connector = fakeConnector('mi-sesion');
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(
      () => expect(connector.joinedSpacesVersion()).toBe(BUILT_IN_SPACES_VERSION),
      LOOP_WAIT,
    );

    bridge.emitCommand('spacesconfig', {
      spaces: BUILT_IN_SPACES,
      version: BUILT_IN_SPACES_VERSION,
    });
    await advanceGameClock(scene, 400);

    expect(connector.sentSpacesVersions).toEqual([]);
  });

  it('una lista servida vacia deja al jugador en piso abierto', async () => {
    // Un despliegue con la tabla vacia es legitimo. La escena no puede
    // degradar a los incorporados: derivaria pertenencia de rectangulos que el
    // servidor no tiene.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    bridge.emitCommand('spacesconfig', { spaces: [], version: 'version-vacia' });
    const rooms: { spaceId: string | null }[] = [];
    bridge.on('room', (payload) => rooms.push(payload));

    // Varios tics de proximidad (250ms cada uno) de reloj de JUEGO.
    await advanceGameClock(scene, 800);

    expect(rooms.every((room) => room.spaceId === null)).toBe(true);
  });
});

/**
 * Los escritorios asignables llegando a la escena (#7, slice 5). Quien los LEE
 * es `desksClient.ts` y quien los resuelve es `useDesks`, ambos probados sin
 * Phaser. Lo que falta cubrir aqui es el DIBUJO y el clic: que cada zona de
 * 3x3 aparece donde toca, que la decoracion de su ocupante cae en su caja, que
 * el propio se distingue del ajeno y que solo se puede clicar lo que es de uno
 * o lo que esta libre.
 *
 * Entran por COMANDO y no por opcion de construccion, misma razon que
 * `spacesconfig`: llegan despues de que Phaser arranque, porque la escena no
 * puede esperar a un viaje de red para existir.
 */
describe('OfficeScene: escritorios asignables (#7, slice 5)', () => {
  function servedDesk(overrides: Partial<OfficeDesk> = {}): OfficeDesk {
    return {
      id: 'id-mesa',
      label: 'Mesa 4',
      x: 10 * TILE,
      y: 12 * TILE,
      w: 3 * TILE,
      h: 3 * TILE,
      occupant: null,
      mine: false,
      ...overrides,
    };
  }

  function occupant(displayName: string | null, items: DeskDecorItem[] = []): DeskOccupant {
    return { id: `id-${displayName ?? 'anonimo'}`, displayName, items };
  }

  function fakePointer(): Phaser.Input.Pointer {
    return { event: { stopPropagation: vi.fn() } } as unknown as Phaser.Input.Pointer;
  }

  function findZone(scene: Phaser.Scene, deskId: string): Phaser.GameObjects.Rectangle | null {
    return scene.children.getByName(deskZoneName(deskId)) as Phaser.GameObjects.Rectangle | null;
  }

  function countZones(scene: Phaser.Scene): number {
    return scene.children.list.filter((child) => child.name.startsWith('desk:')).length;
  }

  it('arranca sin ningun escritorio asignable: nadie espera a la red', async () => {
    // La escena existe antes que la respuesta de `/desks`, igual que existe
    // antes que la de `/spaces`.
    const { scene } = await bootOfficeScene();

    expect(countZones(scene)).toBe(0);
  });

  it('tras el comando dibuja la zona de 3x3 de cada escritorio, en pixeles del mundo', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    const zone = findZone(scene, 'id-mesa');
    expect(zone).not.toBeNull();
    // Origen arriba a la izquierda, 96x96: el rectangulo de Phaser se ancla en
    // su centro, asi que la esquina es centro menos medio lado.
    expect(zone!.x - zone!.width / 2).toBe(10 * TILE);
    expect(zone!.y - zone!.height / 2).toBe(12 * TILE);
    expect(zone!.width).toBe(3 * TILE);
    expect(zone!.height).toBe(3 * TILE);
  });

  it('no toca los 39 escritorios del mapa base: son mobiliario, no sitios que se cojan', async () => {
    // `DESK_ROWS` son 2x1 y van pegados de dos en dos. Un escritorio asignable
    // se dibuja ENCIMA, como un `SpaceArea` es algo aparte de un `Room`.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const deskCount = DESK_ROWS.reduce((sum, [, , n]) => sum + n, 0);

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    const tiled = scene.children.list.filter((c) => c.type === 'TileSprite');
    expect(tiled).toHaveLength(deskCount + 2);
  });

  it('pinta la decoracion del ocupante dentro de su caja, no en cualquier sitio', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({
          occupant: occupant('Ana Torres', [
            { id: 'id-item', slot: 8, rotation: 0, textureKey: 'no-existe-en-el-bundle' },
          ]),
        }),
      ],
    });

    // El slot 8 es la caja de abajo a la derecha (`deskSlotRect`): su centro
    // cae a dos tiles y medio del origen del escritorio.
    const decor = scene.children.getByName('desk-item:id-item') as Phaser.GameObjects.Rectangle;
    expect(decor).not.toBeNull();
    expect(decor.x).toBe(10 * TILE + 2.5 * TILE);
    expect(decor.y).toBe(12 * TILE + 2.5 * TILE);
  });

  it('una pieza con un slot que no existe se salta sin llevarse el escritorio por delante', async () => {
    // El dato viene de la red. Pintarla en una caja inventada la dejaria fuera
    // del escritorio, y no pintar nada dejaria la oficina sin ese sitio.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({
          occupant: occupant('Ana Torres', [
            { id: 'id-fuera', slot: 99, rotation: 0, textureKey: 'x' },
          ]),
        }),
      ],
    });

    expect(scene.children.getByName('desk-item:id-fuera')).toBeNull();
    expect(findZone(scene, 'id-mesa')).not.toBeNull();
  });

  it('el escritorio propio se distingue del de otra persona', async () => {
    // Cual es el propio lo dice el SERVIDOR (`mine`), que es quien sabe quien
    // pregunta. La escena lo lee, no lo deduce.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { playerName: 'Ana Torres' });

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({ id: 'mia', occupant: occupant('Ana Torres'), mine: true }),
        servedDesk({ id: 'ajena', x: 20 * TILE, occupant: occupant('Luis Paz') }),
      ],
    });

    expect(findZone(scene, 'mia')!.fillColor).not.toBe(findZone(scene, 'ajena')!.fillColor);
  });

  it('un homonimo NO hereda tu escritorio: manda `mine`, no el nombre', async () => {
    // El pin de regresion de esta slice. Decidir la pertenencia comparando el
    // nombre visible es lo que la slice 1 de esta misma issue retiro de
    // `proximityAudio.ts`: alli un renombrado cambiaba en silencio quien oye a
    // quien, y aqui cambiaria de manos un escritorio. Dos personas del
    // directorio pueden llamarse igual, y una de ellas puede llamarse como tu
    // desde que un Admin la renombro.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { playerName: 'Ana Torres' });

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({ id: 'homonima', occupant: occupant('Ana Torres'), mine: false }),
        servedDesk({ id: 'ajena', x: 20 * TILE, occupant: occupant('Luis Paz') }),
      ],
    });

    // Se ve como lo que es: el escritorio de otra persona, y sin nada que
    // ofrecer al clicarlo.
    const homonima = findZone(scene, 'homonima')!;
    expect(homonima.fillColor).toBe(findZone(scene, 'ajena')!.fillColor);
    expect(homonima.input).toBeNull();
  });

  it('un escritorio libre se distingue de uno ocupado', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', {
      desks: [
        servedDesk({ id: 'libre' }),
        servedDesk({ id: 'ocupada', x: 20 * TILE, occupant: occupant('Luis Paz') }),
      ],
    });

    expect(findZone(scene, 'libre')!.fillColor).not.toBe(findZone(scene, 'ocupada')!.fillColor);
  });

  it('la profundidad es el borde inferior, misma convencion que el mobiliario del mapa', async () => {
    // `placeFurniture` usa `(y + alto) * TILE` para cada mueble. Con cualquier
    // otra cosa, un avatar de pie delante del escritorio se dibujaria DEBAJO.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk()] });

    expect(findZone(scene, 'id-mesa')!.depth).toBe(12 * TILE + 3 * TILE);
  });

  it('clicar un escritorio libre pide cogerlo', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const clicks: unknown[] = [];
    bridge.on('deskclick', (payload) => clicks.push(payload));

    bridge.emitCommand('desks', { desks: [servedDesk()] });
    findZone(scene, 'id-mesa')!.emit('pointerdown', fakePointer());

    // La escena sabe que hay dibujado; quien habla con el servidor es React.
    expect(clicks).toEqual([{ deskId: 'id-mesa', label: 'Mesa 4', action: 'claim' }]);
  });

  it('clicar el propio ofrece dejarlo', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { playerName: 'Ana Torres' });
    const clicks: unknown[] = [];
    bridge.on('deskclick', (payload) => clicks.push(payload));

    bridge.emitCommand('desks', {
      desks: [servedDesk({ occupant: occupant('Ana Torres'), mine: true })],
    });
    findZone(scene, 'id-mesa')!.emit('pointerdown', fakePointer());

    expect(clicks).toEqual([{ deskId: 'id-mesa', label: 'Mesa 4', action: 'release' }]);
  });

  it('clicar el de otra persona no hace nada', async () => {
    // Ni siquiera se hace clicable: un escritorio ajeno no tiene ninguna
    // accion que ofrecer, y `release` solo suelta el propio.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge, { playerName: 'Ana Torres' });
    const clicks: unknown[] = [];
    bridge.on('deskclick', (payload) => clicks.push(payload));

    bridge.emitCommand('desks', { desks: [servedDesk({ occupant: occupant('Luis Paz') })] });
    const zone = findZone(scene, 'id-mesa')!;
    zone.emit('pointerdown', fakePointer());

    expect(zone.input).toBeNull();
    expect(clicks).toEqual([]);
  });

  it('el clic no se cuela al mapa de fondo', async () => {
    // Mismo `stopPropagation` que el clic de un peer: sin el, el
    // `pointerdown` de la escena cerraria el menu contextual a la vez.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const pointer = fakePointer();

    bridge.emitCommand('desks', { desks: [servedDesk()] });
    findZone(scene, 'id-mesa')!.emit('pointerdown', pointer);

    const { stopPropagation } = pointer.event as unknown as { stopPropagation: () => void };
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('una lista nueva reemplaza a la anterior en vez de acumularse encima', async () => {
    // Cada refresco trae el estado COMPLETO, no un delta: quien solto su sitio
    // tiene que dejar de verse ocupado, y dibujar encima lo dejaria pintado.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk({ id: 'primera' })] });
    bridge.emitCommand('desks', { desks: [servedDesk({ id: 'segunda' })] });

    expect(countZones(scene)).toBe(1);
    expect(findZone(scene, 'primera')).toBeNull();
    expect(findZone(scene, 'segunda')).not.toBeNull();
  });

  it('una lista vacia deja la oficina sin escritorios asignables y sin tocar nada mas', async () => {
    // Es el despliegue sin directorio configurado, donde `/desks` responde 503
    // y el cliente degrada a no pintar ninguno. Todo lo demas sigue igual.
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    bridge.emitCommand('desks', { desks: [servedDesk()] });
    bridge.emitCommand('desks', { desks: [] });

    expect(countZones(scene)).toBe(0);
    expect(findPlayer(scene)).toBeDefined();
  });

  it('desuscribe el handler de desks al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('desks', { desks: [servedDesk()] });

    expect(countZones(scene)).toBe(0);
  });
});

/**
 * Cableado de la reconexion en la escena (issue #52). El viaje por cable ya lo
 * cubre `officeRoomClient.node.test.ts` contra un Colyseus real; lo que se
 * prueba aqui es lo que la escena TIENE que hacer cuando ese viaje termina
 * bien: tirar los avatares viejos y, sobre todo, dejar que el audio vuelva.
 */
describe('OfficeScene: reconexion (issue #52)', () => {
  it('un resync vacia el registro: el replay de la sala nueva es quien repuebla', async () => {
    const connector = fakeConnector();
    const { scene } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'se-fue-durante-la-caida' }));
    expect(findRemoteAvatars(scene)).toHaveLength(1);

    connector.handlers()!.onResync!();

    // Quien se haya ido mientras duraba la caida no tiene `onRemove` que lo
    // retire: ese borrado ocurrio en una sala que ya no existe. Si no se vacia
    // aqui, se queda pintado para siempre.
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('tras un resync el audio vuelve a emitirse aunque el conjunto de pares sea identico', async () => {
    const bridge = createOfficeBridge();
    const voices: {
      selfSessionId: string | null;
      peers: readonly { sessionId: string; name: string }[];
      spaceId: string | null;
    }[] = [];
    bridge.on('voice', (payload) => voices.push(payload));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const audible = () => remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y });
    connector.handlers()!.onAdd(audible());

    await vi.waitFor(() => {
      expect(voices.some((v) => v.peers.some((peer) => peer.sessionId === 'par-1'))).toBe(true);
    }, LOOP_WAIT);
    const emitidosAntes = voices.length;

    // Resync y replay en la MISMA vuelta, sin tic por medio: asi el conjunto de
    // pares que ve el siguiente tic es identico al de antes, y lo unico que
    // puede hacer que se reemita es haber borrado la clave de dedupe.
    connector.handlers()!.onResync!();
    connector.handlers()!.onAdd(audible());

    // Esta es la trampa de la issue #41 vuelta a pisar: `emitVoice` deduplica
    // por `lastVoiceKey`, asi que sin invalidarla el par recuperado se veria y
    // no se oiria -- nadie volveria a pedirle a LiveKit que lo suscriba.
    await vi.waitFor(() => expect(voices.length).toBeGreaterThan(emitidosAntes), LOOP_WAIT);
    expect(voices.at(-1)?.peers.map((peer) => peer.sessionId)).toEqual(['par-1']);
  });

  it('el estado de conexion viaja por "presence" sin cambiarle el significado a `online`', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    bridge.on('presence', (p) => presence.push(p));
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    connector.handlers()!.onConnectionState!('reconnecting');

    // `online` sigue significando lo mismo que siempre (hay sesion viva), para
    // que nada rio abajo cambie de sentido en silencio al ensancharse el evento.
    expect(presence.at(-1)).toEqual({
      online: false,
      peers: 0,
      state: 'reconnecting',
      canRetry: true,
    });
  });

  it('el comando "reconnect" tira la sesion muerta, limpia la oficina y vuelve a entrar', async () => {
    const connector = fakeConnector();
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'de-la-sesion-vieja' }));
    expect(findRemoteAvatars(scene)).toHaveLength(1);

    bridge.emitCommand('reconnect', undefined);

    await vi.waitFor(() => expect(connector.connectCount()).toBe(2), LOOP_WAIT);
    expect(connector.hasLeft()).toBe(true);
    // Los avatares de la sesion anterior no pueden sobrevivir a la nueva: el
    // join reparte los suyos, y mezclarlos dejaria fantasmas.
    expect(findRemoteAvatars(scene)).toHaveLength(0);
  });

  it('deja de escuchar "reconnect" al apagarse la escena', async () => {
    const connector = fakeConnector();
    const { scene, bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.emitCommand('reconnect', undefined);

    // Un comando tardio del HUD no puede resucitar una escena destruida: seria
    // el mismo socket huerfano que la guarda `alive` lleva evitando desde el
    // principio, entrando por otra puerta. El doble cuenta la entrada de forma
    // sincrona, asi que no hace falta esperar a nada para afirmarlo.
    expect(connector.connectCount()).toBe(1);
  });

  it('el reintento manual se anuncia como "reconectando" antes de esperar al servidor', async () => {
    const bridge = createOfficeBridge();
    const presence: OfficeEventMap['presence'][] = [];
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    connector.handlers()!.onConnectionState!('offline');
    bridge.on('presence', (p) => presence.push(p));

    bridge.emitCommand('reconnect', undefined);

    // El aviso sale ANTES del `await` del join, no despues: entrar tarda lo que
    // tarde la red, y durante ese rato el HUD seguiria pintando "Sin servidor"
    // con su boton al lado -- o sea, sin acuse de recibo de un clic que SI hizo
    // algo. Es el mismo sintoma que esta issue viene a quitar, en pequeno.
    expect(presence.at(-1)?.state).toBe('reconnecting');
  });

  it('dos clics seguidos en Reintentar no abren dos sesiones', async () => {
    const connector = fakeConnector();
    const { bridge } = await bootOfficeScene(createOfficeBridge(), {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);

    bridge.emitCommand('reconnect', undefined);
    bridge.emitCommand('reconnect', undefined);

    // Entrar es asincrono, asi que sin guarda el segundo clic arranca un join
    // mientras el primero sigue en vuelo: gana el que resuelva el ultimo y el
    // otro queda huerfano, vivo y publicando la posicion del jugador. Dos
    // sesiones para una persona son DOS avatares suyos en la oficina de los
    // demas -- justo la clase de fantasma que esta issue viene a quitar.
    await vi.waitFor(() => expect(connector.connectCount()).toBe(2), LOOP_WAIT);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connector.connectCount()).toBe(2);
  });
});
