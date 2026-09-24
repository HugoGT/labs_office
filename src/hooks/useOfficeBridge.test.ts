import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createOfficeBridge } from '../game/officeBridge';
import { useOfficeBridge } from './useOfficeBridge';

describe('useOfficeBridge', () => {
  it('expone el estado inicial vacio', () => {
    const bridge = createOfficeBridge();

    const { result } = renderHook(() => useOfficeBridge(bridge));

    expect(result.current.room).toBeNull();
    expect(result.current.menu).toBeNull();
  });

  it('refleja los eventos emitidos por el puente (room, peermenu)', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useOfficeBridge(bridge));

    act(() => {
      bridge.emit('room', { spaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Cafetería' });
      bridge.emit('peermenu', {
        sessionId: 'sess-3',
        name: 'Pablo',
        status: 'Disponible',
        statusCode: 'g',
        x: 10,
        y: 20,
      });
    });

    expect(result.current.room).toBe('Cafetería');
    expect(result.current.menu).toEqual({
      sessionId: 'sess-3',
      name: 'Pablo',
      status: 'Disponible',
      statusCode: 'g',
      x: 10,
      y: 20,
    });
  });

  it('closeMenu limpia el menu localmente', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useOfficeBridge(bridge));

    act(() => {
      bridge.emit('peermenu', {
        sessionId: 'sess-1',
        name: 'Ana',
        status: 'Disponible',
        statusCode: 'g',
        x: 0,
        y: 0,
      });
    });
    expect(result.current.menu).not.toBeNull();

    act(() => result.current.closeMenu());

    expect(result.current.menu).toBeNull();
  });

  it('deja de reaccionar a eventos tras desmontar', () => {
    const bridge = createOfficeBridge();
    const { result, unmount } = renderHook(() => useOfficeBridge(bridge));

    unmount();

    act(() => {
      bridge.emit('room', { spaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Cafetería' });
    });

    expect(result.current.room).toBeNull();
  });

  it('exposes the current spaceId next to the room name (#5)', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useOfficeBridge(bridge));
    expect(result.current.spaceId).toBeNull();

    act(() => bridge.emit('room', { spaceId: 'sala-1', name: 'Sala' }));
    expect(result.current.spaceId).toBe('sala-1');

    act(() => bridge.emit('room', { spaceId: null, name: null }));
    expect(result.current.spaceId).toBeNull();
  });

  it('exposes the active recordings map, replaced whole on every event (#5)', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useOfficeBridge(bridge));
    expect(result.current.recordings).toEqual({});

    act(() => bridge.emit('recordings', { active: { a: { startedBy: 'ses-1', startedAt: 1 } } }));
    expect(result.current.recordings).toEqual({ a: { startedBy: 'ses-1', startedAt: 1 } });

    act(() => bridge.emit('recordings', { active: {} }));
    expect(result.current.recordings).toEqual({});
  });

  it('exposes the own Colyseus sessionId from the voice snapshot (#5)', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useOfficeBridge(bridge));
    expect(result.current.selfSessionId).toBeNull();

    act(() =>
      bridge.emit('voice', { selfSessionId: 'ses-me', selfName: 'Ana', peers: [], spaceId: null }),
    );
    expect(result.current.selfSessionId).toBe('ses-me');
  });
});
