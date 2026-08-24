import type { ReactNode } from 'react';
import styles from './Toast.module.css';

export interface ToastProps {
  message: ReactNode | null;
}

/**
 * Notificacion flotante, portada de `#toast` (`app.js:520-526`, `index.html`).
 * Composicion via children, nunca `dangerouslySetInnerHTML` (D4, spec
 * "No HTML string injection in the HUD"): el llamador compone fragmentos
 * como `<>Entraste a <b>{room}</b>...</>` en vez de concatenar strings.
 */
export function Toast({ message }: ToastProps) {
  if (message === null) return null;

  return <div className={styles.toast}>{message}</div>;
}
