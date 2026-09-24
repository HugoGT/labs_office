import { useEffect, useState } from 'react';
import { SIDEBAR_TOP } from '../game/hudLayout';
import type { RosterPeer } from '../game/roster';
import { STATUS_EMOJI } from '../game/presence';
import { visibleRoster } from './rosterView';
import styles from './OfficeSidebar.module.css';

export interface OfficeSidebarProps {
  /** Uno mismo, para anteponerlo (#74): el `roster` del puente ya lo excluye. */
  self: RosterPeer;
  peers: readonly RosterPeer[];
  /**
   * Se activa cuando otra pieza del HUD reclama el rincon (`DeskDecorEditor`,
   * #74, PR2). Un flanco a `true` colapsa; volver a abrirla queda a mano del
   * usuario, no bloqueada mientras siga en `true`.
   */
  forceCollapsed?: boolean;
}

/**
 * Barra lateral colapsable con el roster en vivo (#74). Presentacional: no
 * conoce el puente, solo la lista ya resuelta por `useRoster` y a uno mismo,
 * que le llegan por props desde `OfficeShell` (mismo patron que `BottomBar`).
 *
 * La geometria fija (`position: fixed`, `top`/`bottom`/`width`/`z-index`) vive
 * SIEMPRE en el contenedor exterior, este o no expandida: lo unico que cambia
 * al colapsar es que el panel con el buscador y la lista deja de montarse.
 */
export function OfficeSidebar({ self, peers, forceCollapsed = false }: OfficeSidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (forceCollapsed) setExpanded(false);
  }, [forceCollapsed]);

  const visible = visibleRoster(self, peers, query);

  return (
    <div
      role="complementary"
      aria-label="Personas"
      className={styles.sidebar}
      style={{
        position: 'fixed',
        top: SIDEBAR_TOP,
        bottom: 72,
        width: 280,
        zIndex: 15,
      }}
    >
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        👥 Personas{expanded ? '' : ` (${peers.length + 1})`}
      </button>
      {expanded && (
        <div className={styles.panel}>
          <input
            type="search"
            className={styles.search}
            placeholder="Buscar por nombre..."
            aria-label="Buscar personas"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className={styles.list}>
            {visible.map((person) => (
              <li key={person.sessionId} className={styles.entry}>
                <span>{STATUS_EMOJI[person.status]}</span>
                <span className={person.isSelf ? styles.self : undefined}>
                  {person.name}
                  {person.isSelf ? ' (tú)' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
