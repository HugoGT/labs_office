import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import styles from './ArtPieceDialog.module.css';

export interface ArtPieceDialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The full-screen dialog an art piece is previewed in (#122), like the "Mi
 * personaje" one: it takes the focus, and over the office nothing typed in it
 * reaches `window`, where the office listens (the arrow keys walk the avatar,
 * the sidebar closes on Escape). Escape only closes the dialog.
 */
export function ArtPieceDialog({ title, onClose, children }: ArtPieceDialogProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div ref={rootRef} className={styles.screen} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={handleKey}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Cerrar
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
