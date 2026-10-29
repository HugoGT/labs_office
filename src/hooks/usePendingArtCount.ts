import { useEffect, useState } from 'react';
import type { ArtReviewPort } from '../dashboard/artReviewPort';

/** How often the count is read again: a piece sent while an admin is in the office shows up within a minute. */
export const PENDING_ART_POLL_MS = 60_000;

/**
 * How many art contributions wait for review (#122), for the badge of an
 * admin's "Revisión de arte". Without a port (anyone who does not review) it
 * asks for nothing and the count is 0. A request that fails leaves the last
 * count and the next poll tries again. `report` is for the queue itself: it
 * knows the number the moment a piece is approved or rejected.
 */
export function usePendingArtCount(reviews: ArtReviewPort | null): { count: number; report: (count: number) => void } {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (reviews === null) {
      setCount(0);
      return undefined;
    }
    let alive = true;
    const refresh = (): void => {
      reviews
        .list('pending')
        .then((pending) => {
          if (alive) setCount(pending.length);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, PENDING_ART_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [reviews]);

  return { count, report: setCount };
}
