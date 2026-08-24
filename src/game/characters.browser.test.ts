import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  makeCharacter,
  scheduleWander,
  spawnNpcs,
  spawnPlayer,
  type NpcContainer,
} from './characters';
import { TILE } from './mapData';
import { NPCS, STATUS_COLOR } from './npcData';
import { createOfficeBridge, type OfficeEventMap } from './officeBridge';
import { buildTerrainGrid } from './terrainGrid';
import { createOfficeTextures } from './textures';

/**
 * Capa navegador: contenedores/sprites/fisica arcade necesitan Phaser real
 * (jsdom no implementa canvas/WebGL). Fisica arcade habilitada en la config
 * de prueba porque `spawnPlayer` requiere un cuerpo fisico.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

async function withScene<T>(run: (scene: Phaser.Scene) => T): Promise<T> {
  const host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '240px';
  document.body.append(host);
  hosts.push(host);

  let result!: T;
  class ProbeScene extends Phaser.Scene {
    constructor() {
      super('probe');
    }
    create(): void {
      createOfficeTextures(this);
      result = run(this);
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 240,
    physics: { default: 'arcade' },
    scene: [ProbeScene],
  });
  games.push(game);

  await vi.waitFor(() => {
    expect(game.scene.getScene('probe')?.scene.settings.status).toBe(Phaser.Scenes.RUNNING);
  });

  return result;
}

describe('spawnNpcs', () => {
  it('crea un contenedor por cada NPC del roster, posicionado en su tile declarada', async () => {
    const list = await withScene((scene) => {
      const grid = buildTerrainGrid();
      const bridge = createOfficeBridge();
      return spawnNpcs(scene, grid, bridge).map((c) => ({ x: c.x, y: c.y }));
    });

    expect(list).toHaveLength(NPCS.length);
    expect(list[0]).toEqual({ x: NPCS[0].tx * TILE + 16, y: NPCS[0].ty * TILE + 16 });
    const last = NPCS[NPCS.length - 1];
    expect(list[NPCS.length - 1]).toEqual({ x: last.tx * TILE + 16, y: last.ty * TILE + 16 });
  });

  it('colorea el punto de estado de la pildora segun g/y/r del NPC (app.js:338)', async () => {
    // Discrepancia vs. la redaccion de la tarea 6.1: el "ring colored per
    // status" no describe el anillo de habla (siempre verde fijo, ver el
    // siguiente test) sino el `dot` de la pildora de nombre. La fuente
    // (app.js:327,338) es inequivoca: solo `dot` recibe `statusColor`.
    const dotColors = await withScene((scene) => {
      const grid = buildTerrainGrid();
      const bridge = createOfficeBridge();
      return spawnNpcs(scene, grid, bridge).map((c) => {
        const dot = c.list[3] as Phaser.GameObjects.Arc;
        return dot.fillColor;
      });
    });

    const pabloIndex = NPCS.findIndex((n) => n.name === 'Pablo');
    const alejandroIndex = NPCS.findIndex((n) => n.name === 'Alejandro');
    const miliIndex = NPCS.findIndex((n) => n.name === 'Mili');
    expect(dotColors[pabloIndex]).toBe(STATUS_COLOR.g);
    expect(dotColors[alejandroIndex]).toBe(STATUS_COLOR.y);
    expect(dotColors[miliIndex]).toBe(STATUS_COLOR.r);
  });

  it('el anillo de habla siempre usa el mismo color fijo, no el color de estado (app.js:327)', async () => {
    const ringColors = await withScene((scene) => {
      const grid = buildTerrainGrid();
      const bridge = createOfficeBridge();
      return spawnNpcs(scene, grid, bridge).map((c) => c.ring.strokeColor);
    });

    expect(new Set(ringColors).size).toBe(1);
    expect(ringColors[0]).toBe(0x22c55e);
  });

  it('al hacer clic en un NPC, emite npcmenu por el bridge con sus datos', async () => {
    const received: OfficeEventMap['npcmenu'][] = [];
    const target = await withScene((scene) => {
      const grid = buildTerrainGrid();
      const bridge = createOfficeBridge();
      bridge.on('npcmenu', (payload) => received.push(payload));
      return spawnNpcs(scene, grid, bridge)[0];
    });

    target.emit('pointerdown', {
      event: { stopPropagation: () => {}, clientX: 42, clientY: 84 },
    });

    expect(received).toEqual([
      {
        id: 0,
        name: NPCS[0].name,
        status: 'Disponible',
        statusCode: 'g',
        x: 42,
        y: 84,
      },
    ]);
  });
});

describe('scheduleWander', () => {
  it('reprograma solo a los NPCs marcados wander:true (Pablo, Jordan Tavara, kevin)', async () => {
    const scheduledCount = await withScene((scene) => {
      const grid = buildTerrainGrid();
      const bridge = createOfficeBridge();
      const addEventSpy = vi.spyOn(scene.time, 'addEvent');
      spawnNpcs(scene, grid, bridge);
      return addEventSpy.mock.calls.length;
    });

    const wanderCount = NPCS.filter((n) => n.wander).length;
    expect(wanderCount).toBe(3);
    expect(scheduledCount).toBe(3);
  });

  it('no reprograma tween cuando el destino cae fuera del rango interior (borde solido)', async () => {
    const tweenCallCount = await withScene((scene) => {
      const grid = buildTerrainGrid();
      const c = makeCharacter(scene, 'Test', 1, 1, 'av0', STATUS_COLOR.g) as NpcContainer;
      c.homeTx = 1;
      c.homeTy = 1;

      let callback: (() => void) | undefined;
      vi.spyOn(scene.time, 'addEvent').mockImplementation((config) => {
        callback = (config as { callback: () => void }).callback;
        return {} as Phaser.Time.TimerEvent;
      });
      const tweenSpy = vi.spyOn(scene.tweens, 'add');
      const betweenSpy = vi.spyOn(Phaser.Math, 'Between');

      scheduleWander(scene, grid, c);
      // dx=-1, dy=-1 desde (1,1) -> destino (0,0): fuera del rango interior (tx<1||ty<1).
      betweenSpy.mockReturnValueOnce(-1).mockReturnValueOnce(-1);
      callback?.();
      betweenSpy.mockRestore();

      return tweenSpy.mock.calls.length;
    });

    expect(tweenCallCount).toBe(0);
  });

  it('tween al destino cuando la tile no es solida ni agua', async () => {
    const tweenTarget = await withScene((scene) => {
      const grid = buildTerrainGrid();
      const c = makeCharacter(scene, 'Test', 6, 26, 'av0', STATUS_COLOR.g) as NpcContainer;
      c.homeTx = 6;
      c.homeTy = 26;

      let callback: (() => void) | undefined;
      vi.spyOn(scene.time, 'addEvent').mockImplementation((config) => {
        callback = (config as { callback: () => void }).callback;
        return {} as Phaser.Time.TimerEvent;
      });
      const tweenSpy = vi
        .spyOn(scene.tweens, 'add')
        .mockImplementation(() => ({}) as Phaser.Tweens.Tween);
      const betweenSpy = vi.spyOn(Phaser.Math, 'Between');

      scheduleWander(scene, grid, c);
      // dx=1, dy=0 desde (6,26) -> destino (7,26): tile de cesped libre.
      betweenSpy.mockReturnValueOnce(1).mockReturnValueOnce(0);
      callback?.();
      betweenSpy.mockRestore();

      const config = tweenSpy.mock.calls[0]?.[0] as unknown as { x: number; y: number };
      return { x: config.x, y: config.y };
    });

    expect(tweenTarget).toEqual({ x: 7 * TILE + 16, y: 26 * TILE + 16 });
  });
});

describe('spawnPlayer', () => {
  it('crea al jugador en su tile declarada con cuerpo fisico y limites de colision', async () => {
    const result = await withScene((scene) => {
      const player = spawnPlayer(scene);
      const body = player.body as Phaser.Physics.Arcade.Body;
      return {
        x: player.x,
        y: player.y,
        hasArcadeBody: body instanceof Phaser.Physics.Arcade.Body,
        collideWorldBounds: body.collideWorldBounds,
      };
    });

    expect(result.x).toBe(22 * TILE + 16);
    expect(result.y).toBe(28 * TILE + 16);
    expect(result.hasArcadeBody).toBe(true);
    expect(result.collideWorldBounds).toBe(true);
  });
});
