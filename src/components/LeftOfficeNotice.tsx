import { useId } from 'react';
import styles from './LeftOfficeNotice.module.css';

/**
 * Why the office is gone (#78): the user left it, or the same account opened
 * it somewhere else and this tab was replaced. Same notice and same way back,
 * only the wording changes.
 */
export type LeftOfficeReason = 'left' | 'replaced';

export interface LeftOfficeNoticeProps {
  reason?: LeftOfficeReason;
  onReenter: () => void;
}

const COPY: Record<LeftOfficeReason, { title: string; action: string }> = {
  left: { title: 'Saliste de la oficina', action: 'Volver a ingresar' },
  // Re-entering is a fresh join, which replaces the other tab in turn: the
  // last one to enter always wins (#78).
  replaced: { title: 'Abriste la oficina en otra pestaña o dispositivo', action: 'Usar aquí' },
};

/**
 * Shown instead of the office after leaving it (#66). The office is already
 * unmounted by then, so nobody sees or hears this user; the auth session is
 * untouched, which is why re-entering needs no login.
 */
export function LeftOfficeNotice({ reason = 'left', onReenter }: LeftOfficeNoticeProps) {
  const titleId = useId();
  const copy = COPY[reason];

  return (
    <div className={styles.backdrop}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <p id={titleId} className={styles.title}>
          {copy.title}
        </p>
        <button type="button" className={styles.btn} onClick={onReenter} autoFocus>
          {copy.action}
        </button>
      </div>
    </div>
  );
}
