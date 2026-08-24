import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from './createGame';
import { createOfficeBridge } from './officeBridge';

/**
 * Capa de navegador: Chromium real, WebGL real. Phaser no se puede ni importar
 * bajo jsdom (`CanvasFeatures` llama a getContext('2d') al cargar el modulo),
 * asi que todo lo que toca el motor se prueba aqui contra el motor de verdad.
 */

const hosts: HTMLElement[] = [];
const games: Phaser.Game[] = [];

function mountHost(width = 320, height = 240): HTMLElement {
  const host = document.createElement('div');
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  document.body.append(host);
  hosts.push(host);
  return host;
}

/** Arranca el juego y espera a que OfficeScene haya corrido su `create()`. */
async function bootedGame(host: HTMLElement): Promise<Phaser.Game> {
  const game = createGame(host, createOfficeBridge());
  games.push(game);
  await vi.waitFor(() => {
    expect(game.scene.getScene('office')?.scene.settings.status).toBe(
      Phaser.Scenes.RUNNING,
    );
  });
  return game;
}

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

describe('createGame en un navegador real', () => {
  it('inserta el canvas dentro del contenedor recibido', async () => {
    const host = mountHost();

    await bootedGame(host);

    expect(host.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('resuelve AUTO a WebGL, no al fallback de canvas 2D', async () => {
    const game = await bootedGame(mountHost());

    expect(game.renderer).toBeInstanceOf(Phaser.Renderer.WebGL.WebGLRenderer);
  });

  it('respeta pixelArt: sin antialias el pixel art no se ve borroso (PRD 4.1)', async () => {
    const game = await bootedGame(mountHost());

    expect(game.config.antialias).toBe(false);
    expect(game.config.pixelArt).toBe(true);
  });

  it('escala el juego al tamano del contenedor', async () => {
    const game = await bootedGame(mountHost(320, 240));

    expect(game.scale.gameSize.width).toBe(320);
    expect(game.scale.gameSize.height).toBe(240);
  });

  it('arranca en OfficeScene', async () => {
    const game = await bootedGame(mountHost());

    expect(game.scene.isActive('office')).toBe(true);
  });

  it('destroy(true) retira el canvas del DOM', async () => {
    const host = mountHost();
    const game = await bootedGame(host);
    expect(host.querySelector('canvas')).not.toBeNull();

    game.destroy(true);
    games.length = 0;

    await vi.waitFor(() => {
      expect(host.querySelector('canvas')).toBeNull();
    });
  });

  it('dos juegos en contenedores distintos no comparten canvas', async () => {
    const first = mountHost();
    const second = mountHost();

    await bootedGame(first);
    await bootedGame(second);

    expect(first.querySelectorAll('canvas')).toHaveLength(1);
    expect(second.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('el motor sigue siendo Phaser 3 (PRD 6.1), no la 4 que resuelve latest', () => {
    expect(Phaser.VERSION.startsWith('3.')).toBe(true);
  });
});
