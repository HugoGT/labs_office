import { useEffect, useRef } from 'react';
import type { OfficeEventMap } from '../game/officeBridge';
import { DO_NOT_DISTURB } from '../game/officeProtocol';
import { statusCssColor } from '../game/presence';
import styles from './ContextMenu.module.css';

export type NpcMenuAction = 'call' | 'goto' | 'profile';

export interface ContextMenuProps {
  menu: OfficeEventMap['npcmenu'] | null;
  onAction: (action: NpcMenuAction, menu: OfficeEventMap['npcmenu']) => void;
  onClose: () => void;
}

/**
 * Menu contextual al hacer clic en un NPC, portado de `#ctxmenu`
 * (`index.html`, `app.js:474-486,588-608`). Se cierra con Escape o un clic
 * fuera de si mismo; ninguna accion abre una llamada/perfil real todavia
 * (`call`/`profile` solo notifican via toast, `goto` teletransporta).
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
  const isPeer = menu.target.kind === 'peer';
  // D2: un peer real no tiene escritorio -- "Ir a su escritorio" es
  // exclusivamente de NPC. D8: ademas del rechazo silencioso del servidor,
  // el cliente deshabilita "Llamar" cuando el peer esta en No molestar; un
  // NPC nunca esta en `r` en la practica, pero la regla es la misma union.
  const callDisabled = isPeer && menu.statusCode === DO_NOT_DISTURB;

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
      {!isPeer && (
        <button type="button" className={styles.action} onClick={() => onAction('goto', menu)}>
          🚶 Ir a su escritorio
        </button>
      )}
      <button type="button" className={styles.action} onClick={() => onAction('profile', menu)}>
        👤 Ver perfil
      </button>
    </div>
  );
}
