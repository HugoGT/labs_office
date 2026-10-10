import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserCameraFilterStore,
  CAMERA_FILTER_KEY,
  createCameraFilterStore,
  type CameraFilterStorage,
} from './cameraFilterStore';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
  } satisfies CameraFilterStorage;
}

const throwing = (): never => {
  throw new DOMException('storage is blocked', 'SecurityError');
};

describe('createCameraFilterStore: the camera filter chosen per browser', () => {
  it.each(['none', 'blur-light', 'blur-strong'] as const)('round-trips %s under one key', (filter) => {
    const storage = memoryStorage();

    createCameraFilterStore(storage).save(filter);

    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(CAMERA_FILTER_KEY, filter);
    expect(createCameraFilterStore(storage).load()).toBe(filter);
  });

  it('uses its own key next to the zoom one', () => {
    expect(CAMERA_FILTER_KEY).toBe('oficina.cameraFilter');
  });

  it('reads the single blur stored before there were two strengths as the light one', () => {
    const storage = memoryStorage({ [CAMERA_FILTER_KEY]: 'blur' });

    expect(createCameraFilterStore(storage).load()).toBe('blur-light');
  });

  it.each([
    ['nothing stored', null],
    ['an empty string', ''],
    ['another case', 'Blur'],
    ['another case of a blur', 'BLUR-LIGHT'],
    ['an unknown filter', 'virtual-background'],
    ['JSON', '"blur"'],
  ])('loads no filter when it finds %s', (_name, stored) => {
    const storage = memoryStorage(stored === null ? {} : { [CAMERA_FILTER_KEY]: stored });

    expect(createCameraFilterStore(storage).load()).toBe('none');
  });

  it('loads no filter and does not throw when reading is blocked', () => {
    const storage = { getItem: vi.fn(throwing), setItem: vi.fn() };

    expect(createCameraFilterStore(storage).load()).toBe('none');
  });

  it('does not throw when writing is blocked', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(throwing) };

    expect(() => createCameraFilterStore(storage).save('blur-strong')).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it('without storage it loads no filter and saving does nothing', () => {
    const store = createCameraFilterStore(null);

    expect(store.load()).toBe('none');
    expect(() => store.save('blur-strong')).not.toThrow();
  });
});

describe('browserCameraFilterStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('keeps the filter in this browser local storage', () => {
    browserCameraFilterStore().save('blur-strong');

    expect(window.localStorage.getItem(CAMERA_FILTER_KEY)).toBe('blur-strong');
    expect(browserCameraFilterStore().load()).toBe('blur-strong');
  });

  it('falls back to no filter when the browser denies access to its storage', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(throwing);

    const store = browserCameraFilterStore();

    expect(store.load()).toBe('none');
    expect(() => store.save('blur-light')).not.toThrow();
  });
});
