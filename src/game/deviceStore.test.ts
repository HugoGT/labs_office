import { describe, expect, it, vi } from 'vitest';
import { NO_DEVICE_PREFERENCES } from './mediaDevices';
import { createDeviceStore, DEVICES_KEY, type DeviceStorage } from './deviceStore';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
  } satisfies DeviceStorage;
}

const throwing = (): never => {
  throw new DOMException('storage is blocked', 'SecurityError');
};

describe('createDeviceStore: microphone, speaker and camera chosen per browser (#284)', () => {
  it('starts with nothing picked: every kind follows the system', () => {
    expect(createDeviceStore(memoryStorage()).load()).toEqual(NO_DEVICE_PREFERENCES);
  });

  it('remembers each kind apart, under one key', () => {
    const storage = memoryStorage();
    const store = createDeviceStore(storage);

    store.save('audioinput', 'headset');
    store.save('audiooutput', 'altavoces');

    expect(DEVICES_KEY).toBe('oficina.devices');
    expect(createDeviceStore(storage).load()).toEqual({
      audioinput: 'headset',
      audiooutput: 'altavoces',
      videoinput: null,
    });
  });

  it('ignores whatever else the key holds', () => {
    const storage = memoryStorage({
      [DEVICES_KEY]: JSON.stringify({ audioinput: 7, videoinput: 'cam', otra: 'x' }),
    });

    expect(createDeviceStore(storage).load()).toEqual({ ...NO_DEVICE_PREFERENCES, videoinput: 'cam' });
  });

  it('survives a value that is not JSON', () => {
    const storage = memoryStorage({ [DEVICES_KEY]: '{roto' });

    expect(createDeviceStore(storage).load()).toEqual(NO_DEVICE_PREFERENCES);
  });

  it('a browser that blocks storage picks nothing and never throws', () => {
    const store = createDeviceStore({ getItem: throwing, setItem: throwing });

    expect(() => store.save('videoinput', 'cam')).not.toThrow();
    expect(store.load()).toEqual(NO_DEVICE_PREFERENCES);
  });

  it('works without storage at all', () => {
    const store = createDeviceStore(null);

    store.save('videoinput', 'cam');

    expect(store.load()).toEqual(NO_DEVICE_PREFERENCES);
  });
});
