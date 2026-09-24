import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import { DeskEditorSection } from './DeskEditorSection';
import { SpaceEditorSection } from './SpaceEditorSection';

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
  refreshDesks: () => void;
  refreshSpaces: () => void;
  onEditingChange?: (editing: boolean) => void;
  forceExit?: boolean;
}

type LayoutEditorSection = 'desk' | 'room';

export default function OfficeLayoutEditor({
  bridge,
  desks,
  spaces,
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
  // Cual seccion, si alguna, tiene derecho al overlay compartido ahora mismo
  // -- ver la nota de cabecera "Exclusividad escritorios<->salas".
  const [activeSection, setActiveSection] = useState<LayoutEditorSection | null>(null);

  const handleDeskEditingChange = useCallback(
    (editing: boolean) => {
      setDeskEditing(editing);
      onEditingChange?.(editing || spaceEditing);
    },
    [onEditingChange, spaceEditing],
  );

  const handleSpaceEditingChange = useCallback(
    (editing: boolean) => {
      setSpaceEditing(editing);
      onEditingChange?.(editing || deskEditing);
    },
    [onEditingChange, deskEditing],
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

  return (
    <>
      <DeskEditorSection
        bridge={bridge}
        desks={desks}
        spaces={spaces}
        refreshDesks={refreshDesks}
        refreshSpaces={refreshSpaces}
        onEditingChange={handleDeskEditingChange}
        forceExit={(forceExit ?? false) || activeSection === 'room'}
        onRequestActive={() => requestActive('desk')}
      />
      <SpaceEditorSection
        bridge={bridge}
        spaces={spaces}
        desks={desks}
        refreshDesks={refreshDesks}
        refreshSpaces={refreshSpaces}
        onEditingChange={handleSpaceEditingChange}
        forceExit={(forceExit ?? false) || activeSection === 'desk'}
        onRequestActive={() => requestActive('room')}
      />
    </>
  );
}
