import { lazy, Suspense, useEffect, useState } from 'react';
import type { Role } from '../dashboard/adminPort';
import type { AssetAdminPort } from '../dashboard/assetAdminPort';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { SIDEBAR_TOP } from '../game/hudLayout';
import type { OfficeBridge } from '../game/officeBridge';
import { statusCssColor } from '../game/presence';
import type { RosterPeer } from '../game/roster';
import { MiEspacioPanel } from './MiEspacioPanel';
import { visibleRoster } from './rosterView';
import styles from './OfficeSidebar.module.css';

/**
 * Frontera `React.lazy` (#74, PR3c): definida a nivel de modulo y no dentro
 * del componente, para que no se reconstruya -- y por tanto no se vuelva a
 * cargar -- en cada render. Quien no administra nunca descarga este chunk.
 */
const OfficeLayoutEditorLazy = lazy(() => import('./OfficeLayoutEditor'));

/**
 * Migrado desde el dashboard (`DashboardRoute.tsx`): el catalogo de
 * decoracion es una pieza de "Personalizar" ahora, no del panel `/dashboard`.
 * `React.lazy` con el mismo motivo que `OfficeLayoutEditorLazy` -- quien no
 * administra nunca descarga este chunk -- y el `.then` porque `AssetsPanel`
 * es una exportacion nombrada, no la que `React.lazy` espera por defecto.
 */
const AssetsPanelLazy = lazy(() =>
  import('../dashboard/AssetsPanel').then((assetsModule) => ({ default: assetsModule.AssetsPanel })),
);

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
  /** Salas admin (#74, PR4): sin esto tampoco se monta nada de edicion, aunque `desks` este presente -- ambas secciones comparten la misma frontera lazy. */
  spaces?: SpacesAdminPort | null;
  refreshDesks?: () => void;
  refreshSpaces?: () => void;
  /** Reenviado tal cual a `OfficeLayoutEditor` (#74, PR3c: exclusividad con `DeskDecorEditor`). */
  onLayoutEditingChange?: (editing: boolean) => void;
  forceExitLayoutEditing?: boolean;
  /**
   * Catalogo de decoracion, migrado desde el dashboard a "Personalizar".
   * `undefined`/`null` -- sin servidor configurado, mismo criterio que
   * `desks`/`spaces` -- simplemente deja sin montar esa seccion, aunque el
   * rol si administre.
   */
  assets?: AssetAdminPort | null;
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
  spaces,
  refreshDesks,
  refreshSpaces,
  onLayoutEditingChange,
  forceExitLayoutEditing,
  assets,
}: OfficeSidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  // "Personalizar" (migracion de la edicion de layout + catalogo, mas "Mi
  // espacio"): panel INDEPENDIENTE del roster, con su propio expandir/colapsar
  // -- mismo patron, distinto estado, para que abrir uno nunca cierre el otro.
  const [personalizing, setPersonalizing] = useState(false);

  useEffect(() => {
    if (forceCollapsed) {
      setExpanded(false);
      setPersonalizing(false);
    }
  }, [forceCollapsed]);

  const visible = visibleRoster(self, peers, query);
  const canAdminister =
    (role === 'admin' || role === 'superadmin') &&
    bridge !== undefined &&
    desks !== undefined &&
    desks !== null &&
    spaces !== undefined &&
    spaces !== null &&
    refreshDesks !== undefined &&
    refreshSpaces !== undefined;

  return (
    <div
      role="complementary"
      aria-label="Personas"
      className={expanded ? `${styles.sidebar} ${styles.expanded}` : styles.sidebar}
      style={{
        position: 'fixed',
        top: SIDEBAR_TOP,
        zIndex: 15,
      }}
    >
      {/*
       * Entre el minimapa (renderizado por Phaser, arriba de este contenedor
       * via `SIDEBAR_TOP`) y "Personas conectadas": quien administra elige
       * entre escritorios/salas/catalogo/"Mi espacio"; quien no, no tiene
       * nada que elegir y activarlo va derecho a "Mi espacio" -- un solo
       * `personalizing` para ambos casos, la diferencia esta en el CONTENIDO.
       */}
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={personalizing}
        onClick={() => setPersonalizing((current) => !current)}
      >
        🎨 Personalizar
      </button>
      {personalizing && (
        <div className={styles.panel}>
          <button
            type="button"
            className={styles.close}
            aria-label="Cerrar"
            title="Cerrar"
            onClick={() => setPersonalizing(false)}
          >
            ×
          </button>
          {canAdminister && (
            <Suspense fallback={null}>
              <OfficeLayoutEditorLazy
                bridge={bridge}
                desks={desks}
                spaces={spaces}
                refreshDesks={refreshDesks}
                refreshSpaces={refreshSpaces}
                onEditingChange={onLayoutEditingChange}
                forceExit={forceExitLayoutEditing}
              />
            </Suspense>
          )}
          {/* `assets` narrowed inline (no variable de por medio) para que
              TypeScript sepa, en este mismo bloque, que ya no es `null`/`undefined`. */}
          {canAdminister && assets !== undefined && assets !== null && (
            <Suspense fallback={null}>
              <AssetsPanelLazy assets={assets} />
            </Suspense>
          )}
          <MiEspacioPanel />
        </div>
      )}
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        👥 Personas conectadas ({peers.length + 1})
      </button>
      {expanded && (
        <div className={styles.panel}>
          {/* Only shown by CSS on very small screens, where the open sidebar
              covers the whole screen and the toggle alone is easy to miss (#86). */}
          <button
            type="button"
            className={styles.close}
            aria-label="Cerrar"
            title="Cerrar"
            onClick={() => setExpanded(false)}
          >
            ×
          </button>
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
                {/* Mismo lenguaje visual que `BottomBar.meDot`: un punto de
                    color, no el emoji del selector -- las dos superficies que
                    muestran el estado a la izquierda del nombre deben verse
                    igual. */}
                <span className={styles.personDot} style={{ background: statusCssColor(person.status) }} />
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
