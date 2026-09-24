import styles from './ExitControls.module.css';

export interface ExitControlsProps {
  /** `null` without a session (auth off): there is nobody to sign out. */
  onSignOut: (() => void) | null;
  /** `null` when nobody above the office can take the user out of it. */
  onLeaveOffice: (() => void) | null;
}

/**
 * Ways out of the office (#66), in the bottom right corner, away from the
 * call controls so neither is pressed by mistake. Presentational (D3): it
 * does not know about the auth port or who mounts the office.
 */
export function ExitControls({ onSignOut, onLeaveOffice }: ExitControlsProps) {
  if (onSignOut === null && onLeaveOffice === null) return null;

  return (
    <div className={styles.controls}>
      {onSignOut && (
        <button type="button" className={styles.btn} onClick={onSignOut}>
          🔑 Cerrar sesión
        </button>
      )}
      {onLeaveOffice && (
        <button type="button" className={styles.btn} onClick={onLeaveOffice}>
          🚪 Salir de la oficina
        </button>
      )}
    </div>
  );
}
