import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createOfficeBridge } from '../game/officeBridge';
import { useOfficeBridge } from './useOfficeBridge';

describe('useOfficeBridge', () => {
  it('expone el estado inicial vacio', () => {
    const bridge = createOfficeBridge();

    const { result } = renderHook(() => useOfficeBridge(bridge));

    expect(result.current.nearby).toEqual([]);
    expect(result.current.room).toBeNull();
    expect(result.current.menu).toBeNull();
  });

  it('refleja los eventos emitidos por el puente (nearby, room, npcmenu)', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useOfficeBridge(bridge));

    act(() => {
      bridge.emit('nearby', { names: ['Ana', 'Beto'] });
      bridge.emit('room', { room: 'Cafetería' });
      bridge.emit('npcmenu', {
        id: 3,
        name: 'Pablo',
        status: 'Disponible',
        statusCode: 'g',
        x: 10,
        y: 20,
      });
    });

    expect(result.current.nearby).toEqual(['Ana', 'Beto']);
    expect(result.current.room).toBe('Cafetería');
    expect(result.current.menu).toEqual({
      id: 3,
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
      bridge.emit('npcmenu', {
        id: 1,
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
      bridge.emit('nearby', { names: ['Ana'] });
    });

    expect(result.current.nearby).toEqual([]);
  });
});
