import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterContainer, NpcContainer } from './characters';
import {
  DESK_ROWS,
  GROUND_TEX,
  MAP_H,
  MAP_W,
  PROX_RADIUS,
  TILE,
  TREES,
  ZONE_LABELS,
} from './mapData';
import { NPCS } from './npcData';
import { createOfficeBridge } from './officeBridge';
import { OFFICE_SCENE_KEY, OfficeScene } from './OfficeScene';

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

async function bootOfficeScene(bridge = createOfficeBridge()): Promise<{
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
    scene: [new OfficeScene(bridge)],
  });
  games.push(game);

  await vi.waitFor(() => {
    expect(game.scene.getScene(OFFICE_SCENE_KEY)?.scene.settings.status).toBe(
      Phaser.Scenes.RUNNING,
    );
  });

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

    const groundKeys = new Set<string>([...GROUND_TEX, 'grassB']);
    const groundImages = images.filter((img) => groundKeys.has(img.texture.key));
    const deskCount = DESK_ROWS.reduce((sum, [, , n]) => sum + n, 0);

    expect(groundImages).toHaveLength(MAP_W * MAP_H);
    expect(images.filter((img) => img.texture.key === 'desk')).toHaveLength(deskCount);
    expect(images.filter((img) => img.texture.key === 'tree')).toHaveLength(TREES.length);
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

    await vi.waitFor(
      () => {
        expect(events.some((names) => names.includes(closestNpc.nameText))).toBe(true);
      },
      { timeout: 2000 },
    );

    const countAfterFirstNotification = events.length;
    // Sin mover al jugador, el proximo tick (250ms) no debe repetir la notificacion.
    await new Promise((resolve) => setTimeout(resolve, 600));
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
      await vi.waitFor(() => expect(npc.ring.visible).toBe(true), { timeout: 6000 });

      // Ya encendido y sin movernos, tiene que apagarse dentro de un ciclo de 4000ms:
      // `speaking = near && ((now + phase) % 4000) < 1800`. Esto es lo que cae si
      // alguien simplifica a `setVisible(near)` o a `setVisible(true)`.
      let wentSilentWhileNear = false;
      for (let i = 0; i < 50 && !wentSilentWhileNear; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const d = Phaser.Math.Distance.Between(player.x, player.y, npc.x, npc.y);
        wentSilentWhileNear = d < PROX_RADIUS && !npc.ring.visible;
      }

      expect(wentSilentWhileNear).toBe(true);
    },
    20000,
  );

  it('emite "room" al entrar a una sala', async () => {
    const bridge = createOfficeBridge();
    const rooms: (string | null)[] = [];
    bridge.on('room', (payload) => rooms.push(payload.room));

    const { scene } = await bootOfficeScene(bridge);
    const player = findPlayer(scene);
    // Sala de Juntas: tile (50,2) tamano 13x14 -> dentro en (52,4).
    player.setPosition(52 * TILE, 4 * TILE);

    await vi.waitFor(
      () => {
        expect(rooms).toContain('Sala de Juntas');
      },
      { timeout: 2000 },
    );
  });
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

