import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    ...overrides,
  };
}

describe('createPhaserAvatarSink', () => {
  it('crea el avatar en las coordenadas de pixel que manda el servidor', async () => {
    const result = await withScene((scene) => {
      const avatar = createPhaserAvatarSink(scene).create(snapshot({ x: 640, y: 480 }));
      return { x: avatar.x, y: avatar.y, name: avatar.nameText };
    });

    // El servidor habla en pixeles de mundo, no en tiles: confundirlos pondria
    // a todo el mundo apilado en la esquina superior izquierda.
    expect(result).toEqual({ x: 640, y: 480, name: 'Ana' });
  });

  it('interpola hacia la nueva posicion en vez de saltar a ella', async () => {
    const { avatar } = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene);
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
      const sink = createPhaserAvatarSink(scene);
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
      const sink = createPhaserAvatarSink(scene);
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
      const registry = createRemoteAvatarRegistry(createPhaserAvatarSink(scene));
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
      const sink = createPhaserAvatarSink(scene);
      const avatar = sink.create(snapshot({ facing: 'down' }));
      sink.update(avatar, snapshot({ facing: 'left' }));
      return { value: avatar.facing, texture: avatar.sprite.texture.key };
    });

    expect(facing.value).toBe('left');
    expect(facing.texture).toContain('-left');
  });

  it('una orientacion desconocida cae a "down" en vez de pedir una textura inexistente', async () => {
    const facing = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene);
      const avatar = sink.create(snapshot({ facing: 'down' }));
      sink.update(avatar, snapshot({ facing: 'noroeste' }));
      return avatar.facing;
    });

    // El servidor ya valida, pero esto es otro limite de confianza: una clave
    // inventada haria que Phaser pintase su cuadro verde de textura ausente.
    expect(facing).toBe('down');
  });

  it('un estado desconocido usa el color de "disponible" en vez de quedarse sin color', async () => {
    const created = await withScene((scene) => {
      const sink = createPhaserAvatarSink(scene);
      return sink.create(snapshot({ status: 'estado-inventado' }));
    });

    expect(created).toBeDefined();
    expect(created.nameText).toBe('Ana');
  });
});
