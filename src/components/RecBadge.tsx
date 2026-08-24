import styles from './RecBadge.module.css';

export interface RecBadgeProps {
  visible: boolean;
}

/**
 * Insignia de grabacion activa, portada de `#recbadge` (`index.html`,
 * `app.js:546,554`). Visibilidad por render condicional, no `style.display`
 * (D4): Vitest 4 no procesa CSS bajo jsdom, asi que el estado debe ser
 * comprobable por presencia/ausencia en el arbol.
 */
export function RecBadge({ visible }: RecBadgeProps) {
  if (!visible) return null;

  return (
    <div className={styles.badge}>
      <span className={styles.dot} />
      REC — Grabando esta sala (todos los participantes son notificados)
    </div>
  );
}
