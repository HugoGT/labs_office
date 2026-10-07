import { isZoomStop, ZOOM_DEFAULT, type ZoomStore } from './mapZoom';

/** One key for the whole browser: the zoom is a view preference, not an account one. */
export const MAP_ZOOM_KEY = 'oficina.mapZoom';

/** The slice of `Storage` the zoom needs, so tests do not need a real one. */
export interface ZoomStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Storage is untrusted twice over: it can hold anything (a hand-edited or stale
 * value) and it can refuse to answer (private mode, blocked cookies). Reading
 * falls back to 100% and writing is best effort, so zoom never breaks the app.
 */
export function createZoomStore(storage: ZoomStorage | null): ZoomStore {
  return {
    load() {
      try {
        const zoom = Number(storage?.getItem(MAP_ZOOM_KEY));
        return isZoomStop(zoom) ? zoom : ZOOM_DEFAULT;
      } catch {
        return ZOOM_DEFAULT;
      }
    },
    save(zoom) {
      try {
        storage?.setItem(MAP_ZOOM_KEY, String(zoom));
      } catch {
        // Not persisted: the next load starts at 100%.
      }
    },
  };
}

/** `window.localStorage` itself throws when the browser blocks storage. */
export function browserZoomStore(): ZoomStore {
  try {
    return createZoomStore(window.localStorage);
  } catch {
    return createZoomStore(null);
  }
}
