import { useCallback, useEffect, useRef, useState } from 'react';
import type { OfficeBridge, OfficeEventMap } from '../game/officeBridge';

/**
 * How long the banner outlives the pointer leaving its desk: the time to
 * reach the banner, which the canvas does not see as the desk any more.
 */
export const DESK_BANNER_GRACE_MS = 200;

export type DeskHover = NonNullable<OfficeEventMap['deskhover']>;

export interface UseDeskHoverResult {
  hover: DeskHover | null;
  /** Pack portraits by session (`characterportraits`), for the occupant's face. */
  portraits: Record<string, string>;
  /** The pointer entered the banner: it stays while it is there. */
  enter: () => void;
  /** The pointer left the banner: it hides after the grace unless a desk is hovered again. */
  leave: () => void;
  /** Hides it at once (an action was taken). */
  dismiss: () => void;
}

/**
 * The desk the scene says is under the pointer (`deskhover`), kept a moment
 * after it leaves and for as long as the pointer is on the banner itself.
 */
export function useDeskHover(bridge: OfficeBridge): UseDeskHoverResult {
  const [hover, setHover] = useState<DeskHover | null>(null);
  const [portraits, setPortraits] = useState<Record<string, string>>({});
  const onBanner = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!onBanner.current) setHover(null);
    }, DESK_BANNER_GRACE_MS);
  }, [cancelHide]);

  useEffect(() => {
    const offHover = bridge.on('deskhover', (payload) => {
      if (payload === null) {
        scheduleHide();
        return;
      }
      cancelHide();
      setHover(payload);
    });
    const offPortraits = bridge.on('characterportraits', (payload) => setPortraits(payload.bySession));
    return () => {
      offHover();
      offPortraits();
      cancelHide();
    };
  }, [bridge, scheduleHide, cancelHide]);

  const enter = useCallback(() => {
    onBanner.current = true;
    cancelHide();
  }, [cancelHide]);

  const leave = useCallback(() => {
    onBanner.current = false;
    scheduleHide();
  }, [scheduleHide]);

  const dismiss = useCallback(() => {
    onBanner.current = false;
    cancelHide();
    setHover(null);
  }, [cancelHide]);

  return { hover, portraits, enter, leave, dismiss };
}
