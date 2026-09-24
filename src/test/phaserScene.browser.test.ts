import Phaser from 'phaser';
import { afterEach, describe, expect, it } from 'vitest';
import { waitForSceneRunning } from './phaserScene';

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];
const timers: ReturnType<typeof setTimeout>[] = [];

afterEach(() => {
  for (const timer of timers.splice(0)) clearTimeout(timer);
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

class ProbeScene extends Phaser.Scene {
  constructor() {
    super('probe');
  }
}

/** A game with no scenes yet, so each test decides when `probe` starts. */
function emptyGame(): Phaser.Game {
  const host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '240px';
  document.body.append(host);
  hosts.push(host);
  const game = new Phaser.Game({ type: Phaser.AUTO, parent: host, width: 320, height: 240 });
  games.push(game);
  return game;
}

describe('waitForSceneRunning (#68)', () => {
  it('resolves once the scene reaches RUNNING', async () => {
    const game = emptyGame();
    game.scene.add('probe', ProbeScene, true);

    await waitForSceneRunning(game, 'probe');

    expect(game.scene.isActive('probe')).toBe(true);
  });

  it('outlasts vi.waitFor 1s default: a scene still LOADING after 1s is not a failure', async () => {
    // In CI the scene sat in LOADING (status 3) past the 1s default while its
    // preload fetched the Kenney sheets. Starting the scene late reproduces
    // that slow boot without depending on the runner's load.
    const game = emptyGame();
    timers.push(setTimeout(() => game.scene.add('probe', ProbeScene, true), 1500));

    await waitForSceneRunning(game, 'probe');

    expect(game.scene.isActive('probe')).toBe(true);
  });

  it('still rejects when the scene never runs within the given budget', async () => {
    const game = emptyGame();

    await expect(waitForSceneRunning(game, 'probe', 200)).rejects.toThrow();
  });
});
