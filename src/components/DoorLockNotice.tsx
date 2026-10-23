import { useEffect, useState } from 'react';
import type { DoorLockNotice as DoorLockState } from '../game/officeDoors';
import styles from './DoorLockNotice.module.css';

/** How long the lock hint stays up once the player comes into range (#223, S15). */
export const DOOR_LOCK_HINT_MS = 10_000;

export interface DoorLockNoticeProps extends DoorLockState {
  /** Overridable so a test need not wait ten seconds. */
  hintMs?: number;
}

/**
 * Two pills above the central bar (#223, S15): the hint of the lock key
 * while the player stands where X would lock or unlock a room, which fades
 * after `hintMs` even if they stay and comes back with the next visit; and
 * «Sala bloqueada», for as long as they are inside a locked room. The scene
 * decides both (`doorLockNotice`), so the hint never promises what X will
 * not do. Presentational: the timer is the only state, and each pill is
 * present or absent (D4).
 */
export function DoorLockNotice({ lockable, insideLocked, hintMs = DOOR_LOCK_HINT_MS }: DoorLockNoticeProps) {
  const inRange = lockable !== null;
  const [expired, setExpired] = useState(false);

  // Keyed on being in range, not on lock/unlock: pressing X flips the text
  // but is not a new visit, so it neither restarts nor cancels the countdown.
  useEffect(() => {
    setExpired(false);
    if (!inRange) return undefined;
    const timer = setTimeout(() => setExpired(true), hintMs);
    return () => clearTimeout(timer);
  }, [inRange, hintMs]);

  const hint = inRange && !expired;
  if (!hint && !insideLocked) return null;

  return (
    <div className={styles.stack}>
      {hint ? (
        <p role="status" aria-live="polite" className={styles.pill}>
          {lockable === 'unlock' ? 'Pulsa X para desbloquear la sala' : 'Pulsa X para bloquear la sala'}
        </p>
      ) : null}
      {insideLocked ? (
        <p role="status" aria-live="polite" className={styles.pill}>
          Sala bloqueada
        </p>
      ) : null}
    </div>
  );
}
