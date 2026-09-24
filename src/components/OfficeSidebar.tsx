import { lazy, Suspense, useEffect, useState } from 'react';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { Role } from '../dashboard/adminPort';
import { SIDEBAR_TOP } from '../game/hudLayout';
import type { OfficeBridge } from '../game/officeBridge';
import type { RosterPeer } from '../game/roster';
import { STATUS_EMOJI } from '../game/presence';
import { visibleRoster } from './rosterView';
import styles from './OfficeSidebar.module.css';

/**
 * Frontera `React.lazy` (#74, PR3c): definida a nivel de modulo y no dentro
 * del componente, para que no se reconstruya -- y por tanto no se vuelva a
 * cargar -- en cada render. Quien no administra nunca descarga este chunk.
 */
const OfficeLayoutEditorLazy = lazy(() => import('./OfficeLayoutEditor'));

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
  /**
   * Rol de sesion (#74, PR3c), resuelto por `OfficeShell` via
   * `useOfficeAdminRole` y pasado por prop -- este componente sigue sin
   * conocer el puerto de administracion, mismo D3 que el resto del HUD.
   * `null` u `'employee'`/`'guest'` no ofrecen nada de edicion.
   */
  role?: Role | null;
  /**
   * Solo se usan si `role` es `admin`/`superadmin`: sin ellos no se monta la
   * seccion de edicion, aunque el rol lo permita -- defensivo, nunca deberia
   * ocurrir en la app real (`OfficeShell` los construye juntos).
   */
  bridge?: OfficeBridge;
  desks?: DeskAdminPort | null;
  refreshDesks?: () => void;
  refreshSpaces?: () => void;
  /** Reenviado tal cual a `OfficeLayoutEditor` (#74, PR3c: exclusividad con `DeskDecorEditor`). */
  onLayoutEditingChange?: (editing: boolean) => void;
  forceExitLayoutEditing?: boolean;
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
export function OfficeSidebar({
  self,
  peers,
  forceCollapsed = false,
  role = null,
  bridge,
  desks,
  refreshDesks,
  refreshSpaces,
  onLayoutEditingChange,
  forceExitLayoutEditing,
}: OfficeSidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (forceCollapsed) setExpanded(false);
  }, [forceCollapsed]);

  const visible = visibleRoster(self, peers, query);
  const canAdminister =
    (role === 'admin' || role === 'superadmin') &&
    bridge !== undefined &&
    desks !== undefined &&
    desks !== null &&
    refreshDesks !== undefined &&
    refreshSpaces !== undefined;

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
          {canAdminister && (
            <Suspense fallback={null}>
              <OfficeLayoutEditorLazy
                bridge={bridge}
                desks={desks}
                refreshDesks={refreshDesks}
                refreshSpaces={refreshSpaces}
                onEditingChange={onLayoutEditingChange}
                forceExit={forceExitLayoutEditing}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
