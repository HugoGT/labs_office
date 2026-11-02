import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePersistedColors } from './usePersistedColors';

const KEY = 'test:colors';

describe('usePersistedColors', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts empty and keeps a chosen color across a remount (a reload)', () => {
    const first = renderHook(() => usePersistedColors<string>(KEY));
    expect(first.result.current[0]).toEqual({});
    act(() => first.result.current[1]('desk-painted', '#c0392b'));
    expect(first.result.current[0]).toEqual({ 'desk-painted': '#c0392b' });
    first.unmount();

    const second = renderHook(() => usePersistedColors<string>(KEY));
    expect(second.result.current[0]).toEqual({ 'desk-painted': '#c0392b' });
  });

  it('keeps each key apart and never reads another scope', () => {
    const office = renderHook(() => usePersistedColors<string>('office'));
    act(() => office.result.current[1]('desk-painted', '#3c6ac8'));
    const desk = renderHook(() => usePersistedColors<string>('desk'));
    expect(desk.result.current[0]).toEqual({});
  });

  it('drops anything stored that is not a #rrggbb string, and survives broken JSON', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ a: '#c0392b', b: 'red', c: 7, d: '#12345' }));
    expect(renderHook(() => usePersistedColors<string>(KEY)).result.current[0]).toEqual({ a: '#c0392b' });
    window.localStorage.setItem(KEY, '{nope');
    expect(renderHook(() => usePersistedColors<string>(KEY)).result.current[0]).toEqual({});
    window.localStorage.setItem(KEY, '[1]');
    expect(renderHook(() => usePersistedColors<string>(KEY)).result.current[0]).toEqual({});
  });

  it('still works for the page when the store is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => usePersistedColors<string>(KEY));
    act(() => result.current[1]('desk-painted', '#c0392b'));
    expect(result.current[0]).toEqual({ 'desk-painted': '#c0392b' });
  });
});
