import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { installMode, type InstallOffer } from '../pwa/installMode';
import { startInstallPromptCapture, type InstallPromptStore } from '../pwa/installPromptStore';

/** The part of `window` the install offer reads; injected in tests. */
export interface InstallHost {
  matchMedia?: (query: string) => {
    readonly matches: boolean;
    addEventListener(type: 'change', listener: () => void): void;
    removeEventListener(type: 'change', listener: () => void): void;
  };
  readonly navigator: {
    readonly userAgent: string;
    readonly vendor: string;
    readonly maxTouchPoints: number;
    /** Apple only, not in TypeScript's DOM lib. */
    readonly standalone?: boolean;
  };
}

const STANDALONE_QUERY = '(display-mode: standalone)';

/**
 * Bridges the browser to the "Instalar app" button (#13): the captured
 * `beforeinstallprompt` (`installPromptStore.ts`), whether the page already
 * runs installed, and the browser itself, decided by the pure `installMode`.
 * `null` means the button is hidden.
 */
export function useInstallPrompt(
  store: InstallPromptStore = startInstallPromptCapture(),
  host: InstallHost = window as InstallHost,
): InstallOffer | null {
  const { promptAvailable, installed } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const standalone = useDisplayModeStandalone(host);
  const onInstall = useCallback(() => void store.prompt(), [store]);

  const mode = installMode({
    displayModeStandalone: standalone,
    navigatorStandalone: host.navigator.standalone,
    userAgent: host.navigator.userAgent,
    vendor: host.navigator.vendor,
    maxTouchPoints: host.navigator.maxTouchPoints,
    promptAvailable,
    installed,
  });
  if (mode === 'none') return null;
  if (mode === 'prompt') return { kind: 'prompt', onInstall };
  return { kind: mode };
}

function useDisplayModeStandalone(host: InstallHost): boolean {
  const [standalone, setStandalone] = useState(() => host.matchMedia?.(STANDALONE_QUERY).matches ?? false);
  useEffect(() => {
    const query = host.matchMedia?.(STANDALONE_QUERY);
    if (!query) return;
    const onChange = () => setStandalone(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [host]);
  return standalone;
}
