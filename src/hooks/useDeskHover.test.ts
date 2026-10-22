import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfficeBridge } from '../game/officeBridge';
import { DESK_BANNER_GRACE_MS, useDeskHover } from './useDeskHover';

const HOVER = { deskId: 'd1', x: 120, y: 80 };

describe('useDeskHover', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('follows the desk the scene says is under the pointer', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useDeskHover(bridge));

    act(() => bridge.emit('deskhover', HOVER));
    expect(result.current.hover).toEqual(HOVER);

    act(() => bridge.emit('deskhover', { ...HOVER, x: 140 }));
    expect(result.current.hover).toEqual({ ...HOVER, x: 140 });
  });

  it('keeps the banner a moment after the pointer leaves the desk, then hides it', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useDeskHover(bridge));
    act(() => bridge.emit('deskhover', HOVER));

    act(() => bridge.emit('deskhover', null));
    expect(result.current.hover).toEqual(HOVER);

    act(() => vi.advanceTimersByTime(DESK_BANNER_GRACE_MS));
    expect(result.current.hover).toBeNull();
  });

  it('keeps it while the pointer is on the banner, and hides it once it leaves', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useDeskHover(bridge));
    act(() => bridge.emit('deskhover', HOVER));

    act(() => {
      bridge.emit('deskhover', null);
      result.current.enter();
      vi.advanceTimersByTime(DESK_BANNER_GRACE_MS * 3);
    });
    expect(result.current.hover).toEqual(HOVER);

    act(() => {
      result.current.leave();
      vi.advanceTimersByTime(DESK_BANNER_GRACE_MS);
    });
    expect(result.current.hover).toBeNull();
  });

  it('a desk hovered again within the grace stays', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useDeskHover(bridge));
    act(() => bridge.emit('deskhover', HOVER));

    act(() => {
      bridge.emit('deskhover', null);
      bridge.emit('deskhover', HOVER);
      vi.advanceTimersByTime(DESK_BANNER_GRACE_MS * 2);
    });

    expect(result.current.hover).toEqual(HOVER);
  });

  it('dismiss hides it at once, even with the pointer on it', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useDeskHover(bridge));
    act(() => bridge.emit('deskhover', HOVER));

    act(() => {
      result.current.enter();
      result.current.dismiss();
    });

    expect(result.current.hover).toBeNull();
  });

  it('keeps the latest pack portrait of each session', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useDeskHover(bridge));

    act(() => bridge.emit('characterportraits', { bySession: { yo: 'data:image/png;base64,AA' } }));

    expect(result.current.portraits).toEqual({ yo: 'data:image/png;base64,AA' });
  });
});
