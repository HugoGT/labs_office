import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NPC_WALK_MS_PER_TILE,
  makeCharacter,
  setCharacterStatus,
  spawnNpcs,
  spawnPlayer,
  walkNpcTo,
  type NpcContainer,
} from './characters';
import { TILE } from './mapData';
import { NPCS } from './npcData';
import { createOfficeBridge, type OfficeEventMap } from './officeBridge';
import { DEFAULT_NAME, DEFAULT_STATUS } from './officeProtocol';
import { STATUS_COLOR } from './presence';
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
      const bridge = createOfficeBridge();
      return spawnNpcs(scene, bridge).map((c) => ({ x: c.x, y: c.y }));
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
      const bridge = createOfficeBridge();
      return spawnNpcs(scene, bridge).map((c) => c.statusDot.fillColor);
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
      const bridge = createOfficeBridge();
      return spawnNpcs(scene, bridge).map((c) => c.ring.strokeColor);
    });

    expect(new Set(ringColors).size).toBe(1);
    expect(ringColors[0]).toBe(0x22c55e);
  });

  it('el anillo de habla nace invisible: solo lo enciende la proximidad (app.js:327)', async () => {
    const ringsVisible = await withScene((scene) => {
      const bridge = createOfficeBridge();
      return spawnNpcs(scene, bridge).map((c) => c.ring.visible);
    });

    // `setVisible(false)` al construir: sin esto la oficina arrancaria con los 33
    // NPCs marcados como hablando antes del primer tick de proximidad.
    expect(ringsVisible).toHaveLength(NPCS.length);
    expect(ringsVisible.every((v) => v === false)).toBe(true);
  });

  it('no programa ningun temporizador: los NPCs simulados ya no deambulan solos', async () => {
    const scheduledCount = await withScene((scene) => {
      const bridge = createOfficeBridge();
      const addEventSpy = vi.spyOn(scene.time, 'addEvent');
      spawnNpcs(scene, bridge);
      return addEventSpy.mock.calls.length;
    });

    // Antes eran 3 (los `wander:true` del roster). Su unico comportamiento
    // ahora es acudir a una llamada, que es reactivo, no periodico.
    expect(scheduledCount).toBe(0);
  });

  it('al hacer clic en un NPC, emite npcmenu por el bridge con sus datos', async () => {
    const received: OfficeEventMap['npcmenu'][] = [];
    const target = await withScene((scene) => {
      const bridge = createOfficeBridge();
      bridge.on('npcmenu', (payload) => received.push(payload));
      return spawnNpcs(scene, bridge)[0];
    });

    target.emit('pointerdown', {
      event: { stopPropagation: () => {}, clientX: 42, clientY: 84 },
    });

    expect(received).toEqual([
      {
        // D1: el id de NPC ahora vive dentro de la variante discriminada.
        target: { kind: 'npc', npcId: 0 },
        name: NPCS[0].name,
        status: 'En línea',
        statusCode: 'g',
        x: 42,
        y: 84,
      },
    ]);
  });
});

describe('walkNpcTo', () => {
  it('tween al centro exacto de la tile destino', async () => {
    const target = await withScene((scene) => {
      const c = makeCharacter(scene, 'Test', 6, 26, 'av0', 'g') as NpcContainer;
      const tweenSpy = vi
        .spyOn(scene.tweens, 'add')
        .mockImplementation(() => ({ stop: () => {} }) as unknown as Phaser.Tweens.Tween);

      walkNpcTo(scene, c, 9, 26);

      const config = tweenSpy.mock.calls[0]?.[0] as unknown as { x: number; y: number };
      return { x: config.x, y: config.y };
    });

    expect(target).toEqual({ x: 9 * TILE + 16, y: 26 * TILE + 16 });
  });

  it('la duracion escala con la distancia recorrida, no es un valor fijo', async () => {
    const durations = await withScene((scene) => {
      const near = makeCharacter(scene, 'Near', 6, 26, 'av0', 'g') as NpcContainer;
      const far = makeCharacter(scene, 'Far', 6, 26, 'av0', 'g') as NpcContainer;
      const tweenSpy = vi
        .spyOn(scene.tweens, 'add')
        .mockImplementation(() => ({ stop: () => {} }) as unknown as Phaser.Tweens.Tween);

      walkNpcTo(scene, near, 8, 26); // 2 tiles
      walkNpcTo(scene, far, 14, 26); // 8 tiles

      return tweenSpy.mock.calls.map(
        (call) => (call[0] as unknown as { duration: number }).duration,
      );
    });

    // Sin esto, un `duration: 900` fijo haria que cruzar la oficina entera
    // fuese tan rapido como dar un paso. 8 tiles deben tardar 4x lo de 2.
    expect(durations[0]).toBeCloseTo(2 * NPC_WALK_MS_PER_TILE, 0);
    expect(durations[1]).toBeCloseTo(8 * NPC_WALK_MS_PER_TILE, 0);
  });

  it('una segunda llamada detiene el tween anterior en vez de acumularlo', async () => {
    const stopped = await withScene((scene) => {
      const c = makeCharacter(scene, 'Test', 6, 26, 'av0', 'g') as NpcContainer;
      const stops: number[] = [];
      let created = 0;
      vi.spyOn(scene.tweens, 'add').mockImplementation(() => {
        const id = created++;
        return { stop: () => stops.push(id) } as unknown as Phaser.Tweens.Tween;
      });

      walkNpcTo(scene, c, 8, 26);
      walkNpcTo(scene, c, 10, 26);

      return stops;
    });

    // El primer tween (id 0) queda cancelado; si no, dos tweens pelean por
    // `x`/`y` del mismo contenedor y el NPC vibra entre ambos destinos.
    expect(stopped).toEqual([0]);
  });

  it('mueve de verdad al NPC hacia el destino dentro de un Phaser.Game real', async () => {
    const c = await withScene((scene) => {
      const npc = makeCharacter(scene, 'Test', 6, 26, 'av0', 'g') as NpcContainer;
      walkNpcTo(scene, npc, 10, 26);
      return npc;
    });
    const startX = c.x;

    await vi.waitFor(
      () => {
        expect(c.x).toBeGreaterThan(startX);
      },
      { timeout: 3000 },
    );
  });
});

describe('spawnPlayer', () => {
  it('crea al jugador en su tile declarada con cuerpo fisico y limites de colision', async () => {
    const result = await withScene((scene) => {
      const player = spawnPlayer(scene, DEFAULT_NAME);
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

  it('etiqueta al jugador con el nombre recibido, no con uno propio (#6)', async () => {
    const nameText = await withScene((scene) => spawnPlayer(scene, 'Ana Torres').nameText);

    // El nombre entra por parametro porque esta fabrica no puede saberlo: lo
    // sabe la sesion verificada, varias capas mas arriba.
    expect(nameText).toBe('Ana Torres');
  });
});

describe('setCharacterStatus', () => {
  it('repinta el punto de la pildora con el color del estado nuevo', async () => {
    const colors = await withScene((scene) => {
      const character = makeCharacter(scene, 'Test', 6, 26, 'av0', 'g');
      const before = character.statusDot.fillColor;
      setCharacterStatus(character, 'r');
      return { before, after: character.statusDot.fillColor, status: character.status };
    });

    expect(colors.before).toBe(STATUS_COLOR.g);
    expect(colors.after).toBe(STATUS_COLOR.r);
    expect(colors.status).toBe('r');
  });

  it('el estado nace en el contenedor, no hay que preguntarselo al punto pintado', async () => {
    // El contenedor es la fuente que lee `proximityTick` para decidir audio:
    // deducir el estado del color seria invertir la direccion del dato.
    const status = await withScene((scene) => makeCharacter(scene, 'Test', 6, 26, 'av0', 'y').status);

    expect(status).toBe('y');
  });

  it('sale pronto si el estado no cambia, sin tocar el objeto pintado', async () => {
    // Espeja `setCharacterFacing`: se llama desde cada mensaje remoto y
    // repintar lo mismo una y otra vez es trabajo tirado.
    const repaints = await withScene((scene) => {
      const character = makeCharacter(scene, 'Test', 6, 26, 'av0', 'g');
      const spy = vi.spyOn(character.statusDot, 'setFillStyle');
      setCharacterStatus(character, 'g');
      return spy.mock.calls.length;
    });

    expect(repaints).toBe(0);
  });

  it('el jugador local arranca "En línea" (DEFAULT_STATUS), no con un color inventado', async () => {
    const player = await withScene((scene) => {
      const created = spawnPlayer(scene, DEFAULT_NAME);
      return { status: created.status, color: created.statusDot.fillColor };
    });

    expect(player.status).toBe(DEFAULT_STATUS);
    expect(player.color).toBe(STATUS_COLOR[DEFAULT_STATUS]);
  });
});
