import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOfficeBridge } from './officeBridge';
import { STATUS_COLOR } from './presence';
import { createRemoteAvatarRegistry, type RemotePlayerSnapshot } from './remoteAvatars';
import { createPhaserAvatarSink } from './remoteAvatarSink';
import { createOfficeTextures } from './textures';

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
    scene: [ProbeScene],
  });
  games.push(game);

  await vi.waitFor(() => {
    expect(game.scene.getScene('probe')?.scene.settings.status).toBe(Phaser.Scenes.RUNNING);
  });

  return result;
}

function snapshot(overrides: Partial<RemotePlayerSnapshot> = {}): RemotePlayerSnapshot {
  return {
    sessionId: 'remota-1',
    name: 'Ana',
    x: 100,
    y: 200,
    status: 'g',
    facing: 'down',
    spacesVersion: 'v1',
    ...overrides,
  };
}

describe('createPhaserAvatarSink', () => {
  it('crea el avatar en las coordenadas de pixel que manda el servidor', async () => {
    const result = await withScene((scene) => {
      const avatar = createPhaserAvatarSink(scene, createOfficeBridge()).create(
        snapshot({ x: 640, y: 480 }),
      );
      return { x: avatar.x, y: avatar.y, name: avatar.nameText };
    });

    // El servidor habla en pixeles de mundo, no en tiles: confundirlos pondria
    // a todo el mundo apilado en la esquina superior izquierda.
    expect(result).toEqual({ x: 640, y: 480, name: 'Ana' });
  });

  it('interpola hacia la nueva posicion en vez de saltar a ella', async () => {
    const { avatar } = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene, createOfficeBridge());
      const created = sink.create(snapshot({ x: 100, y: 100 }));
      sink.update(created, snapshot({ x: 900, y: 100 }));
      return { avatar: created };
    });

    // Justo despues de `update` sigue cerca del origen: si saltase, ya estaria
    // en 900 y los demas se moverian a tirones de 10 Hz.
    expect(avatar.x).toBeLessThan(900);
    expect(avatar.glideTween).toBeDefined();

    await vi.waitFor(() => {
      expect(avatar.x).toBe(900);
    });
  });

  it('un update encadenado cancela la interpolacion anterior', async () => {
    const avatar = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene, createOfficeBridge());
      const created = sink.create(snapshot({ x: 0, y: 0 }));
      sink.update(created, snapshot({ x: 500, y: 0 }));
      const first = created.glideTween;
      sink.update(created, snapshot({ x: 900, y: 0 }));
      return { container: created, first, second: created.glideTween };
    });

    expect(avatar.first).not.toBe(avatar.second);
    expect(avatar.first?.isPlaying()).toBe(false);
  });

  it('destroy saca el contenedor de la escena', async () => {
    const remaining = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene, createOfficeBridge());
      const before = scene.children.list.length;
      const avatar = sink.create(snapshot());
      sink.destroy(avatar);
      return scene.children.list.length - before;
    });

    // Sin esto, cada persona que entra y sale deja su avatar de fantasma.
    expect(remaining).toBe(0);
  });

  it('el registro completo alta/actualiza/baja sobre Phaser real', async () => {
    const result = await withScene((scene) => {
      const registry = createRemoteAvatarRegistry(
        createPhaserAvatarSink(scene, createOfficeBridge()),
      );
      const countContainers = () =>
        scene.children.list.filter((c) => c.type === 'Container').length;

      registry.upsert(snapshot({ sessionId: 'a' }));
      registry.upsert(snapshot({ sessionId: 'b' }));
      const afterTwo = countContainers();

      registry.upsert(snapshot({ sessionId: 'a', x: 777 }));
      const afterUpdate = countContainers();

      registry.remove('a');
      return { afterTwo, afterUpdate, afterRemove: countContainers() };
    });

    expect(result.afterTwo).toBe(2);
    expect(result.afterUpdate).toBe(2);
    expect(result.afterRemove).toBe(1);
  });
});

describe('createPhaserAvatarSink: datos que llegan por red', () => {
  it('aplica la orientacion recibida al sprite del avatar', async () => {
    const facing = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene, createOfficeBridge());
      const avatar = sink.create(snapshot({ facing: 'down' }));
      sink.update(avatar, snapshot({ facing: 'left' }));
      return { value: avatar.facing, texture: avatar.sprite.texture.key };
    });

    expect(facing.value).toBe('left');
    expect(facing.texture).toContain('-left');
  });

  it('una orientacion desconocida cae a "down" en vez de pedir una textura inexistente', async () => {
    const facing = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene, createOfficeBridge());
      const avatar = sink.create(snapshot({ facing: 'down' }));
      sink.update(avatar, snapshot({ facing: 'noroeste' }));
      return avatar.facing;
    });

    // El servidor ya valida, pero esto es otro limite de confianza: una clave
    // inventada haria que Phaser pintase su cuadro verde de textura ausente.
    expect(facing).toBe('down');
  });

  it('un estado desconocido cae a "En línea" en vez de quedarse sin color', async () => {
    const created = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene, createOfficeBridge());
      return sink.create(snapshot({ status: 'estado-inventado' }));
    });

    expect(created.status).toBe('g');
    expect(created.statusDot.fillColor).toBe(STATUS_COLOR.g);
    expect(created.nameText).toBe('Ana');
  });

  it('un cambio de estado remoto repinta el punto: antes solo se reconciliaban posicion y orientacion', async () => {
    // Regresion de #1: el estado era inmutable, asi que `update` podia
    // ignorarlo sin consecuencias. Ahora cualquiera puede pasar a "No
    // molestar" en mitad de la sesion y el resto tiene que verlo.
    const dot = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene, createOfficeBridge());
      const avatar = sink.create(snapshot({ status: 'g' }));
      const before = avatar.statusDot.fillColor;
      sink.update(avatar, snapshot({ status: 'r' }));
      return { before, after: avatar.statusDot.fillColor, status: avatar.status };
    });

    expect(dot.before).toBe(STATUS_COLOR.g);
    expect(dot.after).toBe(STATUS_COLOR.r);
    expect(dot.status).toBe('r');
  });

  it('un estado desconocido en un update no borra el color: cae al valor por defecto', async () => {
    const dot = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene, createOfficeBridge());
      const avatar = sink.create(snapshot({ status: 'r' }));
      sink.update(avatar, snapshot({ status: 'moradito' }));
      return avatar.statusDot.fillColor;
    });

    expect(dot).toBe(STATUS_COLOR.g);
  });
});

/**
 * Issue #2, unit 8 (kill switch): hasta que este `pointerdown` exista, ningun
 * peer real puede abrir el menu de llamada -- toda la tuberia de invitaciones
 * (unidades 9-12) queda inerte por falta de un origen. Autor-verificado: esta
 * suite nunca corrio aqui (`chrome-headless-shell` sin `libglib-2.0.so.0`); el
 * apply-progress documenta la corrida manual `pnpm dev` (Obs#1) como evidencia.
 */
describe('createPhaserAvatarSink: clic en un avatar de peer real (issue #2, D1)', () => {
  function fakePointer(overrides: Partial<MouseEvent> = {}): Phaser.Input.Pointer {
    return {
      event: { stopPropagation: vi.fn(), clientX: 0, clientY: 0, ...overrides },
    } as unknown as Phaser.Input.Pointer;
  }

  it('un pointerdown emite npcmenu con el target peer, direccionado por el sessionId del avatar', async () => {
    const received: unknown[] = [];
    await withScene((scene) => {
      const bridge = createOfficeBridge();
      bridge.on('npcmenu', (payload) => received.push(payload));

      const avatar = createPhaserAvatarSink(scene, bridge).create(
        snapshot({ sessionId: 'peer-42', name: 'Ana', status: 'g' }),
      );
      avatar.emit(
        'pointerdown',
        fakePointer({ clientX: 10, clientY: 20 } as Partial<MouseEvent>),
      );
    });

    expect(received).toEqual([
      {
        target: { kind: 'peer', sessionId: 'peer-42' },
        name: 'Ana',
        status: 'En línea',
        statusCode: 'g',
        x: 10,
        y: 20,
      },
    ]);
  });

  it('lee nombre y estado EN VIVO al momento del clic, no la instantanea de creacion (la trampa que documenta el diseno)', async () => {
    const received: unknown[] = [];
    await withScene((scene) => {
      const bridge = createOfficeBridge();
      bridge.on('npcmenu', (payload) => received.push(payload));

      const sink = createPhaserAvatarSink(scene, bridge);
      const avatar = sink.create(snapshot({ sessionId: 'peer-7', name: 'Ana', status: 'g' }));
      // El companero cambia a "No molestar" DESPUES de creado el avatar, via
      // el mismo `update()` que ya reconcilia nombre/estado remotos (#1).
      sink.update(avatar, snapshot({ sessionId: 'peer-7', name: 'Ana', status: 'r' }));

      avatar.emit('pointerdown', fakePointer());
    });

    // Si el handler cerrase sobre el snapshot de creacion (como un NPC, cuyo
    // estado es fijo para siempre), esto seguiria diciendo "g": ofrecer
    // "Llamar" sobre alguien que acaba de pasar a No molestar.
    expect(received).toHaveLength(1);
    expect((received[0] as { statusCode: string }).statusCode).toBe('r');
    expect((received[0] as { status: string }).status).toBe('No molestar');
  });

  it('el pointerdown detiene la propagacion, igual que el de un NPC (no debe disparar tambien el clic de mapa)', async () => {
    const stopPropagation = vi.fn();
    await withScene((scene) => {
      const bridge = createOfficeBridge();
      const avatar = createPhaserAvatarSink(scene, bridge).create(snapshot());
      avatar.emit('pointerdown', fakePointer({ stopPropagation } as unknown as Partial<MouseEvent>));
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });
});
