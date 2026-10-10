import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Role } from '../dashboard/adminPort';
import type { ArtContributionPort } from '../dashboard/artContributionPort';
import type { AssetAdminPort } from '../dashboard/assetAdminPort';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { CollisionAdminPort } from '../dashboard/collisionAdminPort';
import type { LayoutEditorSection } from './OfficeLayoutEditor';
import { SIDEBAR_TOP } from '../game/hudLayout';
import type { OfficeBridge } from '../game/officeBridge';
import { DO_NOT_DISTURB } from '../game/officeProtocol';
import { statusCssColor } from '../game/presence';
import type { RosterPeer } from '../game/roster';
import { CALL_DISABLED_TITLE } from './ContextMenu';
import { MiEspacioPanel } from './MiEspacioPanel';
import { PhoneIcon } from './PhoneIcon';
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

/** Art contributions (#122): lazy for the same reason, nobody pays for it until "Personalizar" opens. */
const ArtContributionSectionLazy = lazy(() =>
  import('./ArtContributionSection').then((sectionModule) => ({ default: sectionModule.ArtContributionSection })),
);

type PersonalizeSection = LayoutEditorSection | 'assets' | 'space' | 'art';

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
  /** Terrain blocks (#123 phase 2): optional inside the layout editor, which mounts without it. */
  terrain?: TerrainAdminPort | null;
  /** Collision areas per piece: optional inside the layout editor, like `terrain`. */
  collisions?: CollisionAdminPort | null;
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
  /**
   * Contributing art (#122), for anyone signed in, admin or not.
   * `undefined`/`null` (no server, or the open office without a session)
   * leaves the section out.
   */
  contributions?: ArtContributionPort | null;
  /**
   * Calls a person from "Personas conectadas" (#187), the same request as the
   * context menu's "Llamar". Without it the list offers no calls.
   */
  onCallPeer?: (sessionId: string, name: string) => void;
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
  terrain,
  collisions,
  refreshDesks,
  refreshSpaces,
  onLayoutEditingChange,
  forceExitLayoutEditing,
  assets,
  contributions,
  onCallPeer,
}: OfficeSidebarProps) {
  const [openPanel, setOpenPanel] = useState<'personalize' | 'people' | null>(null);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<PersonalizeSection | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const personalizeToggleRef = useRef<HTMLButtonElement>(null);
  const peopleToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (forceCollapsed) {
      setOpenPanel(null);
      setSection(null);
    }
  }, [forceCollapsed]);

  useEffect(() => {
    if (forceExitLayoutEditing) {
      // A rising edge gives the map to another editor without trapping navigation.
      setSection((current) => current === 'desk' || current === 'room' || current === 'terrain' || current === 'collision' ? null : current);
    }
  }, [forceExitLayoutEditing]);

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

  const entries: { section: PersonalizeSection; label: string }[] = [
    ...(canAdminister ? [
      { section: 'desk' as const, label: 'Editar escritorios' },
      { section: 'room' as const, label: 'Editar salas' },
      ...(terrain ? [{ section: 'terrain' as const, label: 'Editar terreno' }] : []),
      ...(collisions ? [{ section: 'collision' as const, label: 'Editar colisiones' }] : []),
      ...(assets ? [{ section: 'assets' as const, label: 'Catálogo de decoración' }] : []),
    ] : []),
    { section: 'space', label: 'Mi espacio' },
    ...(contributions ? [{ section: 'art' as const, label: 'Aportar arte' }] : []),
  ];
  const available = section === null || entries.some((entry) => entry.section === section);
  // Drop unavailable selections immediately, not just hide them until a port returns.
  if (!available) setSection(null);
  const currentSection = available ? section : null;
  const layoutSection = currentSection === 'desk' || currentSection === 'room' || currentSection === 'terrain' || currentSection === 'collision'
    ? currentSection : null;

  function togglePanel(panel: 'personalize' | 'people'): void {
    setSection(null);
    setOpenPanel((current) => current === panel ? null : panel);
  }

  function closePanel(): void {
    setOpenPanel(null);
    setSection(null);
  }

  useEffect(() => {
    // A map editor owns Escape while it holds the map (a picked brush, a draft).
    if (openPanel === null || layoutSection !== null) return undefined;
    const toggle = openPanel === 'people' ? peopleToggleRef : personalizeToggleRef;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Focus inside the closing panel would be lost with it; elsewhere (the map) it stays put.
      const hadFocus = rootRef.current?.contains(document.activeElement) ?? false;
      setOpenPanel(null);
      setSection(null);
      if (hadFocus) toggle.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openPanel, layoutSection]);

  return (
    <div
      ref={rootRef}
      role="complementary"
      aria-label="Personas"
      className={openPanel !== null ? `${styles.sidebar} ${styles.expanded}` : styles.sidebar}
      style={{
        position: 'fixed',
        top: SIDEBAR_TOP,
        zIndex: 15,
      }}
    >
      <button
        ref={personalizeToggleRef}
        type="button"
        className={styles.toggle}
        aria-expanded={openPanel === 'personalize'}
        onClick={() => togglePanel('personalize')}
      >
        🎨 Personalizar
      </button>
      {openPanel === 'personalize' && (
        <div className={styles.panel} role="region" aria-label="Personalizar">
          <button
            type="button"
            className={styles.close}
            aria-label="Cerrar"
            title="Cerrar"
            onClick={closePanel}
          >
            ×
          </button>
          {currentSection === null && entries.map((entry) => (
            <button key={entry.section} type="button" className={styles.menuEntry} onClick={() => setSection(entry.section)}>
              {entry.label}
            </button>
          ))}
          {currentSection !== null && layoutSection === null && (
            <button type="button" className={styles.back} onClick={() => setSection(null)}>
              Salir
            </button>
          )}
          {canAdminister && layoutSection !== null && (
            <Suspense fallback={null}>
              <OfficeLayoutEditorLazy
                section={layoutSection}
                onExit={() => setSection(null)}
                bridge={bridge}
                desks={desks}
                spaces={spaces}
                terrain={terrain}
                collisions={collisions}
                refreshDesks={refreshDesks}
                refreshSpaces={refreshSpaces}
                onEditingChange={onLayoutEditingChange}
              />
            </Suspense>
          )}
          {currentSection === 'assets' && canAdminister && assets !== undefined && assets !== null && (
            <Suspense fallback={null}>
              <AssetsPanelLazy assets={assets} />
            </Suspense>
          )}
          {currentSection === 'space' && <MiEspacioPanel />}
          {currentSection === 'art' && contributions !== undefined && contributions !== null && (
            <Suspense fallback={null}>
              <ArtContributionSectionLazy contributions={contributions} />
            </Suspense>
          )}
        </div>
      )}
      <button
        ref={peopleToggleRef}
        type="button"
        className={styles.toggle}
        aria-expanded={openPanel === 'people'}
        onClick={() => togglePanel('people')}
      >
        👥 Personas conectadas ({peers.length + 1})
      </button>
      {openPanel === 'people' && (
        <div className={styles.panel}>
          {/* Only shown by CSS on very small screens, where the open sidebar
              covers the whole screen and the toggle alone is easy to miss (#86). */}
          <button
            type="button"
            className={styles.close}
            aria-label="Cerrar"
            title="Cerrar"
            onClick={closePanel}
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
                <span className={person.isSelf ? `${styles.name} ${styles.self}` : styles.name}>
                  {person.name}
                  {person.isSelf ? ' (tú)' : ''}
                </span>
                {!person.isSelf && onCallPeer !== undefined && (
                  <button
                    type="button"
                    className={styles.call}
                    aria-label={`Llamar a ${person.name}`}
                    // Same D8 rule as the context menu: the server would drop it anyway.
                    disabled={person.status === DO_NOT_DISTURB}
                    title={person.status === DO_NOT_DISTURB ? CALL_DISABLED_TITLE : `Llamar a ${person.name}`}
                    onClick={() => onCallPeer(person.sessionId, person.name)}
                  >
                    <PhoneIcon />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
