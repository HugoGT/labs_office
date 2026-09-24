import Phaser from 'phaser';
import { expect, vi } from 'vitest';

/**
 * Boot budget for a Phaser scene in the `browser` project (#68). While its
 * preload fetches the Kenney sheets from the Vite server a scene sits in
 * LOADING (status 3), and under a full `test:all` run, or on the CI runner,
 * that alone outlasts `vi.waitFor`'s 1s default. Matches the `LOOP_WAIT`
 * margin the scene tests already use; the browser project's `testTimeout`
 * leaves room for a test that boots two games back to back.
 */
export const SCENE_BOOT_TIMEOUT_MS = 20_000;

/** Waits until the scene `key` of `game` has run its `create()`. */
export async function waitForSceneRunning(
  game: Phaser.Game,
  key: string,
  timeout = SCENE_BOOT_TIMEOUT_MS,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(game.scene.getScene(key)?.scene.settings.status).toBe(Phaser.Scenes.RUNNING);
    },
    { timeout, interval: 50 },
  );
}
