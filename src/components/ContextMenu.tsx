import { useEffect, useRef } from 'react';
import type { OfficeEventMap } from '../game/officeBridge';
import { DO_NOT_DISTURB } from '../game/officeProtocol';
import { statusCssColor } from '../game/presence';
import styles from './ContextMenu.module.css';

export type PeerMenuAction = 'call' | 'profile';

export interface ContextMenuProps {
  menu: OfficeEventMap['peermenu'] | null;
  onAction: (action: PeerMenuAction, menu: OfficeEventMap['peermenu']) => void;
  onClose: () => void;
}

/**
 * Menu contextual al hacer clic en un companero real, portado de `#ctxmenu`
 * (`index.html`, `app.js:588-608`). Se cierra con Escape o un clic fuera de
 * si mismo. "Ir a su escritorio" se fue con los NPCs simulados: una persona
 * real no tiene escritorio asignado en el mapa (D2).
 */
export function ContextMenu({ menu, onAction, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return undefined;

    function handlePointerDown(event: PointerEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const dotColor = statusCssColor(menu.statusCode);
  // D8: ademas del rechazo silencioso del servidor, el cliente deshabilita
  // "Llamar" cuando el companero esta en No molestar.
  const callDisabled = menu.statusCode === DO_NOT_DISTURB;

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: menu.x, top: menu.y }}
    >
      <div className={styles.header}>
        <span className={styles.statusDot} style={{ background: dotColor }} />
        {menu.name}
        <span className={styles.statusText}>{menu.status}</span>
      </div>
      <button
        type="button"
        className={styles.action}
        disabled={callDisabled}
        title={callDisabled ? 'No molestar: no se puede llamar ahora' : undefined}
        onClick={() => onAction('call', menu)}
      >
        📞 Llamar
      </button>
      <button type="button" className={styles.action} onClick={() => onAction('profile', menu)}>
        👤 Ver perfil
      </button>
    </div>
  );
}
