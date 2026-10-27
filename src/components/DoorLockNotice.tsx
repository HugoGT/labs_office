import type { DoorLockNotice as DoorLockState } from '../game/officeDoors';
import styles from './DoorLockNotice.module.css';

export type DoorLockNoticeProps = DoorLockState;

/**
 * The hint of the lock key (#223, S15, #233) above the central bar, for as
 * long as the player stands next to a door: X locks that door, or unlocks it
 * when it is locked. The scene decides it (`doorLockNotice`), so the hint
 * never promises what X will not do. Presentational: present or absent (D4).
 */
export function DoorLockNotice({ lockable }: DoorLockNoticeProps) {
  if (lockable === null) return null;
  return (
    <div className={styles.stack}>
      <p role="status" aria-live="polite" className={styles.pill}>
        {lockable === 'unlock' ? 'Pulsa X para desbloquear la puerta' : 'Pulsa X para bloquear la puerta'}
      </p>
    </div>
  );
}
