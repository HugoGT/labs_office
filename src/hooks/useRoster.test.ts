import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createOfficeBridge } from '../game/officeBridge';
import { useRoster } from './useRoster';

describe('useRoster (#74)', () => {
  it('empieza vacio antes de cualquier evento "roster"', () => {
    const bridge = createOfficeBridge();

    const { result } = renderHook(() => useRoster(bridge));

    expect(result.current).toEqual([]);
  });

  it('devuelve la ultima lista emitida por el puente', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useRoster(bridge));

    act(() => bridge.emit('roster', { peers: [{ sessionId: 'a', name: 'Ana', status: 'g' }] }));

    expect(result.current).toEqual([{ sessionId: 'a', name: 'Ana', status: 'g' }]);
  });

  it('deja de reaccionar a "roster" tras desmontar', () => {
    const bridge = createOfficeBridge();
    const { result, unmount } = renderHook(() => useRoster(bridge));

    unmount();
    act(() => bridge.emit('roster', { peers: [{ sessionId: 'a', name: 'Ana', status: 'g' }] }));

    expect(result.current).toEqual([]);
  });
});
