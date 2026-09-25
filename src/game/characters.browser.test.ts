import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { enablePeerBody, makeCharacter, setCharacterStatus, spawnPlayer } from './characters';
import { avatarDepth, worldAssetDepth } from './depthLayers';
import { TILE, WORLD_H } from './mapData';
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

  await waitForSceneRunning(game, 'probe');

  return result;
}

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

describe('makeCharacter: render band (#70)', () => {
  it('is born in the avatar band, above any normal asset, y-sorted by its feet', async () => {
    const depths = await withScene((scene) => ({
      top: makeCharacter(scene, 'Arriba', 5, 1, 'av1', DEFAULT_STATUS).depth,
      bottom: makeCharacter(scene, 'Abajo', 5, 40, 'av2', DEFAULT_STATUS).depth,
    }));

    expect(depths.top).toBe(avatarDepth(1 * TILE + 16));
    expect(depths.top).toBeGreaterThan(worldAssetDepth(WORLD_H));
    expect(depths.bottom).toBeGreaterThan(depths.top);
  });
});

/**
 * `enablePeerBody` (#59): da a un avatar remoto un cuerpo Arcade inmovible,
 * misma geometria que el jugador local (`spawnPlayer`) -- mismo colisionador
 * en `OfficeScene`, mismo tamano para todo el mundo.
 */
describe('enablePeerBody', () => {
  it('crea un cuerpo Arcade con la misma geometria que el jugador local (22x14, offset -11,6)', async () => {
    const geometry = await withScene((scene) => {
      const container = makeCharacter(scene, 'Ana', 0, 0, 'av1', 'g');
      enablePeerBody(scene, container);
      const body = container.body as Phaser.Physics.Arcade.Body;
      return { width: body.width, height: body.height, offsetX: body.offset.x, offsetY: body.offset.y };
    });

    expect(geometry).toEqual({ width: 22, height: 14, offsetX: -11, offsetY: 6 });
  });

  it('el cuerpo es inmovible y no se mueve por su cuenta (moves=false)', async () => {
    const flags = await withScene((scene) => {
      const container = makeCharacter(scene, 'Ana', 0, 0, 'av1', 'g');
      enablePeerBody(scene, container);
      const body = container.body as Phaser.Physics.Arcade.Body;
      return { immovable: body.immovable, moves: body.moves };
    });

    expect(flags).toEqual({ immovable: true, moves: false });
  });

  it('la geometria del cuerpo remoto es identica a la del jugador local (misma fabrica)', async () => {
    const { playerGeometry, peerGeometry } = await withScene((scene) => {
      const player = spawnPlayer(scene, 'Yo');
      const container = makeCharacter(scene, 'Ana', 0, 0, 'av1', 'g');
      enablePeerBody(scene, container);
      const playerBody = player.body as Phaser.Physics.Arcade.Body;
      const peerBody = container.body as Phaser.Physics.Arcade.Body;
      return {
        playerGeometry: { w: playerBody.width, h: playerBody.height },
        peerGeometry: { w: peerBody.width, h: peerBody.height },
      };
    });

    expect(peerGeometry).toEqual(playerGeometry);
  });
});
