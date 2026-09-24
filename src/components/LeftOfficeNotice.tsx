import { useId } from 'react';
import styles from './LeftOfficeNotice.module.css';

export interface LeftOfficeNoticeProps {
  onReenter: () => void;
}

/**
 * Shown instead of the office after leaving it (#66). The office is already
 * unmounted by then, so nobody sees or hears this user; the auth session is
 * untouched, which is why re-entering needs no login.
 */
export function LeftOfficeNotice({ onReenter }: LeftOfficeNoticeProps) {
  const titleId = useId();

  return (
    <div className={styles.backdrop}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <p id={titleId} className={styles.title}>
          Saliste de la oficina
        </p>
        <button type="button" className={styles.btn} onClick={onReenter} autoFocus>
          Volver a ingresar
        </button>
      </div>
    </div>
  );
}
