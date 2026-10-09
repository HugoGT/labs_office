import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { zoomView, type ZoomAction } from '../game/mapZoom';
import { createOfficeBridge } from '../game/officeBridge';
import { useMapZoom } from './useMapZoom';

describe('useMapZoom (map-zoom)', () => {
  it('starts at the default zoom 2 (2x) until the scene announces its zoom', () => {
    const { result } = renderHook(() => useMapZoom(createOfficeBridge()));

    expect(result.current.view).toEqual(zoomView(2));
  });

  it('follows the zoom the scene announces, whatever input caused it', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useMapZoom(bridge));

    act(() => bridge.emit('zoomchanged', zoomView(0.5)));
    expect(result.current.view).toEqual({ zoom: 0.5, canZoomIn: true, canZoomOut: false });

    act(() => bridge.emit('zoomchanged', zoomView(4)));
    expect(result.current.view).toEqual({ zoom: 4, canZoomIn: false, canZoomOut: true });
  });

  it('asks the scene for each action with one command', () => {
    const bridge = createOfficeBridge();
    const commands: ZoomAction[] = [];
    bridge.onCommand('zoom', ({ action }) => commands.push(action));
    const { result } = renderHook(() => useMapZoom(bridge));

    act(() => result.current.zoomIn());
    act(() => result.current.zoomOut());
    act(() => result.current.reset());

    expect(commands).toEqual(['in', 'out', 'reset']);
  });

  it('does not move the view by itself: only the scene confirms a zoom', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useMapZoom(bridge));

    act(() => result.current.zoomIn());

    expect(result.current.view).toEqual(zoomView(2));
  });

  it('stops reacting to the scene after unmounting', () => {
    const bridge = createOfficeBridge();
    const { result, unmount } = renderHook(() => useMapZoom(bridge));

    unmount();
    act(() => bridge.emit('zoomchanged', zoomView(3)));

    expect(result.current.view).toEqual(zoomView(2));
  });
});
