import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import styles from './ArtPieceDialog.module.css';

export interface ArtPieceDialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons in the bottom right, to decide something about what it shows; they are the way out, so there is no "Cerrar" beside them. */
  actions?: ReactNode;
}

/** A button of the dialog's bottom bar: `accept` is blue like "Guardar" in "Mi personaje", `cancel` red like the delete buttons. */
export function DialogButton({ tone, className, ...rest }: { tone: 'accept' | 'cancel' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} data-tone={tone} className={`${styles.button} ${className ?? ''}`.trim()} />;
}

/**
 * The full-screen dialog an art piece is previewed in (#122), like the "Mi
 * personaje" one, its name in the bottom left and its buttons in the bottom right: it takes the focus, and over the office nothing typed in it
 * reaches `window`, where the office listens (the arrow keys walk the avatar,
 * the sidebar closes on Escape). Escape only closes the dialog.
 */
export function ArtPieceDialog({ title, onClose, children, actions }: ArtPieceDialogProps) {
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
        <div className={styles.body}>{children}</div>
        <div className={styles.footer}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          <div className={styles.actions}>
            {actions ?? (
              <button type="button" className={styles.button} onClick={onClose}>
                Cerrar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
