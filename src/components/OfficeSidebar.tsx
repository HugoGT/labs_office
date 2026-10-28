import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { CharacterPort } from '../auth/characterPort';
import type { Role } from '../dashboard/adminPort';
import type { ArtContributionPort } from '../dashboard/artContributionPort';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { CollisionAdminPort } from '../dashboard/collisionAdminPort';
import type { LayoutEditorSection } from './OfficeLayoutEditor';
import { SIDEBAR_TOP } from '../game/hudLayout';
import type { OfficeBridge } from '../game/officeBridge';
import type { DecorTileRect } from '../game/officeDecor';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import { DO_NOT_DISTURB } from '../game/officeProtocol';
import { statusCssColor } from '../game/presence';
import type { RosterPeer } from '../game/roster';
import { CALL_DISABLED_TITLE } from './ContextMenu';
import { DecorEditorSection } from './DecorEditorSection';
import { PhoneIcon } from './PhoneIcon';
import { visibleRoster } from './rosterView';
import styles from './OfficeSidebar.module.css';

/**
 * Frontera `React.lazy` (#74, PR3c): definida a nivel de modulo y no dentro
 * del componente, para que no se reconstruya -- y por tanto no se vuelva a
 * cargar -- en cada render. Quien no administra nunca descarga este chunk.
 */
const OfficeLayoutEditorLazy = lazy(() => import('./OfficeLayoutEditor'));

/** Art contributions (#122): lazy for the same reason, nobody pays for it until "Personalizar" opens. */
const ArtContributionSectionLazy = lazy(() =>
  import('./ArtContributionSection').then((sectionModule) => ({ default: sectionModule.ArtContributionSection })),
);

/** "Mi personaje": the entrance's creator again, lazy like the others until someone opens it. */
const MyCharacterSectionLazy = lazy(() =>
  import('./MyCharacterSection').then((sectionModule) => ({ default: sectionModule.MyCharacterSection })),
);

type PersonalizeSection = LayoutEditorSection | 'art' | 'character';

/** What "Decoración" edits for whoever does not administer: the own desk (#208). */
export interface MySpace {
  /** The claimed desk's area in tiles, what the editor may touch; `null` without one. */
  area: DecorTileRect | null;
  /** `POST /me/decor`; without it (no server) there is nothing to write to. */
  decor?: OfficeDecorPort | null;
  /** Releases the desk, the same way as the desk banner's "Dejar escritorio". */
  onLeaveDesk?: () => void;
}

/**
 * Opens "Personalizar" on one section from outside (the desk banner's "Mi
 * personaje" and "Decorar"). A new `seq` is a new request, so the same
 * section opens again after it was closed.
 */
export interface SidebarOpenRequest {
  section: 'character' | 'decor';
  seq: number;
}

/** Without a server: no desk to decorate. */
const NO_SPACE: MySpace = { area: null };

/** Never called: a desk-scoped editor without a port has no desk to edit, so it never enters. */
const NO_DECOR_PORT: OfficeDecorPort = { setDecor: async () => undefined };

export interface OfficeSidebarProps {
  /** Uno mismo, para anteponerlo (#74): el `roster` del puente ya lo excluye. */
  self: RosterPeer;
  peers: readonly RosterPeer[];
  /**
   * Se activa cuando otra pieza del HUD reclama el rincon (#74, PR2). Un
   * flanco a `true` colapsa; volver a abrirla queda a mano del usuario, no
   * bloqueada mientras siga en `true`.
   */
  forceCollapsed?: boolean;
  /**
   * What "Decoración" edits for whoever does not administer: the decor on
   * one's own desk (#208) and the way to leave it. Absent (no server, the
   * open office) it asks to claim a desk, which there is no way to do there
   * either. The bridge is the sidebar's.
   */
  mySpace?: MySpace;
  /** Every desk area in tiles, for the desk rules of "Decoración" (`deskDecorRules.ts`). */
  deskAreas?: readonly DecorTileRect[];
  /** Every room area in tiles, outlined while an admin edits the decor or the terrain (#216). */
  roomAreas?: readonly DecorTileRect[];
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
  /** The office decor layer for "Decoración" (#208, `POST /admin/decor`): optional like `terrain`. */
  decor?: OfficeDecorPort | null;
  refreshDesks?: () => void;
  refreshSpaces?: () => void;
  /** Reenviado tal cual a `OfficeLayoutEditor` (#74, PR3c: exclusividad con `DeskDecorEditor`). */
  onLayoutEditingChange?: (editing: boolean) => void;
  forceExitLayoutEditing?: boolean;
  /**
   * Contributing art (#122), for anyone signed in, admin or not.
   * `undefined`/`null` (no server, or the open office without a session)
   * leaves the section out.
   */
  contributions?: ArtContributionPort | null;
  /**
   * Editing one's own character ("Mi personaje"), for anyone signed in: the
   * entrance's port. `undefined`/`null` (no server, or no session) leaves it out.
   */
  character?: CharacterPort | null;
  /**
   * Calls a person from "Personas conectadas" (#187), the same request as the
   * context menu's "Llamar". Without it the list offers no calls.
   */
  onCallPeer?: (sessionId: string, name: string) => void;
  /** Opens a section of "Personalizar" on each new request. */
  openRequest?: SidebarOpenRequest | null;
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
  mySpace = NO_SPACE,
  deskAreas,
  roomAreas,
  role = null,
  bridge,
  desks,
  spaces,
  terrain,
  collisions,
  decor,
  refreshDesks,
  refreshSpaces,
  onLayoutEditingChange,
  forceExitLayoutEditing,
  contributions,
  character,
  onCallPeer,
  openRequest = null,
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
      setSection((current) => (current === 'decor' && officeDecor) || current === 'spaces' || current === 'terrain' || current === 'collision' ? null : current);
    }
  }, [forceExitLayoutEditing]);

  useEffect(() => {
    if (openRequest === null) return;
    setOpenPanel('personalize');
    setSection(openRequest.section);
  }, [openRequest]);

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

  // "Decoración" is one menu for everyone (#208): the whole map for an admin
  // with the decor port, the claimed desk for anyone else.
  const officeDecor = canAdminister && decor !== undefined && decor !== null;
  const entries: { section: PersonalizeSection; label: string }[] = [
    // First: laying out tables and chairs is what desks are then created on top of.
    ...(bridge !== undefined ? [{ section: 'decor' as const, label: 'Decoración' }] : []),
    ...(canAdminister ? [
      { section: 'spaces' as const, label: 'Editar espacios' },
      ...(terrain ? [{ section: 'terrain' as const, label: 'Editar terreno' }] : []),
      ...(collisions ? [{ section: 'collision' as const, label: 'Editar colisiones' }] : []),
    ] : []),
    ...(character ? [{ section: 'character' as const, label: 'Mi personaje' }] : []),
    ...(contributions ? [{ section: 'art' as const, label: 'Aportar arte' }] : []),
  ];
  const available = section === null || entries.some((entry) => entry.section === section);
  // Drop unavailable selections immediately, not just hide them until a port returns.
  if (!available) setSection(null);
  const currentSection = available ? section : null;
  const layoutSection = (currentSection === 'decor' && officeDecor) || currentSection === 'spaces' || currentSection === 'terrain' || currentSection === 'collision'
    ? currentSection : null;
  /** The own desk's "Decoración": its own header and Escape steps, but it never holds the desks. */
  const deskDecor = currentSection === 'decor' && !officeDecor;

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
    if (openPanel === null || layoutSection !== null || deskDecor) return undefined;
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
  }, [openPanel, layoutSection, deskDecor]);

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
          {currentSection !== null && layoutSection === null && !deskDecor && (
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
                decor={decor}
                deskAreas={deskAreas}
                roomAreas={roomAreas}
                refreshDesks={refreshDesks}
                refreshSpaces={refreshSpaces}
                onEditingChange={onLayoutEditingChange}
              />
            </Suspense>
          )}
          {deskDecor && bridge !== undefined && (
            <DecorEditorSection
              bridge={bridge}
              decor={mySpace.decor ?? NO_DECOR_PORT}
              scope="desk"
              area={mySpace.decor == null ? null : mySpace.area}
              desks={deskAreas}
              onLeaveDesk={mySpace.onLeaveDesk}
              onExit={() => setSection(null)}
            />
          )}
          {currentSection === 'character' && character !== undefined && character !== null && (
            <Suspense fallback={null}>
              <MyCharacterSectionLazy character={character} onClose={() => setSection(null)} />
            </Suspense>
          )}
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
