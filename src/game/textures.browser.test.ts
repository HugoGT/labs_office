import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GROUND, GROUND_TEX, TILE } from './mapData';
import { AVATAR_KEYS, PLAYER_TEXTURE, createOfficeTextures } from './textures';

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
  it('genera las 8 claves de textura de suelo declaradas en GROUND_TEX', async () => {
    const exists = await withScene((scene) => {
      createOfficeTextures(scene);
      return GROUND_TEX.map((key) => scene.textures.exists(key));
    });

    expect(exists).toEqual(GROUND_TEX.map(() => true));
    expect(GROUND_TEX).toHaveLength(8);
  });

  it('grassA mide 32x32 (TILE), igual que el resto de tiles de suelo', async () => {
    const size = await withScene((scene) => {
      createOfficeTextures(scene);
      const frame = scene.textures.get('grassA').getSourceImage();
      return { width: frame.width, height: frame.height };
    });

    expect(size).toEqual({ width: TILE, height: TILE });
    expect(GROUND_TEX[GROUND.G]).toBe('grassA');
  });

  it('genera 10 claves de avatar (AVATAR_KEYS) mas la textura del jugador (PLAYER_TEXTURE)', async () => {
    const exists = await withScene((scene) => {
      createOfficeTextures(scene);
      return {
        avatars: AVATAR_KEYS.map((key) => scene.textures.exists(key)),
        player: scene.textures.exists(PLAYER_TEXTURE),
      };
    });

    expect(AVATAR_KEYS).toHaveLength(10);
    expect(exists.avatars).toEqual(AVATAR_KEYS.map(() => true));
    expect(exists.player).toBe(true);
    expect(PLAYER_TEXTURE).toBe('avP');
  });
});
