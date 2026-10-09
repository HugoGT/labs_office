import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZOOM_STOPS } from './mapZoom';
import { browserZoomStore, createZoomStore, MAP_ZOOM_KEY, type ZoomStorage } from './zoomStore';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
  } satisfies ZoomStorage;
}

const throwing = (): never => {
  throw new DOMException('storage is blocked', 'SecurityError');
};

describe('createZoomStore: the zoom chosen per browser (map-zoom)', () => {
  it.each(ZOOM_STOPS)('round-trips the %s stop under one key', (stop) => {
    const storage = memoryStorage();
    const store = createZoomStore(storage);

    store.save(stop);

    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(MAP_ZOOM_KEY, String(stop));
    expect(createZoomStore(storage).load()).toBe(stop);
  });

  it.each([
    ['nothing stored', null],
    ['text', 'abc'],
    ['an empty string', ''],
    ['a number that is not a stop', '1.3'],
    ['the retired 0.75 stop', '0.75'],
    ['the retired 1.5 stop', '1.5'],
    ['the retired 2.25 stop', '2.25'],
    ['zero', '0'],
    ['a negative', '-1'],
    ['infinity', 'Infinity'],
  ])('loads the default when it finds %s', (_name, stored) => {
    const storage = memoryStorage(stored === null ? {} : { [MAP_ZOOM_KEY]: stored });

    expect(createZoomStore(storage).load()).toBe(2);
  });

  it('loads the default and does not throw when reading is blocked', () => {
    const storage = { getItem: vi.fn(throwing), setItem: vi.fn() };

    expect(createZoomStore(storage).load()).toBe(2);
    expect(storage.getItem).toHaveBeenCalledOnce();
  });

  it('does not throw when writing is blocked', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(throwing) };

    expect(() => createZoomStore(storage).save(2)).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it('without storage it loads the default and saving does nothing', () => {
    const store = createZoomStore(null);

    expect(store.load()).toBe(2);
    expect(() => store.save(3)).not.toThrow();
  });
});

describe('browserZoomStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('keeps the zoom in this browser local storage', () => {
    browserZoomStore().save(1);

    expect(window.localStorage.getItem(MAP_ZOOM_KEY)).toBe('1');
    expect(browserZoomStore().load()).toBe(1);
  });

  it('falls back to the default when the browser denies access to its storage', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(throwing);

    const store = browserZoomStore();

    expect(store.load()).toBe(2);
    expect(() => store.save(3)).not.toThrow();
  });
});
