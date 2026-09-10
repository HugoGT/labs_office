/**
 * Test-only positioning hook, exposed on `window` only when the build is
 * compiled with `__OFFICE_E2E__` true (see `vite.config.ts`, D2). It is a
 * thin facade over an already-created `OfficeBridge` instance: it never
 * creates its own `EventTarget`, and it never becomes a global bridge by
 * itself. This deliberately does NOT reintroduce the removed prototype
 * global `window.officeAPI` (see decision on the E2E positioning hook):
 * the exposed surface is three methods, not the bridge itself, and it is
 * dead-code eliminated from the production bundle because the only import
 * site is a guarded dynamic import in `OfficeShell.tsx`.
 */

import type { OfficeBridge, OfficeEventMap } from './officeBridge';

/** Sentinel key scanned for by `e2e/bundle-hook-absent.e2e.test.mjs` (D3). */
export const OFFICE_TEST_HOOK_KEY = '__officeE2E';

export interface OfficeTestHook {
  version: 1;
  /** Moves the local player directly onto a tile, bypassing keyboard input. */
  teleportToTile(tx: number, ty: number): void;
  /** Last "voice" event payload observed, or `null` if none arrived yet. */
  lastVoice(): OfficeEventMap['voice'] | null;
}

/**
 * Attaches an `OfficeTestHook` to `target` (normally `window`). Returns an
 * uninstall function that removes the property and unsubscribes from the
 * bridge's `voice` event.
 */
export function installOfficeTestHook(
  bridge: OfficeBridge,
  target: Record<string, unknown> = window as unknown as Record<string, unknown>,
): () => void {
  let voice: OfficeEventMap['voice'] | null = null;
  const unsubscribeVoice = bridge.on('voice', (payload) => {
    voice = payload;
  });

  const hook: OfficeTestHook = {
    version: 1,
    teleportToTile(tx, ty) {
      bridge.emitCommand('teleportToTile', { tx, ty });
    },
    lastVoice() {
      return voice;
    },
  };

  target[OFFICE_TEST_HOOK_KEY] = hook;

  return () => {
    unsubscribeVoice();
    delete target[OFFICE_TEST_HOOK_KEY];
  };
}
