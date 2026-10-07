import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { createGame } from './createGame';
import { createOfficeBridge } from './officeBridge';
import { MAP_ZOOM_KEY } from './zoomStore';

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
  await waitForSceneRunning(game, 'office');
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

describe('createGame: map zoom persistence (map-zoom)', () => {
  afterEach(() => window.localStorage.removeItem(MAP_ZOOM_KEY));

  const mainZoom = (game: Phaser.Game): number => game.scene.getScene('office').cameras.main.zoom;

  it.each([
    ['a stored stop', '3', 3],
    ['a retired stop', '1.5', 2],
    ['garbage', 'abc', 2],
  ])('restores the zoom of this browser by default: %s', async (_name, stored, expected) => {
    window.localStorage.setItem(MAP_ZOOM_KEY, stored);

    const game = await bootedGame(mountHost());

    expect(mainZoom(game)).toBe(expected);
  });

  it('saves a zoom change in this browser', async () => {
    const bridge = createOfficeBridge();
    const game = createGame(mountHost(), bridge);
    games.push(game);
    await waitForSceneRunning(game, 'office');

    bridge.emitCommand('zoom', { action: 'out' });

    expect(window.localStorage.getItem(MAP_ZOOM_KEY)).toBe('1');
  });

  it('a store given by the caller wins over the browser one', async () => {
    window.localStorage.setItem(MAP_ZOOM_KEY, '1');
    const game = createGame(mountHost(), createOfficeBridge(), { zoomStore: { load: () => 3, save: vi.fn() } });
    games.push(game);
    await waitForSceneRunning(game, 'office');

    expect(mainZoom(game)).toBe(3);
  });
});
