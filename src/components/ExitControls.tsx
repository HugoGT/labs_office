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
      {onSignOut && <ExitButton emoji="🔑" label="Cerrar sesión" onClick={onSignOut} />}
      {onLeaveOffice && <ExitButton emoji="🚪" label="Salir" onClick={onLeaveOffice} />}
    </div>
  );
}

/**
 * Narrow screens show only the emoji (#88), so the name is also carried by
 * `aria-label` (screen readers) and `title` (hover) instead of the text alone.
 */
function ExitButton({ emoji, label, onClick }: { emoji: string; label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.btn} aria-label={label} title={label} onClick={onClick}>
      <span aria-hidden="true">{emoji}</span>
      <span className={styles.label}>{label}</span>
    </button>
  );
}
