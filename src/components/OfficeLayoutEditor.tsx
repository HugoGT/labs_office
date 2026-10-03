import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { CollisionAdminPort } from '../dashboard/collisionAdminPort';
import { CollisionEditorSection } from './CollisionEditorSection';
import type { OfficeBridge } from '../game/officeBridge';
import { DeskEditorSection } from './DeskEditorSection';
import { SpaceEditorSection } from './SpaceEditorSection';
import { TerrainEditorSection } from './TerrainEditorSection';

/**
 * Contenedor del editor de layout en el sidebar (#74, PR3c + PR4). Es la
 * FRONTERA `React.lazy` (design decision "Admin code loading"): `OfficeSidebar`
 * lo carga con `import()` diferido para que quien no administra nunca
 * descargue este subarbol. Monta `DeskEditorSection` Y `SpaceEditorSection`
 * juntas -- la una AL LADO de la otra, no reemplazandola (nota de PR3c) --
 * como dos secciones independientes, cada una con su propio "off"/reductor
 * (`useLayoutEditor.ts`/`useSpaceEditor.ts` son instancias separadas: no hay
 * un unico reductor compartido, ver el deviation note de esta PR).
 *
 * Export por defecto a proposito: es lo que `React.lazy` espera, mismo
 * criterio que `DashboardRoute.tsx`.
 *
 * ## Exclusividad escritorios<->salas (#74, PR4 correction)
 *
 * Las dos secciones son reductores SEPARADOS que emiten al MISMO overlay
 * (`LayoutEditLayer`, un unico `bridge.emitCommand('layoutedit', ...)`): sin
 * nada que lo impida, las dos podian entrar a la vez y "quien emite ultimo
 * gana" -- el `null` de una al salir podia apagar el overlay que la otra
 * seguia usando. `activeSection` es la unica fuente de verdad de "cual, si
 * alguna" -- mismo patron rising-edge que `forceExitLayoutEditing` (decor),
 * pero ADEMAS envuelto en `flushSync`: sin eso, el `exit()` de la seccion
 * saliente (disparado por su propio efecto de `forceExit`, no por el mismo
 * dispatch sincrono que el `enter()` de la entrante) siempre aterriza UN
 * render despues -- su `null` llegaria SIEMPRE despues del comando nuevo,
 * jamas antes, sin importar el orden en el JSX. `flushSync` fuerza a que ese
 * `exit()` -- y el `null` que su propio efecto emite -- se resuelva del todo
 * ANTES de que el `enter()` de la seccion entrante se dispare siquiera.
 */

export interface OfficeLayoutEditorProps {
  bridge: OfficeBridge;
  desks: DeskAdminPort;
  spaces: SpacesAdminPort;
  /**
   * The terrain editor (#123 phase 2), a third section under the same
   * exclusivity: it holds the same map clicks. Absent or `null`, not offered.
   */
  terrain?: TerrainAdminPort | null;
  /** The collision editor, a fourth section under the same exclusivity. Absent or `null`, not offered. */
  collisions?: CollisionAdminPort | null;
  refreshDesks: () => void;
  refreshSpaces: () => void;
  onEditingChange?: (editing: boolean) => void;
  forceExit?: boolean;
}

type LayoutEditorSection = 'desk' | 'room' | 'terrain' | 'collision';

export default function OfficeLayoutEditor({
  bridge,
  desks,
  spaces,
  terrain,
  collisions,
  refreshDesks,
  refreshSpaces,
  onEditingChange,
  forceExit,
}: OfficeLayoutEditorProps) {
  // Cada seccion reporta SU PROPIO off<->activo; "editando" para quien nos
  // contiene (mismo consumidor final que "cierra `DeskDecorEditor`") es
  // "cualquiera de las dos lo esta", no solo escritorios.
  const [deskEditing, setDeskEditing] = useState(false);
  const [spaceEditing, setSpaceEditing] = useState(false);
  const [terrainEditing, setTerrainEditing] = useState(false);
  const [collisionEditing, setCollisionEditing] = useState(false);
  // Cual seccion, si alguna, tiene derecho al overlay compartido ahora mismo
  // -- ver la nota de cabecera "Exclusividad escritorios<->salas".
  const [activeSection, setActiveSection] = useState<LayoutEditorSection | null>(null);

  const handleDeskEditingChange = useCallback(
    (editing: boolean) => {
      setDeskEditing(editing);
      onEditingChange?.(editing || spaceEditing || terrainEditing || collisionEditing);
    },
    [onEditingChange, spaceEditing, terrainEditing, collisionEditing],
  );

  const handleSpaceEditingChange = useCallback(
    (editing: boolean) => {
      setSpaceEditing(editing);
      onEditingChange?.(editing || deskEditing || terrainEditing || collisionEditing);
    },
    [onEditingChange, deskEditing, terrainEditing, collisionEditing],
  );

  const handleTerrainEditingChange = useCallback(
    (editing: boolean) => {
      setTerrainEditing(editing);
      onEditingChange?.(editing || deskEditing || spaceEditing || collisionEditing);
    },
    [onEditingChange, deskEditing, spaceEditing, collisionEditing],
  );

  const handleCollisionEditingChange = useCallback(
    (editing: boolean) => {
      setCollisionEditing(editing);
      onEditingChange?.(editing || deskEditing || spaceEditing || terrainEditing);
    },
    [onEditingChange, deskEditing, spaceEditing, terrainEditing],
  );

  // Cada seccion pide "activarme" ANTES de dispararse a si misma un `enter`
  // (ver `handleEnter` en `DeskEditorSection.tsx`/`SpaceEditorSection.tsx`).
  // `flushSync` es lo que garantiza el orden -- ver la nota de cabecera.
  const requestActive = useCallback((section: LayoutEditorSection) => {
    flushSync(() => setActiveSection(section));
  }, []);

  // Autocorreccion: si la seccion que `activeSection` sigue senalando como
  // activa sale por SU CUENTA -- su propio "Salir", o el `forceExit` externo
  // de `DeskDecorEditor` -- hay que soltarla tambien. Sin esto se quedaria
  // forzando para siempre la salida de la OTRA seccion aunque ya no hubiese
  // nada activo.
  useEffect(() => {
    if (activeSection === 'desk' && !deskEditing) setActiveSection(null);
  }, [activeSection, deskEditing]);
  useEffect(() => {
    if (activeSection === 'room' && !spaceEditing) setActiveSection(null);
  }, [activeSection, spaceEditing]);
  useEffect(() => {
    if (activeSection === 'terrain' && !terrainEditing) setActiveSection(null);
  }, [activeSection, terrainEditing]);
  useEffect(() => {
    if (activeSection === 'collision' && !collisionEditing) setActiveSection(null);
  }, [activeSection, collisionEditing]);

  /** Another section holds the map: this one has to leave. */
  const othersActive = (section: LayoutEditorSection): boolean => activeSection !== null && activeSection !== section;

  return (
    <>
      <DeskEditorSection
        bridge={bridge}
        desks={desks}
        spaces={spaces}
        refreshDesks={refreshDesks}
        refreshSpaces={refreshSpaces}
        onEditingChange={handleDeskEditingChange}
        forceExit={(forceExit ?? false) || othersActive('desk')}
        onRequestActive={() => requestActive('desk')}
      />
      <SpaceEditorSection
        bridge={bridge}
        spaces={spaces}
        desks={desks}
        refreshDesks={refreshDesks}
        refreshSpaces={refreshSpaces}
        onEditingChange={handleSpaceEditingChange}
        forceExit={(forceExit ?? false) || othersActive('room')}
        onRequestActive={() => requestActive('room')}
      />
      {terrain !== undefined && terrain !== null && (
        <TerrainEditorSection
          bridge={bridge}
          terrain={terrain}
          onEditingChange={handleTerrainEditingChange}
          forceExit={(forceExit ?? false) || othersActive('terrain')}
          onRequestActive={() => requestActive('terrain')}
        />
      )}
      {collisions !== undefined && collisions !== null && (
        <CollisionEditorSection
          bridge={bridge}
          collisions={collisions}
          onEditingChange={handleCollisionEditingChange}
          forceExit={(forceExit ?? false) || othersActive('collision')}
          onRequestActive={() => requestActive('collision')}
        />
      )}
    </>
  );
}
