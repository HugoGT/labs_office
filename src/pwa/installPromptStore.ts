/**
 * Holds Chromium's `beforeinstallprompt` event until someone presses
 * "Instalar app" (#13). Chromium fires it once per page load, as soon as the
 * app is installable, which is long before the office mounts (sign-in, name,
 * character): `main.tsx` starts the capture at boot so the event is not lost,
 * and `useInstallPrompt` reads it through `useSyncExternalStore`.
 */

export type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface InstallPromptSnapshot {
  readonly promptAvailable: boolean;
  readonly installed: boolean;
}

export interface InstallPromptStore {
  getSnapshot(): InstallPromptSnapshot;
  subscribe(listener: () => void): () => void;
  /** Shows the browser's install dialog and waits for the answer. */
  prompt(): Promise<InstallPromptOutcome>;
}

/** Not in TypeScript's DOM lib: Chromium only. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function createInstallPromptStore(target: EventTarget): InstallPromptStore {
  let deferred: BeforeInstallPromptEvent | null = null;
  let snapshot: InstallPromptSnapshot = { promptAvailable: false, installed: false };
  const listeners = new Set<() => void>();

  const update = (next: InstallPromptSnapshot) => {
    if (next.promptAvailable === snapshot.promptAvailable && next.installed === snapshot.installed) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  target.addEventListener('beforeinstallprompt', (event) => {
    // Without this, Chrome on Android shows its own mini-infobar; the office
    // offers installing from its own button instead.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    update({ ...snapshot, promptAvailable: true });
  });
  target.addEventListener('appinstalled', () => {
    deferred = null;
    update({ promptAvailable: false, installed: true });
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt() {
      const event = deferred;
      if (event === null) return 'unavailable';
      // An event prompts once; a dismissed one is spent until the browser fires again.
      deferred = null;
      try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        update({ promptAvailable: false, installed: snapshot.installed || outcome === 'accepted' });
        return outcome;
      } catch {
        // Chromium refuses a second prompt() or one outside a user gesture.
        update({ ...snapshot, promptAvailable: false });
        return 'unavailable';
      }
    },
  };
}

let shared: InstallPromptStore | null = null;

/** The page's one store, listening on `window`; idempotent, called at boot and by the hook. */
export function startInstallPromptCapture(target: EventTarget = window): InstallPromptStore {
  shared ??= createInstallPromptStore(target);
  return shared;
}
