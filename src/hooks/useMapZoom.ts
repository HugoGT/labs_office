/**
 * Bridges the map zoom to React (map-zoom). The scene owns the zoom: this
 * hook only mirrors the stop it announces and asks for changes by command, so
 * the control also follows the wheel and the keys. `zoomchanged` has no
 * replay: `OfficeShell` mounts this hook in the same commit that starts the
 * game, and the scene announces only after Phaser boots.
 */

import { useCallback, useEffect, useState } from 'react';
import { ZOOM_DEFAULT, zoomView, type ZoomAction, type ZoomView } from '../game/mapZoom';
import type { OfficeBridge } from '../game/officeBridge';

export interface UseMapZoomResult {
  view: ZoomView;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

export function useMapZoom(bridge: OfficeBridge): UseMapZoomResult {
  const [view, setView] = useState<ZoomView>(() => zoomView(ZOOM_DEFAULT));

  useEffect(() => bridge.on('zoomchanged', setView), [bridge]);

  const ask = useCallback((action: ZoomAction) => bridge.emitCommand('zoom', { action }), [bridge]);
  const zoomIn = useCallback(() => ask('in'), [ask]);
  const zoomOut = useCallback(() => ask('out'), [ask]);
  const reset = useCallback(() => ask('reset'), [ask]);

  return { view, zoomIn, zoomOut, reset };
}
