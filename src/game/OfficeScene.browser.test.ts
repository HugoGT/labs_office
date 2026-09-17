import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterContainer, NpcContainer } from './characters';
import { DESK_ROWS, MAP_H, MAP_W, PROX_RADIUS, TILE, TREES, ZONE_LABELS } from './mapData';
import { TERRAIN_SHEET } from './assets';
import { NPCS } from './npcData';
import { createOfficeBridge } from './officeBridge';
import { DEFAULT_STATUS, type PresenceStatus } from './officeProtocol';
import { STATUS_COLOR } from './presence';
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

function findPlayer(scene: Phaser.Scene): CharacterContainer {
  const player = scene.children.list.find(
    (c): c is CharacterContainer =>
      c.type === 'Container' && (c as CharacterContainer).nameText === 'HugoGT',
  );
  if (!player) throw new Error('player container not found in scene');
  return player;
}

function findNpcs(scene: Phaser.Scene): NpcContainer[] {
  return scene.children.list.filter(
    (c): c is NpcContainer => c.type === 'Container' && 'npcId' in c,
  );
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

describe('OfficeScene dentro de un Phaser.Game real: mapa, NPCs y jugador', () => {
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

  it('crea los 33 NPCs del roster mas el jugador (slice 7 completa el esqueleto de la 5b/6)', async () => {
    const { scene } = await bootOfficeScene();

    const containers = scene.children.list.filter((c) => c.type === 'Container');
    expect(containers).toHaveLength(NPCS.length + 1);
    expect(findNpcs(scene)).toHaveLength(NPCS.length);
    expect(findPlayer(scene).nameText).toBe('HugoGT');
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
  it('el sprite con mayor y queda por delante del de menor y tras update()', async () => {
    const { scene } = await bootOfficeScene();
    const npcs = findNpcs(scene);
    const lower = npcs.reduce((a, b) => (a.y < b.y ? a : b));
    const higher = npcs.reduce((a, b) => (a.y > b.y ? a : b));

    await vi.waitFor(() => {
      expect(higher.depth).toBeGreaterThan(lower.depth);
    });
  });
});

describe('OfficeScene: proximidad y salas (app.js:444-471, cada 250ms)', () => {
  it('emite "nearby" por el puente solo cuando el conjunto cercano cambia', async () => {
    const bridge = createOfficeBridge();
    const events: string[][] = [];
    bridge.on('nearby', (payload) => events.push(payload.names));

    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    const closestNpc = findNpcs(scene)[0];
    // Coloca al jugador justo sobre el primer NPC: queda estrictamente dentro del radio.
    player.setPosition(closestNpc.x, closestNpc.y);

    await vi.waitFor(() => {
      expect(events.some((names) => names.includes(closestNpc.nameText))).toBe(true);
    }, LOOP_WAIT);

    const countAfterFirstNotification = events.length;
    // Sin mover al jugador, los proximos tics (250ms cada uno) no deben repetir
    // la notificacion. La ventana se mide en reloj de juego: 600ms reales pueden
    // no contener ni un tic y entonces el dedupe no quedaria probado.
    await advanceGameClock(scene, 600);
    expect(events.length).toBe(countAfterFirstNotification);
  });

  it(
    'el anillo de habla se apaga estando cerca: no es proximidad pura (app.js:452)',
    async () => {
      const { scene } = await bootOfficeScene();
      const player = findPlayer(scene);
      // El primer NPC del roster no tiene wander, asi que no se mueve durante la muestra.
      const npc = findNpcs(scene)[0];
      // Justo encima del NPC: la distancia se mantiene en 0 durante toda la prueba.
      player.setPosition(npc.x, npc.y);

      // Primero esperamos a verlo ENCENDIDO. Esto ancla la prueba: demuestra que el
      // tick de proximidad corre y que estamos dentro del radio. Sin este anclaje, el
      // `false` inicial de `spawnNpcs` (el anillo nace invisible) bastaria para dar el
      // test por bueno sin haber observado el ciclo siquiera.
      await vi.waitFor(() => expect(npc.ring.visible).toBe(true), LOOP_WAIT);

      // Ya encendido y sin movernos, tiene que apagarse dentro de un ciclo de 4000ms:
      // `speaking = near && ((now + phase) % 4000) < 1800`. Esto es lo que cae si
      // alguien simplifica a `setVisible(near)` o a `setVisible(true)`.
      //
      // El muestreo avanza por reloj de juego (dos ciclos completos de 4000ms):
      // 50 esperas reales de 100ms no garantizan ni un ciclo cuando el runner
      // rinde a una fraccion de la velocidad local.
      let wentSilentWhileNear = false;
      const deadline = scene.time.now + 2 * 4000;
      while (!wentSilentWhileNear && scene.time.now < deadline) {
        await advanceGameClock(scene, 100);
        const d = Phaser.Math.Distance.Between(player.x, player.y, npc.x, npc.y);
        wentSilentWhileNear = d < PROX_RADIUS && !npc.ring.visible;
      }

      expect(wentSilentWhileNear).toBe(true);
    },
    60000,
  );

  it('emite "room" al entrar a una sala', async () => {
    const bridge = createOfficeBridge();
    const rooms: (string | null)[] = [];
    bridge.on('room', (payload) => rooms.push(payload.room));

    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    // Sala de Juntas: tile (50,2) tamano 13x14 -> dentro en (52,4).
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(() => {
      expect(rooms).toContain('Sala de Juntas');
    }, LOOP_WAIT);
  });
});

describe('OfficeScene: audio por proximidad (D3) y D7 (pares reales en los chips)', () => {
  it('emite "voice" con los sessionIds reales audibles, sin repetir en tics identicos', async () => {
    const bridge = createOfficeBridge();
    const voices: { selfSessionId: string | null; sessionIds: string[]; room: string | null }[] =
      [];
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
      expect(voices.some((v) => v.sessionIds.includes('par-1'))).toBe(true);
    }, LOOP_WAIT);

    const countAfterFirstNotification = voices.length;
    // Sin mover a nadie, los proximos tics (250ms cada uno) no deben repetir la
    // notificacion; la ventana se cuenta en reloj de juego, no de pared.
    await advanceGameClock(scene, 600);
    expect(voices.length).toBe(countAfterFirstNotification);
  });

  it('un cruce de sala reemite "voice" aunque el conjunto de pares audibles no cambie', async () => {
    const bridge = createOfficeBridge();
    const voices: { selfSessionId: string | null; sessionIds: string[]; room: string | null }[] =
      [];
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
      expect(voices.at(-1)?.room).toBe('Sala de Juntas');
    }, LOOP_WAIT);
    expect(voices.length).toBeGreaterThan(countBeforeCrossing);
    // El conjunto audible sigue vacio: la clave de dedupe cambio solo por la sala.
    expect(voices.at(-1)?.sessionIds).toEqual([]);
  });

  it('"nearby" incluye el nombre de un par real audible antes que los nombres de NPCs (D7)', async () => {
    const bridge = createOfficeBridge();
    const events: string[][] = [];
    bridge.on('nearby', (payload) => events.push(payload.names));
    const connector = fakeConnector('mi-sesion');

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: connector.connect,
    });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
    const player = findPlayer(scene);
    const closestNpc = findNpcs(scene)[0];
    player.setPosition(closestNpc.x, closestNpc.y);
    connector
      .handlers()!
      .onAdd(remoteSnapshot({ sessionId: 'par-1', name: 'Ana Real', x: player.x, y: player.y }));

    await vi.waitFor(() => {
      expect(
        events.some((names) => names[0] === 'Ana Real' && names.includes(closestNpc.nameText)),
      ).toBe(true);
    }, LOOP_WAIT);
  });

  it(
    'D7 asimetria: un par fuera de la sala del jugador queda fuera de "voice" y de "nearby" ' +
      'mientras un par DENTRO de la sala y un NPC en radio si aparecen en "nearby"',
    async () => {
      const bridge = createOfficeBridge();
      const voices: { sessionIds: string[] }[] = [];
      const nearbyEvents: string[][] = [];
      bridge.on('voice', (payload) => voices.push(payload));
      bridge.on('nearby', (payload) => nearbyEvents.push(payload.names));
      const connector = fakeConnector('mi-sesion');

      const { scene } = await bootOfficeScene(bridge, {
        endpoint: 'ws://fake',
        connect: connector.connect,
      });
      await vi.waitFor(() => expect(connector.handlers()).toBeDefined(), LOOP_WAIT);
      const player = findPlayer(scene);
      const npc = findNpcs(scene)[0];
      // Jugador dentro de "Sala de Juntas"; el NPC se reubica junto a el (regla pura de radio,
      // ajena a la sala: por eso el NPC sigue apareciendo aunque no "comparta sala" con nadie).
      player.setPosition(52 * TILE, 4 * TILE);
      npc.setPosition(52 * TILE, 4 * TILE);
      // Par legitimo: comparte la misma sala que el jugador -> audible y en los chips.
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
        expect(voices.some((v) => v.sessionIds.includes('companera-en-sala'))).toBe(true);
        expect(nearbyEvents.some((names) => names.includes('Compañera De Sala'))).toBe(true);
        expect(nearbyEvents.some((names) => names.includes(npc.nameText))).toBe(true);
      }, LOOP_WAIT);

      expect(voices.some((v) => v.sessionIds.includes('vecina-de-puerta'))).toBe(false);
      expect(nearbyEvents.every((names) => !names.includes('Vecina De Puerta'))).toBe(true);
    },
  );
});

describe('OfficeScene: comando teleportTo via el puente (app.js:474-486, D2)', () => {
  it('mueve al jugador a una tile libre adyacente al NPC objetivo', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    const targetNpc = findNpcs(scene)[0];

    bridge.teleportTo(targetNpc.npcId);

    await vi.waitFor(() => {
      const dx = Math.abs(player.x - targetNpc.x) / TILE;
      const dy = Math.abs(player.y - targetNpc.y) / TILE;
      expect(dx).toBeLessThanOrEqual(1);
      expect(dy).toBeLessThanOrEqual(1);
      expect(dx + dy).toBeGreaterThan(0);
    });
  });

  it('funciona igual para un segundo NPC (confirma el mismo mecanismo que usa ContextMenu "Ir a su escritorio", slice 9)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    const npcs = findNpcs(scene);
    const targetNpc = npcs[npcs.length - 1];

    bridge.teleportTo(targetNpc.npcId);

    await vi.waitFor(() => {
      const dx = Math.abs(player.x - targetNpc.x) / TILE;
      const dy = Math.abs(player.y - targetNpc.y) / TILE;
      expect(dx).toBeLessThanOrEqual(1);
      expect(dy).toBeLessThanOrEqual(1);
      expect(dx + dy).toBeGreaterThan(0);
    });
  });

  it('desuscribe el handler de onCommand al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    const targetNpc = findNpcs(scene)[0];
    const beforeX = player.x;
    const beforeY = player.y;

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.teleportTo(targetNpc.npcId);

    // Handler desuscrito: la posicion del jugador no cambia tras SHUTDOWN.
    expect(player.x).toBe(beforeX);
    expect(player.y).toBe(beforeY);
  });
});

describe('OfficeScene: comando callNpc via el puente (el NPC acude a la llamada)', () => {
  it('el NPC llamado camina hasta una tile adyacente al jugador', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    const npc = findNpcs(scene)[0];
    // El NPC 0 nace en (4,7) y el jugador en (22,28): arrancan lejos.
    const startDistance = Phaser.Math.Distance.Between(player.x, player.y, npc.x, npc.y);
    expect(startDistance).toBeGreaterThan(PROX_RADIUS);

    bridge.callNpc(npc.npcId);

    await vi.waitFor(
      () => {
        const dx = Math.abs(npc.x - player.x) / TILE;
        const dy = Math.abs(npc.y - player.y) / TILE;
        expect(dx).toBeLessThanOrEqual(1);
        expect(dy).toBeLessThanOrEqual(1);
        // Queda *junto al* jugador, no encima de el.
        expect(dx + dy).toBeGreaterThan(0);
      },
      { timeout: 15000 },
    );
  }, 20000);

  it('llamar a un NPC mueve al NPC, no al jugador (al reves que teleportTo)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    const npc = findNpcs(scene)[0];
    const playerX = player.x;
    const playerY = player.y;
    const npcX = npc.x;

    bridge.callNpc(npc.npcId);
    await vi.waitFor(() => expect(npc.x).not.toBe(npcX), { timeout: 5000 });

    expect(player.x).toBe(playerX);
    expect(player.y).toBe(playerY);
  }, 10000);

  it('un NPC quieto no se mueve solo: sin llamada no hay desplazamiento', async () => {
    const { scene } = await bootOfficeScene();
    const npcs = findNpcs(scene);
    const before = npcs.map((c) => ({ x: c.x, y: c.y }));

    // Antes, los tres NPCs con `wander:true` se reprogramaban cada 2.5-6s. Esta
    // ventana cubre de sobra ese peor caso: si alguien resucita el bucle, cae aqui.
    await new Promise((resolve) => setTimeout(resolve, 7000));

    npcs.forEach((c, i) => {
      expect({ x: c.x, y: c.y }).toEqual(before[i]);
    });
  }, 15000);

  it('desuscribe el handler de callNpc al apagar la escena (SHUTDOWN, D2)', async () => {
    const bridge = createOfficeBridge();
    const { scene } = await bootOfficeScene(bridge);
    const npc = findNpcs(scene)[0];

    bridge.callNpc(npc.npcId);
    // `walkNpcTo` crea el tween de forma sincrona, asi que basta con mirarlo.
    expect(npc.walkTween).toBeDefined();
    npc.walkTween?.stop();
    npc.walkTween = undefined;

    scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN);
    bridge.callNpc(npc.npcId);

    // Se comprueba sin esperar a proposito: tras un SHUTDOWN emitido a mano el
    // bucle del juego sigue pisando `update()` con el jugador ya desmontado, y
    // dormir aqui solo probaria ese artefacto del arnes, no la desuscripcion.
    expect(npc.walkTween).toBeUndefined();
  });
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
  let captured: OfficeRoomHandlers | undefined;
  let joinedWith: PresenceStatus | undefined;
  let left = false;

  const connection: OfficeConnection = {
    sessionId,
    sendMove: (x, y, facing) => sent.push({ x, y, facing }),
    sendStatus: (status) => statuses.push(status),
    leave: async () => {
      left = true;
    },
  };

  return {
    sent,
    statuses,
    handlers: () => captured,
    joinedWith: () => joinedWith,
    hasLeft: () => left,
    connect: async (options: ConnectOfficeRoomOptions) => {
      captured = options.handlers;
      joinedWith = options.status;
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
    ...overrides,
  } as Parameters<OfficeRoomHandlers['onAdd']>[0];
}

function findRemoteAvatars(scene: Phaser.Scene): CharacterContainer[] {
  return scene.children.list.filter(
    (c): c is CharacterContainer =>
      c.type === 'Container' && !('npcId' in c) && (c as CharacterContainer).nameText !== 'HugoGT',
  );
}

describe('OfficeScene: avatares reales por Colyseus (PRD 6.2)', () => {
  it('sin endpoint corre en solitario y lo anuncia por el puente', async () => {
    const bridge = createOfficeBridge();
    const presence: { online: boolean; peers: number }[] = [];
    bridge.on('presence', (p) => presence.push(p));

    const { scene } = await bootOfficeScene(bridge, { endpoint: null });

    await vi.waitFor(() => expect(presence).toContainEqual({ online: false, peers: 0 }));
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

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'mi-sesion', name: 'HugoGT' }));

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
    const presence: { online: boolean; peers: number }[] = [];
    bridge.on('presence', (p) => presence.push(p));
    const connector = fakeConnector();
    await bootOfficeScene(bridge, { endpoint: 'ws://fake', connect: connector.connect });
    await vi.waitFor(() => expect(connector.handlers()).toBeDefined());

    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'a' }));
    connector.handlers()!.onAdd(remoteSnapshot({ sessionId: 'b' }));

    expect(presence.at(-1)).toEqual({ online: true, peers: 2 });
  });

  it('si el servidor no responde, la oficina sigue jugable en solitario', async () => {
    const bridge = createOfficeBridge();
    const presence: { online: boolean; peers: number }[] = [];
    bridge.on('presence', (p) => presence.push(p));

    const { scene } = await bootOfficeScene(bridge, {
      endpoint: 'ws://fake',
      connect: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    // Lo que se prueba es que un servidor caido no deja la pantalla en negro:
    // en desarrollo eso seria la mitad del tiempo.
    await vi.waitFor(() => expect(presence).toContainEqual({ online: false, peers: 0 }));
    expect(findPlayer(scene).nameText).toBe('HugoGT');
    expect(findNpcs(scene)).toHaveLength(NPCS.length);
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
    const voices: { sessionIds: string[] }[] = [];
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
      expect(voices.some((v) => v.sessionIds.includes('par-1'))).toBe(true);
    }, LOOP_WAIT);

    bridge.emitCommand('setStatus', { status: 'r' });

    // Sin esperar nada: un "No molestar" que tarda un cuarto de segundo en
    // cortar el audio no es un corte, es un retraso.
    expect(voices.at(-1)?.sessionIds).toEqual([]);
  });

  it('un par que pasa a "No molestar" deja de ser audible en el siguiente tic', async () => {
    const bridge = createOfficeBridge();
    const voices: { sessionIds: string[] }[] = [];
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
      expect(voices.some((v) => v.sessionIds.includes('par-1'))).toBe(true);
    }, LOOP_WAIT);

    connector
      .handlers()!
      .onChange(remoteSnapshot({ sessionId: 'par-1', x: player.x, y: player.y, status: 'r' }));

    await vi.waitFor(() => {
      expect(voices.at(-1)?.sessionIds).toEqual([]);
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
