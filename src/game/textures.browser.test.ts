import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FACINGS } from './officeProtocol';
import { AVATAR_KEYS, PLAYER_TEXTURE, avatarTextureKey, createOfficeTextures } from './textures';

/**
 * Capa navegador: `Graphics#generateTexture` necesita un contexto WebGL/canvas
 * real, ausente bajo jsdom (ver design D-textures / boundary uniforme del
 * change). Se corre dentro de una escena montada en un `Phaser.Game` real.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

/** Arranca una escena vacia y ejecuta `run` dentro de su `create()`. */
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

describe('createOfficeTextures', () => {
  it('genera las cuatro orientaciones de cada avatar y del jugador', async () => {
    const exists = await withScene((scene) => {
      createOfficeTextures(scene);
      const bases = [...AVATAR_KEYS, PLAYER_TEXTURE];
      return bases.flatMap((base) =>
        FACINGS.map((facing) => ({
          key: avatarTextureKey(base, facing),
          present: scene.textures.exists(avatarTextureKey(base, facing)),
        })),
      );
    });

    expect(AVATAR_KEYS).toHaveLength(10);
    expect(exists).toHaveLength(11 * 4);
    expect(exists.filter((e) => !e.present)).toEqual([]);
  });

  it('ya no genera texturas de mapa: eso lo cubren las hojas Kenney', async () => {
    const leftovers = await withScene((scene) => {
      createOfficeTextures(scene);
      // Claves del generador procedural anterior. Si alguna reaparece, hay dos
      // fuentes de verdad para el mismo material.
      return ['grassA', 'grassB', 'water', 'wall', 'desk', 'tree', 'tableGray'].filter((key) =>
        scene.textures.exists(key),
      );
    });

    expect(leftovers).toEqual([]);
  });

  it('las orientaciones de un mismo avatar son imagenes distintas', async () => {
    const sizes = await withScene((scene) => {
      createOfficeTextures(scene);
      return FACINGS.map((facing) => {
        const image = scene.textures.get(avatarTextureKey('av0', facing)).getSourceImage();
        return { w: image.width, h: image.height };
      });
    });

    // Mismo lienzo de 16x20 para las cuatro: lo que cambia es el dibujo, no el
    // tamaño, o el personaje daria un salto al girarse.
    for (const size of sizes) expect(size).toEqual({ w: 16, h: 20 });
  });

  it('de espaldas no se dibujan ojos', async () => {
    const pixels = await withScene((scene) => {
      createOfficeTextures(scene);
      // (6,5) es la posicion del ojo izquierdo mirando de frente.
      const read = (facing: 'down' | 'up') =>
        scene.textures.getPixel(6, 5, avatarTextureKey('av0', facing));
      return { down: read('down'), up: read('up') };
    });

    // Mirando de frente ese pixel es el ojo (casi negro); de espaldas no puede
    // serlo, porque ahi va la nuca cubierta de pelo.
    expect(pixels.down).not.toBeNull();
    expect(pixels.up).not.toBeNull();
    expect(pixels.up?.color).not.toBe(pixels.down?.color);
  });
});
