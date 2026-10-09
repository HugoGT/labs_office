import { DEFAULT_CAMERA_FILTER, isCameraFilter, type CameraFilter } from './cameraFilter';

/** One key for the whole browser, like the map zoom: it is this device's camera. */
export const CAMERA_FILTER_KEY = 'oficina.cameraFilter';

export interface CameraFilterStore {
  load(): CameraFilter;
  save(filter: CameraFilter): void;
}

/** The slice of `Storage` the filter needs, so tests do not need a real one. */
export interface CameraFilterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Same rules as `zoomStore.ts`: storage can hold anything and can refuse to
 * answer, so reading falls back to no filter and writing is best effort.
 */
export function createCameraFilterStore(storage: CameraFilterStorage | null): CameraFilterStore {
  return {
    load() {
      try {
        const filter = storage?.getItem(CAMERA_FILTER_KEY);
        return isCameraFilter(filter) ? filter : DEFAULT_CAMERA_FILTER;
      } catch {
        return DEFAULT_CAMERA_FILTER;
      }
    },
    save(filter) {
      try {
        storage?.setItem(CAMERA_FILTER_KEY, filter);
      } catch {
        // Not persisted: the next load starts without a filter.
      }
    },
  };
}

/** `window.localStorage` itself throws when the browser blocks storage. */
export function browserCameraFilterStore(): CameraFilterStore {
  try {
    return createCameraFilterStore(window.localStorage);
  } catch {
    return createCameraFilterStore(null);
  }
}
