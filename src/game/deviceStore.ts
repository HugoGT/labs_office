import { DEVICE_KINDS, NO_DEVICE_PREFERENCES, type DeviceKind, type DevicePreferences } from './mediaDevices';

/** One key for the whole browser, like the camera filter: these are this machine's devices. */
export const DEVICES_KEY = 'oficina.devices';

export interface DeviceStore {
  load(): DevicePreferences;
  save(kind: DeviceKind, deviceId: string): void;
}

/** The slice of `Storage` the store needs, so tests do not need a real one. */
export interface DeviceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Same rules as `cameraFilterStore.ts`: storage can hold anything and can
 * refuse to answer, so reading falls back to the system's devices and
 * writing is best effort.
 */
export function createDeviceStore(storage: DeviceStorage | null): DeviceStore {
  function load(): DevicePreferences {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(DEVICES_KEY) ?? 'null');
      if (typeof parsed !== 'object' || parsed === null) return NO_DEVICE_PREFERENCES;
      const stored = parsed as Record<string, unknown>;
      const preferences: Record<DeviceKind, string | null> = { ...NO_DEVICE_PREFERENCES };
      for (const kind of DEVICE_KINDS) {
        const deviceId = stored[kind];
        if (typeof deviceId === 'string' && deviceId !== '') preferences[kind] = deviceId;
      }
      return preferences;
    } catch {
      return NO_DEVICE_PREFERENCES;
    }
  }

  return {
    load,
    save(kind, deviceId) {
      try {
        storage?.setItem(DEVICES_KEY, JSON.stringify({ ...load(), [kind]: deviceId }));
      } catch {
        // Not persisted: the next load uses the system's device.
      }
    },
  };
}

/** `window.localStorage` itself throws when the browser blocks storage. */
export function browserDeviceStore(): DeviceStore {
  try {
    return createDeviceStore(window.localStorage);
  } catch {
    return createDeviceStore(null);
  }
}
